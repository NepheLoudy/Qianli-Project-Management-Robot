const fs = require('fs');
const path = require('path');
const config = require('../config');
const keywordService = require('./keywordService');
const dutyPolicy = require('./dutyPolicyService');
const bot = require('../feishu/bot');

// 两张本地回答表（同一份「关键词回答表.xlsx」的两个工作表，由 scripts/syncAutoReplies.js 生成）：
//   group   「关键词回答」：未@机器人的群消息命中即回（群里 @机器人 时作为回落表）
//   mention 「@触发回答」：只在群里 @机器人 时参与匹配，优先级高于 group
const AUTO_REPLIES_CONFIG_PATH = path.join(__dirname, '../config/autoReplies.json');
const MENTION_REPLIES_CONFIG_PATH = path.join(__dirname, '../config/autoRepliesMention.json');

// 隐私约定：同名 .local.json（gitignore，可含真实成员姓名等隐私回答）存在则优先加载，
// 仓库只进脱敏模板；NAS 由 push.js 显式上传 .local.json（git 路径部署仓库里没有它）
function resolveConfigPath(configPath) {
  const localPath = configPath.replace(/\.json$/, '.local.json');
  return fs.existsSync(localPath) ? localPath : configPath;
}

const processedMessageIds = new Set();

/**
 * 读一张回答表的 JSON
 * @param {string} configPath
 * @param {{ silentMissing?: boolean }} [opts] silentMissing：表文件尚未生成时静默当空表（不刷日志）
 */
function loadConfigFrom(configPath, opts = {}) {
  try {
    const data = fs.readFileSync(configPath, 'utf-8');
    const cfg = JSON.parse(data);
    const replies = Array.isArray(cfg.replies)
      ? cfg.replies.filter(r => {
          if (!r || !Array.isArray(r.keywords) || r.keywords.length === 0) return false;
          // 新格式：answers[{text, weight}]；旧格式：answer 字符串（兼容）
          if (Array.isArray(r.answers)) {
            r.answers = r.answers.filter(a => a && typeof a.text === 'string' && a.text.trim());
            return r.answers.length > 0;
          }
          return typeof r.answer === 'string' && r.answer.trim();
        })
      : [];
    return { enabled: cfg.enabled !== false, replies };
  } catch (err) {
    if (!(err.code === 'ENOENT' && opts.silentMissing)) {
      console.error('[关键词自动回复] 加载配置失败:', path.basename(configPath), err.message);
    }
    return { enabled: false, replies: [] };
  }
}

// 「关键词回答」表（未@机器人 的群消息 + @时的回落表）
function loadAutoRepliesConfig() {
  return loadConfigFrom(resolveConfigPath(AUTO_REPLIES_CONFIG_PATH));
}

// 「@触发回答」表（只在群里 @机器人 时参与匹配）
function loadMentionRepliesConfig() {
  return loadConfigFrom(resolveConfigPath(MENTION_REPLIES_CONFIG_PATH), { silentMissing: true });
}

// 从一条规则的候选回复池中按权重随机抽一条（权重 0 = 不触发；全 0 兜底取第一条）
function pickAnswer(entry) {
  const answers = Array.isArray(entry.answers) && entry.answers.length > 0
    ? entry.answers
    : [{ text: entry.answer, weight: 1 }];
  const total = answers.reduce((s, a) => s + (a.weight > 0 ? a.weight : 0), 0);
  if (total <= 0) return answers[0].text;
  let roll = Math.random() * total;
  for (const a of answers) {
    if (a.weight <= 0) continue;
    roll -= a.weight;
    if (roll < 0) return a.text;
  }
  return answers[0].text;
}

// 候选展示权重（用于 /autoreply）：唯一候选或等权显示为均分百分比
function displayWeights(answers) {
  if (!Array.isArray(answers) || answers.length === 0) return [];
  const total = answers.reduce((s, a) => s + a.weight, 0) || 1;
  const distinct = new Set(answers.map(a => a.weight));
  if (distinct.size === 1) {
    return answers.map(() => Math.round(100 / answers.length));
  }
  return answers.map(a => Math.round((a.weight / total) * 100));
}

// 群范围（与原关键词监听插件分立，不读 KEYWORD_CHAT_ID）：
// AUTO_REPLY_CHAT_IDS 显式指定允许自动回复的群（逗号分隔 chat_id）；留空或 '*' = 所有群。
// @机器人 / 私聊属于对话回路，不受该范围限制（在 chatService 内命中）。
// 注意：该范围只作用于「关键词回答」表（未@群消息路径）；「@触发回答」表靠 @ 门禁，全群可用。
// 值日专用群（DUTY_CHAT_ID）也在范围内：未@关键词命中照常回答，@路径的放行在 chatService 值日分支②。
function isChatAllowed(chatId) {
  const raw = (config.autoReply.chatIdsRaw || '').trim();
  if (!raw || raw === '*') return true;
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  return ids.includes(chatId);
}

function matchReplies(text, replies) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return replies.filter(r => r.keywords.some(kw => lower.includes(String(kw).toLowerCase())));
}

/**
 * 按表顺序匹配（先新表后原表）：第一张命中的表胜出，表内命中多条规则时每条各抽一条合并回复
 * @param {string} text
 * @param {Array<{ key: string, config: { enabled: boolean, replies: any[] } }>} tables
 * @returns {{ text: string, keywords: string[], source: string } | null}
 */
function buildReplyFromTables(text, tables) {
  if (!text) return null;

  const lower = text.toLowerCase();

  for (const table of tables) {
    const cfg = table.config;
    if (!cfg || !cfg.enabled || cfg.replies.length === 0) continue;

    const matches = matchReplies(text, cfg.replies);
    if (matches.length === 0) continue;   // 本表未命中 → 继续查下一张

    return {
      text: matches.map(m => pickAnswer(m).trim()).filter(Boolean).join('\n\n────────\n\n'),
      keywords: matches.flatMap(m => m.keywords.filter(kw => lower.includes(String(kw).toLowerCase()))),
      source: table.key,
    };
  }

  return null;
}

// 纯匹配（不发送）：只查「关键词回答」表
function buildReplyForText(text) {
  return buildReplyFromTables(text, [{ key: 'group', config: loadAutoRepliesConfig() }]);
}

// 群里 @机器人 时的匹配：先「@触发回答」，未命中再回落「关键词回答」
function buildMentionReplyForText(text) {
  return buildReplyFromTables(text, [
    { key: 'mention', config: loadMentionRepliesConfig() },
    { key: 'group', config: loadAutoRepliesConfig() },
  ]);
}

// 私聊用：任一表命中即视为命中（只提示该功能面向群聊，不返回回答内容）
function hasKeywordHitForText(text) {
  if (!text) return false;
  return [loadMentionRepliesConfig(), loadAutoRepliesConfig()]
    .some(cfg => cfg.enabled && cfg.replies.length > 0 && matchReplies(text, cfg.replies).length > 0);
}

// ===== 定制窗口（顶层 AGENTS「机器人后端定制窗口」）：回答表读写出口 =====
// 写入目标优先 .local.json（运行时隐私层；运行时每消息重读，改动即时生效）。
// 注意：npm run push 会用本地 .local.json 覆盖 NAS 同名文件——批量持久编辑仍以本地 xlsx 为准，
// 窗口改动如需保留，push 前用 GET /api/autoreplies/rules 取回回填本地。

function rulesFilePath(table) {
  const base = table === 'mention' ? MENTION_REPLIES_CONFIG_PATH : AUTO_REPLIES_CONFIG_PATH;
  return resolveConfigPath(base);
}

function normalizeRuleInput(rule) {
  const keywords = (Array.isArray(rule?.keywords) ? rule.keywords : String(rule?.keywords || '').split(/[,，、]/))
    .map((k) => String(k).trim()).filter(Boolean);
  if (keywords.length === 0) throw new Error('关键词不能为空');
  let answers;
  if (Array.isArray(rule?.answers) && rule.answers.length > 0) {
    answers = rule.answers
      .map((a) => ({ text: String(a.text ?? '').trim(), weight: Number.parseInt(a.weight, 10) > 0 ? Number.parseInt(a.weight, 10) : 1 }))
      .filter((a) => a.text);
  } else if (typeof rule?.answersText === 'string' && rule.answersText.trim()) {
    // 窗口便捷格式：每行一条 `回答|权重`（权重可省，默认 1）
    answers = rule.answersText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      .map((l) => {
        const [text, w] = l.split('|');
        return { text: text.trim(), weight: Number.parseInt(w, 10) > 0 ? Number.parseInt(w, 10) : 1 };
      });
  } else if (typeof rule?.answer === 'string' && rule.answer.trim()) {
    answers = [{ text: rule.answer.trim(), weight: 1 }];
  }
  if (!answers || answers.length === 0) throw new Error('回答不能为空（answers 数组 / answersText 每行一条 / answer 字符串）');
  return { keywords, answers };
}

function ruleKey(keywords) {
  return keywords.map((k) => String(k).toLowerCase()).sort().join('|');
}

/** 读一张表的规则全景（file = 当前生效文件名，.local.json 优先） */
function getRules(table) {
  const cfg = loadConfigFrom(rulesFilePath(table));
  return { table, file: path.basename(rulesFilePath(table)), enabled: cfg.enabled, replies: cfg.replies };
}

function saveRules(table, replies, enabled) {
  const base = table === 'mention' ? MENTION_REPLIES_CONFIG_PATH : AUTO_REPLIES_CONFIG_PATH;
  const localPath = base.replace(/\.json$/, '.local.json');
  fs.writeFileSync(localPath, JSON.stringify({ enabled: enabled !== false, replies }, null, 2));
  console.log(`[关键词自动回复] 定制窗口写回 ${path.basename(localPath)}：${replies.length} 条规则`);
  return getRules(table);
}

/** 值日域保留词撞车校验：回答表按「包含关键词」匹配，关键词若与值日指令词
 *  互为子串，管辖群里 @值日语义会被彩蛋抢先（看板/打卡词被截胡）——写入时直接拒绝 */
function assertNoDutyConflict(keywords) {
  const reserved = dutyPolicy.dutyReservedWords();
  const hits = keywords.filter((kw) => {
    const k = String(kw).trim().toLowerCase();
    if (!k) return false;
    return reserved.some((w) => {
      const r = w.toLowerCase();
      return r.includes(k) || k.includes(r);
    });
  });
  if (hits.length > 0) {
    throw new Error(`关键词与值日域保留词冲突（${hits.join('、')}）：看板/打卡等值日指令词已被值日分支占用，请换用其他关键词`);
  }
}

/** 新增/更新规则（按关键词组整体匹配，忽略大小写与顺序） */
function upsertRule(table, rule) {
  const norm = normalizeRuleInput(rule);
  assertNoDutyConflict(norm.keywords);
  const current = getRules(table);
  const replies = current.replies.slice();
  const key = ruleKey(norm.keywords);
  const idx = replies.findIndex((r) => ruleKey(r.keywords) === key);
  if (idx >= 0) replies[idx] = norm; else replies.push(norm);
  return saveRules(table, replies, current.enabled);
}

/** 删除规则（keywords 传该规则任一/全部关键词组） */
function deleteRule(table, keywords) {
  const list = (Array.isArray(keywords) ? keywords : String(keywords).split(/[,，、]/)).map((k) => String(k).trim()).filter(Boolean);
  if (list.length === 0) throw new Error('keywords 不能为空');
  const current = getRules(table);
  const key = ruleKey(list);
  const replies = current.replies.filter((r) => ruleKey(r.keywords) !== key);
  if (replies.length === current.replies.length) throw new Error('未找到该关键词组对应的规则');
  return saveRules(table, replies, current.enabled);
}

/** 启停整张表 */
function setTableEnabled(table, enabled) {
  const current = getRules(table);
  return saveRules(table, current.replies, enabled !== false);
}

// 未@机器人的群聊消息入口：只查「关键词回答」表（「@触发回答」必须在群里 @ 才生效）
async function processMessageEvent(event) {
  const message = event.message;
  if (!message) {
    return { matched: false, reason: '无消息内容' };
  }

  const { enabled, replies } = loadAutoRepliesConfig();
  if (!enabled || replies.length === 0) {
    return { matched: false, reason: '自动回复未启用或回答表为空' };
  }

  const chatType = message.chat_type || message.chatMode;
  if (chatType !== 'group') {
    return { matched: false, reason: '非群聊' };
  }

  // 全群生效（含财务审批群）：命中即回复；审批群未命中时由 chatService 维持财务引导语
  if (!isChatAllowed(message.chat_id)) {
    return { matched: false, reason: '非目标群' };
  }

  // 值日域管辖策略：管辖群按 duty-bot 下发的生效范畴决定关键词放行（非管辖群恒放行）
  const dutyPol = await dutyPolicy.getDutyPolicy();
  if (!dutyPolicy.keywordAllowedInGroup(dutyPol, message.chat_id)) {
    return { matched: false, reason: '值日管辖群未放行关键词' };
  }

  // 其他应用/机器人发出的消息不触发（防 webhook 播报卡片、机器人互答造成循环）
  if (event.sender?.sender_type === 'app') {
    return { matched: false, reason: '应用消息跳过' };
  }

  if (message.message_id) {
    if (processedMessageIds.has(message.message_id)) {
      return { matched: false, reason: '重复消息' };
    }
    processedMessageIds.add(message.message_id);
    if (processedMessageIds.size > 1000) {
      const firstKey = processedMessageIds.values().next().value;
      processedMessageIds.delete(firstKey);
    }
  }

  const text = keywordService.extractTextContent(message);
  const hit = buildReplyForText(text);
  if (!hit) {
    return { matched: false, reason: '未命中关键词' };
  }

  try {
    try {
      await bot.replyTextMessage(message.message_id, hit.text);
    } catch (err) {
      console.error('[关键词自动回复] 引用回复失败，降级直接发送:', err.message);
      await bot.sendTextToChat(message.chat_id, hit.text);
    }
    console.log('[关键词自动回复] 已回复:', hit.keywords.join('/'), '(chat_id:', message.chat_id, ')');
    return { matched: true, keywords: hit.keywords, replied: true };
  } catch (err) {
    console.error('[关键词自动回复] 回复失败:', err.message);
    return { matched: true, keywords: hit.keywords, replied: false, error: err.message };
  }
}

module.exports = {
  loadAutoRepliesConfig,
  loadMentionRepliesConfig,
  matchReplies,
  pickAnswer,
  displayWeights,
  buildReplyForText,
  buildMentionReplyForText,
  hasKeywordHitForText,
  processMessageEvent,
  getRules,
  upsertRule,
  deleteRule,
  setTableEnabled,
};
