// ============================================================
// 队员/功能统计归因上报（2026-09-13 统计覆盖规则）：
// 网关路由层看不见的功能命中（关键词回答/DDL 确认/值日指令等）回报到
// 网关 POST /api/usage/report——只记功能与活跃，不影响任何业务流程。
// 2026-09-22 活跃口径修正：娱乐功能（抽奖/关键词回答等）不计入队员活跃，
// 上报时带 opts.fun 标记；抽奖另带 opts.learn（触发词数组）供网关把
// '/触发词' 路由记录学进娱乐清单。规则见顶层 AGENTS「队员/功能统计上报规则」。
// 上报失败静默忽略（fire-and-forget，3s 超时）。
// ============================================================

const config = require('../config');

// 网关地址统一走 config.gateway（GATEWAY_URL），与本仓其他网关消费方（workloadService 等）同源；
// 旧独立键 USAGE_REPORT_URL 已废弃不再读取（.env 残留该键无副作用，见 .env.example 标注）
const URL = `${config.gateway.url}/api/usage/report`;
const TOKEN = process.env.API_TOKEN || '';
const TIMEOUT_MS = 3000;

function report(openId, feature, opts = {}) {
  if (!openId || !feature) return;
  const body = { openId, feature };
  if (opts.fun) body.fun = 1;
  if (Array.isArray(opts.learn) && opts.learn.length) body.learn = opts.learn;
  fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': TOKEN },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err) => console.warn(`[统计上报] ${feature} 上报失败（忽略）:`, err.message));
}

module.exports = { report };
