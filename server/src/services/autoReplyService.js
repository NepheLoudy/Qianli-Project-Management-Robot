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
      ? cfg.replies.filter(r => r
        && Array.isArray(r.keywords) && r.keywords.length > 0
        && typeof r.answer === 'string' && r.answer.trim())
      : [];
    return { enabled: cfg.enabled !== false, replies };
  } catch (err) {
    console.error('[关键词自动回复] 加载配置失败:', err.message);
    return { enabled: false, replies: [] };
  }
}

// 群范围（与原关键词监听插件分立，不读 KEYWORD_CHAT_ID）：
// AUTO_REPLY_CHAT_IDS 显式指定允许自动回复的群（逗号分隔 chat_id）；留空或 '*' = 所有群（审批群始终排除）。
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

// 纯匹配（不发送）：@机器人 / 私聊消息在 chatService 内命中时用
function buildReplyForText(text) {
  const { enabled, replies } = loadAutoRepliesConfig();
  if (!enabled || replies.length === 0) return null;

  const matches = matchReplies(text, replies);
  if (matches.length === 0) return null;

  const lower = text.toLowerCase();
  return {
    text: matches.map(m => m.answer.trim()).join('\n\n────────\n\n'),
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

  // 审批群保持财务专属能力，不做关键词自动回复
  if (config.approval.chatId && message.chat_id === config.approval.chatId) {
    return { matched: false, reason: '审批群跳过' };
  }

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
  buildReplyForText,
  processMessageEvent,
};
