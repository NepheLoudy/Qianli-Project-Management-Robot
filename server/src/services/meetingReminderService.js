const bot = require('../feishu/bot');
const config = require('../config');
const keywordService = require('./keywordService');

const processedMessageIds = new Set();

const MEETING_KEYWORDS = [
  '会议',
  '开会',
  '开会了',
  '开始会议',
  '组织会议',
  '召开会议',
];

const MEETING_URL_REGEX = /(https?:\/\/(?:[^\s]+\.)?feishu\.cn\/(?:meeting|calendar|vc)\/[^\s]+)/gi;

function containsMeetingKeyword(text) {
  if (!text) return false;
  return MEETING_KEYWORDS.some(keyword => text.includes(keyword));
}

function containsMeetingLink(text) {
  if (!text) return false;
  return MEETING_URL_REGEX.test(text);
}

function extractMeetingLinks(text) {
  if (!text) return [];
  const matches = text.match(MEETING_URL_REGEX);
  return matches || [];
}

async function processMeetingMessage(event) {
  const message = event.message;
  if (!message) {
    return { handled: false, reason: '无消息内容' };
  }

  const chatId = message.chat_id;
  const chatType = message.chat_type || message.chatMode;

  if (chatType !== 'group') {
    return { handled: false, reason: '非群聊消息' };
  }

  const monitorChatIds = config.meeting?.chatIds || [];
  if (monitorChatIds.length > 0 && !monitorChatIds.includes(chatId)) {
    return { handled: false, reason: '非监控群聊' };
  }

  if (processedMessageIds.has(message.message_id)) {
    return { handled: true, skipped: true, reason: '重复消息' };
  }
  processedMessageIds.add(message.message_id);
  if (processedMessageIds.size > 500) {
    const firstKey = processedMessageIds.values().next().value;
    processedMessageIds.delete(firstKey);
  }

  const text = keywordService.extractTextContent(message);

  const hasKeyword = containsMeetingKeyword(text);
  const hasLink = containsMeetingLink(text);

  if (!hasKeyword && !hasLink) {
    return { handled: false, reason: '未检测到会议相关内容' };
  }

  const links = extractMeetingLinks(text);
  const senderId = event.sender?.sender_id?.open_id || event.sender?.sender_id?.user_id || '';

  let replyText = '<at user_id="all">所有人</at> 📢 收到会议通知！';
  if (links.length > 0) {
    replyText += '\n会议链接：';
    links.forEach(link => {
      replyText += `\n• ${link}`;
    });
  }
  replyText += '\n请及时查看并参加会议！';

  try {
    await bot.sendTextToChat(chatId, replyText);
    console.log(`[会议提醒] 已在群聊 ${chatId} 中 @所有人 发送会议提醒 (关键词: ${hasKeyword}, 链接: ${links.length})`);
    return {
      handled: true,
      triggered: true,
      hasKeyword,
      hasLink,
      links,
      senderId,
    };
  } catch (err) {
    console.error('[会议提醒] 发送消息失败:', err.message);
    return { handled: true, triggered: false, error: err.message };
  }
}

module.exports = {
  processMeetingMessage,
  containsMeetingKeyword,
  containsMeetingLink,
  extractMeetingLinks,
};
