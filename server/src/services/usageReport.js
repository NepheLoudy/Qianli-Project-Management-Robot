// ============================================================
// 队员/功能统计归因上报（2026-09-13 统计覆盖规则）：
// 网关路由层看不见的功能命中（关键词回答/DDL 确认回复/值日指令等）回报到
// 网关 POST /api/usage/report——只记功能与活跃，不影响任何业务流程。
// 上报失败静默忽略（fire-and-forget，3s 超时）。
// ============================================================

const URL = process.env.USAGE_REPORT_URL || 'http://localhost:3010/api/usage/report';
const TOKEN = process.env.API_TOKEN || '';
const TIMEOUT_MS = 3000;

function report(openId, feature) {
  if (!openId || !feature) return;
  fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': TOKEN },
    body: JSON.stringify({ openId, feature }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err) => console.warn(`[统计上报] ${feature} 上报失败（忽略）:`, err.message));
}

module.exports = { report };
