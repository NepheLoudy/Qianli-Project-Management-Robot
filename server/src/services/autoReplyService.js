const fs = require('fs');
const path = require('path');
const config = require('../config');
const keywordService = require('./keywordService');
const bot = require('../feishu/bot');

// 两张本地回答表（同一份「关键词回答表.xlsx」的两个工作表，由 scripts/syncAutoReplies.js 生成）：
//   group   「关键词回答」：未@机器人的群消息命中即回（群里 @机器人 时作为回落表）
//   mention 「@触发回答」：只在群里 @机器人 时参与匹配，优先级高于 group
const AUTO_REPLIES_CONFIG_PATH = path.join(__dirname, '../config/autoReplies.json');
const MENTION_REPLIES_CONFIG_PATH = path.join(__dirname, '../config/autoRepliesMention.json');

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
  return loadConfigFrom(AUTO_REPLIES_CONFIG_PATH);
}

// 「@触发回答」表（只在群里 @机器人 时参与匹配）
function loadMentionRepliesConfig() {
  return loadConfigFrom(MENTION_REPLIES_CONFIG_PATH, { silentMissing: true });
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
};
