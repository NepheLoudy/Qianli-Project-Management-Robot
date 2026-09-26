const bot = require('../feishu/bot');
const config = require('../config');
const keywordService = require('./keywordService');
const quietHours = require('../utils/quietHours');

const processedMessageIds = new Set();

const lastTriggerTime = new Map();
const TRIGGER_INTERVAL_MS = 5 * 60 * 1000;

// 晚间静默补闸（顶层 AGENTS「晚间静默」铁律，2026-09-25 审查补齐）：会议提醒是
// 事件通知型自动播报（收到会议卡片 → @所有人），静默窗口内不直接发送，
// 载荷原样落盘积压，09:00 整点由冲刷器按本处理器原样补发同一文本。
quietHours.registerPayloadHandler('meeting-reminder', async (payload) => {
  await bot.sendTextToChat(payload.chatId, payload.text);
});

function containsMeetingCard(message) {
  if (!message || !message.content) return false;

  try {
    let content = message.content;
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch (err) {
        // 非 JSON 字符串 content（system/转发等消息形态）不可能是会议卡片，按无卡片处理
        return false;
      }
    }

    const msgType = message.msg_type || message.message_type;

    // share_chat（分享群聊卡片）与会议无关，无论群名是否带「会议」都不触发

    if (msgType === 'share_calendar') {
      const title = content.title || '';
      const description = content.description || '';
      if (title.includes('会议') || title.includes('meeting') || title.includes('日程') || title.includes('日历')) {
        return true;
      }
      if (description.includes('会议') || description.includes('meeting') || description.includes('日程') || description.includes('calendar')) {
        return true;
      }
      if (content.calendar_id || content.event_id || content.agenda) {
        return true;
      }
      return false;
    }

    if (msgType === 'calendar_event') {
      return true;
    }

    // 视频会议卡片（群聊发起视频会议）
    if (msgType === 'video_chat') {
      return true;
    }

    if (msgType === 'interactive') {
      const card = content.card || {};
      const cardSchema = card.schema || '';
      if (cardSchema.includes('meeting') || cardSchema.includes('calendar')) {
        return true;
      }
      const header = card.header || {};
      const headerTitle = header.title || {};
      const titleText = headerTitle.content || '';
      if (titleText.includes('会议') || titleText.includes('meeting') || titleText.includes('日程')) {
        return true;
      }
      const elements = card.elements || [];
      for (const element of elements) {
        if (element.tag === 'div') {
          const fields = element.fields || [];
          for (const field of fields) {
            const text = field.text || {};
            const contentText = text.content || '';
            if (contentText.includes('会议') || contentText.includes('meeting') || contentText.includes('Meeting ID') || contentText.includes('会议ID') || contentText.includes('日程') || contentText.includes('日历')) {
              return true;
            }
          }
        }
        if (element.tag === 'action') {
          const actions = element.actions || [];
          for (const action of actions) {
            if (action.tag === 'button') {
              const text = action.text || {};
              const buttonText = text.content || '';
              if (buttonText.includes('加入会议') || buttonText.includes('join') || buttonText.includes('meeting') || buttonText.includes('查看日程')) {
                return true;
              }
            }
          }
        }
      }
    }

    return false;
  } catch (err) {
    console.error('[会议提醒] 解析会议卡片失败:', err.message);
    return false;
  }
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

  // 其他应用/机器人发出的会议卡片不触发（防应用间互触发 @所有人，同 autoReplyService 口径）
  if (event.sender?.sender_type === 'app') {
    return { handled: false, reason: '应用消息跳过' };
  }

  // 监听机器人所在的所有群聊，无需手动配置

  if (processedMessageIds.has(message.message_id)) {
    return { handled: true, skipped: true, reason: '重复消息' };
  }
  processedMessageIds.add(message.message_id);
  if (processedMessageIds.size > 500) {
    const firstKey = processedMessageIds.values().next().value;
    processedMessageIds.delete(firstKey);
  }

  // 仅监听会议卡片消息
  const hasMeetingCard = containsMeetingCard(message);
  if (!hasMeetingCard) {
    return { handled: false, reason: '非会议卡片消息' };
  }

  const now = Date.now();
  const lastTime = lastTriggerTime.get(chatId);
  if (lastTime && now - lastTime < TRIGGER_INTERVAL_MS) {
    return { handled: true, skipped: true, reason: '时间窗口内重复触发' };
  }

  lastTriggerTime.set(chatId, now);

  const replyText = '<at user_id="all">所有人</at> 📢 收到会议卡片通知！\n请及时查看并参加会议！';

  // 晚间静默闸门（gatePayload）：静默窗口内载荷落盘积压并返回 true → 跳过直发，
  // 09:00 整点由冲刷器按文件头注册的处理器原样补发（即时事件型通知，不走 gateTask 重扫）
  if (quietHours.gatePayload('meeting-reminder', { chatId, text: replyText }, `[会议提醒] ${chatId}`)) {
    return { handled: true, triggered: false, deferred: true, reason: '晚间静默积压，待统一补发' };
  }

  try {
    await bot.sendTextToChat(chatId, replyText);
    console.log(`[会议提醒] 已在群聊 ${chatId} 中 @所有人 发送会议提醒 (会议卡片)`);
    return {
      handled: true,
      triggered: true,
      hasMeetingCard,
    };
  } catch (err) {
    console.error('[会议提醒] 发送消息失败:', err.message);
    return { handled: true, triggered: false, error: err.message };
  }
}

module.exports = {
  processMeetingMessage,
  containsMeetingCard,
};
