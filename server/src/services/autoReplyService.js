const fs = require('fs');
const path = require('path');
const config = require('../config');
const keywordService = require('./keywordService');
const bot = require('../feishu/bot');

const AUTO_REPLIES_CONFIG_PATH = path.join(__dirname, '../config/autoReplies.json');

const processedMessageIds = new Set();

function loadAutoRepliesConfig() {
  try {
    const data = fs.readFileSync(AUTO_REPLIES_CONFIG_PATH, 'utf-8');
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
    console.error('[关键词自动回复] 加载配置失败:', err.message);
    return { enabled: false, replies: [] };
  }
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

// 纯匹配（不发送）：@机器人 / 私聊消息在 chatService 内命中时用。
// 命中多条规则时，每条规则按各自概率抽一条回复，合并成一条（与未@路径一致）
function buildReplyForText(text) {
  const { enabled, replies } = loadAutoRepliesConfig();
  if (!enabled || replies.length === 0) return null;

  const matches = matchReplies(text, replies);
  if (matches.length === 0) return null;

  const lower = text.toLowerCase();
  return {
    text: matches.map(m => pickAnswer(m).trim()).filter(Boolean).join('\n\n────────\n\n'),
    keywords: matches.flatMap(m => m.keywords.filter(kw => lower.includes(String(kw).toLowerCase()))),
  };
}

// 未@机器人的群聊消息入口（@机器人/私聊的命中在 chatService 内处理，避免双重回复）
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
  matchReplies,
  pickAnswer,
  displayWeights,
  buildReplyForText,
  processMessageEvent,
};
