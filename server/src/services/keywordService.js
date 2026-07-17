const fs = require('fs');
const path = require('path');
const bitableApi = require('../feishu/bitable');
const config = require('../config');
const { requestAPI } = require('../feishu/client');

const KEYWORDS_CONFIG_PATH = path.join(__dirname, '../config/keywords.json');
const TABLE_ID = () => config.bitable.keywordTableId;

const processedMessageIds = new Set();

function loadKeywordsConfig() {
  try {
    const data = fs.readFileSync(KEYWORDS_CONFIG_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('加载关键词配置失败:', err.message);
    return { enabled: false, keywords: [] };
  }
}

function extractKeywords(text, keywordList) {
  if (!text || !keywordList || keywordList.length === 0) {
    return [];
  }

  const found = [];
  for (const keyword of keywordList) {
    if (text.includes(keyword)) {
      found.push(keyword);
    }
  }
  return found;
}

function extractContentAfterKeyword(text, keyword) {
  if (!text || !keyword) return text || '';
  const idx = text.indexOf(keyword);
  if (idx === -1) return text;
  let after = text.substring(idx + keyword.length);
  after = after.replace(/^[\s\n\r]+/, '');
  return after || text;
}

function extractTextContent(message) {
  if (!message || !message.content) return '';

  try {
    const content = typeof message.content === 'string'
      ? JSON.parse(message.content)
      : message.content;

    const msgType = message.msg_type || message.message_type;

    if (msgType === 'text') {
      return content.text || '';
    }

    if (msgType === 'post') {
      let text = '';
      const zhCn = content.zh_cn || content.post?.zh_cn;
      const postContent = (zhCn && zhCn.content) ? zhCn.content : content.content;
      if (postContent && Array.isArray(postContent)) {
        for (const line of postContent) {
          for (const item of line) {
            if (item.tag === 'text') {
              text += item.text;
            }
          }
          text += '\n';
        }
      }
      return text;
    }

    if (msgType === 'share_chat') {
      const title = content.title || content.chat_name || '';
      const description = content.description || '';
      return `${title} ${description}`;
    }

    if (msgType === 'share_calendar') {
      const title = content.title || '';
      const description = content.description || '';
      const agenda = content.agenda || '';
      return `${title} ${description} ${agenda}`;
    }

    if (msgType === 'calendar_event') {
      const title = content.title || '';
      const description = content.description || '';
      return `${title} ${description}`;
    }

    if (msgType === 'interactive') {
      let text = '';
      const card = content.card || {};
      const header = card.header || {};
      const headerTitle = header.title || {};
      text += headerTitle.content || '';
      const elements = card.elements || [];
      for (const element of elements) {
        if (element.tag === 'div') {
          const fields = element.fields || [];
          for (const field of fields) {
            const fieldText = field.text || {};
            text += fieldText.content || '';
          }
        }
      }
      return text;
    }

    return '';
  } catch (err) {
    console.error('解析消息内容失败:', err.message);
    return '';
  }
}

function extractImageKeys(message) {
  const imageKeys = [];

  try {
    if (!message || !message.content) return imageKeys;

    const content = typeof message.content === 'string'
      ? JSON.parse(message.content)
      : message.content;

    const msgType = message.msg_type || message.message_type;

    if (msgType === 'image') {
      if (content.image_key) {
        imageKeys.push(content.image_key);
      }
    }

    if (msgType === 'post') {
      const zhCn = content.zh_cn || content.post?.zh_cn;
      const postContent = (zhCn && zhCn.content) ? zhCn.content : content.content;
      if (postContent && Array.isArray(postContent)) {
        for (const line of postContent) {
          for (const item of line) {
            if (item.tag === 'img' && item.image_key) {
              imageKeys.push(item.image_key);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('提取图片失败:', err.message);
  }

  return imageKeys;
}

async function getUserName(userId) {
  try {
    const res = await requestAPI(
      'GET',
      `/contact/v3/users/${userId}`
    );

    if (res.code === 0 && res.data && res.data.user) {
      return res.data.user.name || userId;
    }
    return userId;
  } catch (err) {
    console.error('获取用户名失败:', err.message);
    return userId;
  }
}

async function findOrCreateKeywordParent(groupName) {
  const tableId = TABLE_ID();

  const allRecords = await bitableApi.getAllRecords(tableId);
  for (const record of allRecords) {
    const f = record.fields;
    const groupValue = f['组别'];
    let groupText = '';
    if (typeof groupValue === 'string') {
      groupText = groupValue;
    } else if (groupValue && typeof groupValue === 'object') {
      if (groupValue.text) groupText = groupValue.text;
      else if (Array.isArray(groupValue) && groupValue.length > 0 && groupValue[0]?.text) {
        groupText = groupValue[0].text;
      }
    }

    if (groupText === groupName) {
      const rawParentId = f.parentId || f.parent_id;
      let hasParent = false;
      if (rawParentId && Array.isArray(rawParentId) && rawParentId.length > 0) {
        const first = rawParentId[0];
        if (first && (first.record_ids || first.record_id || first.id || first.text)) {
          hasParent = true;
        }
      }
      if (!hasParent) {
        console.log(`[关键词监听] 找到已有父记录: ${groupName} (${record.record_id})`);
        return record.record_id;
      }
    }
  }

  const parentFields = {
    组别: groupName,
  };

  const record = await bitableApi.createRecord(tableId, parentFields);
  console.log(`[关键词监听] 已创建关键词父记录: ${groupName} (${record.record_id})`);
  return record.record_id;
}

async function processMessageEvent(event) {
  const keywordsConfig = loadKeywordsConfig();

  if (!keywordsConfig.enabled || keywordsConfig.keywords.length === 0) {
    return { skipped: true, reason: '关键词监听未启用' };
  }

  const message = event.message;
  if (!message) {
    return { skipped: true, reason: '无消息内容' };
  }

  if (processedMessageIds.has(message.message_id)) {
    console.log('[关键词监听] 跳过重复消息:', message.message_id);
    return { skipped: true, reason: '重复消息' };
  }
  processedMessageIds.add(message.message_id);
  if (processedMessageIds.size > 1000) {
    const firstKey = processedMessageIds.values().next().value;
    processedMessageIds.delete(firstKey);
  }

  const text = extractTextContent(message);
  console.log('[关键词监听] 消息文本:', text);
  const matchedKeywords = extractKeywords(text, keywordsConfig.keywords);

  if (matchedKeywords.length === 0) {
    return { skipped: true, reason: '未匹配关键词' };
  }

  const chatId = message.chat_id;
  const messageId = message.message_id;
  const senderId = event.sender?.sender_id?.open_id || event.sender?.sender_id?.user_id || '';
  const sendTime = message.create_time
    ? Number(message.create_time)
    : Date.now();

  const imageKeys = extractImageKeys(message);

  const results = [];
  for (const keyword of matchedKeywords) {
    const groupName = keyword.replace(/^#/, '');
    const contentAfter = extractContentAfterKeyword(text, keyword);

    const childFields = {
      组别: groupName,
      消息内容: contentAfter,
    };

    try {
      const parentRecordId = await findOrCreateKeywordParent(groupName);
      childFields['parentId'] = [parentRecordId];

      if (sendTime) {
        childFields['时间'] = sendTime;
      }

      if (senderId) {
        childFields['发送人'] = [{ id: senderId }];
      }

      if (imageKeys.length > 0) {
        childFields['图片'] = imageKeys.map(key => ({ file_token: key }));
      }

      const childRecord = await bitableApi.createRecord(TABLE_ID(), childFields);
      results.push({
        keyword,
        success: true,
        parentRecordId,
        childRecordId: childRecord.record_id,
      });
      console.log(`[关键词监听] 已记录 ${keyword} - 用户:${senderId} (父记录: ${parentRecordId})`);
    } catch (err) {
      console.error(`[关键词监听] 写入多维表格失败 (${keyword}):`, err.message);
      console.error(`[关键词监听] 写入的字段:`, Object.keys(childFields));
      results.push({
        keyword,
        success: false,
        error: err.message,
      });
    }
  }

  return {
    matched: true,
    keywords: matchedKeywords,
    sender: senderId,
    results,
  };
}

async function getKeywordRecords(params = {}) {
  if (!config.bitable.keywordTableId) {
    throw new Error('未配置关键词监听表格 ID');
  }
  return bitableApi.listRecords(config.bitable.keywordTableId, params);
}

function parseParentId(rawParentId) {
  let parentId = '';
  if (rawParentId) {
    if (typeof rawParentId === 'string') {
      parentId = rawParentId;
    } else if (Array.isArray(rawParentId)) {
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
  return parentId;
}

function buildKeywordHierarchy(records) {
  const recordMap = new Map();
  const rootRecords = [];

  records.forEach(r => {
    const parentId = parseParentId(r.fields?.parentId || r.fields?.parent_id);
    recordMap.set(r.record_id, { ...r, children: [], parentId });
  });

  records.forEach(r => {
    const record = recordMap.get(r.record_id);
    if (record.parentId && recordMap.has(record.parentId)) {
      recordMap.get(record.parentId).children.push(record);
    } else {
      rootRecords.push(record);
    }
  });

  return rootRecords;
}

async function getKeywordRecordsWithHierarchy(params = {}) {
  const result = await getKeywordRecords(params);
  const hierarchy = buildKeywordHierarchy(result.items);
  return {
    ...result,
    items: hierarchy,
  };
}

module.exports = {
  loadKeywordsConfig,
  extractKeywords,
  extractTextContent,
  extractImageKeys,
  processMessageEvent,
  getKeywordRecords,
  getKeywordRecordsWithHierarchy,
  buildKeywordHierarchy,
};
