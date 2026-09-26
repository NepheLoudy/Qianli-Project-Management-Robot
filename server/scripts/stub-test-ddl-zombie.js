// 桩测试：DDL 播报·僵尸父项目——子项目全部收尾后，未完成且有窗口内 DDL 的父项目
// 必须以叶子行回到播报（🧟 标注），不允许静默变僵尸；含全部反例
// 全离线：直接喂预解析项目数组（getDDLForBroadcastWithHierarchy 的 preloadedProjects 入口）
// （接入 push.js 部署前测试闸门，行为改动必须过本套件）
const assert = require('assert/strict');
const dayjs = require('dayjs');
const config = require('../src/config');

const { getDDLForBroadcastWithHierarchy } = require('../src/services/projectService');

function proj(id, opts = {}) {
  return {
    id,
    name: opts.name || id,
    owner: opts.owner || '',
    ownerName: opts.ownerName || '',
    ownerMembers: opts.owner ? [{ id: opts.owner, name: opts.ownerName || '' }] : [],
    contributers: [],
    dkyjContributers: [],
    sjContributers: [],
    xyContributers: [],
    ddl: opts.ddl || '',
    priority: 'medium',
    status: opts.status || 'in_progress',
    category: opts.category || '硬件',
    parentId: opts.parentId || '',
  };
}

(async () => {
  let pass = 0;
  const ok = (cond, label) => { assert.ok(cond, label); pass++; console.log(`  ✅ ${label}`); };

  const now = dayjs();
  const d = (n) => now.add(n, 'day').toISOString();
  const projects = [
    // 僵尸父项目：未完成 + DDL 3 天后 + 两个子项目全部 completed → 应进 week 且带 🧟
    proj('P1', { name: '僵尸父项目', ddl: d(3), owner: 'ou_a', ownerName: '张三' }),
    proj('C1', { name: '子A（已完成）', status: 'completed', parentId: 'P1' }),
    proj('C2', { name: '子B（已截止）', status: 'died', parentId: 'P1' }),
    // 反例1：有进行中的子项目 → 父项目只当容器，自身不单独成行
    proj('P2', { name: '活跃父项目', ddl: d(2), owner: 'ou_a', ownerName: '张三' }),
    proj('C3', { name: '进行中子项目', ddl: d(1), parentId: 'P2' }),
    // 反例2：父项目自身已 completed → 不播
    proj('P3', { name: '已完成的父项目', status: 'completed', ddl: d(1), owner: 'ou_a', ownerName: '张三' }),
    proj('C4', { name: '已完成子项目', status: 'completed', parentId: 'P3' }),
    // 反例3：子项目全收尾但父项目 DDL 在 7 日窗口之外 → 暂不播（临近自动浮现）
    proj('P4', { name: '远期僵尸父项目', ddl: d(30), owner: 'ou_a', ownerName: '张三' }),
    proj('C5', { name: '远期已收尾子项目', status: 'completed', parentId: 'P4' }),
    // 反例4：子项目还在暂停（pending，非终态）→ 不算全部收尾
    proj('P5', { name: '子项目暂停的父项目', ddl: d(2), owner: 'ou_a', ownerName: '张三' }),
    proj('C6', { name: '暂停子项目', status: 'pending', parentId: 'P5' }),
    // v118 占位支持行：子行全是占位（名字整体括号包住）且已终态 → 父项目观感是「无子项目」，
    // 按叶子行正常播报、不标 🧟（2026-09-26 曼波反馈）
    proj('P6', { name: '全占位子行的父项目', ddl: d(2), owner: 'ou_a', ownerName: '张三' }),
    proj('C7', { name: '（重装支持项目）', status: 'completed', parentId: 'P6' }),
    // 占位支持行对照：真实子行全终态的父项目 → 仍标 🧟（占位行不影响真实子行判定）
    proj('P7', { name: '真实子行全终态的父项目', ddl: d(2), owner: 'ou_a', ownerName: '张三' }),
    proj('C8', { name: '真实已完成子项目', status: 'completed', parentId: 'P7' }),
    proj('C9', { name: '（占位支持行）', status: 'completed', parentId: 'P7' }),
  ];

  const result = await getDDLForBroadcastWithHierarchy('all', projects);

  // 僵尸父项目出现在 urgent（DDL 3 天 > alertDays 时落 week；alertDays 以 config 为准，两处都找）
  const all = [];
  const walk = (nodes) => {
    if (!Array.isArray(nodes)) return;
    nodes.forEach(n => { all.push(n); walk(n.children); });
  };
  walk(result.urgent); walk(result.week); walk(result.overdue);
  const zombie = all.find(n => n.id === 'P1');
  ok(Boolean(zombie), '僵尸父项目回到播报树');
  ok(zombie && zombie.zombieParent === true && zombie.isQualified === true && zombie.hasChildren === false, '僵尸父项目：叶子行 + 🧟 标记（非容器）');
  ok(zombie && (zombie.ddlCategory === 'urgent' || zombie.ddlCategory === 'week'), '僵尸父项目：按其 DDL 归入对应分栏');

  // 反例
  const p2 = all.find(n => n.id === 'P2');
  ok(Boolean(p2) && p2.zombieParent !== true && p2.hasChildren === true, '反例：有进行中子项目 → 父项目仍是容器，不标 🧟');
  ok(!all.some(n => n.id === 'P3'), '反例：父项目自身已完成 → 不播');
  ok(!all.some(n => n.id === 'P4'), '反例：DDL 在窗口外 → 暂不播（临近自动浮现）');
  ok(!all.some(n => n.id === 'P5'), '反例：子项目仅暂停（非终态）→ 不算全部收尾，不标 🧟');

  // 占位支持行（v118，2026-09-27 对抗审查 #5 补断言）
  const p6 = all.find(n => n.id === 'P6');
  ok(Boolean(p6) && p6.isQualified === true && p6.hasChildren === false && p6.zombieParent !== true,
    '占位支持行：子行全占位（已完成）的父项目按叶子行播报，不标 🧟');
  ok(!all.some(n => n.id === 'C7'), '占位支持行：占位子行自身不单独成行');
  const p7 = all.find(n => n.id === 'P7');
  ok(Boolean(p7) && p7.zombieParent === true && p7.hasChildren === false,
    '占位支持行：真实子行全终态（含占位行混挂）的父项目仍标 🧟');

  // 渲染冒烟：僵尸叶子行带 🧟 文案与责任人
  const bot = require('../src/feishu/bot');
  if (typeof bot.renderTreeNode === 'function') {
    const line = bot.renderTreeNode({ ...zombie, children: [], hasChildren: false }, 'owner', null, [], true);
    const text = Array.isArray(line) ? line.join('\n') : String(line);
    ok(text.includes('🧟 子项目均已收尾'), '渲染：叶子行带 🧟 提示文案');
    ok(text.includes('张三'), '渲染：责任人可见');
    // 占位支持行父项目的叶子行不带 🧟（渲染层与数据层口径一致）
    if (p6) {
      const p6Line = bot.renderTreeNode({ ...p6, children: [], hasChildren: false }, 'owner', null, [], true);
      const p6Text = Array.isArray(p6Line) ? p6Line.join('\n') : String(p6Line);
      ok(!p6Text.includes('🧟'), '渲染：全占位子行父项目的叶子行不带 🧟');
    }
  }

  console.log(`\n结果：${pass} 通过 / 0 失败`);
  process.exit(0);
})().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
