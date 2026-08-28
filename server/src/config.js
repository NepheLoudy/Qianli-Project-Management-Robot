const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// 播报群配置：4个群对应多维表格的4个人员字段，每个群只播报对应字段有人的项目
// 对应人员字段：owner / dkyjcontributers / sjcontributers / xycontributers
const broadcastGroups = [
  {
    key: 'owner',
    label: 'owner群',
    chatId: process.env.OWNER_CHAT_ID || process.env.CHAT_CHAT_ID || '',
    webhookUrl: process.env.OWNER_WEBHOOK_URL || process.env.BOT_WEBHOOK_URL || '',
    mentionField: 'owner',
  },
  {
    key: 'dkyj',
    label: 'dkyj组',
    chatId: process.env.DKYJ_CHAT_ID || '',
    webhookUrl: process.env.DKYJ_WEBHOOK_URL || '',
    mentionField: 'dkyjcontributers',
  },
  {
    key: 'sj',
    label: 'sj组',
    chatId: process.env.SJ_CHAT_ID || '',
    webhookUrl: process.env.SJ_WEBHOOK_URL || '',
    mentionField: 'sjcontributers',
  },
  {
    key: 'xy',
    label: 'xy组',
    chatId: process.env.XY_CHAT_ID || '',
    webhookUrl: process.env.XY_WEBHOOK_URL || '',
    mentionField: 'xycontributers',
  },
];

module.exports = {
  port: process.env.PORT || 3000,
  feishu: {
    appId: process.env.APP_ID || '',
    appSecret: process.env.APP_SECRET || '',
  },
  bitable: {
    appToken: process.env.BITABLE_APP_TOKEN || '',
    projectTableId: process.env.BITABLE_PROJECT_TABLE_ID || '',
    logTableId: process.env.BITABLE_LOG_TABLE_ID || '',
    keywordTableId: process.env.BITABLE_KEYWORD_TABLE_ID || '',
    quoteTableId: process.env.BITABLE_QUOTE_TABLE_ID || 'tblGLs09KVReMYHk',
  },
  feishuEvent: {
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || '',
    encryptKey: process.env.FEISHU_ENCRYPT_KEY || '',
    useLongConnection: process.env.FEISHU_USE_LONG_CONNECTION !== 'false',
  },
  bot: {
    name: process.env.BOT_NAME || '爆米花机',
    // 兼容保留：默认回落到 owner 群 webhook
    webhookUrl: process.env.OWNER_WEBHOOK_URL || process.env.BOT_WEBHOOK_URL || '',
  },
  keyword: {
    chatId: process.env.KEYWORD_CHAT_ID || '',
  },
  meeting: {
    chatIds: process.env.MEETING_CHAT_IDS ? process.env.MEETING_CHAT_IDS.split(',') : [],
  },
  cron: {
    schedule: process.env.CRON_SCHEDULE || '0 0 12 * * *',
  },
  ddl: {
    alertDays: parseInt(process.env.DDL_ALERT_DAYS || '2', 10),
  },
  printServer: {
    url: process.env.PRINT_SERVER_URL || 'http://localhost:3001',
  },
  broadcastGroups,
};

/**
 * 根据 chatId 获取对应群的播报上下文
 * 每个群 chatId 只会命中一个配置项，避免同一群被多个播报配置重复处理
 * @param {string} chatId
 * @returns {{ key: string, chatId: string, webhookUrl: string, mentionField: string, label: string } | null}
 */
function getChatContext(chatId) {
  if (!chatId) return null;
  return module.exports.broadcastGroups.find(g => g.chatId && g.chatId === chatId) || null;
}

/**
 * 获取 owner 群配置（逾期私聊确认的群聊降级使用）
 * @returns {{ key: string, chatId: string, webhookUrl: string, mentionField: string, label: string } | null}
 */
function getOwnerGroup() {
  return module.exports.broadcastGroups.find(g => g.mentionField === 'owner') || null;
}

module.exports.getChatContext = getChatContext;
module.exports.getOwnerGroup = getOwnerGroup;
