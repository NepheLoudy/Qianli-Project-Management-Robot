const bitable = require('../feishu/bitable');
const config = require('../config');
const dayjs = require('dayjs');

// 与 ticket-bot 对齐的字段解析：标题取 申请编号 → 需求1/需求 → 工单-后6位
function extractText(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return extractText(value[0]);
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (value.text !== null && value.text !== undefined && value.text !== '') return String(value.text);
    if (value.name) return String(value.name);
  }
  return String(value);
}

function getTicketTitle(fields, recordId) {
  return (
    extractText(fields['申请编号']) ||
    extractText(fields['需求1']) ||
    extractText(fields['需求']) ||
    `工单-${recordId.slice(-6)}`
  );
}

/**
 * 获取未结单工单并按理想结单时间分桶（ticket-bot 不可用时的降级直读链路）
 *
 * 未结单判定对齐 ticket-bot 的结单提醒分支逻辑（checkClosingTickets）：
 * 审批节点处于未审批的最后一层「回执单：是否结单」。
 *
 * 播报对象对齐 ticket-bot unclosedService 主链路口径：指定负责人 → 补充负责人
 * （两者都为空的工单不播，不回退到发起人/当前处理人——当前处理人是结单提醒的口径）。
 *
 * 分桶（对齐 DDL 播报节奏）：
 *   - urgent：理想结单时间在 2 日内（含已超期，超期单独标注）
 *   - week：2 日外、7 日内
 *
 * @returns {Promise<{ urgent: Array, week: Array }>}
 */
async function getUnclosedBuckets() {
  const { tableId, approvalField, closeValue, deadlineField, assigneeField, supplementField } = config.ticketClose;
  const filter = `CurrentValue.[${approvalField}] = "${closeValue}"`;
  const records = await bitable.getAllRecords(tableId, { filter });

  const now = dayjs();
  const urgent = [];
  const week = [];

  for (const record of records) {
    const fields = record.fields;

    // 播报对象：指定负责人 → 补充负责人（去重并集），与 ticket-bot 分组分栏口径一致
    const people = [];
    const seen = new Set();
    for (const field of [assigneeField, supplementField]) {
      for (const p of fields[field] || []) {
        if (p && p.id && !seen.has(p.id)) {
          seen.add(p.id);
          people.push(p);
        }
      }
    }
    if (people.length === 0) continue;

    const deadline = fields[deadlineField];
    if (!deadline) continue;
    const deadlineTs = dayjs(deadline);
    if (!deadlineTs.isValid()) continue;

    const daysLeft = deadlineTs.diff(now, 'day');
    const ticket = {
      recordId: record.record_id,
      title: getTicketTitle(fields, record.record_id),
      handlerId: people[0].id,
      handlerName: people.map((p) => p.name || '未知').join('、'),
      daysLeft,
      deadlineFormatted: deadlineTs.format('YYYY-MM-DD'),
    };

    if (daysLeft <= 2) urgent.push(ticket);
    else if (daysLeft <= 7) week.push(ticket);
    // 超出 7 日的不播报
  }

  urgent.sort((a, b) => a.daysLeft - b.daysLeft);
  week.sort((a, b) => a.daysLeft - b.daysLeft);

  return { urgent, week };
}

/**
 * 从 ticket-bot 获取按「负责人所属组别」分组的未结单工单
 *
 * ticket-bot 侧负责：负责人取指定负责人→补充负责人（不取发起人）、
 * 人员组别解析（USER_GROUPS → 通讯录部门 → 面向组别兜底）、组别到群 chatId 的映射。
 *
 * @returns {Promise<Object<{urgent: Array, week: Array}>>} 以群 chatId 为键
 */
// ticket-bot 假死（端口存活但不响应）时快速超时走降级，不拖住正午播报；
// 10s 为冷缓存余量（分组接口会对无 USER_GROUPS 映射的负责人逐人查通讯录部门）
const GROUPED_FETCH_TIMEOUT_MS = 10 * 1000;

async function getGroupedBuckets() {
  const res = await fetch(`${config.ticketBot.url}/api/tickets/unclosed-by-group`, {
    signal: AbortSignal.timeout(GROUPED_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ticket-bot API HTTP ${res.status}`);
  const data = await res.json();
  return data.result || {};
}

module.exports = {
  getUnclosedBuckets,
  getGroupedBuckets,
};
