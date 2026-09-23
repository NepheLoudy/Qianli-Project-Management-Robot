// 桩测试：团队负载聚合（/api/hub/workload 主链路）——
// 时效系数边界/状态折减/优先级权重/owner 加权/多人摊薄/父项目负责人归并/
// ticket-bot 拉取降级（仅项目侧 + ticketsSource 标注）
// 全离线：stub 掉项目表全量拉取与 ticket-bot fetch（接入 push.js 部署前测试闸门）
const assert = require('assert/strict');

const projectService = require('../src/services/projectService');

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000; // 固定基准时刻，边界断言可复算

// ---- 打桩：项目表拉取（必须在 require workloadService 之前——服务模块加载时解构捕获） ----
let fakeProjects = [];
projectService.getProjects = async () => fakeProjects;

// ---- 打桩：ticket-bot fetch（workloadService 内裸 fetch 运行时查全局，可后置打桩） ----
let fetchImpl = null;
globalThis.fetch = async (...args) => {
  if (!fetchImpl) throw new Error('fetch not stubbed');
  return fetchImpl(...args);
};

const { getTeamWorkload, computeWorkload, timePressureW, ticketElapsedW } = require('../src/services/workloadService');

(async () => {
  let pass = 0;
  const ok = (cond, label) => { assert.ok(cond, label); pass++; console.log(`  ✅ ${label}`); };
  const near = (actual, expected, label, eps = 0.02) => {
    assert.ok(Math.abs(actual - expected) <= eps, `${label}（期望≈${expected}，实际 ${actual}）`);
    pass++; console.log(`  ✅ ${label}`);
  };

  // —— A. 时效系数边界（DDL 距发起时间的消耗比 → 档位）——
  near(timePressureW(NOW - 10 * DAY, 0, NOW), 0.5, 'A1 无 DDL → 0.5');
  near(timePressureW(NOW - 10 * DAY, NOW + 30 * DAY, NOW), 0.8, 'A2 消耗比 0.25 → 0.8');
  near(timePressureW(NOW - 28 * DAY, NOW + 7 * DAY, NOW), 1.0, 'A3 消耗比 0.8（边界）→ 1.0');
  near(timePressureW(NOW - 32 * DAY, NOW + 3 * DAY, NOW), 1.3, 'A4 消耗比 0.91 → 1.3');
  near(timePressureW(NOW - 30 * DAY, NOW - 5 * DAY, NOW), 1.8, 'A5 逾期 5 天 → 1.8');
  near(timePressureW(NOW - 60 * DAY, NOW - 30 * DAY, NOW), 2.7, 'A6 逾期 30 天 → 封顶 2.7');
  near(timePressureW(0, NOW + 2 * DAY, NOW), 1.3, 'A7 无发起时间+2 日内 → 1.3（降档不吞）');
  near(timePressureW(0, NOW + 5 * DAY, NOW), 1.0, 'A8 无发起时间+5 日 → 1.0');
  near(timePressureW(0, NOW + 10 * DAY, NOW), 0.8, 'A9 无发起时间+10 日 → 0.8');
  near(ticketElapsedW(NOW - 80 * DAY, NOW), 1.2, 'A10 工单无 DDL 滞留 ≥72h → 1.2');
  near(ticketElapsedW(NOW - 30 * 60 * 60 * 1000, NOW), 1.0, 'A11 工单无 DDL 滞留 <72h → 1.0');
  near(ticketElapsedW(NOW - 2 * 60 * 60 * 1000, NOW), 0.8, 'A12 工单无 DDL 滞留 <24h → 0.8');
  near(ticketElapsedW(0, NOW), 1.0, 'A13 工单发起时间缺失 → 中性 1.0');

  // —— B. computeWorkload 纯函数：双源聚合/权重/归并 ——
  const mk = (over) => ({
    id: over.id, name: over.name, owner: '', ownerName: '', ownerMembers: [],
    contributers: [], dkyjContributers: [], sjContributers: [], xyContributers: [],
    ddl: over.ddl, priority: over.priority, status: over.status,
    category: over.category, fileToken: '', parentId: over.parentId || '',
    createdAt: over.createdAt, updatedAt: over.createdAt,
    ...(over.raw || {}),
  });
  const projects = [
    // P1 in_progress/high：张三(owner, 1.3×) + 李四(dkyj 成员)
    mk({ id: 'p1', name: '视觉自瞄重构', status: 'in_progress', priority: 'high', ddl: NOW + 3 * DAY, createdAt: NOW - 20 * DAY, category: '研发组', raw: { ownerMembers: [{ id: 'ou_a', name: '张三' }], dkyjContributers: [{ id: 'ou_b', name: '李四' }] } }),
    // P2 waiting/medium/无 DDL：李四(owner)
    mk({ id: 'p2', name: '宣传物料设计', status: 'waiting', priority: 'medium', ddl: null, createdAt: NOW - 10 * DAY, category: '宣运组', raw: { ownerMembers: [{ id: 'ou_b', name: '李四' }] } }),
    // P3 pending/low：王五(owner)
    mk({ id: 'p3', name: '备件库盘点', status: 'pending', priority: 'low', ddl: NOW + 30 * DAY, createdAt: NOW - 1 * DAY, category: '研发组', raw: { ownerMembers: [{ id: 'ou_c', name: '王五' }] } }),
    // P4 completed / P5 died：不产生任何人的负载
    mk({ id: 'p4', name: '已完结项目', status: 'completed', priority: 'high', ddl: NOW + 3 * DAY, createdAt: NOW - 20 * DAY, category: '研发组', raw: { ownerMembers: [{ id: 'ou_d', name: '赵七' }] } }),
    mk({ id: 'p5', name: '已截止项目', status: 'died', priority: 'high', ddl: NOW + 3 * DAY, createdAt: NOW - 20 * DAY, category: '研发组', raw: { ownerMembers: [{ id: 'ou_e', name: '孙八' }] } }),
    // P6 父 + P7 子（子自身无人，父负责人赵六应归并到 P7）
    mk({ id: 'p6', name: '赛季总控', status: 'in_progress', priority: 'medium', ddl: NOW + 5 * DAY, createdAt: NOW - 5 * DAY, category: '研发组', raw: { ownerMembers: [{ id: 'ou_f', name: '赵六' }] } }),
    mk({ id: 'p7', name: '总控-子任务', status: 'in_progress', priority: 'medium', ddl: NOW + 5 * DAY, createdAt: NOW - 5 * DAY, category: '研发组', parentId: 'p6' }),
  ];
  const { buildEffMembers } = projectService;
  const effed = buildEffMembers(projects.map((p) => ({ ...p })));

  const ticketData = {
    persons: {
      ou_a: {
        name: '张三', groups: ['装配区'],
        tickets: [
          { recordId: 't1', code: 'GD-1', title: '急单', bucket: 'urgent', daysLeft: 1, deadlineMs: NOW + 1 * DAY, deadlineFormatted: '', createdMs: NOW - 9 * DAY, shareCount: 1 },
        ],
      },
      ou_b: {
        name: '李四', groups: [],
        tickets: [
          { recordId: 't2', code: 'GD-2', title: '双人单', bucket: 'week', daysLeft: 5, deadlineMs: NOW + 5 * DAY, deadlineFormatted: '', createdMs: NOW - 5 * DAY, shareCount: 2 },
        ],
      },
    },
    orphanTickets: [{ recordId: 't9', code: 'GD-9', title: '无主单', bucket: 'waiting', groups: ['工位区'] }],
    unclaimed: [{ recordId: 'u1', code: 'GD-U', title: '待接单', elapsedHours: 30, groups: ['装配区'] }],
  };

  const w = computeWorkload(effed, ticketData, NOW);
  const by = (name) => w.persons.find((p) => p.name === name);

  // 状态折减 + 优先级 + owner 加权（P1: 1.0×1.3(时效)×1.5×1.3(owner)）
  near(by('张三').projects.find((x) => x.name === '视觉自瞄重构').score, 2.54, 'B1 in_progress+high+owner 加权');
  near(by('李四').projects.find((x) => x.name === '视觉自瞄重构').score, 1.95, 'B2 同项目参与成员（无 owner 加权）');
  near(by('李四').projects.find((x) => x.name === '宣传物料设计').score, 0.39, 'B3 waiting 折减 0.6 × 无DDL 0.5 × owner 1.3');
  near(by('王五').projects[0].score, 0.22, 'B4 pending 0.3 × low 0.7 × owner 1.3 × 0.8');
  ok(!by('赵七') && !by('孙八') && !w.persons.some((p) => p.openId === 'ou_d' || p.openId === 'ou_e'), 'B5 completed/died 不计负载');

  // 父项目负责人归并（P7 自身无人 → 赵六经 effMembers 挂上 P7）
  const zl = by('赵六');
  ok(zl && zl.projects.length === 2 && zl.projects.some((x) => x.name === '总控-子任务'), 'B6 父项目负责人归并到子项目');
  near(zl.score, 2.08, 'B7 归并后总分（两项目同参数）');

  // 工单侧：urgent 1.5×1.3(时效)/1 人；week 1.0×0.8(时效)/2 人摊薄
  near(by('张三').tickets[0].score, 1.95, 'B8 工单 urgent 满额');
  near(by('李四').tickets[0].score, 0.4, 'B9 多人单按 shareCount=2 摊薄');
  near(by('张三').score, 4.49, 'B10 双源合计（项目 2.54 + 工单 1.95）');

  // 排序与汇总
  ok(w.persons[0].name === '张三' && w.persons.map((p) => p.name).join(',') === '张三,李四,赵六,王五', 'B11 按总分降序');
  ok(w.summary.personCount === 4 && w.summary.topPersonName === '张三' && w.summary.unclaimedTotal === 1, 'B12 汇总字段');
  ok(w.unclaimedTop.length === 1 && w.unclaimedTop[0].code === 'GD-U', 'B13 待接单榜（组别待接压力素材）');

  // 组别切面：张三经工单 groups 带「装配区」；unclaimed 归装配区组
  const grp = (n) => w.groups.find((g) => g.name === n);
  ok(grp('研发组') && grp('研发组').memberCount === 4, 'B14 组切面成员数（张三/李四/赵六/王五）');
  ok(grp('装配区') && grp('装配区').unclaimedCount === 1 && grp('装配区').maxPersonName === '张三', 'B15 组切面：unclaimed 归组 + 峰值人');

  // —— C. getTeamWorkload 全链路：fetch 降级与正常 ——
  fakeProjects = [projects[0]];
  fetchImpl = async () => { throw new Error('connection refused'); };
  const degraded = await getTeamWorkload();
  ok(degraded.ticketsSource === 'unavailable' && degraded.persons.some((p) => p.name === '张三') && !degraded.persons[0].tickets.length,
    'C1 ticket-bot 不可用：降级仅项目侧，不 500，ticketsSource 标注');

  fetchImpl = async () => ({ ok: true, json: async () => ({ result: ticketData }) });
  const full = await getTeamWorkload();
  ok(full.ticketsSource === 'ok' && full.persons[0].tickets.length > 0 && full.generatedAt, 'C2 双源正常：ticketsSource=ok + generatedAt');
  ok(full.weights && full.weights.status && full.weights.ticketBucket, 'C3 权重参数随 meta 透出（口径可核对）');

  console.log(`\n结果：${pass} 通过 / 0 失败`);
  process.exit(0);
})().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
