const fs = require('fs');
const path = require('path');
const config = require('../config');
const keywordService = require('./keywordService');
const bot = require('../feishu/bot');
const usageReport = require('./usageReport');

// 抽奖（server/src/config/lottery.json，由项目根目录「抽奖配置表.xlsx」经 scripts/syncLottery.js 生成）：
// 走「关键词回答」同一条全群链路——未@机器人的群消息包含触发词即抽一次，按概率加权随机抽一条
// 奖品文字原文回复。命中优先级最高：先于「@触发回答」「关键词回答」两张表（两处调用点互斥，
// 同一条消息不会既抽奖又回关键词回答）。
const LOTTERY_CONFIG_PATH = path.join(__dirname, '../config/lottery.json');

// 隐私约定同 autoReplies：同名 .local.json（gitignore；定制窗口热改写这里）存在则优先加载，
// 仓库只进表格同步出的脱敏模板
function resolveConfigPath(configPath) {
  const localPath = configPath.replace(/\.json$/, '.local.json');
  return fs.existsSync(localPath) ? localPath : configPath;
}

const processedMessageIds = new Set();

/** 读抽奖配置（运行时每消息重读，表格同步/窗口改动即时生效） */
function loadLotteryConfig() {
  try {
    const data = fs.readFileSync(resolveConfigPath(LOTTERY_CONFIG_PATH), 'utf-8');
    const cfg = JSON.parse(data);
    const replies = Array.isArray(cfg.replies)
      ? cfg.replies.filter(r => {
          if (!r || !Array.isArray(r.keywords) || r.keywords.length === 0) return false;
          if (!Array.isArray(r.answers)) return false;
          r.answers = r.answers.filter(a => a && typeof a.text === 'string' && a.text.trim());
          return r.answers.length > 0;
        })
      : [];
    return { enabled: cfg.enabled !== false, replies };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[抽奖] 加载配置失败:', path.basename(resolveConfigPath(LOTTERY_CONFIG_PATH)), err.message);
    }
    return { enabled: false, replies: [] };
  }
}

// 生效群范围（同 AUTO_REPLY_CHAT_IDS 模式）：LOTTERY_CHAT_IDS 逗号分隔 chat_id；留空或 '*' = 所有群。
// 抽奖只走群聊（@机器人/私聊不触发，私聊是对话回路）。
function isChatAllowed(chatId) {
  const raw = (config.lottery.chatIdsRaw || '').trim();
  if (!raw || raw === '*') return true;
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  return ids.includes(chatId);
}

// 从一个奖池按权重随机抽一条（weight 0 = 永不抽中；全 0 兜底取第一条）
function drawPrize(entry) {
  const answers = entry.answers;
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

function matchPools(text, replies) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return replies.filter(r => r.keywords.some(kw => lower.includes(String(kw).toLowerCase())));
}

/**
 * 纯抽奖（不发送、不上报）：命中多条规则时逐条各抽一条合并
 * @returns {{ keywords: string[], text: string } | null}
 */
function buildDrawForText(text) {
  const { enabled, replies } = loadLotteryConfig();
  if (!enabled || replies.length === 0) return null;

  const lower = String(text || '').toLowerCase();
  const matches = matchPools(text, replies);
  if (matches.length === 0) return null;

  return {
    keywords: matches.flatMap(m => m.keywords.filter(kw => lower.includes(String(kw).toLowerCase()))),
    text: matches.map(m => drawPrize(m).trim()).filter(Boolean).join('\n\n────────\n\n'),
  };
}

// 未@机器人的群消息抽奖入口（eventSubscription 在关键词回答表之前调用，命中则跳过回答表）
async function processMessageEvent(event) {
  const message = event.message;
  if (!message) {
    return { matched: false, reason: '无消息内容' };
  }

  const { enabled, replies } = loadLotteryConfig();
  if (!enabled || replies.length === 0) {
    return { matched: false, reason: '抽奖未启用或奖池为空' };
  }

  const chatType = message.chat_type || message.chatMode;
  if (chatType !== 'group') {
    return { matched: false, reason: '非群聊' };
  }

  if (!isChatAllowed(message.chat_id)) {
    return { matched: false, reason: '非目标群' };
  }

  // 其他应用/机器人发出的消息不触发（防播报卡片、机器人互抽循环）
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
  const hit = buildDrawForText(text);
  if (!hit) {
    return { matched: false, reason: '未命中触发词' };
  }

  const reporterOpenId = (event.sender && event.sender.sender_id && (event.sender.sender_id.open_id || event.sender.sender_id.user_id)) || '';
  usageReport.report(reporterOpenId, '抽奖');

  try {
    try {
      await bot.replyTextMessage(message.message_id, hit.text);
    } catch (err) {
      console.error('[抽奖] 引用回复失败，降级直接发送:', err.message);
      await bot.sendTextToChat(message.chat_id, hit.text);
    }
    console.log('[抽奖] 已回复:', hit.keywords.join('/'), '(chat_id:', message.chat_id, ')');
    return { matched: true, keywords: hit.keywords, replied: true };
  } catch (err) {
    console.error('[抽奖] 回复失败:', err.message);
    return { matched: true, keywords: hit.keywords, replied: false, error: err.message };
  }
}

// ===== 定制窗口（顶层 AGENTS「机器人后端定制窗口」）：抽奖配置读写出口 =====
// 写入目标优先 .local.json（运行时每消息重读，改动即时生效）。
// 注意：npm run push 会用本地 .local.json 覆盖部署目标同名文件——持久批量编辑仍以本地 xlsx 为准，
// 窗口改动如需保留，push 前用 GET /api/lottery/rules 取回回填本地。

function rulesFilePath() {
  return resolveConfigPath(LOTTERY_CONFIG_PATH);
}

// 概率解析：显式填 ≥0 的数照用（0 = 永不抽中）；省略/非法回落默认值（1 = 等概率参与）
function parseWeight(v, def) {
  if (v === undefined || v === null || String(v).trim() === '') return def;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

function normalizeRuleInput(rule) {
  const keywords = (Array.isArray(rule?.keywords) ? rule.keywords : String(rule?.keywords || '').split(/[,，、]/))
    .map((k) => String(k).trim()).filter(Boolean);
  if (keywords.length === 0) throw new Error('触发词不能为空');
  let answers;
  if (Array.isArray(rule?.answers) && rule.answers.length > 0) {
    answers = rule.answers
      .map((a) => ({ text: String(a.text ?? '').trim(), weight: parseWeight(a.weight, 1) }))
      .filter((a) => a.text);
  } else if (typeof rule?.answersText === 'string' && rule.answersText.trim()) {
    // 窗口便捷格式：每行一条 `奖品|概率`（概率可省，默认 1；0 = 永不抽中）
    answers = rule.answersText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      .map((l) => {
        const [text, w] = l.split('|');
        return { text: text.trim(), weight: parseWeight(w, 1) };
      });
  } else if (typeof rule?.answer === 'string' && rule.answer.trim()) {
    answers = [{ text: rule.answer.trim(), weight: 1 }];
  }
  if (!answers || answers.length === 0) throw new Error('奖品不能为空（answers 数组 / answersText 每行一条 / answer 字符串）');
  return { keywords, answers };
}

function ruleKey(keywords) {
  return keywords.map((k) => String(k).toLowerCase()).sort().join('|');
}

/** 读抽奖规则全景（file = 当前生效文件名，.local.json 优先） */
function getRules() {
  const cfg = loadLotteryConfig();
  return { table: 'lottery', file: path.basename(rulesFilePath()), enabled: cfg.enabled, replies: cfg.replies };
}

function saveRules(replies, enabled) {
  const localPath = LOTTERY_CONFIG_PATH.replace(/\.json$/, '.local.json');
  fs.writeFileSync(localPath, JSON.stringify({ enabled: enabled !== false, replies }, null, 2));
  console.log(`[抽奖] 定制窗口写回 ${path.basename(localPath)}：${replies.length} 条触发规则`);
  return getRules();
}

/** 新增/更新奖池（按触发词组整体匹配，忽略大小写与顺序） */
function upsertRule(rule) {
  const norm = normalizeRuleInput(rule);
  const current = getRules();
  const replies = current.replies.slice();
  const key = ruleKey(norm.keywords);
  const idx = replies.findIndex((r) => ruleKey(r.keywords) === key);
  if (idx >= 0) replies[idx] = norm; else replies.push(norm);
  return saveRules(replies, current.enabled);
}

/** 删除奖池（keywords 传该规则任一/全部触发词组） */
function deleteRule(keywords) {
  const list = (Array.isArray(keywords) ? keywords : String(keywords).split(/[,，、]/)).map((k) => String(k).trim()).filter(Boolean);
  if (list.length === 0) throw new Error('keywords 不能为空');
  const current = getRules();
  const key = ruleKey(list);
  const replies = current.replies.filter((r) => ruleKey(r.keywords) !== key);
  if (replies.length === current.replies.length) throw new Error('未找到该触发词组对应的奖池');
  return saveRules(replies, current.enabled);
}

/** 启停抽奖 */
function setEnabled(enabled) {
  const current = getRules();
  return saveRules(current.replies, enabled !== false);
}

module.exports = {
  loadLotteryConfig,
  isChatAllowed,
  drawPrize,
  buildDrawForText,
  processMessageEvent,
  getRules,
  upsertRule,
  deleteRule,
  setEnabled,
};
