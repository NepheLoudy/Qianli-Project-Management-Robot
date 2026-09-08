const bot = require('../feishu/bot');
const projectService = require('./projectService');
const keywordService = require('./keywordService');
const config = require('../config');

// key: owner open_id, value: 数组 [{ projectId, projectName, ownerName, sentAt, chatId }]
const pendingConfirmations = new Map();

// 消息去重 Set
const processedMessageIds = new Set();

// 待确认记录的最大保留时间（7天），防止无限堆积
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function buildAtTag(openId, name) {
  return `<at user_id="${openId}">${name || '用户'}</at>`;
}

/**
 * 向逾期项目的 owner 私聊发送确认消息
 * @param {Object} project 项目信息（来自 getDDLForBroadcastWithHierarchy 的 overdue 项；
 *   owner 为空但 effMembers.owner 有人时——子项目无自己负责人——回退父项目总负责人）
 */
async function sendOverdueConfirmation(project) {
  const effOwner = (project.effMembers && project.effMembers.owner) || [];
  const ownerOpenId = project.owner || effOwner[0]?.id || '';
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
  const ownerName = project.ownerName || effOwner[0]?.name || '同学';

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
      chatId: null, // 私聊不限制来源
    });
    pendingConfirmations.set(ownerOpenId, existing);
    return { sent: true, mode: 'p2p' };
  } catch (err) {
    const errMsg = err.message || '';
    if (errMsg.includes('230013')) {
      // 机器人已可直达所有在册员工，230013 仅出现在离队/未激活账号，安静失败即可，不再群聊降级
      console.error(`[DDL确认] 用户 ${ownerName}(${ownerOpenId}) 不可用（230013，疑离队/未激活），跳过`);
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
 *
 * 只认整句匹配的确认/否认词，不做 contains 级别的宽松匹配——
 * 否则「你是谁」「是的（附和他人）」这类日常消息会被误判成项目确认，
 * 直接把项目状态改成 completed（写过库，误判代价高）。
 *
 * @returns {'yes' | 'no' | null}
 */
function parseConfirmationReply(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase();

  const yesPatterns = /^(是|是的|yes|y|确认|完成|已完成|做完了|完成了|搞定|搞定了|好|好的|没问题|done|ok|okay)$/i;
  const noPatterns = /^(否|不|不是|no|n|未完成|没完成|没做完|还没|还没完成|没有完成|not yet|pending)$/i;

  if (yesPatterns.test(t)) return 'yes';
  if (noPatterns.test(t)) return 'no';

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
  const replyChatId = message.chat_id || ''; // 回复来源的群聊 ID

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

  // 找到匹配的待确认项目。
  // 来源必须与发送方式一致：私聊发出的确认只能私聊回复（群聊里含「是/否」的
  // 日常消息不得被当成确认），群聊发出的只能在同一个群里回复
  const pendingIndex = pendingList.findIndex(p => {
    if (p.sentMode === 'p2p') {
      return chatType === 'p2p';
    }
    if (p.sentMode === 'group') {
      return chatType === 'group' && p.chatId && p.chatId === replyChatId;
    }
    return false;
  });

  if (pendingIndex === -1) {
    // 没有匹配的待确认项目（可能是群聊串行）
    if (chatType === 'group' && replyChatId) {
      console.log(`[DDL确认] 群聊 ${replyChatId} 的回复不匹配任何待确认项目，跳过`);
    }
    return { handled: false, reason: '回复来源与待确认项目不匹配' };
  }

  const text = keywordService.extractTextContent(message);
  console.log(`[DDL确认] 收到 ${senderId} 的回复 (${chatType}, chatId: ${replyChatId}):`, text);

  if (text && text.trim().startsWith('/')) {
    console.log('[DDL确认] 检测到指令消息，跳过确认流程');
    return { handled: false, reason: '指令消息' };
  }

  const reply = parseConfirmationReply(text);

  if (!reply) {
    // 群聊中保守策略：不回复未识别的消息，避免反复触发
    if (chatType === 'p2p') {
      const pending = pendingList[pendingIndex];
      let tipText = `未识别你的回复。请回复 "是" 或 "否" 来确认项目 "${pending.projectName}" 是否已完成。\n• "是" → 标记为已完成\n• "否" → 保持当前状态`;
      try {
        await bot.sendTextToUser(senderId, tipText);
      } catch (err) {
        console.error('[DDL确认] 发送引导提示失败:', err.message);
      }
    }
    // 群聊中静默忽略，不算作 handled，让后续服务（关键词/会议提醒）继续处理
    return { handled: false, reason: '群聊未识别回复，静默忽略' };
  }

  const pending = pendingList.splice(pendingIndex, 1)[0];
  if (pendingList.length === 0) {
    pendingConfirmations.delete(senderId);
  }

  // 确定回复目标：使用发送问询时的 chatId（群聊）或私聊
  const targetChatId = pending.sentMode === 'group' ? pending.chatId : null;

  if (reply === 'yes') {
    try {
      await projectService.updateProject(pending.projectId, { status: 'completed' });
      console.log(`[DDL确认] 已将项目 "${pending.projectName}" 状态更新为 completed`);

      let successText = `✅ 已将项目 "${pending.projectName}" 的状态更新为 completed。\n如需修改，请在看板中手动调整。`;
      if (chatType === 'p2p' || !targetChatId) {
        await bot.sendTextToUser(senderId, successText);
      } else {
        await bot.sendTextToChat(targetChatId, `${buildAtTag(senderId, pending.ownerName)} ${successText}`);
      }
    } catch (err) {
      console.error(`[DDL确认] 更新项目状态失败 (${pending.projectName}):`, err.message);
      let failText = `❌ 更新项目 "${pending.projectName}" 状态失败：${err.message}\n请手动在看板中更新。`;
      if (chatType === 'p2p' || !targetChatId) {
        await bot.sendTextToUser(senderId, failText);
      } else {
        await bot.sendTextToChat(targetChatId, `${buildAtTag(senderId, pending.ownerName)} ${failText}`);
      }
      const list = pendingConfirmations.get(senderId) || [];
      list.push(pending);
      pendingConfirmations.set(senderId, list);
    }
  } else {
    console.log(`[DDL确认] 用户 ${senderId} 选择保持项目 "${pending.projectName}" 当前状态`);
    let keepText = `📋 已记录你的回复，项目 "${pending.projectName}" 状态保持不变。请尽快在看板中更新进度。`;
    if (chatType === 'p2p' || !targetChatId) {
      await bot.sendTextToUser(senderId, keepText);
    } else {
      await bot.sendTextToChat(targetChatId, `${buildAtTag(senderId, pending.ownerName)} ${keepText}`);
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
  handleReply,
  getPendingStats,
  parseConfirmationReply,
};
