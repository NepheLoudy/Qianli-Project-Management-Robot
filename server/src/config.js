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
  bot2: {
    webhookUrl: process.env.BOT2_WEBHOOK_URL || '',
    chatId: process.env.BOT2_CHAT_ID || '',
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
  printServer: {
    url: process.env.PRINT_SERVER_URL || 'http://localhost:3001',
  },
};

/**
 * 根据 chatId 获取对应群的配置上下文
 * @param {string} chatId
 * @returns {{ chatId: string, webhookUrl: string, mentionField: string, filter: string, label: string } | null}
 */
function getChatContext(chatId) {
  if (!chatId) return null;

  if (chatId === module.exports.chat.chatId) {
    return {
      chatId: module.exports.chat.chatId,
      webhookUrl: module.exports.bot.webhookUrl,
      mentionField: 'owner',
      filter: 'owner',
      label: 'owner群',
    };
  }

  if (chatId === module.exports.bot2.chatId) {
    return {
      chatId: module.exports.bot2.chatId,
      webhookUrl: module.exports.bot2.webhookUrl,
      mentionField: 'contributers',
      filter: 'contributers',
      label: 'contributers群',
    };
  }

  return null;
}

module.exports.getChatContext = getChatContext;
