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

// 与 duty-bot GROUP_GUIDANCE 同文案（仅断联兜底用，改口径两仓同批）；
// 文案原则：只写「应该怎么做」，不通告能力范围
const DEFAULT_GUIDANCE = '🧹 @我 发送「值日助手」查看今日值日\n查询排班、请假、打卡确认请私信机器人';

let cache = { policy: null, fetchedAt: 0 };

function buildFallbackPolicy() {
  return {
    groupChatIds: config.duty.chatId ? [config.duty.chatId] : [],
    hubEnforcement: {
      groupBoardCommand: '值日助手',
      closeBasicCommands: true,
      fallbackGuidance: DEFAULT_GUIDANCE,
    },
    p2pCommands: [
      '值日助手', '我要请假', '查询我的下一次值日', '是', '否', '打卡', '打卡了', '生成排班表',
      '是的', '好', '好了', '完成', '完成了', '做完了', '搞定', '搞定了',
      '快递助手', '快递', '查询当前快递', '已取', '全部已取',
      '/值日助手', '/我要请假', '/查询我的下一次值日', '/是', '/否', '/打卡', '/打卡了', '/生成排班表',
      '/快递助手', '/快递', '/查询当前快递',
    ],
    p2pCommandPrefixes: ['绑定', '/绑定'],
    p2pCommandPatterns: ['^已取\\s*\\d*$', '^全部已取$'],
    groupCommands: ['值日助手', '快递助手', '快递', '查询当前快递'],
    express: { enabled: true },
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

// 取件词形放行判定（已取n / 全部已取；策略正则清单，2026-09-17 快递助手）
function isDutyPatternText(policy, text) {
  if (!text) return false;
  const patterns = Array.isArray(policy.p2pCommandPatterns) ? policy.p2pCommandPatterns : [];
  return patterns.some((p) => {
    try { return new RegExp(p).test(text); } catch { return false; }
  });
}

// p2p 值日指令放行判定（精确词 + 前缀词 + 词形，清单来自策略）
function isDutyCommandText(policy, text) {
  if (!text) return false;
  const cmds = Array.isArray(policy.p2pCommands) ? policy.p2pCommands : [];
  const prefixes = Array.isArray(policy.p2pCommandPrefixes) ? policy.p2pCommandPrefixes : [];
  return cmds.includes(text) || prefixes.some((p) => text.startsWith(p)) || isDutyPatternText(policy, text);
}

// 管辖群内 hub 转发判定（2026-09-17）：指令子集 groupCommands（裸词/带/ 双形态）+ 取件词形。
// 刻意不含 p2pCommands 里的确认口语词（是/好/完成…）——否则非管辖群 @ 口语词被值日引导语误拦
function isDutyGroupCommandText(policy, text) {
  if (!text) return false;
  const cmds = Array.isArray(policy.groupCommands) ? policy.groupCommands : [];
  if (cmds.length) {
    if (cmds.includes(text) || cmds.includes(String(text).replace(/^\//, ''))) return true;
    return isDutyPatternText(policy, text);
  }
  // 旧版 duty-bot 无 groupCommands 字段：回落 p2pCommands（保持兼容）
  const cmds2 = Array.isArray(policy.p2pCommands) ? policy.p2pCommands : [];
  return cmds2.includes(text) || cmds2.includes(String(text).replace(/^\//, '')) || isDutyPatternText(policy, text);
}

// stub 测试用：清空策略缓存，强制下一次重新拉取
function resetCacheForTests() {
  cache = { policy: null, fetchedAt: 0 };
}

module.exports = {
  getDutyPolicy,
  isManagedGroup,
  isDutyCommandText,
  isDutyGroupCommandText,
  isDutyPatternText,
  buildFallbackPolicy,
  resetCacheForTests,
};
