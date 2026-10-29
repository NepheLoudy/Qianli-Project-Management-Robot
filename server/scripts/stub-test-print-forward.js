/**
 * hub 打印指令转发 stub 测试（不触飞书/不触打印服务：mock bot + 捕获 fetch 载荷）
 * 覆盖（2026-10-29 跨工作区交付：bambu /print-bind 自助绑定）：
 *  - /print-* 转发体带 senderId（飞书 open_id），且 command/args 原样不变；
 *  - 所有 /print-* 指令统一透传（查看类不受影响）；
 *  - 事件缺 sender 时 senderId 以空串占位（接收端自行降级，不抛错）；
 *  - 非 /print-* 指令不落打印转发链路。
 * 运行：node server/scripts/stub-test-print-forward.js
 */
const http = require('http');

const PRINT_URL = 'http://127.0.0.1:39009';
process.env.PRINT_SERVER_URL = PRINT_URL;
process.env.DUTY_SERVICE_URL = 'http://127.0.0.1:39008';

const captured = { printForwards: [], botReplies: [], usageReports: [] };

const realFetch = global.fetch;
global.fetch = (url, opts = {}) => {
  const urlStr = String(url);
  if (urlStr.includes('/api/usage/report')) {
    try { captured.usageReports.push(JSON.parse(opts.body || '{}')); } catch (err) { /* 忽略 */ }
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  }
  if (urlStr.startsWith(PRINT_URL) && urlStr.includes('/api/chat/command')) {
    try { captured.printForwards.push({ url: urlStr, body: JSON.parse(opts.body || '{}') }); } catch (err) { /* 忽略 */ }
    return Promise.resolve({ ok: true, json: async () => ({ reply: '占位打印回执' }) });
  }
  return realFetch(url, opts);
};

// 占位值日策略服务：测试群不在管辖清单，值日分支直接放行（避免兜底策略把群当管辖群）
const dutyServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ groupChatIds: ['oc_duty_group_test'], hubEnforcement: {} }));
});

// mock 飞书 bot 层（捕获回复，不触网）
require.cache[require.resolve('../src/feishu/bot')] = {
  id: 'bot-stub', filename: 'bot-stub', loaded: true, exports: {
    async replyTextMessage(messageId, text) { captured.botReplies.push({ messageId, text }); return {}; },
    async sendTextToChat() { return {}; },
    async sendTextToUser() { return {}; },
  },
};

const chatService = require('../src/services/chatService');

let failed = 0;
function check(desc, cond, detail = '') {
  if (cond) console.log(`✓ ${desc}`);
  else { failed += 1; console.error(`❌ ${desc}${detail ? ` —— ${detail}` : ''}`); }
}

function groupEvent(text, msgId, sender = { sender_id: { open_id: 'ou_print_user', name: '打印队员' } }) {
  return {
    message: {
      message_id: msgId,
      message_type: 'text',
      chat_type: 'group',
      chat_id: 'oc_print_group',
      content: JSON.stringify({ text: `@_bot_1 ${text}` }),
      mentions: [{ key: '@_bot_1', id: { open_id: 'ou_bot' }, mentioned_type: 'bot', name: '爆米花机-对话型' }],
    },
    sender,
  };
}

(async () => {
  await new Promise((r) => dutyServer.listen(39008, r));

  // ① 自助绑定：command/args 原样 + senderId 透传
  await chatService.processChatMessage(groupEvent('/print-bind 123456', 'pf1'));
  const bind = captured.printForwards.find((f) => f.body.command === '/print-bind');
  check('「/print-bind 123456」→ 转发到打印服务', !!bind && bind.url === `${PRINT_URL}/api/chat/command`, JSON.stringify(captured.printForwards));
  check('绑定指令 args 原样透传', !!bind && Array.isArray(bind.body.args) && bind.body.args[0] === '123456', bind && JSON.stringify(bind.body));
  check('绑定指令透传 senderId（飞书 open_id）', !!bind && bind.body.senderId === 'ou_print_user', bind && JSON.stringify(bind.body));
  check('打印服务回执已回复用户', captured.botReplies.some((r) => r.messageId === 'pf1' && r.text.includes('占位打印回执')));

  // ② 查看类指令同样透传（接收端会忽略多余字段，契约统一）
  await chatService.processChatMessage(groupEvent('/print-status', 'pf2'));
  const status = captured.printForwards.find((f) => f.body.command === '/print-status');
  check('「/print-status」→ 透传 senderId（所有 /print-* 统一口径）', !!status && status.body.senderId === 'ou_print_user', status && JSON.stringify(status.body));

  // ③ 事件缺 sender：senderId 以空串占位（接收端按未透传降级，不在 hub 侧抛错）
  await chatService.processChatMessage(groupEvent('/print-bind 654321', 'pf3', {}));
  const noSender = captured.printForwards.find((f) => f.body.command === '/print-bind' && f.body.args[0] === '654321');
  check('缺发送者身份 → senderId 空串（不省略键）', !!noSender && noSender.body.senderId === '', noSender && JSON.stringify(noSender.body));

  // ④ 非打印指令不落打印链路
  await chatService.processChatMessage(groupEvent('/help', 'pf4'));
  check('「/help」不转发到打印服务', !captured.printForwards.some((f) => f.body.command === '/help'));

  dutyServer.close();
  console.log(failed === 0 ? '\n全部断言通过' : `\n${failed} 条断言失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('测试异常:', err);
  dutyServer.close();
  process.exit(1);
});
