const config = require('../config');

// ============================================================
// 值日域管辖策略消费端：duty-bot GET /api/duty/policy 的短缓存客户端。
// 权限管辖范畴（哪些群）/生效范畴（群里放行什么）的权威在 duty-bot 后端，
// hub 只是执行闸门；duty-bot 不可用时按本仓 env（DUTY_CHAT_ID）+ 内置默认规则
// 短暂兜底（兜底缓存 TTL 更短，恢复后自动回到下发策略）。
// ============================================================

const POLICY_TTL_MS = 60 * 1000;        // 下发策略缓存
const FALLBACK_TTL_MS = 15 * 1000;      // 兜底策略缓存（短暂后重试拉取）
const POLICY_TIMEOUT_MS = 2000;

const DEFAULT_GUIDANCE = '🧹 本群为值日/快递申领专用群：@我 发送「值日助手」查看今日值日，关键词彩蛋照常有效\n（查询排班、请假、打卡确认请私信机器人）';

let cache = { policy: null, fetchedAt: 0 };

function buildFallbackPolicy() {
  return {
    groupChatIds: config.duty.chatId ? [config.duty.chatId] : [],
    hubEnforcement: {
      groupBoardCommand: '值日助手',
      closeBasicCommands: true,
      keywordPassthrough: true,
      fallbackGuidance: DEFAULT_GUIDANCE,
    },
    p2pCommands: [
      '值日助手', '我要请假', '查询我的下一次值日', '是', '否', '生成排班表',
      '是的', '好', '好了', '完成', '完成了', '做完了', '搞定', '搞定了',
      '/值日助手', '/我要请假', '/查询我的下一次值日', '/是', '/否', '/生成排班表',
    ],
    p2pCommandPrefixes: ['绑定', '/绑定'],
    source: 'fallback',
  };
}

function cacheFresh() {
  if (!cache.policy) return false;
  const ttl = cache.policy.source === 'fallback' ? FALLBACK_TTL_MS : POLICY_TTL_MS;
  return Date.now() - cache.fetchedAt < ttl;
}

// 拉取当前生效策略（带缓存；duty-bot 不可用时回落本仓兜底，不抛错）
async function getDutyPolicy({ force = false } = {}) {
  if (!force && cacheFresh()) return cache.policy;
  try {
    const res = await fetch(`${config.duty.serviceUrl}/api/duty/policy`, { signal: AbortSignal.timeout(POLICY_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`策略响应 ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.groupChatIds) || !data.hubEnforcement) throw new Error('策略结构异常');
    cache = { policy: { ...data, source: 'duty-bot' }, fetchedAt: Date.now() };
  } catch (err) {
    if (!cache.policy || cache.policy.source !== 'fallback') {
      console.error('[值日策略] 拉取失败，暂用本仓兜底策略（DUTY_CHAT_ID + 默认规则）:', err.message);
    }
    cache = { policy: buildFallbackPolicy(), fetchedAt: Date.now() };
  }
  return cache.policy;
}

// 管辖范畴判定：chat_id 是否值日管辖群
// （空列表 = 不限制，与 duty-bot 侧判定口径一致；失联兜底策略的
//  groupChatIds 取本仓 DUTY_CHAT_ID，配置了该键即非空）
function isManagedGroup(policy, chatId) {
  const ids = Array.isArray(policy.groupChatIds) ? policy.groupChatIds : [];
  return ids.length === 0 || ids.includes(chatId);
}

// p2p 值日指令放行判定（精确词 + 前缀词，清单来自策略）
function isDutyCommandText(policy, text) {
  if (!text) return false;
  const cmds = Array.isArray(policy.p2pCommands) ? policy.p2pCommands : [];
  const prefixes = Array.isArray(policy.p2pCommandPrefixes) ? policy.p2pCommandPrefixes : [];
  return cmds.includes(text) || prefixes.some((p) => text.startsWith(p));
}

// 未@关键词路径的放行判定：非管辖群恒放行（走通用口径），管辖群看策略开关
function keywordAllowedInGroup(policy, chatId) {
  if (!isManagedGroup(policy, chatId)) return true;
  return policy.hubEnforcement.keywordPassthrough !== false;
}

// 值日域保留词（归一去斜杠后的静态清单，取内置兜底策略而非实时下发——
// 校验口径不随 duty-bot 在线改写漂移）：回答表关键词撞车校验用
function dutyReservedWords() {
  const p = buildFallbackPolicy();
  const words = [p.hubEnforcement.groupBoardCommand, ...p.p2pCommands, ...p.p2pCommandPrefixes]
    .map((w) => String(w).replace(/^\//, '').trim())
    .filter(Boolean);
  return [...new Set(words)];
}

// stub 测试用：清空策略缓存，强制下一次重新拉取
function resetCacheForTests() {
  cache = { policy: null, fetchedAt: 0 };
}

module.exports = {
  getDutyPolicy,
  isManagedGroup,
  isDutyCommandText,
  keywordAllowedInGroup,
  buildFallbackPolicy,
  dutyReservedWords,
  resetCacheForTests,
};
