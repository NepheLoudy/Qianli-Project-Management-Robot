/**
 * hub 值日分支 stub 测试（不触飞书：mock bot 回复捕获 + 本地占位 duty 服务）
 * 覆盖：值日管辖策略驱动（duty-bot /api/duty/policy 下发 + 失联兜底）下的
 *      「看板触发词」转发（裸词/带 / 双形态）、载荷 messageId、关键词回答放行
 *      （@与未@，策略开关）、基础指令关闭、@+纯图片静默、非管辖群值日指令提示、
 *      空管辖群列表=不限制、p2p 值日指令放行（策略清单）、打卡口语变体接管/落回、
 *      p2p 图片最小转发、非值日能力不受影响；回答表保留词校验已随「未@关键词回答全群统一」口径移除（2026-09-13）；
 *      抽奖动态指令集（v87）：/触发词 抽一次、奖池抽取/权重 0、普通群与值日群 @指令、未知指令不误吞、
 *      /lottery 指令、/help 动态指令段与运维指令隐藏、启停窗口、CRUD（.local.json 测试后按原状恢复）。
 * 运行：node scripts/stub-test-duty-branch.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// ---- 环境与占位（必须先于 require src 模块） ----
process.env.DUTY_CHAT_ID = 'oc_duty_group_test';
process.env.DUTY_SERVICE_URL = 'http://127.0.0.1:39006';

const captured = { dutyPayloads: [], botReplies: [], usageReports: [] };

// 捕获统计归因上报（usageReport 走全局 fetch 到网关 :3010，测试离线）：
// 断言 2026-09-22 活跃口径修正——娱乐功能上报带 fun 标记、抽奖带 learn 触发词
const realFetch = global.fetch;
global.fetch = (url, opts = {}) => {
  if (String(url).includes('/api/usage/report')) {
    try { captured.usageReports.push(JSON.parse(opts.body || '{}')); } catch (err) { /* 忽略 */ }
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  }
  return realFetch(url, opts);
};

// 占位 duty 服务（:39006）：管辖策略下发 + 指令载荷记录。
// policyState.payload：null → 下发 defaultPolicy()；'FAIL' → 模拟 duty-bot 不可用；对象 → 原样下发
const policyState = { payload: null };

function defaultPolicy() {
  return {
    groupChatIds: ['oc_duty_group_test'],
    hubEnforcement: {
      groupBoardCommand: '值日助手',
      closeBasicCommands: true,
      // keywordPassthrough 已随 v82 移除（关键词回答全群统一，hub 不再读取该 flag）
      fallbackGuidance: '🧹 @我 发送「值日助手」查看今日值日\n查询排班、请假、打卡确认请私信机器人',
    },
    p2pCommands: [
      '值日助手', '我要请假', '查询我的下一次值日', '是', '否', '生成排班表',
      '是的', '好', '好了', '完成', '完成了', '做完了', '搞定', '搞定了',
    ],
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
    // 模拟 duty-bot「无会话口语变体不接管」：handled=false + 空 reply → hub 落回常规流程
    if (payload.command === '好了') {
      return res.end(JSON.stringify({ handled: false, reply: '' }));
    }
    res.end(JSON.stringify({ reply: `占位回执:${payload.command || payload.type || ''}` }));
  });
});

// mock 飞书 bot 层（捕获回复，不触网）
require.cache[require.resolve('../src/feishu/bot')] = {
  id: 'bot-stub', filename: 'bot-stub', loaded: true, exports: {
    async replyTextMessage(messageId, text) { captured.botReplies.push({ messageId, text }); return {}; },
    async sendTextToChat() { return {}; },
    async sendTextToUser(openId, text) { captured.botReplies.push({ openId, messageId: `dm_${openId}_${text.length}`, text }); return {}; },
  },
};

const chatService = require('../src/services/chatService');
const autoReplyService = require('../src/services/autoReplyService');
const lotteryService = require('../src/services/lotteryService');
const dutyPolicy = require('../src/services/dutyPolicyService');
const config = require('../src/config');

// 抽奖私有配置快照（测试写 .local.json，结束按原状恢复/删除，防止测试残留随 push 覆盖现网种子）
const LOTTERY_LOCAL = path.join(__dirname, '../src/config/lottery.local.json');
const lotteryLocalBefore = fs.existsSync(LOTTERY_LOCAL) ? fs.readFileSync(LOTTERY_LOCAL, 'utf8') : null;

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

  // ① 值日管辖群：看板触发词放行并转发（管辖群与触发词均来自策略下发；载荷带 messageId）
  await chatService.processChatMessage(groupEvent('值日助手', 'm1'));
  check('值日群「值日助手」→ 转发群看板载荷（含 messageId）', captured.dutyPayloads.some((p) => p.command === '值日助手' && p.chatType === 'group' && p.chatId === 'oc_duty_group_test' && p.messageId === 'm1'));
  check('值日群「值日助手」→ 回执已回复', captured.botReplies.some((r) => r.messageId === 'm1' && r.text.includes('占位回执')));

  // ①′ 值日管辖群：带 / 前缀形态同样触达看板（hub 群门双形态匹配）
  await chatService.processChatMessage(groupEvent('/值日助手', 'm1s'));
  check('值日群「/值日助手」→ 转发群看板载荷', captured.dutyPayloads.some((p) => p.command === '/值日助手' && p.chatType === 'group' && p.messageId === 'm1s'));

  // ①″ 值日管辖群：@+纯图片（无文字）→ 静默吞掉，不回引导语、不转发
  await chatService.processChatMessage({
    message: {
      message_id: 'm1i',
      message_type: 'image',
      chat_type: 'group',
      chat_id: 'oc_duty_group_test',
      content: JSON.stringify({ image_key: 'ik_group_img' }),
      mentions: [{ key: '@_bot_1', id: { open_id: 'ou_bot' }, mentioned_type: 'bot', name: '爆米花机-对话型' }],
    },
    sender: { sender_id: { open_id: 'ou_member_1', name: '队员甲' } },
  });
  // 2026-09-17 快递助手口径：@+纯图片在快递群转为登记素材转发 duty-bot（无窗口 duty-bot 静默，用户侧仍无回复）
  check('值日群 @+纯图片 → 转发图片载荷（快递窗口登记素材）+ 回执来自 duty-bot',
    captured.dutyPayloads.some((p) => p.type === 'image' && p.chatType === 'group' && p.chatId === 'oc_duty_group_test' && p.messageId === 'm1i' && p.imageKey === 'ik_group_img')
    && captured.botReplies.some((r) => r.messageId === 'm1i' && r.text.includes('占位回执')));

  // ② 值日管辖群：基础指令按策略关闭（值日群引导语）
  await chatService.processChatMessage(groupEvent('/help', 'm2'));
  check('值日群「/help」→ 值日群引导语', captured.botReplies.some((r) => r.messageId === 'm2' && r.text.includes('查看今日值日')));
  check('值日群「/help」未返回帮助内容', !captured.botReplies.some((r) => r.messageId === 'm2' && r.text.includes('可用指令')));

  // ③ 值日管辖群：未命中关键词的普通对话 → 引导语（不进欢迎语流程）
  await chatService.processChatMessage(groupEvent('你好呀', 'm3'));
  check('值日群普通对话 → 值日群引导语', captured.botReplies.some((r) => r.messageId === 'm3' && r.text.includes('查看今日值日')));

  // ③′ 值日管辖群：@ 关键词命中 → 关键词回答放行（不转发 duty、非引导语）
  await chatService.processChatMessage(groupEvent('大狗大狗请叫叫', 'm3k'));
  const m3k = captured.botReplies.find((r) => r.messageId === 'm3k');
  check('值日群 @关键词 → 关键词回答（非引导语）', !!m3k && !m3k.text.includes('查看今日值日') && !m3k.text.includes('占位回执'), m3k && m3k.text);
  check('值日群 @关键词 未被转发到值日服务', !captured.dutyPayloads.some((p) => (p.command || '').includes('大狗')));

  // ③″ 值日管辖群：未@消息关键词命中 → 照常自动回答（关键词回答全群统一）
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

  // ④′ p2p 打卡口语变体：duty-bot 接管 → 转发并回执；未接管（好了=模拟无会话）→ 落回 hub 常规流程
  await chatService.processChatMessage(p2pEvent('完成了', 'p_done'));
  check('p2p「完成了」→ 转发 duty-bot', captured.dutyPayloads.some((p) => p.command === '完成了' && p.chatType === 'p2p' && p.messageId === 'p_done'));
  check('p2p「完成了」→ 转发回执已回复', captured.botReplies.some((r) => r.messageId === 'p_done' && r.text.includes('占位回执')));
  await chatService.processChatMessage(p2pEvent('好了', 'p_hao'));
  check('p2p「好了」→ 已转发 duty-bot（未接管空回执）', captured.dutyPayloads.some((p) => p.command === '好了' && p.messageId === 'p_hao'));
  const hao = captured.botReplies.find((r) => r.messageId === 'p_hao');
  check('p2p「好了」→ hub 落回常规流程（非占位回执）', !!hao && hao.text.length > 0 && !hao.text.includes('占位回执'), hao && hao.text);

  // ④″ R9（2026-09-15）：DDL 确认在 p2p 对值日词表让位——有待确认项目时，
  // 打卡主词/被 duty 接管的口语变体不再被 DDL 抢成「项目 completed」
  const ddlConfirmService = require('../src/services/ddlConfirmService');
  ddlConfirmService.pendingConfirmations.set('ou_member_1', [
    { projectId: 'proj_test_1', projectName: '测试项目R9', ownerName: '队员甲', sentAt: Date.now(), chatId: null, sentMode: 'p2p' },
  ]);
  const r9a = await ddlConfirmService.handleP2PReply(p2pEvent('打卡', 'r9_punch'));
  check('R9 有待确认时 p2p「打卡」→ duty 接管（handled）', r9a.handled === true && (r9a.reason || '').includes('值日'), JSON.stringify(r9a));
  check('R9「打卡」转发 duty-bot 带原命令', captured.dutyPayloads.some((p) => p.command === '打卡' && p.messageId === 'r9_punch'));
  check('R9「打卡」duty 回执转达用户', captured.botReplies.some((r) => r.openId === 'ou_member_1' && r.text.includes('占位回执:打卡')));
  check('R9「打卡」未消耗 DDL 待确认项（项目状态不被改）', ddlConfirmService.pendingConfirmations.get('ou_member_1').length === 1);
  const r9b = await ddlConfirmService.handleP2PReply(p2pEvent('是的', 'r9_yes'));
  check('R9 口语变体 duty 接管时同样让位', r9b.handled === true && (r9b.reason || '').includes('值日'), JSON.stringify(r9b));
  check('R9 DDL 待确认项全程未被消费', ddlConfirmService.pendingConfirmations.get('ou_member_1').length === 1);
  ddlConfirmService.pendingConfirmations.delete('ou_member_1');

  // ⑤ p2p 图片：最小转发
  await chatService.processChatMessage(p2pEvent('', 'img1', {
    message_type: 'image',
    content: JSON.stringify({ image_key: 'ik_test_123' }),
  }));
  const imgPayload = captured.dutyPayloads.find((p) => p.type === 'image' && p.messageId === 'img1'); // group 图片转发（m1i）已先行入捕获，按 messageId 精确取 p2p 载荷
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

  // ⑨ 策略外的群不进值日分支（env DUTY_CHAT_ID 之外的群发看板词 → 办理路径提示）
  dutyPolicy.resetCacheForTests();
  await chatService.processChatMessage(groupEvent('值日助手', 'm9', 'oc_outsider_group'));
  check('非管辖群 @值日助手 → 不转发看板', !captured.dutyPayloads.some((p) => p.command === '值日助手' && p.chatId === 'oc_outsider_group'));
  check('非管辖群 @值日助手 → 值日办理路径提示', captured.botReplies.some((r) => r.messageId === 'm9' && r.text.includes('值日专用群')));

  // ⑨′ 空管辖群列表 = 不限制（与 duty-bot 判定口径一致）
  policyState.payload = { ...defaultPolicy(), groupChatIds: [] };
  dutyPolicy.resetCacheForTests();
  await chatService.processChatMessage(groupEvent('/help', 'm9e', 'oc_outsider_group'));
  check('空管辖群列表 → 任意群按管辖群对待（基础指令关闭回引导语）', captured.botReplies.some((r) => r.messageId === 'm9e' && r.text.includes('查看今日值日')));

  // ⑩ 关键词回答全群统一（2026-09-13）：策略不再有放行开关——值日管辖群的 @/未@ 关键词命中照常回答
  await chatService.processChatMessage(groupEvent('大狗大狗请叫叫', 'm10a'));
  check('管辖群 @关键词 → 照常回答（与其它群一致）', captured.botReplies.some((r) => r.messageId === 'm10a' && !r.text.includes('查看今日值日')));
  const r10 = await autoReplyService.processMessageEvent(unAtEvent('小狗小狗', 'm10b'));
  check('管辖群 未@关键词 → 照常回答（全群统一）', r10.matched === true && r10.replied === true, JSON.stringify(r10));

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
  check('duty-bot 失联：兜底策略仍管辖 env 配置群', captured.botReplies.some((r) => r.messageId === 'm13a' && r.text.includes('查看今日值日')));
  await chatService.processChatMessage(p2pEvent('我要请假', 'm13b'));
  check('duty-bot 失联：兜底 p2p 清单仍放行值日指令', captured.dutyPayloads.some((p) => p.command === '我要请假' && p.messageId === 'm13b'));

  policyState.payload = null;
  dutyPolicy.resetCacheForTests();

  // ⑭ 回答表关键词不再做保留词校验（2026-09-13 口径：值日助手仅@/私聊、未@关键词回答全群统一，无撞车面）
  {
    let ok = true, err = '';
    try {
      autoReplyService.upsertRule('group', { keywords: ['值日助手'], answersText: '测试回答' });
    } catch (e) { ok = false; err = e.message; }
    check('回答表关键词含「值日助手」不再被拒（保留词校验已移除）', ok, err);
    try { autoReplyService.deleteRule('group', ['值日助手']); } catch { /* 清理失败不影响断言 */ }
  }

  // ===== 抽奖（动态指令集：/触发词 抽一次，2026-09-14 v87）=====
  lotteryService.upsertRule({ keywords: ['开抽测试'], answersText: '奖品甲|1' + String.fromCharCode(10) + '奖品乙|9' });
  lotteryService.upsertRule({ keywords: ['零权重'], answersText: '永不奖品|0' + String.fromCharCode(10) + '必有奖品|5' });
  check('抽奖 CRUD：窗口 upsert 后 getRules 含测试池', lotteryService.getRules().replies.some((r) => r.keywords.includes('开抽测试')));

  const prizeTexts = ['奖品甲', '奖品乙'];
  const draws = new Set();
  for (let i = 0; i < 300; i++) {
    draws.add(lotteryService.drawForCommand('/开抽测试', 'oc_normal_group').text);
  }
  check('抽奖指令：300 次抽取全部落在奖池内', [...draws].every((t) => prizeTexts.some((p) => t.includes(p))), [...draws].join(','));
  check('抽奖指令：1/9 权重奖品 300 次内出现（非永不可中）', [...draws].some((t) => t.includes('奖品甲')));

  const zeroDraws = new Set();
  for (let i = 0; i < 200; i++) {
    zeroDraws.add(lotteryService.drawForCommand('/零权重', 'oc_normal_group').text);
  }
  check('抽奖指令：权重 0 = 永不抽中，非零权重 100% 抽中', [...zeroDraws].every((t) => t.includes('必有奖品') && !t.includes('永不奖品')), [...zeroDraws].join(','));

  // 普通群 @/触发词 → 抽奖回复
  await chatService.processChatMessage(groupEvent('/开抽测试', 'mL3', 'oc_normal_group'));
  check('抽奖：普通群 @/开抽测试 → 回奖品', prizeTexts.some((p) => captured.botReplies.some((r) => r.messageId === 'mL3' && r.text.includes(p))));

  // 值日管辖群：抽奖指令先于基础指令关闭的引导语
  await chatService.processChatMessage(groupEvent('/开抽测试', 'mL4', 'oc_duty_group_test'));
  check('抽奖：值日管辖群 @/开抽测试 → 回奖品（先于引导语）', prizeTexts.some((p) => captured.botReplies.some((r) => r.messageId === 'mL4' && r.text.includes(p))));

  // 未注册指令不落入抽奖，仍是未知指令提示
  await chatService.processChatMessage(groupEvent('/胡说八道', 'mL4x', 'oc_normal_group'));
  check('抽奖：未注册指令不误吞，仍回未知指令', captured.botReplies.some((r) => r.messageId === 'mL4x' && r.text.includes('未知指令')));

  // /lottery 指令可见奖池
  await chatService.processChatMessage(groupEvent('/lottery', 'mL5', 'oc_normal_group'));
  check('/lottery 指令：输出奖池与触发词', captured.botReplies.some((r) => r.messageId === 'mL5' && r.text.includes('抽奖奖池') && r.text.includes('开抽测试')));

  // /help：含抽奖动态指令段，运维/诊断指令不再展示
  await chatService.processChatMessage(groupEvent('/help', 'mL5h', 'oc_normal_group'));
  check('/help：含抽奖动态指令段', captured.botReplies.some((r) => r.messageId === 'mL5h' && r.text.includes('/开抽测试') && r.text.includes('抽一次奖')));
  check('/help：不再展示运维指令（/status /test-ddl /keywords /autoreply /history）', captured.botReplies.some((r) => r.messageId === 'mL5h' && !r.text.includes('/test-ddl') && !r.text.includes('/autoreply') && !r.text.includes('/keywords') && !r.text.includes('/history') && !r.text.includes('/status')));

  // 统计归因上报（2026-09-22 活跃口径修正）：娱乐功能（抽奖/关键词回答）必须带 fun 标记，
  // 抽奖另带 learn 触发词数组（网关据此把 '/触发词' 路由记录学进娱乐清单，不计入队员活跃）
  check('统计上报：抽奖/关键词回答全部带 fun 标记', captured.usageReports.length > 0 && captured.usageReports.every((r) => (r.feature !== '抽奖' && r.feature !== '关键词回答') || r.fun === 1), JSON.stringify(captured.usageReports));
  check('统计上报：抽奖带 learn 触发词', captured.usageReports.some((r) => r.feature === '抽奖' && Array.isArray(r.learn) && r.learn.includes('开抽测试')), JSON.stringify(captured.usageReports));
  check('统计上报：关键词回答带 fun 标记', captured.usageReports.some((r) => r.feature === '关键词回答' && r.fun === 1), JSON.stringify(captured.usageReports));

  // 启停：停用后指令不命中（落未知指令提示），恢复后照常
  lotteryService.setEnabled(false);
  check('抽奖启停：停用后 drawForCommand 不命中', lotteryService.drawForCommand('/开抽测试', 'oc_normal_group') === null);
  await chatService.processChatMessage(groupEvent('/开抽测试', 'mL6', 'oc_normal_group'));
  check('抽奖启停：停用后指令落未知指令提示', captured.botReplies.some((r) => r.messageId === 'mL6' && r.text.includes('未知指令')));
  lotteryService.setEnabled(true);
  check('抽奖启停：恢复后照常命中', lotteryService.drawForCommand('/开抽测试', 'oc_normal_group') !== null);

  // 清理：删测试池并按原状恢复 .local.json（测试残留不得随 push 上传覆盖现网种子）
  lotteryService.deleteRule(['开抽测试']);
  lotteryService.deleteRule(['零权重']);
  if (lotteryLocalBefore === null) fs.rmSync(LOTTERY_LOCAL, { force: true });
  else fs.writeFileSync(LOTTERY_LOCAL, lotteryLocalBefore);

  console.log(failed === 0 ? '全部通过 ✅' : failed + ' 项失败 ❌');
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
