const bitable = require('../feishu/bitable');
const config = require('../config');

const LOG_TABLE_ID = config.bitable.logTableId;

async function createLog(version, content) {
  if (!LOG_TABLE_ID) {
    console.warn('未配置维护日志表ID，跳过写入');
    return null;
  }

  const fields = {
    version: version,
    content: content,
    createdAt: Date.now(),
  };

  try {
    const record = await bitable.createRecord(LOG_TABLE_ID, fields);
    console.log(`[维护日志] 版本 ${version} 已记录`);
    return record;
  } catch (err) {
    console.error('[维护日志] 写入失败:', err);
    throw err;
  }
}

async function getLogs(pageSize = 20, pageToken = '') {
  if (!LOG_TABLE_ID) {
    return { items: [], hasMore: false, total: 0 };
  }

  let result;
  try {
    result = await bitable.listRecords(LOG_TABLE_ID, {
      page_size: pageSize,
      page_token: pageToken,
      sort: [
        {
          field_name: 'createdAt',
          desc: true,
        },
      ],
    });
  } catch (sortErr) {
    // 排序字段不支持时，降级为不排序
    console.warn('[维护日志] 排序失败，降级为不排序:', sortErr.message);
    result = await bitable.listRecords(LOG_TABLE_ID, {
      page_size: pageSize,
      page_token: pageToken,
    });
  }

  return {
    items: result.items.map(record => ({
      id: record.record_id,
      version: record.fields.version || '',
      content: record.fields.content || '',
      createdAt: record.fields.createdAt || record.fields['创建时间'] || null,
    })),
    hasMore: result.hasMore,
    pageToken: result.pageToken,
    total: result.total,
  };
}

async function getAllLogs() {
  if (!LOG_TABLE_ID) {
    return [];
  }

  let records;
  try {
    records = await bitable.getAllRecords(LOG_TABLE_ID, {
      sort: [
        {
          field_name: 'createdAt',
          desc: true,
        },
      ],
    });
  } catch (sortErr) {
    console.warn('[维护日志] 排序失败，降级为不排序:', sortErr.message);
    records = await bitable.getAllRecords(LOG_TABLE_ID);
  }

  return records.map(record => ({
    id: record.record_id,
    version: record.fields.version || '',
    content: record.fields.content || '',
    createdAt: record.fields.createdAt || record.fields['创建时间'] || null,
  }));
}

module.exports = {
  createLog,
  getLogs,
  getAllLogs,
};
