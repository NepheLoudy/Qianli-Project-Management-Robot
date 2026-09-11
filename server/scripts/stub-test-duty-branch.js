/**
 * hub 值日分支 stub 测试（不触飞书：mock bot 回复捕获 + 本地占位 duty 服务）
 * 覆盖：值日专用群放行「值日助手」看板与关键词回答（@与未@，基础指令仍关闭）、
 *      p2p 值日指令放行（绕过私聊白名单）、p2p 图片最小转发、非值日能力不受影响。
 * 运行：node scripts/stub-test-duty-branch.js
 */
const http = require('http');

// ---- 环境与占位（必须先于 require src 模块） ----
process.env.DUTY_CHAT_ID = 'oc_duty_group_test';
process.env.DUTY_SERVICE_URL = 'http://127.0.0.1:39006';

const captured = { dutyPayloads: [], botReplies: [] };

// 占位 duty 服务（:39006）：记录载荷并回执
const dutyServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    captured.dutyPayloads.push(payload);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ reply: `占位回执:${payload.command || payload.type || ''}` }));
  });
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
const autoReplyService = require('../src/services/autoReplyService');
const config = require('../src/config');

let failed = 0;
function check(desc, cond, detail = '') {
  if (cond) console.log(`✓ ${desc}`);
  else { failed += 1; console.error(`❌ ${desc}${detail ? ` —— ${detail}` : ''}`); }
}

function groupEvent(text, msgId) {
  return {
    message: {
      message_id: msgId,
      message_type: 'text',
      chat_type: 'group',
      chat_id: 'oc_duty_group_test',
      content: JSON.stringify({ text: `@_bot_1 ${text}` }),
      mentions: [{ key: '@_bot_1', id: { open_id: 'ou_bot' }, mentioned_type: 'bot', name: '爆米花机-对话型' }],
    },
    sender: { sender_id: { open_id: 'ou_member_1', name: '队员甲' } },
  };
}

function p2pEvent(text, msgId, extra = {}) {
  return {
    message: {
      message_id: msgId,
      message_type: extra.message_type || 'text',
      chat_type: 'p2p',
      chat_id: `oc_p2p_${msgId}`,
      content: extra.content || JSON.stringify({ text }),
      ...extra,
    },
    sender: { sender_id: { open_id: 'ou_member_1', name: '队员甲' } },
  };
}

(async () => {
  await new Promise((r) => dutyServer.listen(39006, r));
  check('配置加载：值日群/服务地址来自 env', config.duty.chatId === 'oc_duty_group_test' && config.duty.serviceUrl.includes('39006'));

  // ① 值日专用群：值日助手 放行并转发
  await chatService.processChatMessage(groupEvent('值日助手', 'm1'));
  check('值日群「值日助手」→ 转发群看板载荷', captured.dutyPayloads.some((p) => p.command === '值日助手' && p.chatType === 'group' && p.chatId === 'oc_duty_group_test'));
  check('值日群「值日助手」→ 回执已回复', captured.botReplies.some((r) => r.messageId === 'm1' && r.text.includes('占位回执')));

  // ② 值日专用群：基础指令仍被拒（值日群引导语）
  await chatService.processChatMessage(groupEvent('/help', 'm2'));
  check('值日群「/help」→ 值日群引导语', captured.botReplies.some((r) => r.messageId === 'm2' && r.text.includes('值日/快递申领专用群')));
  check('值日群「/help」未返回帮助内容', !captured.botReplies.some((r) => r.messageId === 'm2' && r.text.includes('可用指令')));

  // ③ 值日专用群：未命中关键词的普通对话 → 引导语（不进欢迎语流程）
  await chatService.processChatMessage(groupEvent('你好呀', 'm3'));
  check('值日群普通对话 → 值日群引导语', captured.botReplies.some((r) => r.messageId === 'm3' && r.text.includes('值日/快递申领专用群')));

  // ③′ 值日专用群：@ 关键词命中 → 关键词回答放行（不转发 duty、非引导语）
  await chatService.processChatMessage(groupEvent('大狗大狗请叫叫', 'm3k'));
  const m3k = captured.botReplies.find((r) => r.messageId === 'm3k');
  check('值日群 @关键词 → 关键词回答（非引导语）', !!m3k && !m3k.text.includes('值日/快递申领专用群') && !m3k.text.includes('占位回执'), m3k && m3k.text);
  check('值日群 @关键词 未被转发到值日服务', !captured.dutyPayloads.some((p) => (p.command || '').includes('大狗')));

  // ③″ 值日专用群：未@消息关键词命中 → 照常自动回答
  const unmentioned = {
    message: {
      message_id: 'm3u',
      message_type: 'text',
      chat_type: 'group',
      chat_id: 'oc_duty_group_test',
      content: JSON.stringify({ text: '小狗小狗' }),
    },
    sender: { sender_id: { open_id: 'ou_member_1' }, sender_type: 'user' },
  };
  const autoResult = await autoReplyService.processMessageEvent(unmentioned);
  check('值日群未@关键词 → 自动回答命中', autoResult.matched === true, JSON.stringify(autoResult));
  check('值日群未@关键词 → 已回复', captured.botReplies.some((r) => r.messageId === 'm3u' && r.text.length > 0));

  // ④ p2p 值日指令：绕过私聊白名单
  for (const t of ['值日助手', '我要请假', '查询我的下一次值日', '是', '否', '生成排班表', '绑定 队员C']) {
    await chatService.processChatMessage(p2pEvent(t, `p_${t}`));
  }
  check('p2p 七类值日指令全部转发', captured.dutyPayloads.filter((p) => p.chatType === 'p2p' && p.command).length === 7,
    JSON.stringify(captured.dutyPayloads.map((p) => p.command)));
  check('p2p 绑定指令原文转发（duty-bot 侧解析姓名）', captured.dutyPayloads.some((p) => p.command === '绑定 队员C'));

  // ⑤ p2p 图片：最小转发
  await chatService.processChatMessage(p2pEvent('', 'img1', {
    message_type: 'image',
    content: JSON.stringify({ image_key: 'ik_test_123' }),
  }));
  const imgPayload = captured.dutyPayloads.find((p) => p.type === 'image');
  check('p2p 图片 → 转发 image_key', imgPayload && imgPayload.imageKey === 'ik_test_123' && imgPayload.openId === 'ou_member_1', JSON.stringify(imgPayload));

  // ⑥ 非值日能力不受影响：p2p 非白名单 /status 仍被白名单拦截
  await chatService.processChatMessage(p2pEvent('/status', 's1'));
  check('p2p 非白名单基础指令仍被拦截', captured.botReplies.some((r) => r.messageId === 's1' && r.text.includes('私聊指令暂未开放')));
  check('基础指令未被转发到值日服务', !captured.dutyPayloads.some((p) => p.command === '/status'));

  // ⑦ 普通群（非值日群）/help 仍是完整帮助（含值日段）
  const normalGroup = groupEvent('/help', 'm7');
  normalGroup.message.chat_id = 'oc_normal_group';
  await chatService.processChatMessage(normalGroup);
  check('普通群 /help → 完整帮助且含值日段', captured.botReplies.some((r) => r.messageId === 'm7' && r.text.includes('值日指令（转发 duty-bot')));
  check('普通群 /help 未被转发到值日服务', !captured.dutyPayloads.some((p) => p.command === '/help'));

  dutyServer.close();
  console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
