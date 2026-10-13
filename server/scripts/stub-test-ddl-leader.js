// 桩测试：DDL 播报·负责人群整合播报——把「逾期 + 临期」跨播报群汇总再在负责人群
// 播一遍，卡头 @ 指定负责人（2026-09-22 用户需求）。全离线：项目数据走 preloadedProjects
// 入口，飞书发送/确认/工单桶全部注入桩，广场写表用 PLAZA_ENABLED 停写隔离，播报状态文件外移临时目录。
// 2026-10-13 拆分（曼波需求：逾期汇总提前到 10 点）：整合卡独立 runLeaderBroadcast
// 定时发送（LEADER_CRON_SCHEDULE，默认 10:00），不再随 12:05 主播报。锁定行为：
//  1) 整合口径 = filter 'all'（各人员字段并集）：只在 dkyj 字段有人的项目也进负责人群卡
//  2) 卡头 @ 指定负责人：open_id 进卡片 <at id> 标签（卡片 @ 语法）
//  3) 只含逾期/临期两栏：周概览项目、工单分栏、语录不上负责人群卡
//  4) 逾期+临期全空当日不发送（负责人群只收升级事项，各群常规卡照发）
//  5) 主播报（12:05）不再发负责人群卡；负责人任务（10:00）不发各群卡/不发逾期确认私聊
//  6) 双当日标记互相独立：leader 标记不得阻塞主播报（反之亦然），状态文件字段合并不互抹
//  7) 负责人任务发送失败（业务性错误）：向上抛出、当日标记不落盘（可手动重跑）
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert/strict');
const dayjs = require('dayjs');

const ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(os.tmpdir(), `stub-leader-broadcast-state-${process.pid}.json`);
process.env.BROADCAST_STATE_FILE = STATE_FILE;
process.env.PLAZA_BITABLE_TABLE_ID = '';
process.env.PLAZA_ENABLED = '';

let pass = 0;
const ok = (cond, label) => { assert.ok(cond, label); pass++; console.log(`  ✅ ${label}`); };

// ---------- 测试数据 ----------
const now = dayjs();
const d = (n) => now.add(n, 'day').toISOString();
function proj(id, opts = {}) {
  return {
    id,
    name: opts.name || id,
    owner: opts.owner || '',
    ownerName: opts.ownerName || '',
    ownerMembers: opts.owner ? [{ id: opts.owner, name: opts.ownerName || '' }] : [],
    contributers: opts.contrib ? [{ id: opts.contrib, name: opts.contribName || '' }] : [],
    dkyjContributers: opts.dkyj ? [{ id: opts.dkyj, name: opts.dkyjName || '' }] : [],
    sjContributers: opts.sj ? [{ id: opts.sj, name: opts.sjName || '' }] : [],
    xyContributers: opts.xy ? [{ id: opts.xy, name: opts.xyName || '' }] : [],
    ddl: opts.ddl || '',
    priority: 'medium',
    status: opts.status || 'in_progress',
    category: opts.category || '硬件',
    parentId: opts.parentId || '',
  };
}
// 逾期·有 owner / 临期·仅 dkyj 字段有人 / 本周·不该上负责人群卡 / 逾期·完全无负责人
const TEST_PROJECTS = [
  proj('P_OWNER', { name: '逾期有主项目', ddl: d(-1), owner: 'ou_a', ownerName: '张三' }),
  proj('P_DKYJ', { name: '仅电控组项目', ddl: d(1), dkyj: 'ou_dkyj', dkyjName: '李电控' }),
  proj('P_WEEK', { name: '本周才到期项目', ddl: d(5), owner: 'ou_b', ownerName: '王五' }),
  proj('P_NOOWNER', { name: '无主逾期项目', ddl: d(-3) }),
];

function walkNames(nodes, acc = []) {
  (nodes || []).forEach(n => { acc.push(n.name); walkNames(n.children, acc); });
  return acc;
}

// ---------- 第一部分：卡片构建（真实 bot 模块，先于桩注入取引用） ----------
const config = require(path.join(ROOT, 'src', 'config'));
const realBot = require(path.join(ROOT, 'src', 'feishu/bot.js'));
const realProjectService = require(path.join(ROOT, 'src', 'services/projectService.js'));

config.broadcastGroups = [
  { key: 'owner', label: 'owner群', chatId: 'oc_owner', webhookUrl: 'https://hook/owner', mentionField: 'owner' },
  { key: 'dkyj', label: 'dkyj组', chatId: 'oc_dkyj', webhookUrl: 'https://hook/dkyj', mentionField: 'dkyjcontributers' },
];
config.ddl.leaderGroup = {
  label: '负责人群',
  webhookUrl: 'https://hook/leader',
  chatId: 'oc_leader',
  mentionOpenId: 'ou_leader_zhang',
  mentionName: '章子赫',
};

(async () => {
  console.log('== stub-test-ddl-leader · 卡片构建 ==');
  const allData = await realProjectService.getDDLForBroadcastWithHierarchy('all', TEST_PROJECTS);
  const card = realBot.buildLeaderDDLReportCard(allData.overdue, allData.urgent, config.ddl.leaderGroup);
  const text = card.elements.map(e => e.content || '').join('\n');

  ok(text.includes('<at id="ou_leader_zhang">章子赫</at>'), '卡头 @ 指定负责人（open_id 进卡片 at 标签）');
  ok(text.includes('整合自各播报群'), '卡头注明整合口径');
  ok(text.includes('逾期有主项目') && text.includes('无主逾期项目'), '逾期项目入卡（含无主项目，filter=all 全量口径）');
  ok(text.includes('仅电控组项目'), '整合口径：仅 dkyj 字段有人的项目也进负责人群卡');
  ok(!walkNames(allData.overdue).concat(walkNames(allData.urgent)).includes('本周才到期项目'), '本周桶项目不进逾期/临期数据');
  ok(!text.includes('本周才到期项目'), '负责人群卡不含周概览项目');
  ok(!text.includes('工单结单加急') && !text.includes('无人接单工单'), '负责人群卡不含工单分栏');
  ok(!text.includes('桩语录'), '负责人群卡不含语录');
  ok(text.includes('已逾期项目（2个）'), '逾期分栏计数 = 2');
  ok(text.includes(`2天内到期（1个）`), '临期分栏计数 = 1');
  ok(text.includes('<at id="ou_a">张三</at>'), '项目行 @ owner 责任人');
  ok(text.includes('👤 未指派'), '无主项目行回退纯文本「未指派」不丢行');
  ok(card.header.template === 'red', '有逾期时卡片头红色');

  const urgentOnly = realBot.buildLeaderDDLReportCard([], allData.urgent, config.ddl.leaderGroup);
  ok(urgentOnly.header.template === 'orange', '仅临期时卡片头橙色');

  // ---------- 2026-09-26 曼波反馈回归：负责人群行 @ 全部责任人（不只 owner） ----------
  // 实例：yolo魔改学习 owner 空、负责人填在视觉组字段 → 整合卡曾显示「未指派」且不 @ 负责人
  const UNION_PROJECTS = [
    proj('P_YOLO', { name: 'yolo魔改学习（桩）', ddl: d(-1), sj: 'ou_sj_hh', sjName: '贺韵洁' }),
    proj('P_NOOWNER2', { name: '彻底无主逾期项目', ddl: d(-2) }),
  ];
  const unionData = await realProjectService.getDDLForBroadcastWithHierarchy('all', UNION_PROJECTS);
  const unionCard = realBot.buildLeaderDDLReportCard(unionData.overdue, unionData.urgent, config.ddl.leaderGroup);
  const unionText = unionCard.elements.map(e => e.content || '').join('\n');
  ok(unionText.includes('<at id="ou_sj_hh">贺韵洁</at>'), '负责人群行 @ 组字段负责人（不只 owner）');
  const yoloLine = unionText.split('\n').find(l => l.includes('yolo魔改学习（桩）'));
ok(yoloLine && !yoloLine.includes('未指派') && yoloLine.includes('ou_sj_hh'), '组字段负责人的行 @ 本人且不再显示未指派');
  const orphanCard = realBot.buildLeaderDDLReportCard(
    (await realProjectService.getDDLForBroadcastWithHierarchy('all', [proj('P_NOBODY', { name: '真无主项目', ddl: d(-1) })])).overdue,
    [], config.ddl.leaderGroup);
  ok(orphanCard.elements.map(e => e.content || '').join('\n').includes('未指派'), '五字段全空的行仍回退「未指派」不丢行');

  // ---------- 2026-09-26 曼波反馈回归：占位支持行不计入僵尸子项目 ----------
  // 实测：自定义客户端/大符 的子行是「（重装支持项目）」类占位行，观感是无子项目却报「子项目均已收尾」
  const ZOMBIE_PROJECTS = [
    proj('P_ZREAL', { name: '真实僵尸父项目', ddl: d(-1) }),
    proj('P_ZREAL_C', { name: '真实已完成子项目', ddl: d(-10), status: 'completed', parentId: 'P_ZREAL' }),
    proj('P_ZPH', { name: '占位僵尸父项目', ddl: d(-1) }),
    proj('P_ZPH_C', { name: '（占位支持项目）', ddl: d(-10), status: 'completed', parentId: 'P_ZPH' }),
  ];
  const zombieData = await realProjectService.getDDLForBroadcastWithHierarchy('all', ZOMBIE_PROJECTS);
  let zreal = null, zph = null;
  walkNames(zombieData.overdue); // 走一遍确认不炸
  (function findZ(nodes) { (nodes || []).forEach(n => { if (n.id === 'P_ZREAL') zreal = n; if (n.id === 'P_ZPH') zph = n; if (n.children) findZ(n.children); }); })([...zombieData.overdue, ...zombieData.urgent]);
  ok(zreal && zreal.zombieParent === true, '真实子行全收尾的父项目仍标 🧟（9-17 口径保留）');
  ok(zph && zph.zombieParent !== true && zph.isQualified === true, '全占位子行的父项目按无子项目叶子行正常播报（不标 🧟）');

  // ---------- 桩注入（在 require cron 之前）：飞书发送 / 工单桶 / 逾期确认 ----------
  const Module = require('module');
  const groupSendCalls = [];
  const leaderSendCalls = [];
  const confirmCalls = [];
  let leaderFailOnce = false;

  function inject(requestPath, exports) {
    const resolved = require.resolve(requestPath);
    const m = new Module(resolved, null);
    m.filename = resolved;
    m.exports = exports;
    m.loaded = true;
    require.cache[resolved] = m;
  }

  inject(path.join(ROOT, 'src', 'feishu/bot.js'), {
    sendDDLReport: async (...args) => { groupSendCalls.push(args); return {}; },
    sendLeaderDDLReport: async (overdue, urgent, leader) => {
      if (leaderFailOnce) { leaderFailOnce = false; throw new Error('发送消息失败: {"code":9499,"msg":"stub"}'); }
      leaderSendCalls.push({ overdue, urgent, leader });
      return {};
    },
    getRandomQuote: async () => ({ words: '桩语录', person: '桩' }),
  });
  const projectServiceStub = Object.create(realProjectService);
  projectServiceStub.getProjects = async () => TEST_PROJECTS;
  inject(path.join(ROOT, 'src', 'services/projectService.js'), projectServiceStub);
  inject(path.join(ROOT, 'src', 'services/ticketCloseService.js'), {
    getGroupedBuckets: async () => { throw new Error('stub: 工单分桶停用'); },
    getUnclosedBuckets: async () => { throw new Error('stub: 工单分桶停用'); },
  });
  inject(path.join(ROOT, 'src', 'services/ddlConfirmService.js'), {
    sendOverdueConfirmation: async (p) => { confirmCalls.push(p.name); return { sent: true, sentMode: 'stub' }; },
  });

  const cronPath = require.resolve(path.join(ROOT, 'src', 'cron/index.js'));
  // 每个场景重载 cron 模块（重置当日标记的内存值）并清状态文件——
  // 否则上一场景写入的「今日已播报」标记会让下一场景整轮跳过
  const freshCron = () => {
    delete require.cache[cronPath];
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    return require(cronPath);
  };
  const readState = () => (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) : {});

  console.log('== stub-test-ddl-leader · 主播报（12:05，负责人卡已拆出） ==');
  const cron1 = freshCron();
  await cron1.runDDLBroadcast();
  ok(groupSendCalls.length === 2 && groupSendCalls.every(c => c[4] && c[4].webhookUrl), '各播报群常规卡各发一张');
  ok(leaderSendCalls.length === 0, '主播报不再发送负责人群整合卡（2026-10-13 拆分）');
  ok(readState().lastBroadcastDate === new Date().toLocaleDateString('zh-CN'), '群卡送达即落当日主播报标记');
  ok(readState().lastLeaderBroadcastDate === undefined, '主播报不写负责人任务标记');
  ok(confirmCalls.length >= 1, '逾期确认私聊仍随主播报发送');
  const hist1 = cron1.getBroadcastHistory()[0];
  ok(hist1.success === true && !hist1.groups.some(g => g.label === '负责人群'), '主播报历史不含负责人群统计');

  console.log('== stub-test-ddl-leader · 负责人整合任务（10:00）正常发送 ==');
  const today = new Date().toLocaleDateString('zh-CN');
  const cron2 = freshCron();
  const r2 = await cron2.runLeaderBroadcast();
  ok(leaderSendCalls.length === 1, '负责人群整合卡发送一次');
  ok(leaderSendCalls[0].leader.mentionOpenId === 'ou_leader_zhang', '发送时携带卡头 @ 配置');
  ok(walkNames(leaderSendCalls[0].overdue).includes('仅电控组项目') || walkNames(leaderSendCalls[0].urgent).includes('仅电控组项目'), '整合口径在独立任务生效（跨字段并集）');
  ok(r2 && r2.sent === true && r2.overdue === 2 && r2.urgent === 1, '返回值带发送结果与统计（逾期2 临期1）');
  ok(groupSendCalls.length === 2, '负责人任务不发各群常规卡');
  ok(confirmCalls.length >= 1 && !confirmCalls.includes('远期项目'), '负责人任务不发逾期确认私聊');
  ok(readState().lastLeaderBroadcastDate === today && readState().lastBroadcastDate === undefined, '负责人任务落自己的当日标记');
  const again = await cron2.runLeaderBroadcast();
  ok(again === null, '当日已发送过再次触发返回 null 跳过');
  const hist2 = cron2.getBroadcastHistory()[0];
  ok(hist2.type === 'ddl_leader_broadcast' && hist2.success === true, '负责人任务历史独立成条（ddl_leader_broadcast）');

  console.log('== stub-test-ddl-leader · 逾期临期全空（不发卡但计完成） ==');
  projectServiceStub.getProjects = async () => [
    proj('P_FAR', { name: '远期项目', ddl: d(30), owner: 'ou_a', ownerName: '张三' }),
  ];
  const cron3 = freshCron();
  const r3 = await cron3.runLeaderBroadcast();
  ok(leaderSendCalls.length === 1, '逾期临期全空当日不发送负责人群卡');
  ok(r3 && r3.sent === false, '全空返回 sent:false');
  ok(readState().lastLeaderBroadcastDate === today, '全空也算完成，落当日标记（防重复触发）');
  await cron3.runDDLBroadcast();
  ok(groupSendCalls.length === 4, '负责人标记不阻塞 12:05 主播报（标记互相独立）');
  ok(readState().lastBroadcastDate === today && readState().lastLeaderBroadcastDate === today, '双标记同日共存、字段合并不互抹');

  console.log('== stub-test-ddl-leader · 负责人发送失败（业务性错误，不重试） ==');
  projectServiceStub.getProjects = async () => TEST_PROJECTS;
  leaderFailOnce = true;
  const cron4 = freshCron();
  let rejected = null;
  try { await cron4.runLeaderBroadcast(); } catch (err) { rejected = err; }
  ok(rejected && /9499/.test(rejected.message), '业务性失败向上抛出（不静默吞掉）');
  ok(leaderSendCalls.length === 1, '失败的那次发送不计入送达（桩抛错前不入列）');
  ok(readState().lastLeaderBroadcastDate === undefined && readState().lastBroadcastDate === undefined, '负责人任务失败不落任何标记（可手动重跑）');
  const hist4 = cron4.getBroadcastHistory()[0];
  ok(hist4 && hist4.success === false && hist4.type === 'ddl_leader_broadcast', '失败记录进负责人任务历史');

  console.log('== stub-test-ddl-leader · 负责人 webhook 与播报群同址（拆分后语义） ==');
  config.ddl.leaderGroup = { ...config.ddl.leaderGroup, webhookUrl: 'https://hook/owner' };
  const cron5 = freshCron();
  const r5 = await cron5.runLeaderBroadcast();
  ok(leaderSendCalls.length === 2 && r5.sent === true, '拆分后同址不再跳过（10:00 与 12:05 不同轮次，无同轮双卡可防）');
  ok(groupSendCalls.length === 4, '同址场景各群卡计数不受影响');

  fs.existsSync(STATE_FILE) && fs.unlinkSync(STATE_FILE);
  console.log(`\n结果：${pass} 通过 / 0 失败`);
  process.exit(0);
})().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
