/**
 * 会议提醒 stub 测试（不触飞书：mock bot 发送捕获；晚间静默窗口用环境变量圈定）
 * 覆盖（2026-09-25 审查修复批）：
 *      1) sender_type=app 的会议卡片不触发（防其他应用/机器人的卡片误触发 @所有人）；
 *      2) 晚间静默窗口内不直发，载荷原样落盘积压（gatePayload，顶层晚间静默铁律补闸）；
 *      3) 静默判定关闭（START=END）时照常 @所有人 直发；
 *      4) 静默期积压的载荷过点冲刷：由注册的补发处理器原样重发（registerPayloadHandler 接线）。
 * 静默窗口/积压文件均经环境变量注入临时路径，不污染真实 .quiet-backlog.json。
 * 运行：node scripts/stub-test-meeting-reminder.js（父进程分 quiet/open/flush 三个场景自跑）
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---- 父进程：依次跑三个子场景（静默窗口配置在模块加载期读取，须分进程隔离） ----
if (!process.env.MEETING_SCENARIO) {
  const { spawnSync } = require('child_process');
  let failed = 0;
  for (const s of ['quiet', 'open', 'flush']) {
    console.log(`\n----- 场景 ${s} -----`);
    const r = spawnSync(process.execPath, [__filename], {
      env: { ...process.env, MEETING_SCENARIO: s },
      stdio: 'inherit',
    });
    if (r.status !== 0) failed += 1;
  }
  console.log(failed === 0 ? '\nstub-test-meeting-reminder: 全部通过' : `\nstub-test-meeting-reminder: ${failed} 个场景失败`);
  process.exit(failed === 0 ? 0 : 1);
}

const scenario = process.env.MEETING_SCENARIO;

// ---- 环境与占位（必须先于 require src 模块） ----
// 上海当前小时（Asia/Shanghai 无夏令时，固定 UTC+8）
const shanghaiHour = (new Date().getUTCHours() + 8) % 24;
if (scenario === 'quiet') {
  // 窗口 [h, h+1) 恒覆盖当前时刻（h=23 时 [23,0) 跨午夜同样覆盖）
  process.env.QUIET_HOURS_START = String(shanghaiHour);
  process.env.QUIET_HOURS_END = String((shanghaiHour + 1) % 24);
} else {
  // START=END → inQuietHours 恒 false（open=直发；flush=过点立即补跑）
  process.env.QUIET_HOURS_START = '0';
  process.env.QUIET_HOURS_END = '0';
}
const backlogFile = path.join(os.tmpdir(), `meeting-reminder-backlog-${scenario}-${process.pid}.json`);
process.env.QUIET_BACKLOG_FILE = backlogFile; // dotenv 不覆盖已有变量，隔离真实积压文件
try { fs.rmSync(backlogFile, { force: true }); } catch { /* 不存在即可 */ }

// mock 飞书 bot 层（捕获发送，不触网）
const botSends = [];
require.cache[require.resolve('../src/feishu/bot')] = {
  id: 'bot-stub', filename: 'bot-stub', loaded: true, exports: {
    async sendTextToChat(chatId, text) { botSends.push({ chatId, text }); return {}; },
    async replyTextMessage() { return {}; },
    async sendTextToUser() { return {}; },
  },
};

const quietHours = require('../src/utils/quietHours');
const meetingReminderService = require('../src/services/meetingReminderService');

let failed = 0;
function check(desc, cond, detail = '') {
  if (cond) console.log(`✓ ${desc}`);
  else { failed += 1; console.error(`❌ ${desc}${detail ? ` —— ${detail}` : ''}`); }
}

// video_chat 卡片事件（containsMeetingCard 对 video_chat 恒命中；content 为卡片守卫必需）
function cardEvent(msgId, senderType, chatId = 'oc_meeting_test') {
  return {
    sender: { sender_type: senderType },
    message: {
      message_id: msgId,
      message_type: 'video_chat',
      chat_type: 'group',
      chat_id: chatId,
      content: JSON.stringify({}),
    },
  };
}

function readBacklogSafe() {
  try {
    return JSON.parse(fs.readFileSync(backlogFile, 'utf8'));
  } catch {
    return { items: [] };
  }
}

// 退出前清掉本场景的临时积压文件（不污染 %TEMP%，也绝不动真实 .quiet-backlog.json）
function finish() {
  try { fs.rmSync(backlogFile, { force: true }); } catch { /* 清理失败不影响结果 */ }
  process.exit(failed === 0 ? 0 : 1);
}

async function runScenario() {
  if (scenario === 'quiet') {
    // 1) 其他应用的会议卡片不触发
    const appResult = await meetingReminderService.processMeetingMessage(cardEvent('m_app_1', 'app'));
    check('静默中：app 发送者会议卡片不触发', appResult.handled === false && appResult.reason === '应用消息跳过', JSON.stringify(appResult));
    check('静默中：app 卡片未产生任何发送', botSends.length === 0, JSON.stringify(botSends));

    // 2) 人员会议卡片 → 静默积压，不直发，载荷原样落盘
    const humanResult = await meetingReminderService.processMeetingMessage(cardEvent('m_user_1', 'user'));
    check('静默中：人员卡片被闸门积压（deferred）', humanResult.handled === true && humanResult.deferred === true && !humanResult.triggered, JSON.stringify(humanResult));
    check('静默中：未直发 @所有人', botSends.length === 0, JSON.stringify(botSends));
    const backlog = readBacklogSafe();
    const item = (backlog.items || []).find((it) => it.type === 'payload' && it.name === 'meeting-reminder');
    check('静默中：积压载荷按 meeting-reminder 原样落盘', !!item && item.payload.chatId === 'oc_meeting_test' && String(item.payload.text).includes('所有人'), JSON.stringify(backlog));
    finish();
  }

  if (scenario === 'open') {
    // 3) 静默判定关闭 → 照常直发
    const result = await meetingReminderService.processMeetingMessage(cardEvent('m_user_2', 'user'));
    check('静默关：人员卡片照常触发 @所有人', result.handled === true && result.triggered === true, JSON.stringify(result));
    check('静默关：bot 收到群文本发送', botSends.some((s) => s.chatId === 'oc_meeting_test' && String(s.text).includes('所有人')), JSON.stringify(botSends));
    finish();
  }

  // scenario === 'flush'
  // 4) 静默期积压过点冲刷：预置积压 → initQuietHoursFlush 5 秒后补跑 → 处理器原样重发
  const queuedText = '【积压补发】昨夜会议卡片提醒';
  fs.writeFileSync(backlogFile, JSON.stringify({
    items: [{ type: 'payload', name: 'meeting-reminder', payload: { chatId: 'oc_meeting_test', text: queuedText }, queuedAt: new Date().toISOString() }],
  }, null, 2));
  quietHours.initQuietHoursFlush();
  const deadline = Date.now() + 15000;
  while (botSends.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
  }
  check('冲刷：积压载荷由注册处理器原样补发', botSends.some((s) => s.chatId === 'oc_meeting_test' && s.text === queuedText), JSON.stringify(botSends));
  check('冲刷：补发成功后积压清空', readBacklogSafe().items.length === 0, JSON.stringify(readBacklogSafe()));
  finish();
}

runScenario().catch((err) => {
  console.error('场景执行异常:', err);
  process.exit(1);
});
