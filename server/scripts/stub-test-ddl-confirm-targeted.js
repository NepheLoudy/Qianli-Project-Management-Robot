/**
 * stub-test-ddl-confirm-targeted.js — DDL 逾期确认「编号定向回复」stub 测试（不触飞书）
 *
 * 背景：2026-09-21 用户反馈——同一人多个项目同时逾期时，确认私聊回复没有区分性
 * （旧逻辑裸「是」恒完成「最近发送的一条」，会完成错的项目；项目名相同时更无从分辨）。
 * 方案：确认私聊带「确认编号 N」并教学定向回复；解析「编号+是/否」（如「2 是」）；
 * 私聊多项目裸回复不再猜最新一条，改回编号清单引导定向。
 * 本测试锁定：编号解析、定向完成、裸回复引导、编号不存在提示、单项目裸回复兼容（旧行为）、
 * 普通文本不被误判为定向回复。
 * 运行：node scripts/stub-test-ddl-confirm-targeted.js
 */

// ---- 占位（必须先于 require src 模块） ----
const captured = { p2pSends: [], updates: [] };

require.cache[require.resolve('../src/feishu/bot')] = {
  id: 'bot-stub', filename: 'bot-stub', loaded: true, exports: {
    async replyTextMessage() { return {}; },
    async sendTextToChat() { return {}; },
    async sendTextToUser(openId, text) { captured.p2pSends.push({ openId, text }); return {}; },
  },
};
require.cache[require.resolve('../src/services/projectService')] = {
  id: 'projectService-stub', filename: 'projectService-stub', loaded: true, exports: {
    async updateProject(projectId, patch) { captured.updates.push({ projectId, patch }); return {}; },
  },
};
require.cache[require.resolve('../src/services/usageReport')] = {
  id: 'usageReport-stub', filename: 'usageReport-stub', loaded: true, exports: { report() {} },
};

const confirm = require('../src/services/ddlConfirmService');

let failed = 0;
function assert(name, cond) {
  if (cond) {
    console.log('  ok -', name);
  } else {
    failed++;
    console.error('  FAIL -', name);
  }
}
function reset() {
  captured.p2pSends.length = 0;
  captured.updates.length = 0;
  confirm.pendingConfirmations.delete('ou_t');
}
function injectPending(seq, projectId, projectName) {
  const list = confirm.pendingConfirmations.get('ou_t') || [];
  list.push({ projectId, projectName, ownerName: '张三', ownerOpenId: 'ou_t', seq, sentAt: Date.now(), sentMode: 'p2p', chatId: null });
  confirm.pendingConfirmations.set('ou_t', list);
}
function replyEvent(messageId, text) {
  return {
    message: { chat_type: 'p2p', chat_id: 'oc_p2p_x', message_id: messageId, message_type: 'text', content: { text } },
    sender: { sender_id: { open_id: 'ou_t' } },
  };
}

async function main() {
// ---- 1. parseTargetedReply 纯解析 ----
console.log('== parseTargetedReply ==');
assert('"2 是" → seq 2 / yes', JSON.stringify(confirm.parseTargetedReply('2 是')) === JSON.stringify({ seq: 2, reply: 'yes' }));
assert('"2是" 紧贴形态', confirm.parseTargetedReply('2是').seq === 2 && confirm.parseTargetedReply('2是').reply === 'yes');
assert('"2：还没" 全角冒号 + 否认', confirm.parseTargetedReply('2：还没').reply === 'no');
assert('"#3 是" 井号前缀', confirm.parseTargetedReply('#3 是').seq === 3);
assert('"2" 无词不判定向', confirm.parseTargetedReply('2').seq === null);
assert('"234001: invalid request param." 普通文本不误判', confirm.parseTargetedReply('234001: invalid request param.').seq === null);
assert('"12 完成了" 两位数+变体词', confirm.parseTargetedReply('12 完成了').seq === 12 && confirm.parseTargetedReply('12 完成了').reply === 'yes');
assert('"ok" 裸词 seq 为 null', confirm.parseTargetedReply('ok').seq === null);

// ---- 2. 发送侧：确认编号入文案与记录 ----
console.log('== sendOverdueConfirmation 编号 ==');
reset();
const s1 = await confirm.sendOverdueConfirmation({ id: 'p1', name: '项目A', category: '装配', ddl: '2026-09-18', daysLeft: -3, owner: 'ou_t', ownerName: '张三' });
const s2 = await confirm.sendOverdueConfirmation({ id: 'p2', name: '项目B', category: '装配', ddl: '2026-09-19', daysLeft: -2, owner: 'ou_t', ownerName: '张三' });
assert('连续发送编号递增（1、2）', s1.sent && s2.sent && /确认编号 1/.test(captured.p2pSends[0].text) && /确认编号 2/.test(captured.p2pSends[1].text));
assert('文案教学定向回复（含「编号+是/否」与示例）', /编号\+是\/否/.test(captured.p2pSends[1].text) && /2 是/.test(captured.p2pSends[1].text));
const stored = confirm.pendingConfirmations.get('ou_t');
assert('待确认记录带 seq 且按发送序', stored.length === 2 && stored[0].seq === 1 && stored[1].seq === 2);

// ---- 3. 多项目裸「是」→ 引导，不完成任何项目 ----
console.log('== 多项目裸回复引导 ==');
reset();
injectPending(1, 'p1', '项目A');
injectPending(2, 'p2', '项目B');
const r1 = await confirm.handleReply(replyEvent('m1', '是'));
assert('裸「是」不完成任何项目', captured.updates.length === 0);
assert('回编号清单引导（含两个项目与示例）', captured.p2pSends.some(x => /多个项目待确认/.test(x.text) && /1\. 项目A/.test(x.text) && /2\. 项目B/.test(x.text)));
assert('两条待确认记录保留', (confirm.pendingConfirmations.get('ou_t') || []).length === 2);

// ---- 4. 定向「2 是」→ 只完成项目B ----
const r2 = await confirm.handleReply(replyEvent('m2', '2 是'));
assert('定向完成项目B（updateProject p2 completed）', captured.updates.length === 1 && captured.updates[0].projectId === 'p2' && captured.updates[0].patch.status === 'completed');
assert('项目A 仍待确认', (confirm.pendingConfirmations.get('ou_t') || []).length === 1 && confirm.pendingConfirmations.get('ou_t')[0].projectId === 'p1');

// ---- 5. 定向「1 还没」→ 保持状态 ----
const r3 = await confirm.handleReply(replyEvent('m3', '1 还没'));
assert('定向否认不写库', captured.updates.length === 1);
assert('否认后待确认清空', !confirm.pendingConfirmations.has('ou_t'));

// ---- 6. 编号不存在 → 提示当前清单 ----
reset();
injectPending(1, 'p1', '项目A');
injectPending(2, 'p2', '项目B');
await confirm.handleReply(replyEvent('m4', '9 是'));
assert('「9 是」不写库', captured.updates.length === 0);
assert('提示编号不存在并列当前清单', captured.p2pSends.some(x => /未找到编号 9/.test(x.text) && /1\. 项目A/.test(x.text)));

// ---- 7. 单项目裸「是」→ 旧行为兼容 ----
reset();
injectPending(1, 'p1', '项目A');
await confirm.handleReply(replyEvent('m5', '是'));
assert('单项目裸「是」照常完成', captured.updates.length === 1 && captured.updates[0].projectId === 'p1');

// ---- 8. 普通文本不误判定向，走未识别提示 ----
reset();
injectPending(1, 'p1', '项目A');
injectPending(2, 'p2', '项目B');
await confirm.handleReply(replyEvent('m6', '234001: invalid request param.'));
assert('日志串不触发任何定向/完成', captured.updates.length === 0 && !captured.p2pSends.some(x => /多个项目待确认/.test(x.text)));
assert('走「未识别」提示并列清单（多项目形态）', captured.p2pSends.some(x => /未识别你的回复/.test(x.text) && /1\. 项目A/.test(x.text)));

// ---- 9. getPendingStats 带 seq ----
reset();
injectPending(3, 'p9', '项目X');
const stat = confirm.getPendingStats().find(s => s.projectId === 'p9');
assert('getPendingStats 暴露 seq', stat && stat.seq === 3);

if (failed > 0) {
  console.error(`stub-test-ddl-confirm-targeted: ${failed} 项失败`);
  process.exit(1);
}
console.log('stub-test-ddl-confirm-targeted: 全部通过');
}
main().catch((e) => { console.error('stub-test-ddl-confirm-targeted: 异常退出:', e); process.exit(1); });
