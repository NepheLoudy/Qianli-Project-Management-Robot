// 桩测试：审批群「接取」链路——裸词匹配（matchApprovalTake）与转发契约
// （handleApprovalCommand 身份字段透传：senderName/senderId 供 approval-bot 登记接取人）。
// 全离线：mock 全局 fetch。运行：node scripts/stub-test-approval-take.js
const assert = require('assert/strict');

// ---- 环境占位（先于 require src 模块） ----
process.env.APPROVAL_CHAT_ID = process.env.APPROVAL_CHAT_ID || 'oc_approval_test';
process.env.APPROVAL_SERVICE_URL = process.env.APPROVAL_SERVICE_URL || 'http://127.0.0.1:39002';

const chatService = require('../src/services/chatService');

async function main() {
  // ---------- 单元：matchApprovalTake（裸词接取匹配） ----------
  assert.deepEqual(chatService.matchApprovalTake('接取'), { args: [] }, '裸「接取」');
  assert.deepEqual(chatService.matchApprovalTake('接取 27对抗赛飞镖24'), { args: ['27对抗赛飞镖24'] }, '带批次号');
  assert.deepEqual(chatService.matchApprovalTake('  接取  '), { args: [] }, '首尾空白容忍');
  assert.deepEqual(chatService.matchApprovalTake('接取。'), { args: [] }, '尾部标点容忍');
  assert.deepEqual(chatService.matchApprovalTake('接取！'), { args: [] }, '尾部叹号容忍');
  assert.deepEqual(chatService.matchApprovalTake('接取 27备赛20步兵5 '), { args: ['27备赛20步兵5'] }, '尾随空白');
  assert.equal(chatService.matchApprovalTake('接个取'), null, '非接取词不命中');
  assert.equal(chatService.matchApprovalTake('取接'), null, '倒序不命中');
  assert.equal(chatService.matchApprovalTake(''), null, '空文本');
  assert.equal(chatService.matchApprovalTake('/approval-batch status'), null, '斜杠指令不归接取分支');
  assert.deepEqual(chatService.matchApprovalTake('接取 27备赛20步兵5 备注'), { args: ['27备赛20步兵5', '备注'] }, '多参数切分');

  // ---------- 转发契约：handleApprovalCommand 透传发送者身份 ----------
  const captured = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    captured.push({ url: String(url), body: JSON.parse(opts.body || '{}') });
    return { ok: true, json: async () => ({ reply: '✅ 批次已接取' }) };
  };
  try {
    const reply = await chatService.handleApprovalCommand('接取', ['27对抗赛飞镖24'], { name: '贺韵洁', id: 'ou_test' });
    assert.equal(reply, '✅ 批次已接取');
    assert.equal(captured.length, 1);
    assert.ok(captured[0].url.includes('/api/chat/command'), '转发到 /api/chat/command');
    assert.deepEqual(captured[0].body, {
      command: '接取',
      args: ['27对抗赛飞镖24'],
      senderName: '贺韵洁',
      senderId: 'ou_test',
    }, '转发载荷带身份字段（登记接取人用）');

    // 不带 sender（既有 /approval-* 调用方兼容）：身份字段为空串
    captured.length = 0;
    await chatService.handleApprovalCommand('/approval-batch', ['status']);
    assert.deepEqual(captured[0].body, { command: '/approval-batch', args: ['status'], senderName: '', senderId: '' }, '既有调用兼容（身份空串）');
  } finally {
    global.fetch = realFetch;
  }
}

(async () => {
  await main();
  console.log('✅ stub-test-approval-take 全部通过');
  process.exit(0);
})().catch((err) => {
  console.error('❌ stub-test-approval-take 失败:', err);
  process.exit(1);
});
