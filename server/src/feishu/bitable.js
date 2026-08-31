const { requestAPI } = require('./client');
const config = require('../config');

const bitableApi = {
  appToken: config.bitable.appToken,

  async listRecords(tableId, params = {}) {
    const query = {};
    if (params.page_size) query.page_size = params.page_size;
    if (params.page_token) query.page_token = params.page_token;
    if (params.filter) query.filter = params.filter;
    if (params.sort) query.sort = JSON.stringify(params.sort);

    const res = await requestAPI(
      'GET',
      `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records`,
      query
    );

    if (res.code !== 0) {
      throw new Error(`获取记录失败: ${res.msg}`);
    }

    return {
      items: res.data.items || [],
      pageToken: res.data.page_token || '',
      hasMore: res.data.has_more || false,
      total: res.data.total || 0,
    };
  },

  async getAllRecords(tableId, params = {}) {
    const allItems = [];
    let pageToken = '';

    do {
      const result = await this.listRecords(tableId, {
        ...params,
        page_size: 100,
        page_token: pageToken,
      });
      allItems.push(...result.items);
      pageToken = result.hasMore ? result.pageToken : '';
    } while (pageToken);

    return allItems;
  },

  async createRecord(tableId, fields) {
    const res = await requestAPI(
      'POST',
      `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records`,
      {
        fields,
      }
    );

    if (res.code !== 0) {
      console.error('创建记录失败详细信息:', JSON.stringify(res));
      throw new Error(`创建记录失败: ${res.msg}`);
    }

    return res.data.record;
  },

  async batchCreateRecords(tableId, records) {
    const res = await requestAPI(
      'POST',
      `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/batch_create`,
      {
        records: records.map(fields => ({ fields })),
      }
    );

    if (res.code !== 0) {
      throw new Error(`批量创建记录失败: ${res.msg}`);
    }

    return res.data.records || [];
  },

  async updateRecord(tableId, recordId, fields) {
    const res = await requestAPI(
      'PUT',
      `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/${recordId}`,
      {
        fields,
      }
    );

    if (res.code !== 0) {
      throw new Error(`更新记录失败: ${res.msg}`);
    }

    return res.data.record;
  },

  async deleteRecord(tableId, recordId) {
    const res = await requestAPI(
      'DELETE',
      `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/${recordId}`
    );

    if (res.code !== 0) {
      throw new Error(`删除记录失败: ${res.msg}`);
    }

    return true;
  },

  async searchRecord(tableId, fieldName, value) {
    const records = await this.getAllRecords(tableId);

    for (const record of records) {
      const fieldValue = record.fields[fieldName];
      if (fieldValue === value) {
        return record;
      }
      if (typeof fieldValue === 'object' && fieldValue !== null) {
        if (fieldValue.text === value) return record;
        if (Array.isArray(fieldValue) && fieldValue.length > 0) {
          if (fieldValue[0]?.text === value) return record;
        }
      }
    }

    return null;
  },
};

module.exports = bitableApi;
