const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

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
    webhookUrl: process.env.BOT_WEBHOOK_URL || '',
  },
  keyword: {
    chatId: process.env.KEYWORD_CHAT_ID || '',
  },
  chat: {
    chatId: process.env.CHAT_CHAT_ID || '',
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
};
