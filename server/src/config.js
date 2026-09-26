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
  plaza: {
    // 动态广场事件流（机器人项目看板「动态广场」表，供多维表格仪表盘展示）
    appToken: process.env.PLAZA_BITABLE_APP_TOKEN || 'ZlVZbXDkRayUzSsFRiycznmZn5b',
    tableId: process.env.PLAZA_BITABLE_TABLE_ID || 'tbld1zHXkTzko20p',
  },
  bitable: {
    appToken: process.env.BITABLE_APP_TOKEN || '',
    projectTableId: process.env.BITABLE_PROJECT_TABLE_ID || '',
    logTableId: process.env.BITABLE_LOG_TABLE_ID || '',
    keywordTableId: process.env.BITABLE_KEYWORD_TABLE_ID || '',
    // quoteTableId 默认值为生产先例表 id（历史原因未 env 化，值保持不动）：
    // 换环境/换 base 必须显式配 BITABLE_QUOTE_TABLE_ID，否则会静默读写到生产语录表（2026-09-25 审查标注）
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
  // 与原关键词监听插件（KEYWORD_CHAT_ID → 写多维表格）分立，互不依赖，互不影响范围。
  // AUTO_REPLY_CHAT_IDS：未@机器人时的生效群范围（逗号分隔 chat_id）；留空或 '*' = 所有群
  //（含财务审批群；审批群的 /approval-* 指令路由不受影响）。@机器人/私聊提问不受此限。
  autoReply: {
    chatIdsRaw: process.env.AUTO_REPLY_CHAT_IDS || '',
  },
  // 抽奖（server/src/config/lottery.json，由项目根目录「抽奖配置表.xlsx」同步）：
  // 动态指令集——群里 @机器人 发「/触发词」即按概率抽一条奖品文字回复（触发词在表格定义）。
  // LOTTERY_CHAT_IDS：生效群范围（逗号分隔 chat_id）；留空或 '*' = 所有群（审批群由审批分支天然排除）。
  // 私聊不参与（指令仅白名单管理员可用）；启停走窗口 POST /api/lottery/enabled，不靠删配置
  lottery: {
    chatIdsRaw: process.env.LOTTERY_CHAT_IDS || '',
  },
  // 审批群（approval-bot 服务）：本群指令能力整体切换为财务相关，
  // /approval-* 指令转发给 approval-bot 处理
  approval: {
    // 审批群 id 只存 .env（不硬编码进仓库）
    chatId: process.env.APPROVAL_CHAT_ID || '',
    serviceUrl: process.env.APPROVAL_SERVICE_URL || 'http://localhost:3002',
  },
  duty: {
    // 值日服务（duty-bot :3006）：值日指令/图片转发 + 管辖策略源（GET /api/duty/policy）。
    // 值日域管辖范畴/生效范畴以 duty-bot 下发为准；chatId 仅作 hub 失联兜底与预留播报目标
    serviceUrl: process.env.DUTY_SERVICE_URL || 'http://localhost:3006',
    chatId: process.env.DUTY_CHAT_ID || '',
  },
  meeting: {
    chatIds: process.env.MEETING_CHAT_IDS ? process.env.MEETING_CHAT_IDS.split(',') : [],
  },
  cron: {
    // 默认 12:05（2026-09-19 起）：与 duty-bot 12:00 值日看板播报错峰——两者同秒拉
    // bitable 会互踢 429 TooManyRequest（09-18 12:00 当日 DDL 播报整轮被限频炸掉）
    schedule: process.env.CRON_SCHEDULE || '0 5 12 * * *',
  },
  ddl: {
    alertDays: parseInt(process.env.DDL_ALERT_DAYS || '2', 10),
    // 负责人群整合播报（2026-09-22）：每日 DDL 播报时把「逾期 + 临期（alertDays 内）」
    // 跨播报群汇总后再播一遍（filter=all 全量口径，不分人员字段），卡头 @ 指定负责人。
    // webhook 优先（与各播报群同款）；未配 webhook 时用 chat_id 走 im API 发卡。
    // 两者都空 = 功能关闭。open_id/chat_id 只存 .env（不硬编码进仓库，同审批群先例）。
    leaderGroup: {
      label: '负责人群',
      webhookUrl: process.env.LEADER_WEBHOOK_URL || '',
      chatId: process.env.LEADER_CHAT_ID || '',
      mentionOpenId: process.env.LEADER_MENTION_OPEN_ID || '',
      mentionName: process.env.LEADER_MENTION_NAME || '负责人',
    },
  },
  printServer: {
    url: process.env.PRINT_SERVER_URL || 'http://localhost:3001',
  },
  // ticket-bot 服务地址（未结单工单按「负责人所属组别」分组数据的来源，供 DDL 播报分组分栏）
  ticketBot: {
    url: process.env.TICKET_BOT_URL || 'http://localhost:3003',
  },
  // feishu-gateway 服务地址（团队负载评分的被@统计 /api/usage/mentions 拉取源）
  gateway: {
    url: process.env.GATEWAY_URL || 'http://localhost:3010',
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
