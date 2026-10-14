// 桩测试：工单分桶已指派待确认（unconfirmed）+ DDL 卡片分栏渲染——
// 2026-10-15 曼波需求：指定负责人公示绑定后超 24h 未确认的单，此前两头不进
//（ticket-bot unclaimed 桶按「已接单」跳过、结单三桶只收回执节点），DDL 完全不可见；
// 两仓同批加 unconfirmed 桶（主链路在 ticket-bot，本仓测降级直读链路与卡片渲染）。
// 全离线：stub 掉多维表格拉取，直接调用 getUnclosedBuckets / buildDDLReportCard
const assert = require('assert/strict');

const bitable = require('../src/feishu/bitable');
const config = require('../src/config');

// ---- 测试桩：多维表格记录仓（降级直读链路在调用时才访问 getAllRecords，先打桩保险）----
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
let fakeRecords = [];
bitable.getAllRecords = async () => fakeRecords;

// 口径键显式钉死（不依赖本机 .env）
config.ticketClose.assignField = '是否指定人员负责';
config.ticketClose.assignYesValue = '是';
config.ticketClose.assignAcceptValue = '负责人确认消息后通过';
config.ticketClose.acceptValues = ['群内有组员接单后通过', '有组员接单后通过', '负责人确认消息后通过'];
config.ticketClose.closeValue = '回执单：是否结单';
config.ticketClose.routeField = '面向组别';

const ticketCloseService = require('../src/services/ticketCloseService');
const { buildDDLReportCard } = require('../src/feishu/bot');

function rec(fields, id) {
  return { record_id: id || `rec${Math.random().toString(36).slice(2, 8)}`, fields };
}

(async () => {
  let pass = 0;
  const ok = (cond, label) => { assert.ok(cond, label); pass++; console.log(`  ✅ ${label}`); };

  const now = Date.now();

  // —— 降级直读链路：unconfirmed 桶判定 ——
  fakeRecords = [
    // 指定负责人流：节点=负责人确认消息后通过 + 已绑定 + 发起 30h → unconfirmed
    rec({
      '审批节点': '负责人确认消息后通过',
      '是否指定人员负责': '是',
      '指定负责人': [{ id: 'ou_a', name: '张三' }],
      '补充负责人': [{ id: 'ou_a', name: '张三' }],
      '面向组别': ['装配区'],
      '发起时间': now - 30 * HOUR_MS,
      '需求': '已指派但负责人一直没确认的工单',
      '申请编号': 'GD-U-001',
    }, 'recUnf1'),
    // 同状态但刚公示 2h → 未到 24h 阈值不播
    rec({
      '审批节点': '负责人确认消息后通过',
      '是否指定人员负责': '是',
      '指定负责人': [{ id: 'ou_a', name: '张三' }],
      '补充负责人': [{ id: 'ou_a', name: '张三' }],
      '面向组别': ['装配区'],
      '发起时间': now - 2 * HOUR_MS,
    }, 'recUnfFresh'),
    // 多人单续接中：触发节点 + 已绑定但非指定负责人流 → 不进 unconfirmed
    rec({
      '审批节点': '有组员接单后通过',
      '补充负责人': [{ id: 'ou_b', name: '李四' }],
      '面向组别': ['装配区'],
      '发起时间': now - 30 * HOUR_MS,
    }, 'recMulti'),
    // 未绑定（公示即绑定失败/对账未补）→ 不进 unconfirmed（与确认追问口径一致）
    rec({
      '审批节点': '负责人确认消息后通过',
      '是否指定人员负责': '是',
      '指定负责人': [{ id: 'ou_a', name: '张三' }],
      '面向组别': ['装配区'],
      '发起时间': now - 30 * HOUR_MS,
    }, 'recUnbound'),
  ];
  const buckets = await ticketCloseService.getUnclosedBuckets();
  const unf = (buckets.unconfirmed || []).find((t) => t.recordId === 'recUnf1');
  ok(unf && unf.assigneeName === '张三' && unf.elapsedHours >= 30, '降级链路：绑定后滞留超 24h 进 unconfirmed 桶（带负责人姓名/滞留时长）');
  ok(unf && unf.title === '已指派但负责人一直没确认的工单' && unf.code === 'GD-U-001', '降级链路：标题=需求优先、编号作 code（与主链路口径一致）');
  ok(!(buckets.unconfirmed || []).some((t) => t.recordId === 'recUnfFresh'), '降级链路：未到 24h 阈值不播');
  ok(!(buckets.unconfirmed || []).some((t) => t.recordId === 'recMulti'), '降级链路：多人单续接中不进 unconfirmed');
  ok(!(buckets.unconfirmed || []).some((t) => t.recordId === 'recUnbound'), '降级链路：未绑定的不进 unconfirmed（对账补绑后自然进入）');
  ok(!buckets.unclaimed.some((t) => t.recordId === 'recUnf1'), '降级链路：已指派待确认不再误入无人接单桶');
  ok(buckets.urgent.length === 0 && buckets.week.length === 0 && buckets.waiting.length === 0, '降级链路：不串入结单三桶（未到回执节点）');

  // —— DDL 卡片渲染：已指派待确认分栏 + 无人接单分栏引导行 ——
  const card = buildDDLReportCard([], [], [], null, 'owner', [], {
    urgent: [],
    week: [],
    unclaimed: [{ recordId: 'r1', title: '没人接的工单', code: 'GD-X-1', elapsedHours: 30, groups: ['装配区'] }],
    unconfirmed: [
      { recordId: 'r2', title: '指派了没人理的工单', code: 'GD-U-9', assigneeName: '张三', elapsedHours: 30, groups: [] },
      { recordId: 'r3', title: '滞留两天的工单', code: '', assigneeName: '李四', elapsedHours: 48, groups: [] },
    ],
    waiting: [],
  });
  const mdContents = card.elements.filter((e) => e.tag === 'markdown').map((e) => e.content);
  const joined = mdContents.join('\n');
  ok(mdContents.some((c) => c.startsWith('**📨 已指派待确认（超24小时未确认接单，2个）**')), '卡片：已指派待确认分栏头部（含数量）');
  ok(mdContents.some((c) => c.includes('确认方式') && c.includes('接单N') && c.includes('「接单」')), '卡片：已指派待确认分栏带确认引导（@机器人 接单N / 私聊回接单）');
  ok(joined.includes('👤 张三') && joined.includes('GD-U-9') && joined.includes('指派了没人理的工单'), '卡片：分栏行含负责人姓名/编号/标题');
  ok(joined.includes('已滞留 30 小时未确认') && joined.includes('已滞留 2 天未确认'), '卡片：滞留时长 48h 内按小时、超过按天');
  ok(mdContents.some((c) => c.startsWith('**🆘 无人接单工单（超6小时无人响应，1个）**') && c.includes('接单N')), '卡片：无人接单分栏头部带接单引导（2026-10-15 曼波）');
  ok(!joined.includes('undefined') && !joined.includes('null'), '卡片：无字段缺省泄漏（buckets 形状漂移防护）');

  // 无 unconfirmed 数据时分栏不出现（不播空栏）
  const cardEmpty = buildDDLReportCard([], [], [], null, 'owner', [], { urgent: [], week: [], unclaimed: [], unconfirmed: [], waiting: [] });
  const emptyJoined = cardEmpty.elements.filter((e) => e.tag === 'markdown').map((e) => e.content).join('\n');
  ok(!emptyJoined.includes('已指派待确认'), '卡片：无已指派待确认数据时分栏整体省略');

  console.log(`\n结果：${pass} 通过 / 0 失败`);
  process.exit(0);
})().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
