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
 * 获取未结单工单并按理想结单时间分桶
 *
 * 未结单判定对齐 ticket-bot 的结单提醒分支逻辑（checkClosingTickets）：
 * 审批节点处于未审批的最后一层「回执单：是否结单」，且当前处理人有值
 * （无论公开质询被接单还是指定负责人，走到该节点即代表工作已交付、只差结单确认）。
 *
 * 分桶（对齐 DDL 播报节奏）：
 *   - urgent：理想结单时间在 2 日内（含已超期，超期单独标注）
 *   - week：2 日外、7 日内
 *
 * @returns {Promise<{ urgent: Array, week: Array }>}
 */
async function getUnclosedBuckets() {
  const { tableId, approvalField, closeValue, deadlineField } = config.ticketClose;
  const filter = `CurrentValue.[${approvalField}] = "${closeValue}"`;
  const records = await bitable.getAllRecords(tableId, { filter });

  const now = dayjs();
  const urgent = [];
  const week = [];

  for (const record of records) {
    const fields = record.fields;

    // 有人负责才播报（当前处理人有值），与 ticket-bot 结单提醒分支一致
    const handler = fields['当前处理人']?.[0];
    if (!handler || !handler.id) continue;

    const deadline = fields[deadlineField];
    if (!deadline) continue;
    const deadlineTs = dayjs(deadline);
    if (!deadlineTs.isValid()) continue;

    const daysLeft = deadlineTs.diff(now, 'day');
    const ticket = {
      recordId: record.record_id,
      title: getTicketTitle(fields, record.record_id),
      handlerId: handler.id,
      handlerName: handler.name || '未知',
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

module.exports = {
  getUnclosedBuckets,
};
