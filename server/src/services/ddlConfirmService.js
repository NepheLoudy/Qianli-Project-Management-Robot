const bot = require('../feishu/bot');
const projectService = require('./projectService');
const keywordService = require('./keywordService');
const config = require('../config');

// key: owner open_id, value: 数组 [{ projectId, projectName, ownerName, sentAt }]
const pendingConfirmations = new Map();

// 消息去重 Set
const processedMessageIds = new Set();

// 待确认记录的最大保留时间（7天），防止无限堆积
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function buildAtTag(openId, name) {
  return `<at id="${openId}">${name || '用户'}</at>`;
}

/**
 * 向逾期项目的 owner 私聊发送确认消息
 * @param {Object} project 项目信息（来自 getDDLForBroadcastWithHierarchy 的 overdue 项）
 */
async function sendOverdueConfirmation(project) {
  const ownerOpenId = project.owner;
  if (!ownerOpenId) {
    console.warn('[DDL确认] 项目无 owner，跳过:', project.name);
    return { sent: false, reason: '无 owner' };
  }

  // 已存在该项目的待确认则跳过，避免重复发送
  const existing = pendingConfirmations.get(ownerOpenId) || [];
  if (existing.some(p => p.projectId === project.id)) {
    console.log('[DDL确认] 项目已有待确认记录，跳过:', project.name);
    return { sent: false, reason: '已存在待确认' };
  }

  const overdueDays = Math.abs(project.daysLeft);
  const ownerName = project.ownerName || '同学';

  const p2pText = [
    `⚠️ 项目逾期提醒`,
    ``,
    `${ownerName}，你负责的以下项目已逾期：`,
    `• 项目名称：${project.name}`,
    `• 组别：${project.category || '其他'}`,
    `• 截止日期：${project.ddl}`,
    `• 已逾期：${overdueDays} 天`,
    ``,
    `请记得更新看板状态。该项目是否已完成？`,
    `• 回复 "是" - 我会帮你把状态改为 completed`,
    `• 回复 "否" - 状态保持不变，继续提醒`,
  ].join('\n');

  const groupText = [
    `⚠️ ${buildAtTag(ownerOpenId, ownerName)} 项目逾期提醒`,
    ``,
    `你负责的项目「${project.name}」已逾期 ${overdueDays} 天，请及时处理。`,
    `组别：${project.category || '其他'} | 截止日期：${project.ddl}`,
    ``,
    `请在群内回复 "是" 或 "否" 确认项目状态：`,
    `• 回复 "是" → 我会帮你标记为已完成`,
    `• 回复 "否" → 状态保持不变，继续提醒`,
  ].join('\n');

  const chatId = config.chat.chatId;

  try {
    await bot.sendTextToUser(ownerOpenId, p2pText);
    console.log(`[DDL确认] 已向 ${ownerName}(${ownerOpenId}) 发送项目 "${project.name}" 的确认请求（私聊）`);

    existing.push({
      projectId: project.id,
      projectName: project.name,
      ownerName,
      ownerOpenId,
      sentAt: Date.now(),
      sentMode: 'p2p',
    });
    pendingConfirmations.set(ownerOpenId, existing);
    return { sent: true, mode: 'p2p' };
  } catch (err) {
    const errMsg = err.message || '';
    if (errMsg.includes('230013')) {
      console.warn(`[DDL确认] 机器人对用户 ${ownerName}(${ownerOpenId}) 没有可用性，降级到群聊 @提醒`);
      if (!chatId) {
        console.error('[DDL确认] 未配置群聊 ID，无法降级发送');
        return { sent: false, reason: '未配置群聊 ID' };
      }
      try {
        await bot.sendTextToChat(chatId, groupText);
        console.log(`[DDL确认] 已在群聊 ${chatId} 中 @${ownerName} 发送项目 "${project.name}" 的确认请求（群聊降级）`);

        existing.push({
          projectId: project.id,
          projectName: project.name,
          ownerName,
          ownerOpenId,
          sentAt: Date.now(),
          sentMode: 'group',
        });
        pendingConfirmations.set(ownerOpenId, existing);
        return { sent: true, mode: 'group' };
      } catch (groupErr) {
        console.error(`[DDL确认] 群聊发送也失败 (${project.name}):`, groupErr.message);
        return { sent: false, reason: `私聊失败+群聊失败: ${groupErr.message}` };
      }
    } else if (errMsg.includes('230053')) {
      console.error(`[DDL确认] 用户 ${ownerName}(${ownerOpenId}) 已设置不再接收机器人消息，跳过`);
    } else if (errMsg.includes('230002')) {
      console.error(`[DDL确认] 机器人不在用户 ${ownerName} 的群组中（不应发生在 p2p 场景）`);
    } else {
      console.error(`[DDL确认] 发送私聊失败 (${project.name}):`, errMsg);
    }
    return { sent: false, reason: errMsg };
  }
}

/**
 * 解析用户回复是否为 "是" 或 "否"
 * @returns {'yes' | 'no' | null}
 */
function parseConfirmationReply(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase();

  const yesPatterns = /^(是|yes|y|确认|完成|已完成|done|ok)$/i;
  const noPatterns = /^(否|no|n|未完成|没完成|not yet|pending)$/i;

  if (yesPatterns.test(t)) return 'yes';
  if (noPatterns.test(t)) return 'no';

  if (t.length <= 10) {
    if (t.includes('是') && !t.includes('不是') && !t.includes('否')) return 'yes';
    if (t.includes('否') || t.includes('没完成') || t.includes('未完成')) return 'no';
  }

  return null;
}

/**
 * 处理 owner 的回复（支持私聊和群聊）
 * @param {Object} event 飞书事件 data
 * @returns {Promise<{handled: boolean, reason?: string}>}
 */
async function handleReply(event) {
  const message = event.message;
  if (!message) return { handled: false, reason: '无消息内容' };

  const chatType = message.chat_type || message.chatMode;

  // 消息去重
  if (message.message_id) {
    if (processedMessageIds.has(message.message_id)) {
      return { handled: true, skipped: true, reason: '重复消息' };
    }
    processedMessageIds.add(message.message_id);
    if (processedMessageIds.size > 500) {
      const firstKey = processedMessageIds.values().next().value;
      processedMessageIds.delete(firstKey);
    }
  }

  const senderId = event.sender?.sender_id?.open_id || event.sender?.sender_id?.user_id || '';
  if (!senderId) return { handled: false, reason: '无 sender_id' };

  // 清理过期待确认记录
  cleanupExpired();

  const pendingList = pendingConfirmations.get(senderId);
  if (!pendingList || pendingList.length === 0) {
    return { handled: false, reason: '该用户无待确认项目' };
  }

  const text = keywordService.extractTextContent(message);
  console.log(`[DDL确认] 收到 ${senderId} 的回复 (${chatType}):`, text);

  if (text && text.trim().startsWith('/')) {
    console.log('[DDL确认] 检测到指令消息，跳过确认流程');
    return { handled: false, reason: '指令消息' };
  }

  const reply = parseConfirmationReply(text);

  if (!reply) {
    const pending = pendingList[0];
    let tipText = `未识别你的回复。请回复 "是" 或 "否" 来确认项目 "${pending.projectName}" 是否已完成。\n• "是" → 标记为已完成\n• "否" → 保持当前状态`;

    try {
      if (chatType === 'p2p') {
        await bot.sendTextToUser(senderId, tipText);
      } else {
        await bot.sendTextToChat(config.chat.chatId, `${buildAtTag(senderId, pending.ownerName)} ${tipText}`);
      }
    } catch (err) {
      console.error('[DDL确认] 发送引导提示失败:', err.message);
    }
    return { handled: true, reason: '未识别回复' };
  }

  const pending = pendingList.shift();
  if (pendingList.length === 0) {
    pendingConfirmations.delete(senderId);
  }

  if (reply === 'yes') {
    try {
      await projectService.updateProject(pending.projectId, { status: 'completed' });
      console.log(`[DDL确认] 已将项目 "${pending.projectName}" 状态更新为 completed`);

      let successText = `✅ 已将项目 "${pending.projectName}" 的状态更新为 completed。\n如需修改，请在看板中手动调整。`;
      if (chatType === 'p2p') {
        await bot.sendTextToUser(senderId, successText);
      } else {
        await bot.sendTextToChat(config.chat.chatId, `${buildAtTag(senderId, pending.ownerName)} ${successText}`);
      }
    } catch (err) {
      console.error(`[DDL确认] 更新项目状态失败 (${pending.projectName}):`, err.message);
      let failText = `❌ 更新项目 "${pending.projectName}" 状态失败：${err.message}\n请手动在看板中更新。`;
      if (chatType === 'p2p') {
        await bot.sendTextToUser(senderId, failText);
      } else {
        await bot.sendTextToChat(config.chat.chatId, `${buildAtTag(senderId, pending.ownerName)} ${failText}`);
      }
      const list = pendingConfirmations.get(senderId) || [];
      list.unshift(pending);
      pendingConfirmations.set(senderId, list);
    }
  } else {
    console.log(`[DDL确认] 用户 ${senderId} 选择保持项目 "${pending.projectName}" 当前状态`);
    let keepText = `📋 已记录你的回复，项目 "${pending.projectName}" 状态保持不变。请尽快在看板中更新进度。`;
    if (chatType === 'p2p') {
      await bot.sendTextToUser(senderId, keepText);
    } else {
        await bot.sendTextToChat(config.chat.chatId, `${buildAtTag(senderId, pending.ownerName)} ${keepText}`);
      }
  }

  return { handled: true, reply };
}

/**
 * 处理 owner 的私聊回复（兼容旧接口）
 */
async function handleP2PReply(event) {
  return handleReply(event);
}

/**
 * 清理过期的待确认记录（超过 TTL）
 */
function cleanupExpired() {
  const now = Date.now();
  for (const [ownerId, list] of pendingConfirmations.entries()) {
    const fresh = list.filter(p => now - p.sentAt < PENDING_TTL_MS);
    if (fresh.length === 0) {
      pendingConfirmations.delete(ownerId);
    } else if (fresh.length !== list.length) {
      pendingConfirmations.set(ownerId, fresh);
    }
  }
}

/**
 * 获取当前待确认记录的统计（调试用）
 */
function getPendingStats() {
  const stats = [];
  for (const [ownerId, list] of pendingConfirmations.entries()) {
    for (const p of list) {
      stats.push({
        ownerOpenId: ownerId,
        ownerName: p.ownerName,
        projectId: p.projectId,
        projectName: p.projectName,
        sentAt: new Date(p.sentAt).toISOString(),
      });
    }
  }
  return stats;
}

module.exports = {
  sendOverdueConfirmation,
  handleP2PReply,
  getPendingStats,
  parseConfirmationReply,
};
