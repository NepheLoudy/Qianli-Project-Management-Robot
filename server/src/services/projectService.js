const bitable = require('../feishu/bitable');
const config = require('../config');
const dayjs = require('dayjs');

const PROJECT_TABLE_ID = config.bitable.projectTableId;

async function getProjects() {
  const records = await bitable.getAllRecords(PROJECT_TABLE_ID);

  const projects = records.map(r => recordToProject(r));
  return projects.sort((a, b) => new Date(a.ddl) - new Date(b.ddl));
}

async function createProject(data) {
  const now = Date.now();
  const fields = {
    name: data.name,
    owner: data.owner ? [{ id: data.owner }] : [],
    ddl: data.ddl,
    priority: data.priority || 'medium',
    status: data.status || 'pending',
    category: data.category || '其他',
    fileToken: data.fileToken || '',
    parentId: data.parentId ? [data.parentId] : [],
    createdAt: now,
    updatedAt: now,
  };

  const record = await bitable.createRecord(PROJECT_TABLE_ID, fields);
  return recordToProject(record);
}

async function updateProject(id, data) {
  const fields = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.owner !== undefined) fields.owner = [{ id: data.owner }];
  if (data.ddl !== undefined) fields.ddl = data.ddl;
  if (data.priority !== undefined) fields.priority = data.priority;
  if (data.status !== undefined) fields.status = data.status;
  if (data.category !== undefined) fields.category = data.category;
  if (data.fileToken !== undefined) fields.fileToken = data.fileToken;
  if (data.parentId !== undefined) fields.parentId = data.parentId ? [data.parentId] : [];
  fields.updatedAt = Date.now();

  const record = await bitable.updateRecord(PROJECT_TABLE_ID, id, fields);
  return recordToProject(record);
}

async function deleteProject(id) {
  return bitable.deleteRecord(PROJECT_TABLE_ID, id);
}

async function getDDLAlerts(days = 7) {
  const projects = await getProjects();
  const now = dayjs();

  const alerts = projects
    .filter(p => p.status !== 'completed')
    .map(p => {
      const daysLeft = dayjs(p.ddl).diff(now, 'day');
      return {
        projectId: p.id,
        projectName: p.name,
        owner: p.owner,
        ownerName: p.ownerName,
        ddl: p.ddl,
        daysLeft,
        priority: p.priority,
        category: p.category || '其他',
      };
    })
    .filter(a => a.daysLeft <= days);

  return alerts.sort((a, b) => a.daysLeft - b.daysLeft);
}

// 解析人员字段（多选人员），对应各播报群
function parsePersonField(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(c => ({ id: c.id || '', name: c.name || c.en_name || '' }))
    .filter(c => c.id);
}

function recordToProject(record) {
  const f = record.fields;

  let ownerId = '';
  let ownerName = '';
  const rawOwner = Array.isArray(f.owner) ? f.owner : (f.owner ? [f.owner] : []);
  const ownerMembers = parsePersonField(rawOwner); // 完整列表（多选），父负责人归并用
  if (ownerMembers.length > 0) {
    ownerId = ownerMembers[0].id;
    ownerName = ownerMembers[0].name;
  }

  // parentId 可能是文本字段，也可能是关联字段（含 record_ids 数组）
  let parentId = '';
  const rawParentId = f.parentId || f.parent_id;
  if (rawParentId) {
    if (typeof rawParentId === 'string') {
      parentId = rawParentId;
    } else if (Array.isArray(rawParentId)) {
      // 关联字段：[{ record_ids: [...], ... }] 或 [{ text: 'recXXX', ... }]
      const first = rawParentId[0];
      if (first) {
        if (Array.isArray(first.record_ids) && first.record_ids.length > 0) {
          parentId = first.record_ids[0];
        } else if (typeof first.text === 'string') {
          parentId = first.text;
        } else if (typeof first === 'string') {
          parentId = first;
        }
      }
    } else if (typeof rawParentId === 'object') {
      if (Array.isArray(rawParentId.record_ids) && rawParentId.record_ids.length > 0) {
        parentId = rawParentId.record_ids[0];
      } else if (typeof rawParentId.text === 'string') {
        parentId = rawParentId.text;
      }
    }
  }

  // 解析4个人员字段，对应4个播报群
  const contributers = parsePersonField(f.contributers);
  const dkyjContributers = parsePersonField(f.dkyjcontributers);
  const sjContributers = parsePersonField(f.sjcontributers);
  const xyContributers = parsePersonField(f.xycontributers);

  return {
    id: record.record_id,
    name: f.name || '',
    owner: ownerId,
    ownerName: ownerName,
    ownerMembers,
    contributers,
    dkyjContributers,
    sjContributers,
    xyContributers,
    ddl: f.ddl,
    priority: f.priority || 'medium',
    status: f.status || 'pending',
    category: f.category || '其他',
    fileToken: f.fileToken || '',
    parentId: parentId,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

function buildHierarchy(projects) {
  const projectMap = new Map();
  const rootProjects = [];

  projects.forEach(p => {
    projectMap.set(p.id, { ...p, children: [] });
  });

  projects.forEach(p => {
    const project = projectMap.get(p.id);
    if (p.parentId && projectMap.has(p.parentId)) {
      projectMap.get(p.parentId).children.push(project);
    } else {
      rootProjects.push(project);
    }
  });

  return rootProjects;
}

// 播报归属成员字段（与播报群 mentionField / 看板人员字段对齐）；
// 播报时每个项目的「有效成员」= 自身成员 ∪ 各祖先（父/爷…）同字段成员，按 id 去重——
// 父项目负责人是总负责人，视为其名下所有子项目都有他；子项目自身负责人照旧（自身优先）
const MEMBER_FIELD_NAMES = ['owner', 'contributers', 'dkyjcontributers', 'sjcontributers', 'xycontributers'];

// item → 该字段原始成员列表（owner 在看板是 User 多选，完整列表用于父负责人归并；
// ownerId/ownerName 单值语义保留给逾期确认等既有逻辑）
function membersOf(project, field) {
  if (field === 'owner') {
    if (project.ownerMembers && project.ownerMembers.length > 0) return project.ownerMembers;
    return project.ownerId ? [{ id: project.ownerId, name: project.ownerName || '' }] : [];
  }
  if (field === 'contributers') return project.contributers;
  if (field === 'dkyjcontributers') return project.dkyjContributers;
  if (field === 'sjcontributers') return project.sjContributers;
  if (field === 'xycontributers') return project.xyContributers;
  return [];
}

function unionMembers(acc, list) {
  for (const m of list) {
    if (!m || !m.id) continue;
    if (!acc.some(x => x.id === m.id)) acc.push(m);
  }
}

/**
 * 为每个项目计算归并成员（effMembers）：自身成员优先，再沿 parentId 链向上并入各祖先
 * 同字段成员，按 id 去重。无父项目时 effMembers 即自身成员（行为与现状一致）。
 */
function buildEffMembers(projects) {
  const byId = new Map(projects.map(p => [p.id, p]));
  const cache = new Map();

  function effOf(item) {
    if (cache.has(item.id)) return cache.get(item.id);

    // 先算父链（自身在前，其后是父、爷…），避免递归重复
    const chain = [];
    const seen = new Set();
    let cur = item;
    while (cur && !seen.has(cur.id)) {
      chain.push(cur);
      seen.add(cur.id);
      cur = cur.parentId && byId.has(cur.parentId) ? byId.get(cur.parentId) : null;
    }

    const eff = {};
    for (const field of MEMBER_FIELD_NAMES) {
      const members = [];
      for (const node of chain) unionMembers(members, membersOf(node, field));
      eff[field] = members;
    }
    cache.set(item.id, eff);
    return eff;
  }

  for (const p of projects) effOf(p);
  for (const p of projects) p.effMembers = cache.get(p.id);
  return projects;
}

async function getProjectsWithHierarchy() {
  const projects = await getProjects();
  return buildHierarchy(projects);
}

async function getDDLForBroadcastWithHierarchy(filter = 'all', preloadedProjects = null) {
  const projects = preloadedProjects || await getProjects();
  const now = dayjs();
  const alertDays = config.ddl.alertDays;

  const priorityLabels = {
    high: '高',
    medium: '中',
    low: '低',
  };

  const allProjects = projects.map(p => {
    const daysLeft = dayjs(p.ddl).diff(now, 'day');
    return {
      ...p,
      daysLeft,
      ddlFormatted: dayjs(p.ddl).format('YYYY-MM-DD'),
      priorityLabel: priorityLabels[p.priority] || '中',
    };
  });

  // 父项目负责人归并：播报时父项目各人员字段的成员视为其名下所有子项目也有（自身优先，id 去重）
  buildEffMembers(allProjects);

  const hierarchy = buildHierarchy(allProjects);

  // 各播报群对应的人员字段判断（mentionField 即多维表格字段名）；
  // 用归并后的 effMembers：父项目负责人在该字段 → 其名下未自配该字段的子项目也进本群播报
  const mentionFieldChecks = {
    owner: item => (item.effMembers?.owner || []).length > 0,
    contributers: item => (item.effMembers?.contributers || []).length > 0,
    dkyjcontributers: item => (item.effMembers?.dkyjcontributers || []).length > 0,
    sjcontributers: item => (item.effMembers?.sjcontributers || []).length > 0,
    xycontributers: item => (item.effMembers?.xycontributers || []).length > 0,
  };

  function passesFilter(item) {
    const check = mentionFieldChecks[filter];
    if (check) return check(item);
    return true;
  }

  function getDDLCategory(item) {
    // died: 项目已截止，不再管理；其余非进行中/等待认领的状态也不播报
    if (item.status !== 'in_progress' && item.status !== 'waiting') return 'none';
    if (!passesFilter(item)) return 'none';
    // 未填 DDL（或日期非法）的项目不播报
    if (!item.ddl || !dayjs(item.ddl).isValid()) return 'none';
    if (item.daysLeft < 0) return 'overdue';
    if (item.daysLeft <= alertDays) return 'urgent';
    if (item.daysLeft <= 7) return 'week';
    return 'none';
  }

  function hasUncompletedChild(item) {
    if (!item.children || item.children.length === 0) return false;
    return item.children.some(child => {
      if (child.status === 'in_progress' || child.status === 'waiting') return true;
      return hasUncompletedChild(child);
    });
  }

  function pruneTree(items, level = 0) {
    const pruned = [];

    items.forEach(item => {
      const node = {
        ...item,
        level,
        ddlCategory: getDDLCategory(item),
        isQualified: getDDLCategory(item) !== 'none',
        hasChildren: item.children && item.children.length > 0,
        children: [],
      };

      if (item.children && item.children.length > 0) {
        node.children = pruneTree(item.children, level + 1);
      }

      if (node.hasChildren && node.children.length === 0) {
        return;
      }

      if (node.isQualified || node.children.length > 0) {
        pruned.push(node);
      }
    });

    return pruned;
  }

  const prunedHierarchy = pruneTree(hierarchy);

  // 各分栏按类过滤成各自的子树：只保留本类合格节点与通往它们的祖先容器。
  // 不能整树下发再靠渲染区分——renderTreeNode 只看节点自身 ddlCategory，
  // 父组名下跨类时同一棵子树会被原样画进多个分栏（逾期/2天内两栏内容重复的根因）。
  // hasChildren 按过滤结果重算：自身合格但子项全被滤掉的节点降级为叶子行，
  // 否则会渲染成空组头，丢掉自己的状态文案。
  // isQualified 同步收敛为本类合格：跨类充当容器的节点不再被 countQualifiedNodes
  // 计入本栏数量，保证分栏标题的 N 与栏内可见行数一致。
  function filterTreeByCategory(items, category) {
    const filtered = [];

    items.forEach(item => {
      const children = item.children && item.children.length > 0
        ? filterTreeByCategory(item.children, category)
        : [];
      const selfMatch = item.isQualified && item.ddlCategory === category;
      if (!selfMatch && children.length === 0) return;
      filtered.push({ ...item, children, hasChildren: children.length > 0, isQualified: selfMatch });
    });

    return filtered;
  }

  // pending: 意外暂停的项目，不参与 DDL 分类，单独收集后在卡片中单独说明
  // （暂停中的项目往往没有明确 DDL，因此不检查 ddl；died 与其他状态不列）
  const pausedProjects = allProjects.filter(p => p.status === 'pending' && passesFilter(p));

  return {
    overdue: filterTreeByCategory(prunedHierarchy, 'overdue'),
    urgent: filterTreeByCategory(prunedHierarchy, 'urgent'),
    week: filterTreeByCategory(prunedHierarchy, 'week'),
    paused: pausedProjects,
    fullHierarchy: prunedHierarchy,
  };
}

module.exports = {
  getProjects,
  getProjectsWithHierarchy,
  createProject,
  updateProject,
  deleteProject,
  getDDLAlerts,
  getDDLForBroadcastWithHierarchy,
};
