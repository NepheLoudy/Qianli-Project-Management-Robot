const config = require('../config');
const dayjs = require('dayjs');
const { getProjects, buildEffMembers } = require('./projectService');

// ============================================================
// 团队负载聚合（/api/hub/workload 数据源，运维台「团队负载」看板消费）
//
// 双源：项目表（本项目 getProjects，含 effMembers 父项目负责人归并）+
// ticket-bot 未结单按人明细（GET /api/tickets/workload-by-person，open_id 对齐）。
// 评分 = 复核算法（非计数）：DDL 距发起时间的时效消耗 × 状态折减 × 重要性/分桶
// × 负责人角色加权；多人协作单按负责人数摊薄。算法只在本文件——
// 口径改动同步更新 weights 透出与运维台展示说明。
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;
// ticket-bot 假死（端口存活但不响应）时快速超时走降级（与 ticketCloseService 同款）；
// 按人端点同样会对无 USER_GROUPS 映射的负责人逐人查通讯录部门，10s 冷缓存余量
const TICKET_FETCH_TIMEOUT_MS = 10 * 1000;

// —— 复核算法权重（默认参数）——
// 项目状态折减：in_progress 全额 / waiting(待认领) 折减 / pending(意外暂停) 仍占心智但低折；
// completed/died 不计（STATUS_W 无键即跳过）
const STATUS_W = { in_progress: 1.0, waiting: 0.6, pending: 0.3 };
// 项目重要性（项目表 priority 单选）
const PRIORITY_W = { high: 1.5, medium: 1.0, low: 0.7 };
// 工单无优先级字段，以分桶代理：urgent(2 日内结单) 1.5 / week(2-7 日) 1.0 / waiting(等回执无时限) 0.8
const TICKET_BUCKET_W = { urgent: 1.5, week: 1.0, waiting: 0.8 };
// 项目 owner 是总负责人，心智负担高于参与成员
const OWNER_ROLE_W = 1.3;
// 组别系数（2026-09-24 用户拍板）：按任务归属组别乘——宣运域（项目 category「宣经」/
// 工单面向组别「宣运组」）×0.5（宣传运营类任务密度高但单项压力轻）；重装/步兵/哨兵
// 项目 ×1.2（机械兵种装配压力重——兵种分组只存在于项目 category，工单面向组别是
// 职能组枚举，故兵种系数天然只作用于项目侧）。多组命中连乘（罕见）。
const GROUP_COEFF = {
  宣经: 0.5, 宣运: 0.5, 宣运组: 0.5,
  重装: 1.2, 步兵: 1.2, 哨兵: 1.2,
};
// 被@接量（2026-09-24 用户拍板）：群聊每被@一次 +0.01 分，网关 /api/usage/mentions
// 近 7 天自然日滑窗（网关侧过滤，稀疏数据不会把老计数长期带在身上）
const MENTION_SCORE = 0.01;
const MENTION_WINDOW_DAYS = 7;
const MENTION_FETCH_TIMEOUT_MS = 5 * 1000;
// 参与人取 effMembers 五字段并集（与播报归属口径一致）
const MEMBER_FIELDS = ['owner', 'contributers', 'dkyjcontributers', 'sjcontributers', 'xycontributers'];

const groupCoeff = (names) => {
  let c = 1;
  for (const g of names || []) if (GROUP_COEFF[g]) c *= GROUP_COEFF[g];
  return round2(c);
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * DDL 距发起时间的时效系数（时间消耗比 p = 已耗时长 ÷ (发起→DDL 全窗)）：
 * 无 DDL → 0.5（无明确时限）；p≤0.5 → 0.8（充裕）；p≤0.8 → 1.0；p≤1 → 1.3（临期）；
 * 逾期 → 1.3 + min(逾期天数,14)×0.1（封顶 2.7）。
 * 无发起时间（历史数据 createdAt 缺失）退化按剩余天数给档，不放大不吞掉。
 */
function timePressureW(createdMs, ddlMs, nowMs) {
  if (!ddlMs) return 0.5;
  const overdueMs = nowMs - ddlMs;
  if (overdueMs > 0) {
    const overdueDays = overdueMs / DAY_MS;
    return Math.min(1.3 + Math.min(overdueDays, 14) * 0.1, 2.7);
  }
  const daysLeft = (ddlMs - nowMs) / DAY_MS;
  const total = createdMs ? ddlMs - createdMs : 0;
  if (total <= 0) {
    // 无发起时间：按剩余天数降档（2 日内视同临期、7 日内中性、更远充裕）
    if (daysLeft <= 2) return 1.3;
    if (daysLeft <= 7) return 1.0;
    return 0.8;
  }
  const p = (nowMs - createdMs) / total;
  if (p <= 0.5) return 0.8;
  if (p <= 0.8) return 1.0;
  return 1.3;
}

/**
 * 工单无理想结单时间时的时效系数：按发起至今滞留时长给压（越拖越沉）。
 * 滞留时长由 createdMs 推导；发起时间也缺（0）时取中性 1.0。
 */
function ticketElapsedW(createdMs, nowMs) {
  if (!createdMs) return 1.0;
  const hours = (nowMs - createdMs) / (60 * 60 * 1000);
  if (hours >= 72) return 1.2;
  if (hours >= 24) return 1.0;
  return 0.8;
}

/**
 * 从 ticket-bot 拉未结单按人明细。失败抛错由调用方降级（仅项目侧 + 标注 unavailable）。
 */
async function fetchTicketWorkload() {
  const res = await fetch(`${config.ticketBot.url}/api/tickets/workload-by-person`, {
    signal: AbortSignal.timeout(TICKET_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ticket-bot API HTTP ${res.status}`);
  const data = await res.json();
  return data.result || null;
}

/**
 * 从网关拉近 N 天被@计数。失败抛错由调用方降级（缺失该加分维度 + 标注 unavailable）。
 */
async function fetchMentionCounts() {
  const res = await fetch(`${config.gateway.url}/api/usage/mentions?days=${MENTION_WINDOW_DAYS}`, {
    signal: AbortSignal.timeout(MENTION_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`gateway mentions API HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.users) ? data.users : [];
}

/**
 * 纯计算核心（不 IO，stub 测试直测）：项目列表 + ticket-bot 按人明细 + 网关被@计数 → 负载全景。
 *
 * @param {Array} projects getProjects() 全量（会补挂 effMembers）
 * @param {Object|null} ticketData workload-by-person 的 result（null=工单侧不可用）
 * @param {Array|null} mentionUsers 网关被@计数 [{id, name, count}]（null=网关侧不可用）
 * @param {number} nowMs 计算基准时刻
 */
function computeWorkload(projects, ticketData, mentionUsers, nowMs) {
  const now = dayjs(nowMs);
  const persons = new Map(); // openId → { name, groupSet, score, projects, tickets, mentionCount }

  const ensurePerson = (openId, name) => {
    if (!persons.has(openId)) {
      persons.set(openId, { name: name || '未知', groupSet: new Set(), score: 0, projects: [], tickets: [], mentionCount: 0 });
    }
    return persons.get(openId);
  };

  // —— 被@接量先入榜：零任务但被@密集的协调型角色也显形（组别无来源，留空） ——
  if (mentionUsers) {
    for (const u of mentionUsers) {
      if (!u || !u.id) continue;
      const person = ensurePerson(u.id, u.name);
      person.mentionCount = u.count || 0;
    }
  }

  // —— 项目侧 ——
  for (const p of projects) {
    const statusW = STATUS_W[p.status];
    if (!statusW) continue; // completed / died 不计负载

    const ddlValid = p.ddl && dayjs(p.ddl).isValid();
    const ddlMs = ddlValid ? dayjs(p.ddl).valueOf() : null;
    const createdMs = Number(p.createdAt) || 0;
    const timeW = timePressureW(createdMs, ddlMs, nowMs);
    const priorityW = PRIORITY_W[p.priority] || 1.0;
    const gCoeff = groupCoeff([p.category]);
    const daysLeft = ddlValid ? dayjs(p.ddl).diff(now, 'day') : null;

    // 参与人 = effMembers 五字段并集；owner 字段成员按负责人加权
    const memberMap = new Map(); // id → { name, isOwner }
    const eff = p.effMembers || {};
    for (const field of MEMBER_FIELDS) {
      for (const m of eff[field] || []) {
        if (!m || !m.id) continue;
        if (!memberMap.has(m.id)) memberMap.set(m.id, { name: m.name, isOwner: false });
        if (field === 'owner') memberMap.get(m.id).isOwner = true;
      }
    }
    if (memberMap.size === 0) continue; // 无人项目挂不到人（运维台组切面外，跳过）

    for (const [openId, m] of memberMap) {
      const roleW = m.isOwner ? OWNER_ROLE_W : 1.0;
      const score = round2(statusW * timeW * priorityW * gCoeff * roleW);
      const person = ensurePerson(openId, m.name);
      person.groupSet.add(p.category || '其他');
      person.score = round2(person.score + score);
      person.projects.push({
        name: p.name,
        category: p.category || '其他',
        status: p.status,
        priority: p.priority,
        ddl: ddlValid ? dayjs(p.ddl).format('YYYY-MM-DD') : '',
        daysLeft,
        isOwner: m.isOwner,
        score,
      });
    }
  }

  // —— 工单侧（ticket-bot 不可用时整段跳过，ticketsSource 由调用方标注）——
  if (ticketData) {
    for (const [openId, tp] of Object.entries(ticketData.persons || {})) {
      const person = ensurePerson(openId, tp.name);
      for (const g of tp.groups || []) person.groupSet.add(g);
      for (const t of tp.tickets || []) {
        const timeW = t.deadlineMs
          ? timePressureW(Number(t.createdMs) || 0, t.deadlineMs, nowMs)
          : ticketElapsedW(Number(t.createdMs) || 0, nowMs);
        const bucketW = TICKET_BUCKET_W[t.bucket] || 1.0;
        const gCoeff = groupCoeff(t.groups); // 单级「面向组别」系数（宣运组 ×0.5 等）
        const score = round2((bucketW * timeW * gCoeff) / (t.shareCount || 1)); // 多人协作单按人数摊薄
        person.score = round2(person.score + score);
        person.tickets.push({
          code: t.code || '',
          title: t.title,
          bucket: t.bucket,
          daysLeft: t.daysLeft === undefined ? null : t.daysLeft,
          deadlineFormatted: t.deadlineFormatted || '',
          score,
        });
      }
    }
  }

  // —— 被@加分结算（每 0.01 分/次，入总分） ——
  for (const person of persons.values()) {
    const mentionScore = round2(person.mentionCount * MENTION_SCORE);
    person.mentionScore = mentionScore;
    if (mentionScore > 0) person.score = round2(person.score + mentionScore);
  }

  // —— 输出：按人降序 + 组别切面 + 待接单 ——
  const personsOut = [...persons.entries()]
    .map(([openId, person]) => ({
      openId,
      name: person.name,
      groups: [...person.groupSet],
      score: person.score,
      mentionCount: person.mentionCount,
      mentionScore: person.mentionScore || 0,
      projectCount: person.projects.length,
      ticketCount: person.tickets.length,
      projects: person.projects.sort((a, b) => b.score - a.score),
      tickets: person.tickets.sort((a, b) => b.score - a.score),
    }))
    .sort((a, b) => b.score - a.score);

  const unclaimed = (ticketData && ticketData.unclaimed) || [];
  const orphanTickets = (ticketData && ticketData.orphanTickets) || [];

  // 组别切面：成员分均值/峰值 + 组内待接单数（unclaimed 按「面向组别」归属）
  const groupMap = new Map(); // 组名 → { members: [{name, score}], unclaimedCount }
  const addToGroup = (g, entry) => {
    if (!g) return;
    if (!groupMap.has(g)) groupMap.set(g, { members: [], unclaimedCount: 0 });
    groupMap.get(g).members.push(entry);
  };
  for (const person of personsOut) {
    for (const g of person.groups) addToGroup(g, { openId: person.openId, name: person.name, score: person.score });
  }
  for (const t of unclaimed) {
    for (const g of t.groups || []) {
      if (groupMap.has(g)) groupMap.get(g).unclaimedCount += 1;
      else groupMap.set(g, { members: [], unclaimedCount: 1 });
    }
  }

  const groupsOut = [...groupMap.entries()]
    .map(([name, g]) => {
      const scores = g.members.map((m) => m.score);
      const top = g.members.reduce((a, b) => (b.score > (a ? a.score : -1) ? b : a), null);
      return {
        name,
        memberCount: new Set(g.members.map((m) => m.openId)).size,
        avgScore: scores.length ? round2(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
        maxScore: top ? top.score : 0,
        maxPersonName: top ? top.name : '',
        unclaimedCount: g.unclaimedCount,
      };
    })
    .sort((a, b) => b.maxScore - a.maxScore);

  const scores = personsOut.map((p) => p.score);
  const summary = {
    personCount: personsOut.length,
    avgScore: scores.length ? round2(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    topScore: personsOut.length ? personsOut[0].score : 0,
    topPersonName: personsOut.length ? personsOut[0].name : '',
    projectTotal: personsOut.reduce((a, p) => a + p.projectCount, 0),
    ticketTotal: personsOut.reduce((a, p) => a + p.ticketCount, 0),
    unclaimedTotal: unclaimed.length,
    mentionTotal: personsOut.reduce((a, p) => a + p.mentionCount, 0),
  };

  return {
    weights: {
      status: STATUS_W,
      priority: PRIORITY_W,
      ticketBucket: TICKET_BUCKET_W,
      ownerRole: OWNER_ROLE_W,
      groupCoeff: GROUP_COEFF,
      mention: `群聊每被@一次 +${MENTION_SCORE} 分（近 ${MENTION_WINDOW_DAYS} 天自然日滑窗，网关 /api/usage/mentions）`,
      timePressure: '无DDL 0.5 / 消耗比≤0.5→0.8 / ≤0.8→1.0 / ≤1→1.3 / 逾期 1.3+min(天,14)×0.1 封顶2.7；工单无DDL按滞留 <24h 0.8 / <72h 1.0 / ≥72h 1.2',
      dilution: '多人协作工单按负责人数摊薄（÷shareCount）',
    },
    summary,
    persons: personsOut,
    groups: groupsOut,
    unclaimedTop: [...unclaimed].sort((a, b) => b.elapsedHours - a.elapsedHours).slice(0, 10),
    orphanTickets,
  };
}

/**
 * 团队负载全景：项目表全量 + ticket-bot 按人未结单 + 网关被@计数，聚合评分。
 * ticket-bot 不可用降级为仅项目侧（ticketsSource='unavailable'）、网关不可用缺被@
 * 加分维度（mentionsSource='unavailable'），都不 500。
 */
async function getTeamWorkload() {
  const nowMs = Date.now();
  const projects = buildEffMembers(await getProjects());

  let ticketData = null;
  let ticketsSource = 'ok';
  try {
    ticketData = await fetchTicketWorkload();
  } catch (err) {
    ticketsSource = 'unavailable';
    console.warn(`[负载聚合] ticket-bot 按人明细拉取失败，本次仅项目侧: ${err.message}`);
  }

  let mentionUsers = null;
  let mentionsSource = 'ok';
  try {
    mentionUsers = await fetchMentionCounts();
  } catch (err) {
    mentionsSource = 'unavailable';
    console.warn(`[负载聚合] 网关被@计数拉取失败，本次缺被@加分维度: ${err.message}`);
  }

  const result = computeWorkload(projects, ticketData, mentionUsers, nowMs);
  return { generatedAt: new Date(nowMs).toISOString(), ticketsSource, mentionsSource, ...result };
}

module.exports = {
  getTeamWorkload,
  computeWorkload,
  timePressureW,
  ticketElapsedW,
};
