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
  // 关键词自动回复（server/src/config/autoReplies.json）：群消息命中关键词自动回答。
  // 与原关键词监听插件（KEYWORD_CHAT_ID → 写多维表格）分立，互不依赖。
  // AUTO_REPLY_CHAT_IDS：未@机器人时的生效群范围（逗号分隔 chat_id）；留空或 '*' = 所有群。
  // @机器人/私聊提问不受此限。审批群始终排除。
  autoReply: {
    chatIdsRaw: process.env.AUTO_REPLY_CHAT_IDS || '',
  },
  // 审批群（approval-bot 服务）：本群指令能力整体切换为财务相关，
  // /approval-* 指令转发给 approval-bot 处理
  approval: {
    chatId: process.env.APPROVAL_CHAT_ID || 'oc_1ea53731a8772400450da6ab107f8331',
    serviceUrl: process.env.APPROVAL_SERVICE_URL || 'http://localhost:3002',
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
  // ticket-bot 服务地址（未结单工单按「负责人所属组别」分组数据的来源，供 DDL 播报分组分栏）
  ticketBot: {
    url: process.env.TICKET_BOT_URL || 'http://localhost:3003',
  },
  // ticket-bot 工单源表（与项目表同一个多维表格 base，直接读取做未结单播报）
  // 字段/节点值默认与 ticket-bot 的配置保持一致，若 ticket-bot 侧改动需同步
  ticketClose: {
    tableId: process.env.TICKET_SOURCE_TABLE_ID || 'tblFA6Pj4Mv83Mb0',
    approvalField: process.env.TICKET_APPROVAL_FIELD || '审批节点',
    // 未审批的最后一层节点（处于该节点 = 工作已交付但尚未结单）
    closeValue: process.env.TICKET_CLOSE_VALUE || '回执单：是否结单',
    // 无人接单分栏的触发节点值（逗号分隔，与 ticket-bot APPROVAL_NODE_ACCEPT_VALUE 对齐）
    acceptValues: (process.env.TICKET_ACCEPT_VALUES || '群内有组员接单后通过,有组员接单后通过,负责人确认消息后通过')
      .split(',').map(s => s.trim()).filter(Boolean),
    deadlineField: process.env.TICKET_DEADLINE_FIELD || '理想结单时间',
    // 降级直读链路的播报对象字段（与 ticket-bot unclosedService 口径一致：指定 → 补充）
    assigneeField: process.env.TICKET_ASSIGNEE_FIELD || '指定负责人',
    supplementField: process.env.TICKET_SUPPLEMENT_FIELD || '补充负责人',
    // 无人接单分桶的组别字段（与 ticket-bot ROUTE_FIELD 对齐；降级链路只按它直出，不解析人员）
    routeField: process.env.TICKET_ROUTE_FIELD || '面向组别',
  },
  // 指令仅群内触发；私聊指令仅白名单内可用（open_id / p2p chat_id 任一命中即可）。
  // 两个列表都留空 = 所有人（含管理员）私聊指令均关闭，fail-closed。
  p2pCommandAllow: {
    openIds: (process.env.P2P_COMMAND_OPEN_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    chatIds: (process.env.P2P_COMMAND_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
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
