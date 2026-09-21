/**
 * stub-test-status-fleet.js — /status 舰队健康段 stub 测试（不触网：劫持 global fetch）
 *
 * 背景（2026-09-21 用户需求「不连开发内网也能看运维状态」）：/status（管理员私聊白名单）
 * 新增部署目标本机全服务健康快照段——7 服务 health 探测 + 网关长连接/投递统计。
 * 管理员人在外网时经飞书私聊即可远程看状态。
 * 本测试锁定：7 服务逐行输出、单服务僵死显示 ❌ 无响应、网关深度行（ws running/异常 + 投递计数）。
 * 运行：node scripts/stub-test-status-fleet.js
 */

const chatService = require('../src/services/chatService');

const originalFetch = globalThis.fetch;
let wsState = 'running';
let delivery = { ok: 42, failed: 1 };

globalThis.fetch = async (url) => {
  const u = String(url);
  const m = /127\.0\.0\.1:(\d+)\/api\/health/.exec(u);
  if (!m) throw new Error('unexpected url: ' + u);
  const port = Number(m[1]);
  if (port === 3002) throw new Error('connect ECONNREFUSED 127.0.0.1:3002'); // 模拟僵死
  if (port === 3010) {
    return { ok: true, status: 200, json: async () => ({ status: 'ok', ws: wsState, delivery }) };
  }
  return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
};

let failed = 0;
function assert(name, cond) {
  if (cond) {
    console.log('  ok -', name);
  } else {
    failed++;
    console.error('  FAIL -', name);
  }
}

async function main() {
  console.log('== stub-test-status-fleet ==');

  const lines = await chatService.fleetHealthLines();
  const text = lines.join('\n');

  assert('标题行存在', lines[0].includes('舰队健康'));
  assert('7 个服务各占一行', lines.filter((l) => /:\d{4}\)/.test(l)).length === 7);
  assert('健康服务显示 ✅（抽查 3000/3006/3007）', /✅ hub 对话枢纽\(:3000\)/.test(text) && /✅ duty 值日\(:3006\)/.test(text) && /✅ wecom 考勤周报\(:3007\)/.test(text));
  assert('僵死服务显示 ❌ 无响应（3002）', /❌ approval 财务审批\(:3002\) 无响应/.test(text));
  assert('网关深度行：ws running', /网关长连接：✅ running/.test(text));
  assert('网关深度行：投递计数', /投递计数 ok=42 failed=1/.test(text));

  // 网关长连接异常形态
  wsState = 'disconnected';
  delivery = { ok: 7, failed: 0 };
  const lines2 = (await chatService.fleetHealthLines()).join('\n');
  assert('长连接异常显示 ❌ disconnected', /网关长连接：❌ disconnected/.test(lines2));

  // 网关 health 详情读取失败降级（探测成功、详情调用失败）
  let gwCalls = 0;
  globalThis.fetch = async (url) => {
    if (/127\.0\.0\.1:3010\/api\/health/.test(String(url))) {
      gwCalls++;
      if (gwCalls === 1) return { ok: true, status: 200, json: async () => ({}) };
      throw new Error('timeout');
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const lines3 = await chatService.fleetHealthLines();
  assert('网关详情读取失败降级为 ⚠️ 不抛错', lines3.some((l) => l.includes('详情读取失败')));

  globalThis.fetch = originalFetch;

  if (failed > 0) {
    console.error(`stub-test-status-fleet: ${failed} 项失败`);
    process.exit(1);
  }
  console.log('stub-test-status-fleet: 全部通过');
}

main().catch((e) => { console.error('stub-test-status-fleet: 异常退出:', e); globalThis.fetch = originalFetch; process.exit(1); });
