const bot = require('../feishu/bot');
const projectService = require('./projectService');
const keywordService = require('./keywordService');
const config = require('../config');
const usageReport = require('./usageReport');
// chatService 延迟到调用时 require：存在经第三方模块回到本模块的循环加载链，
// 顶层 require 会捕获到未绑定完成的导出对象（handleDutyForward 缺失）

// key: owner open_id, value: 数组 [{ projectId, projectName, ownerName, sentAt, chatId }]
const pendingConfirmations = new Map();

// 消息去重 Set
const processedMessageIds = new Set();

// 待确认记录的确认时效（2026-09-13 口径：确认私信发出后 N 小时内才认「是/否」；
// 超时记录清除 → 项目保持原状态，次日 12:00 播报重新询问。默认 12 小时，DDL_CONFIRM_WINDOW_HOURS 可配
const CONFIRM_WINDOW_HOURS = Number(process.env.DDL_CONFIRM_WINDOW_HOURS || 12);
const PENDING_TTL_MS = CONFIRM_WINDOW_HOURS * 60 * 60 * 1000;

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

  // 先清掉该 owner 的过期待确认（超过时效未回复 = 自动放弃本轮，项目保持原状态、
  // 次日播报重新询问），再做重复发送判定
  const existing = (pendingConfirmations.get(ownerOpenId) || []).filter(p => Date.now() - p.sentAt < PENDING_TTL_MS);
  pendingConfirmations.set(ownerOpenId, existing);
  if (existing.some(p => p.projectId === project.id)) {
    console.log('[DDL确认] 项目已有待确认记录，跳过:', project.name);
    return { sent: false, reason: '已存在待确认' };
  }

  const overdueDays = Math.abs(project.daysLeft);
  const ownerName = project.ownerName || effOwner[0]?.name || '同学';

  // 确认编号：同一 owner 内递增（12h 窗口内稳定）。多项目同时到期时，
  // 各条提醒带各自编号，回复「编号+是/否」即可定向确认，不再混淆
  const seq = existing.reduce((m, p) => Math.max(m, p.seq || 0), 0) + 1;

  const p2pText = [
    `⚠️ 项目逾期提醒（确认编号 ${seq}）`,
    ``,
    `${ownerName}，你负责的以下项目已逾期：`,
    `• 项目名称：${project.name}`,
    `• 组别：${project.category || '其他'}`,
    `• 截止日期：${project.ddl}`,
    `• 已逾期：${overdueDays} 天`,
    ``,
    `请记得更新看板状态。该项目是否已完成？`,
    `• 回复 "是" - 我会帮你把状态改为 completed（请在 ${CONFIRM_WINDOW_HOURS} 小时内回复）`,
    `• 回复 "否" - 状态保持不变`,
    `• 多个项目待确认时，回复「编号+是/否」定向确认（如 "${seq} 是"）`,
    `• 超时未回复 - 状态保持不变，明日播报会再次提醒`,
  ].join('\n');

  try {
    await bot.sendTextToUser(ownerOpenId, p2pText);
    console.log(`[DDL确认] 已向 ${ownerName}(${ownerOpenId}) 发送项目 "${project.name}" 的确认请求（私聊，编号 ${seq}）`);

    existing.push({
      projectId: project.id,
      projectName: project.name,
      ownerName,
      ownerOpenId,
      seq,
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
const YES_RE = /^(是|是的|yes|y|确认|完成|已完成|做完了|完成了|搞定|搞定了|好|好的|没问题|done|ok|okay)$/i;
const NO_RE = /^(否|不|不是|no|n|未完成|没完成|没做完|还没|还没完成|没有完成|not yet|pending)$/i;

function parseConfirmationReply(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase();

  if (YES_RE.test(t)) return 'yes';
  if (NO_RE.test(t)) return 'no';

  return null;
}

/**
 * 解析「编号+是/否」定向回复（多项目待确认时的区分性，2026-09-21）。
 * 形态：`2 是` / `2是` / `2：还没` / `#2 是`。
 * 编号限 1-3 位数字且后面必须紧跟确认/否认词——否则普通文本
 * （如日志串 "234001: invalid..."）会被误当定向回复。
 *
 * @returns {{seq: number|null, reply: 'yes'|'no'|null}}
 */
function parseTargetedReply(text) {
  const t = String(text || '').trim().toLowerCase().replace(/^#/, '');
  const m = /^(\d{1,3})\s*[:：,，、]?\s*(.+)$/.exec(t);
  if (!m) return { seq: null, reply: null };
  const reply = parseConfirmationReply(m[2]);
  if (!reply) return { seq: null, reply: null };
  return { seq: Number(m[1]), reply };
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
  // 候选按回复来源过滤；默认取法=「最近发送的一条」（2026-09-13 口径）。
  // 2026-09-21 起私聊多项目裸回复不再用该默认（会完成错的项目），改走编号定向/引导；
  // 该默认仅剩单项目与群聊多项目两个场景在用
  const candidateIdx = pendingList
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => (p.sentMode === 'p2p'
      ? chatType === 'p2p'
      : (p.sentMode === 'group' && chatType === 'group' && p.chatId && p.chatId === replyChatId)));
  const fallbackIndex = candidateIdx.length === 0
    ? -1
    : candidateIdx.reduce((best, cur) => (cur.p.sentAt > pendingList[best].sentAt ? cur.i : best), candidateIdx[0].i);

  if (fallbackIndex === -1) {
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

  // 值日词表让位（2026-09-15 R9）：DDL 确认词表（是/是的/好/完成…）与值日打卡口语
  // 变体完全重叠，p2p 有待确认项目时值日打卡会被这里抢成「项目 completed」。
  // - 打卡/打卡了（值日主词，duty v16 口径）：恒让位 duty-bot，本模块不做任何提示；
  // - 口语变体（duty-bot confirmVariant 同词表）：先转 duty-bot——仅当日有活跃值日
  //   询问会话时被接管；无会话（reply 为空）回落 DDL 确认，行为与此前一致。
  if (chatType === 'p2p') {
    const raw = String(text || '').trim().toLowerCase();
    const DUTY_PRIMARY = /^(打卡|打卡了)$/;
    const DUTY_VARIANTS = /^(是的|好|好了|完成|完成了|做完了|搞定|搞定了)$/;
    if (DUTY_PRIMARY.test(raw) || DUTY_VARIANTS.test(raw)) {
      let dutyReply = '';
      try {
        const dutyResult = await require('./chatService').handleDutyForward({
          command: raw, openId: senderId, chatType: 'p2p', messageId: message.message_id,
        });
        dutyReply = (dutyResult && dutyResult.reply) || '';
      } catch (err) {
        console.error('[DDL确认] 值日让位转发失败（按 duty 未接管处理）:', err.message);
      }
      if (dutyReply) {
        try { await bot.sendTextToUser(senderId, dutyReply); } catch (err) { console.error('[DDL确认] 值日回复转发失败:', err.message); }
        console.log('[DDL确认] 值日助手接管「' + raw + '」，DDL 确认让位');
        return { handled: true, reason: '值日助手接管，DDL 确认让位' };
      }
      if (DUTY_PRIMARY.test(raw)) {
        // 打卡主词 duty 未接管（非名册成员等）：不提示不确认，静默交回常规链路
        return { handled: false, reason: '值日打卡主词静默让位（duty 未接管）' };
      }
      console.log('[DDL确认] 口语变体 duty 未接管（无活跃值日会话），回落 DDL 确认');
    }
  }

  // —— 定向/裸回复分流（2026-09-21 多项目区分性）——
  // 定向「编号+是/否」：编号命中候选即定向该条；裸回复且私聊多项目：不再猜
  // 「最近发送的一条」，回编号清单引导定向。单项目裸回复与群聊行为不变
  const seqList = () => candidateIdx.slice().sort((a, b) => (a.p.seq || 0) - (b.p.seq || 0))
    .map(({ p }) => `${p.seq}. ${p.projectName}`).join('\n');

  let pendingIndex = fallbackIndex;
  let reply = parseConfirmationReply(text);

  const targeted = parseTargetedReply(text);
  if (targeted.seq != null) {
    const hit = candidateIdx.find(({ p }) => (p.seq || 0) === targeted.seq);
    if (!hit) {
      if (chatType === 'p2p') {
        try {
          await bot.sendTextToUser(senderId,
            `未找到编号 ${targeted.seq} 对应的待确认项目（可能已确认或超时）。当前待确认：\n${seqList()}\n例如："${candidateIdx[0].p.seq} 是"`);
        } catch (err) {
          console.error('[DDL确认] 发送引导提示失败:', err.message);
        }
      }
      return { handled: false, reason: `编号 ${targeted.seq} 无匹配待确认项目` };
    }
    pendingIndex = hit.i;
    reply = targeted.reply;
  } else if (reply && candidateIdx.length > 1 && chatType === 'p2p') {
    try {
      await bot.sendTextToUser(senderId,
        `你有多个项目待确认，请回复「编号+是/否」定向确认：\n${seqList()}\n例如："${candidateIdx[0].p.seq} 是" / "${candidateIdx[candidateIdx.length - 1].p.seq} 还没"`);
    } catch (err) {
      console.error('[DDL确认] 发送引导提示失败:', err.message);
    }
    return { handled: false, reason: '多项目待确认，已引导编号定向回复' };
  }

  if (!reply) {
    // 群聊中保守策略：不回复未识别的消息，避免反复触发
    if (chatType === 'p2p') {
      // 图片等非文本消息不提示（可能属于其它服务的私聊链路，如值日照片凭证），交后续链路处理
      const msgType = message.message_type || message.msg_type;
      if (msgType && msgType !== 'text') {
        return { handled: false, reason: 'p2p 非文本消息，静默交由后续链路处理' };
      }
      const pending = pendingList[pendingIndex];
      let tipText;
      if (candidateIdx.length > 1) {
        tipText = `未识别你的回复。当前待确认项目：\n${seqList()}\n请回复「编号+是/否」定向确认（如 "${candidateIdx[0].p.seq} 是"）`;
      } else {
        tipText = `未识别你的回复。请回复 "是" 或 "否" 来确认项目 "${pending.projectName}" 是否已完成。\n• "是" → 标记为已完成\n• "否" → 保持当前状态`;
      }
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
      // 先把待确认记录塞回（2026-09-13）：失败通知若再发送失败，记录不丢——次日播报仍可重问
      const list = pendingConfirmations.get(senderId) || [];
      list.push(pending);
      pendingConfirmations.set(senderId, list);
      try {
        let failText = `❌ 更新项目 "${pending.projectName}" 状态失败：${err.message}\n请手动在看板中更新。`;
        if (chatType === 'p2p' || !targetChatId) {
          await bot.sendTextToUser(senderId, failText);
        } else {
          await bot.sendTextToChat(targetChatId, `${buildAtTag(senderId, pending.ownerName)} ${failText}`);
        }
      } catch (sendErr) {
        console.error('[DDL确认] 失败通知发送失败:', sendErr.message);
      }
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

  usageReport.report(senderId, 'DDL确认');
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
  cleanupExpired(); // 先清过期（2026-09-13）：否则不活跃 owner 的过期确认永久混进 /api/ddl/pending，值日询问被错误附加冲突提示
  const stats = [];
  for (const [ownerId, list] of pendingConfirmations.entries()) {
    for (const p of list) {
      stats.push({
        ownerOpenId: ownerId,
        ownerName: p.ownerName,
        seq: p.seq || null,
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
  parseTargetedReply,
  pendingConfirmations, // stub 测试注入待确认项用（勿在业务代码直写）
};
