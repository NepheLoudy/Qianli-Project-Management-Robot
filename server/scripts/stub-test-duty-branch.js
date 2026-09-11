/**
 * hub 值日分支 stub 测试（不触飞书：mock bot 回复捕获 + 本地占位 duty 服务）
 * 覆盖：值日管辖策略驱动（duty-bot /api/duty/policy 下发 + 失联兜底）下的
 *      「看板触发词」转发、关键词回答放行（@与未@，策略开关）、基础指令关闭、
 *      p2p 值日指令放行（策略清单）、p2p 图片最小转发、非值日能力不受影响。
 * 运行：node scripts/stub-test-duty-branch.js
 */
const http = require('http');

// ---- 环境与占位（必须先于 require src 模块） ----
process.env.DUTY_CHAT_ID = 'oc_duty_group_test';
process.env.DUTY_SERVICE_URL = 'http://127.0.0.1:39006';

const captured = { dutyPayloads: [], botReplies: [] };

// 占位 duty 服务（:39006）：管辖策略下发 + 指令载荷记录。
// policyState.payload：null → 下发 defaultPolicy()；'FAIL' → 模拟 duty-bot 不可用；对象 → 原样下发
const policyState = { payload: null };

function defaultPolicy() {
  return {
    groupChatIds: ['oc_duty_group_test'],
    hubEnforcement: {
      groupBoardCommand: '值日助手',
      closeBasicCommands: true,
      keywordPassthrough: true,
      fallbackGuidance: '🧹 本群为值日/快递申领专用群：@我 发送「值日助手」查看今日值日，关键词彩蛋照常有效\n（查询排班、请假、打卡确认请私信机器人）',
    },
    p2pCommands: ['值日助手', '我要请假', '查询我的下一次值日', '是', '否', '生成排班表'],
    p2pCommandPrefixes: ['绑定'],
  };
}

const dutyServer = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/api/duty/policy')) {
    if (policyState.payload === 'FAIL') {
      res.statusCode = 500;
      return res.end('{}');
    }
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(policyState.payload || defaultPolicy()));
  }
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
const dutyPolicy = require('../src/services/dutyPolicyService');
const config = require('../src/config');

let failed = 0;
function check(desc, cond, detail = '') {
  if (cond) console.log(`✓ ${desc}`);
  else { failed += 1; console.error(`❌ ${desc}${detail ? ` —— ${detail}` : ''}`); }
}

function groupEvent(text, msgId, chatId = 'oc_duty_group_test') {
  return {
    message: {
      message_id: msgId,
      message_type: 'text',
      chat_type: 'group',
      chat_id: chatId,
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

function unAtEvent(text, msgId, chatId = 'oc_duty_group_test') {
  return {
    message: {
      message_id: msgId,
      message_type: 'text',
      chat_type: 'group',
      chat_id: chatId,
      content: JSON.stringify({ text }),
    },
    sender: { sender_id: { open_id: 'ou_member_1' }, sender_type: 'user' },
  };
}

(async () => {
  await new Promise((r) => dutyServer.listen(39006, r));
  check('配置加载：值日群/服务地址来自 env', config.duty.chatId === 'oc_duty_group_test' && config.duty.serviceUrl.includes('39006'));

  // ① 值日管辖群：看板触发词放行并转发（管辖群与触发词均来自策略下发）
  await chatService.processChatMessage(groupEvent('值日助手', 'm1'));
  check('值日群「值日助手」→ 转发群看板载荷', captured.dutyPayloads.some((p) => p.command === '值日助手' && p.chatType === 'group' && p.chatId === 'oc_duty_group_test'));
  check('值日群「值日助手」→ 回执已回复', captured.botReplies.some((r) => r.messageId === 'm1' && r.text.includes('占位回执')));

  // ② 值日管辖群：基础指令按策略关闭（值日群引导语）
  await chatService.processChatMessage(groupEvent('/help', 'm2'));
  check('值日群「/help」→ 值日群引导语', captured.botReplies.some((r) => r.messageId === 'm2' && r.text.includes('值日/快递申领专用群')));
  check('值日群「/help」未返回帮助内容', !captured.botReplies.some((r) => r.messageId === 'm2' && r.text.includes('可用指令')));

  // ③ 值日管辖群：未命中关键词的普通对话 → 引导语（不进欢迎语流程）
  await chatService.processChatMessage(groupEvent('你好呀', 'm3'));
  check('值日群普通对话 → 值日群引导语', captured.botReplies.some((r) => r.messageId === 'm3' && r.text.includes('值日/快递申领专用群')));

  // ③′ 值日管辖群：@ 关键词命中 → 关键词回答放行（不转发 duty、非引导语）
  await chatService.processChatMessage(groupEvent('大狗大狗请叫叫', 'm3k'));
  const m3k = captured.botReplies.find((r) => r.messageId === 'm3k');
  check('值日群 @关键词 → 关键词回答（非引导语）', !!m3k && !m3k.text.includes('值日/快递申领专用群') && !m3k.text.includes('占位回执'), m3k && m3k.text);
  check('值日群 @关键词 未被转发到值日服务', !captured.dutyPayloads.some((p) => (p.command || '').includes('大狗')));

  // ③″ 值日管辖群：未@消息关键词命中 → 照常自动回答（策略 keywordPassthrough）
  const autoResult = await autoReplyService.processMessageEvent(unAtEvent('小狗小狗', 'm3u'));
  check('值日群未@关键词 → 自动回答命中', autoResult.matched === true, JSON.stringify(autoResult));
  check('值日群未@关键词 → 已回复', captured.botReplies.some((r) => r.messageId === 'm3u' && r.text.length > 0));

  // ④ p2p 值日指令（策略清单）：绕过私聊白名单
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

  // ⑦ 普通群（非管辖群）/help 仍是完整帮助（含值日段）
  await chatService.processChatMessage(groupEvent('/help', 'm7', 'oc_normal_group'));
  check('普通群 /help → 完整帮助且含值日段', captured.botReplies.some((r) => r.messageId === 'm7' && r.text.includes('值日指令（转发 duty-bot')));
  check('普通群 /help 未被转发到值日服务', !captured.dutyPayloads.some((p) => p.command === '/help'));

  // ===== 管辖策略驱动场景（改策略 + 清缓存） =====

  // ⑧ 策略扩管辖群：新群享受值日分支（管辖范畴来自策略，而非 env）
  policyState.payload = { ...defaultPolicy(), groupChatIds: ['oc_duty_group_test', 'oc_policy_group'] };
  dutyPolicy.resetCacheForTests();
  await chatService.processChatMessage(groupEvent('值日助手', 'm8', 'oc_policy_group'));
  check('策略扩管辖：新管辖群「值日助手」→ 转发看板', captured.dutyPayloads.some((p) => p.command === '值日助手' && p.chatId === 'oc_policy_group'));

  // ⑨ 策略外的群不进值日分支（env DUTY_CHAT_ID 之外的群发看板词 → 常规流程接管）
  dutyPolicy.resetCacheForTests();
  await chatService.processChatMessage(groupEvent('值日助手', 'm9', 'oc_outsider_group'));
  check('非管辖群 @值日助手 → 不转发看板', !captured.dutyPayloads.some((p) => p.command === '值日助手' && p.chatId === 'oc_outsider_group'));
  check('非管辖群 @值日助手 → 常规回复接管', captured.botReplies.some((r) => r.messageId === 'm9' && r.text.length > 0));

  // ⑩ 策略关关键词放行：@关键词回引导语、未@关键词不再回复
  policyState.payload = { ...defaultPolicy(), hubEnforcement: { ...defaultPolicy().hubEnforcement, keywordPassthrough: false } };
  dutyPolicy.resetCacheForTests();
  await chatService.processChatMessage(groupEvent('大狗大狗请叫叫', 'm10a'));
  check('策略关关键词：@关键词 → 引导语', captured.botReplies.some((r) => r.messageId === 'm10a' && r.text.includes('值日/快递申领专用群')));
  const r10 = await autoReplyService.processMessageEvent(unAtEvent('小狗小狗', 'm10b'));
  check('策略关关键词：未@命中 → 不回复', r10.matched === false && (r10.reason || '').includes('值日管辖群'), JSON.stringify(r10));

  // ⑪ 策略不关基础指令：@/help 落回常规指令流程
  policyState.payload = { ...defaultPolicy(), hubEnforcement: { ...defaultPolicy().hubEnforcement, closeBasicCommands: false } };
  dutyPolicy.resetCacheForTests();
  await chatService.processChatMessage(groupEvent('/help', 'm11'));
  check('策略不关指令：@/help → 常规帮助（含值日段）', captured.botReplies.some((r) => r.messageId === 'm11' && r.text.includes('值日指令（转发 duty-bot')));

  // ⑫ p2p 指令清单来自策略：清单外指令不转发
  policyState.payload = { ...defaultPolicy(), p2pCommands: ['签到'], p2pCommandPrefixes: [] };
  dutyPolicy.resetCacheForTests();
  await chatService.processChatMessage(p2pEvent('签到', 'm12a'));
  check('策略 p2p 清单：签到 → 转发', captured.dutyPayloads.some((p) => p.command === '签到' && p.messageId === 'm12a'));
  await chatService.processChatMessage(p2pEvent('我要请假', 'm12b'));
  check('策略 p2p 清单外：我要请假 → 不转发', !captured.dutyPayloads.some((p) => p.command === '我要请假' && p.messageId === 'm12b'));

  // ⑬ duty-bot 失联：兜底策略（env DUTY_CHAT_ID + 默认规则）短暂接管
  policyState.payload = 'FAIL';
  dutyPolicy.resetCacheForTests();
  await chatService.processChatMessage(groupEvent('你好呀', 'm13a'));
  check('duty-bot 失联：兜底策略仍管辖 env 配置群', captured.botReplies.some((r) => r.messageId === 'm13a' && r.text.includes('值日/快递申领专用群')));
  await chatService.processChatMessage(p2pEvent('我要请假', 'm13b'));
  check('duty-bot 失联：兜底 p2p 清单仍放行值日指令', captured.dutyPayloads.some((p) => p.command === '我要请假' && p.messageId === 'm13b'));

  policyState.payload = null;
  dutyPolicy.resetCacheForTests();
  dutyServer.close();
  console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
