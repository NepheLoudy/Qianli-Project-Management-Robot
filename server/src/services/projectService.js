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
  if (f.owner) {
    const ownerData = Array.isArray(f.owner) ? f.owner[0] : f.owner;
    if (ownerData) {
      ownerId = ownerData.id || '';
      ownerName = ownerData.name || ownerData.en_name || '';
    }
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

  const hierarchy = buildHierarchy(allProjects);

  // 各播报群对应的人员字段判断（mentionField 即多维表格字段名）
  const mentionFieldChecks = {
    owner: item => !!item.owner,
    contributers: item => item.contributers.length > 0,
    dkyjcontributers: item => item.dkyjContributers.length > 0,
    sjcontributers: item => item.sjContributers.length > 0,
    xycontributers: item => item.xyContributers.length > 0,
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

  function collectByCategory(items) {
    const result = { overdue: [], urgent: [], week: [] };

    items.forEach(item => {
      if (item.isQualified) {
        if (item.ddlCategory === 'overdue') result.overdue.push(item);
        else if (item.ddlCategory === 'urgent') result.urgent.push(item);
        else if (item.ddlCategory === 'week') result.week.push(item);
      }

      if (item.children && item.children.length > 0) {
        const childResult = collectByCategory(item.children);
        result.overdue.push(...childResult.overdue);
        result.urgent.push(...childResult.urgent);
        result.week.push(...childResult.week);
      }
    });

    return result;
  }

  function hasQualifiedDescendant(node, category) {
    if (node.ddlCategory === category) return true;
    if (node.children && node.children.length > 0) {
      return node.children.some(child => hasQualifiedDescendant(child, category));
    }
    return false;
  }

  // pending: 意外暂停的项目，不参与 DDL 分类，单独收集后在卡片中单独说明
  // （暂停中的项目往往没有明确 DDL，因此不检查 ddl；died 与其他状态不列）
  const pausedProjects = allProjects.filter(p => p.status === 'pending' && passesFilter(p));

  return {
    overdue: prunedHierarchy.filter(n => hasQualifiedDescendant(n, 'overdue')),
    urgent: prunedHierarchy.filter(n => hasQualifiedDescendant(n, 'urgent')),
    week: prunedHierarchy.filter(n => hasQualifiedDescendant(n, 'week')),
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
