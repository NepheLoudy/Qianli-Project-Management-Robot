const bot = require('../feishu/bot');
const keywordService = require('./keywordService');
const autoReplyService = require('./autoReplyService');
const { getBroadcastHistory } = require('../cron');
const config = require('../config');
const dayjs = require('dayjs');

const processedMessageIds = new Set();

/**
 * 检测机器人是否被 @ 提到
 * 飞书 mentions 数组中每个元素包含 key(@_user_1/@_bot_1)、id、name 等字段
 */
function isMentionedBot(message) {
  if (!message) return false;

  // 私聊（p2p）不需要 @，直接就是向机器人说话
  const chatType = message.chat_type;
  if (chatType === 'p2p') return true;

  // 群聊：检查 mentions 数组
  if (!message.mentions || message.mentions.length === 0) return false;

  // 通过 name 匹配（支持配置的机器人名）+ mentioned_type=app/bot 兜底
  // （共用应用下机器人实际名称可能与配置名不一致；真实事件里 @机器人 的
  //  mentioned_type 为 "bot"、id 为 {open_id,...} 对象，均需兼容）
  const botName = config.bot.name;
  return message.mentions.some(m => {
    if (m.id === 'self') return true;
    if (m.mentioned_type === 'app' || m.mentioned_type === 'bot') return true;
    if (m.name === botName) return true;
    return false;
  });
}

function extractTextWithoutMention(message) {
  const text = keywordService.extractTextContent(message);
  if (!text) return '';

  const botName = config.bot.name;

  return text
    .replace(new RegExp(`@${botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'g'), '')
    .replace(/@_user_\d+\s*/g, '')
    .replace(/@_bot_\d+\s*/g, '')
    .replace(/@_everyone\s*/g, '')
    .trim();
}

function parseCommand(text) {
  if (!text || !text.startsWith('/')) return null;
  
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);
  
  return { command, args, raw: text };
}

/**
 * 是否审批群：本群指令能力整体切换为财务相关（转发 approval-bot）
 */
function isApprovalGroup(chatId) {
  return !!config.approval.chatId && chatId === config.approval.chatId;
}

/**
 * 私聊指令白名单：指令仅群内触发，私聊指令仅白名单账号/会话可用
 * （sender open_id 与 p2p chat_id 任一命中即可，见 config.p2pCommandAllow）
 */
function isP2pCommandAllowed(senderId, chatId) {
  const allow = config.p2pCommandAllow;
  return (
    (!!senderId && allow.openIds.includes(senderId)) ||
    (!!chatId && allow.chatIds.includes(chatId))
  );
}

/**
 * 转发 /approval-* 指令到 approval-bot（bambu 打印服务同款转发契约）
 */
async function handleApprovalCommand(command, args) {
  const serviceUrl = config.approval.serviceUrl;
  try {
    const res = await fetch(`${serviceUrl}/api/chat/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, args }),
    });
    if (!res.ok) {
      throw new Error(`财务服务响应失败: ${res.status}`);
    }
    const data = await res.json();
    return data.reply || '❌ 财务机器人响应异常';
  } catch (err) {
    console.error('[对话服务] 调用财务审批服务失败:', err.message);
    return '❌ 财务审批服务暂不可用，请稍后再试';
  }
}

async function handleHelpCommand() {
  const botName = config.bot.name;
  return `🍿 ${botName} - 指令帮助

基础指令：
  /help      显示此帮助信息
  /status    查看服务运行状态
  /test-ddl  测试DDL播报（与正式播报同内容，可作部分失败后的补发）
  /keywords  查看关键词监听插件配置（发言记录）
  /autoreply 查看关键词自动回答表（独立功能）
  /history   查看最近播报历史

财务审批指令（审批群内自动切换为 /approval-*，转发 approval-bot）：
  /approval-help /approval-list /approval-pending /approval-status /approval-urge

3D打印指令（转发 bambu）：
  /print-help     显示打印相关帮助
  /print-status   查看打印机状态
  /print-list     查看预约列表
  /print-pending  查看待审批预约

使用方式：
  • 群聊中请先 @${botName} 再发送指令
  • 示例：@${botName} /help
  • 示例：@${botName} /print-status
  • 群内消息命中关键词回答表会自动回复（/autoreply 查看）`;
}

async function handleStatusCommand() {
  const keywordsConfig = keywordService.loadKeywordsConfig();
  const autoRepliesConfig = autoReplyService.loadAutoRepliesConfig();
  const botName = config.bot.name;

  const lines = [
    `🍿 ${botName} - 运行状态`,
    '',
    `服务状态：✅ 运行中`,
    `当前时间：${dayjs().format('YYYY-MM-DD HH:mm:ss')}`,
    // 网关模式下 useLongConnection=false 是正确配置，不该显示 ❌
    `事件接入：${config.feishuEvent.useLongConnection ? '长连接模式（仅调试用，会与网关抢事件）' : '✅ 网关转发模式（feishu-gateway）'}`,
    ``,
    `📋 关键词监听：${keywordsConfig.enabled ? '✅ 已启用' : '❌ 未启用'}`,
    `   监听关键词数量：${keywordsConfig.keywords.length} 个`,
    `💬 关键词自动回复：${autoRepliesConfig.enabled ? `✅ 已启用（回答表 ${autoRepliesConfig.replies.length} 条）` : '❌ 未启用'}`,
    ``,
    `⏰ 定时任务：`,
    `   DDL播报：${config.cron.schedule} (Asia/Shanghai)`,
    `   DDL预警天数：${config.ddl.alertDays} 天`,
    ``,
    `📢 播报群（${config.broadcastGroups.length} 个）：`,
    ...config.broadcastGroups.map(g => {
      const webhookStatus = g.webhookUrl ? '✅ webhook已配置' : '❌ webhook未配置';
      const chatStatus = g.chatId ? '✅ 群ID已配置' : '⚠️ 群ID未配置';
      return `   ${g.label}：${webhookStatus}，${chatStatus}`;
    }),
  ];
  
  return lines.join('\n');
}

async function handleTestDDLCommand(chatCtx, chatType) {
  // 非播报群的群聊里不借用 owner webhook 兜底，避免测试卡跨群打到 owner 群；
  // 私聊（管理员白名单）保留 owner webhook 兜底用于测试
  if (!chatCtx && chatType === 'group') {
    return '❌ 当前群未配置 DDL 播报，请在播报群内使用 /test-ddl（或私聊机器人测试，卡会发到 owner 群）';
  }
  try {
    const projectService = require('./projectService');
    const ticketCloseService = require('./ticketCloseService');
    const { sendDDLReport, getRandomQuote } = require('../feishu/bot');

    const allProjects = await projectService.getProjects();
    const quote = await getRandomQuote();
    const mentionField = chatCtx?.mentionField || 'owner';
    const webhookUrl = chatCtx?.webhookUrl;

    const { overdue, urgent, week, paused } = await projectService.getDDLForBroadcastWithHierarchy(mentionField, allProjects);

    // 与正式播报取同一份「未结单工单」分栏数据（分组失败降级共用，再失败不含分栏），
    // 保证 /test-ddl 补发卡与正式卡等价（否则补出来的卡缺工单分栏与意外暂停区块）
    let ticketBuckets = { urgent: [], week: [], unclaimed: [] };
    let groupedTickets = null;
    try {
      groupedTickets = await ticketCloseService.getGroupedBuckets();
    } catch (err) {
      try {
        ticketBuckets = await ticketCloseService.getUnclosedBuckets();
      } catch (err2) {
        console.warn('[测试DDL] 未结单工单读取失败（本次不含工单分栏）:', err2.message);
      }
    }

    await sendDDLReport(overdue, urgent, week, quote, {
      webhookUrl,
      mentionField,
      pausedProjects: paused,
      ticketBuckets: (groupedTickets && groupedTickets[chatCtx?.chatId]) || ticketBuckets,
    });

    const label = chatCtx?.label || '默认';
    return `✅ DDL测试播报已发送（${label}）\n逾期:${overdue.length} 紧急:${urgent.length} 本周:${week.length}`;
  } catch (err) {
    console.error('测试DDL播报失败:', err);
    return `❌ 测试播报失败：${err.message}`;
  }
}

async function handleKeywordsCommand() {
  const keywordsConfig = keywordService.loadKeywordsConfig();

  if (!keywordsConfig.enabled) {
    return '📋 关键词监听：未启用';
  }

  const lines = [
    `📋 关键词监听（发言记录插件）：已启用 (${keywordsConfig.keywords.length}个)`,
    '',
    '当前监听关键词：',
  ];

  keywordsConfig.keywords.forEach((kw, i) => {
    lines.push(`  ${i + 1}. ${kw}`);
  });

  lines.push('');
  lines.push('提示：修改 server/src/config/keywords.json 后即时生效（无需重启）；v23 起发言全量记录，列表仅作展示兼容');
  lines.push('关键词自动回复是独立功能，发送 /autoreply 查看');

  return lines.join('\n');
}

async function handleAutoReplyCommand() {
  const autoRepliesConfig = autoReplyService.loadAutoRepliesConfig();

  if (!autoRepliesConfig.enabled) {
    return '💬 关键词自动回复：未启用';
  }

  const lines = [];

  if (autoRepliesConfig.replies.length === 0) {
    lines.push('💬 关键词自动回复：已启用（回答表为空）');
  } else {
    lines.push(`💬 关键词自动回复：已启用 (${autoRepliesConfig.replies.length}条)，命中即自动回答：`);
    autoRepliesConfig.replies.forEach((r, i) => {
      const preview = r.answer.trim().replace(/\s+/g, ' ');
      lines.push(`  ${i + 1}. [${r.keywords.join('/')}] → ${preview.slice(0, 30)}${preview.length > 30 ? '…' : ''}`);
    });
  }

  lines.push('');
  lines.push('提示：修改 server/src/config/autoReplies.json 后即时生效（无需重启）');

  return lines.join('\n');
}

async function handleHistoryCommand() {
  const history = getBroadcastHistory();
  
  if (history.length === 0) {
    return '📜 暂无播报历史记录';
  }
  
  const lines = ['📜 最近播报历史 (最新5条)', ''];
  
  history.slice(0, 5).forEach((item, i) => {
    const time = dayjs(item.time).format('MM-DD HH:mm');
    if (item.success) {
      const parts = (item.groups || []).map(g => `${g.label} 逾期:${g.overdue} 紧急:${g.urgent} 本周:${g.week}`);
      lines.push(`${i + 1}. ${time} ✅ ${parts.join(' | ')}`);
    } else {
      lines.push(`${i + 1}. ${time} ❌ 失败: ${item.error}`);
    }
  });
  
  return lines.join('\n');
}

const commandHandlers = {
  '/help': handleHelpCommand,
  '/status': handleStatusCommand,
  '/test-ddl': handleTestDDLCommand,
  '/keywords': handleKeywordsCommand,
  '/autoreply': handleAutoReplyCommand,
  '/history': handleHistoryCommand,
};

async function handlePrintCommand(command, args) {
  const printServerUrl = config.printServer.url;
  
  try {
    const res = await fetch(`${printServerUrl}/api/chat/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command, args }),
    });
    
    if (!res.ok) {
      throw new Error(`打印服务响应失败: ${res.status}`);
    }
    
    const data = await res.json();
    return data.reply || '❌ 打印服务响应异常';
  } catch (err) {
    console.error('[对话服务] 调用打印服务失败:', err.message);
    return '❌ 打印服务暂不可用，请稍后再试';
  }
}

async function handleNormalChat(senderName, chatId) {
  const botName = config.bot.name;

  // 审批群：引导财务相关能力
  if (isApprovalGroup(chatId)) {
    return `你好${senderName ? '，' + senderName : ''}！我是🧾${botName}（财务审批）。

本群为财务审批群，支持以下指令（发送 /help 查看完整帮助）：
• /approval-pending 查看审批中列表
• /approval-status  查看审批统计
• /approval-list    查看所有申请`;
  }

  return `你好${senderName ? '，' + senderName : ''}！我是🍿${botName}。

我是项目管理追踪助手，你可以通过以下方式与我互动：

• 发送 /help 查看所有可用指令
• 直接发送关键词消息我会自动记录
• @我 可以触发对话和指令

有什么需要帮忙的吗？`;
}

async function processChatMessage(event) {
  const message = event.message;
  if (!message) return { handled: false, reason: '无消息内容' };

  const chatType = message.chat_type || message.chatMode;
  const isGroup = chatType === 'group';

  console.log('[对话服务] 收到消息 - chat_type:', chatType, 'mentions:', JSON.stringify(message.mentions || []), 'message_id:', message.message_id);

  if (isGroup && !isMentionedBot(message)) {
    console.log('[对话服务] 跳过 - 群聊未@机器人');
    return { handled: false, reason: '群聊未@机器人' };
  }

  // 消息去重：防止长连接和 HTTP 回调同时处理同一条消息
  if (message.message_id) {
    if (processedMessageIds.has(message.message_id)) {
      console.log('[对话服务] 跳过重复消息:', message.message_id);
      return { handled: true, skipped: true, reason: '重复消息' };
    }
    processedMessageIds.add(message.message_id);
    if (processedMessageIds.size > 500) {
      const firstKey = processedMessageIds.values().next().value;
      processedMessageIds.delete(firstKey);
    }
  }

  const text = extractTextWithoutMention(message);
  console.log('[对话服务] 收到消息:', text, '(chat_id:', message.chat_id, ')');

  const senderId = event.sender?.sender_id?.open_id || event.sender?.sender_id?.user_id || '';
  const senderName = event.sender?.sender_id?.name || '';

  const chatCtx = config.getChatContext(message.chat_id);
  const isApproval = isApprovalGroup(message.chat_id);

  let replyText = '';

  const cmd = parseCommand(text);
  if (cmd) {
    if (!isGroup && !isP2pCommandAllowed(senderId, message.chat_id)) {
      // 铁律：指令只在群里触发并回复到对应群；私聊指令仅白名单账号（管理员）可用
      console.log('[对话服务] 拒绝私聊指令:', cmd.command, 'sender:', senderId || '未知', 'chat_id:', message.chat_id);
      replyText = '⚠️ 指令仅支持在群聊中 @机器人 使用，私聊指令暂未开放';
    } else if (isApproval) {
      // 审批群：指令能力整体切换为财务相关，仅放行 /help 与 /approval-*
      console.log('[对话服务] 审批群指令:', cmd.command, '参数:', cmd.args);
      if (cmd.command === '/help') {
        replyText = await handleApprovalCommand('/approval-help', []);
      } else if (cmd.command.startsWith('/approval-')) {
        replyText = await handleApprovalCommand(cmd.command, cmd.args);
      } else {
        replyText = `🧾 本群为财务审批群，仅支持财务指令（/approval-*）\n发送 /help 查看可用财务指令`;
      }
    } else {
      console.log('[对话服务] 解析到指令:', cmd.command, '参数:', cmd.args, '群:', chatCtx?.label || '未知');
      const handler = commandHandlers[cmd.command];
      if (handler) {
        try {
          replyText = await handler(cmd.args, chatCtx, chatType);
        } catch (err) {
          console.error('[对话服务] 指令执行失败:', err);
          replyText = `❌ 指令执行失败：${err.message}`;
        }
      } else if (cmd.command.startsWith('/print-')) {
        replyText = await handlePrintCommand(cmd.command, cmd.args);
      } else {
        replyText = `❌ 未知指令：${cmd.command}\n发送 /help 查看可用指令`;
      }
    }
  } else {
    // 关键词自动回复：@机器人/私聊消息命中本地回答表时直接回答，优先于默认欢迎语
    // （审批群除外，保持财务专属能力；未@机器人的群消息由 eventSubscription 管道处理）
    const autoHit = isApproval ? null : autoReplyService.buildReplyForText(text);
    if (autoHit) {
      console.log('[对话服务] 关键词自动回复命中:', autoHit.keywords.join('/'));
      replyText = autoHit.text;
    } else {
      replyText = await handleNormalChat(senderName, message.chat_id);
    }
  }

  if (replyText) {
    try {
      await bot.replyTextMessage(message.message_id, replyText);
      console.log('[对话服务] 已回复消息');
    } catch (err) {
      console.error('[对话服务] 回复消息失败:', err.message);
      try {
        await bot.sendTextToChat(message.chat_id, replyText);
        console.log('[对话服务] 已通过群聊发送消息（降级方式）');
      } catch (err2) {
        console.error('[对话服务] 群聊发送也失败:', err2.message);
      }
    }
  }

  return {
    handled: true,
    isCommand: !!cmd,
    command: cmd?.command || null,
    senderId,
    chatId: message.chat_id,
  };
}

module.exports = {
  processChatMessage,
  isMentionedBot,
  parseCommand,
  isP2pCommandAllowed,
};
