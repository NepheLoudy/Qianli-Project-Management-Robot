const bot = require('../feishu/bot');
const keywordService = require('./keywordService');
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

  // 通过 name 匹配（支持配置的机器人名）
  const botName = config.bot.name;
  return message.mentions.some(m => {
    if (m.id === 'self') return true;
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

async function handleHelpCommand() {
  const botName = config.bot.name;
  return `🍿 ${botName} - 指令帮助

基础指令：
  /help      显示此帮助信息
  /status    查看服务运行状态
  /test-ddl  测试DDL播报
  /keywords  查看当前监听关键词
  /history   查看最近播报历史

3D打印指令：
  /print-help     显示打印相关帮助
  /print-status   查看打印机状态
  /print-list     查看预约列表
  /print-pending  查看待审批预约

使用方式：
  • 群聊中请先 @${botName} 再发送指令
  • 示例：@${botName} /help
  • 示例：@${botName} /print-status`;
}

async function handleStatusCommand() {
  const keywordsConfig = keywordService.loadKeywordsConfig();
  const botName = config.bot.name;

  const lines = [
    `🍿 ${botName} - 运行状态`,
    '',
    `服务状态：✅ 运行中`,
    `当前时间：${dayjs().format('YYYY-MM-DD HH:mm:ss')}`,
    `飞书长连接：${config.feishuEvent.useLongConnection ? '✅ 已启用' : '❌ 未启用'}`,
    ``,
    `📋 关键词监听：${keywordsConfig.enabled ? '✅ 已启用' : '❌ 未启用'}`,
    `   监听关键词数量：${keywordsConfig.keywords.length} 个`,
    ``,
    `⏰ 定时任务：`,
    `   DDL播报：${config.cron.schedule} (Asia/Shanghai)`,
    `   DDL预警天数：${config.ddl.alertDays} 天`,
  ];
  
  return lines.join('\n');
}

async function handleTestDDLCommand(chatCtx) {
  try {
    const projectService = require('./projectService');
    const { sendDDLReport, getRandomQuote } = require('../feishu/bot');

    const allProjects = await projectService.getProjects();
    const quote = await getRandomQuote();
    const filter = chatCtx?.filter || 'all';
    const mentionField = chatCtx?.mentionField || 'owner';
    const webhookUrl = chatCtx?.webhookUrl;

    const { overdue, urgent, week } = await projectService.getDDLForBroadcastWithHierarchy(filter, allProjects);

    await sendDDLReport(overdue, urgent, week, quote, { webhookUrl, mentionField });

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
    `📋 关键词监听：已启用 (${keywordsConfig.keywords.length}个)`,
    '',
    '当前监听关键词：',
  ];
  
  keywordsConfig.keywords.forEach((kw, i) => {
    lines.push(`  ${i + 1}. ${kw}`);
  });
  
  lines.push('');
  lines.push('提示：修改 server/src/config/keywords.json 后需重启服务生效');
  
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
      lines.push(`${i + 1}. ${time} ✅ 逾期:${item.ownerOverdue} 紧急:${item.ownerUrgent} 本周:${item.ownerWeek}`);
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

async function handleNormalChat(senderName) {
  const botName = config.bot.name;
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

  let replyText = '';

  const cmd = parseCommand(text);
  if (cmd) {
    console.log('[对话服务] 解析到指令:', cmd.command, '参数:', cmd.args, '群:', chatCtx?.label || '未知');
    const handler = commandHandlers[cmd.command];
    if (handler) {
      try {
        replyText = await handler(cmd.args, chatCtx);
      } catch (err) {
        console.error('[对话服务] 指令执行失败:', err);
        replyText = `❌ 指令执行失败：${err.message}`;
      }
    } else if (cmd.command.startsWith('/print-')) {
      replyText = await handlePrintCommand(cmd.command, cmd.args);
    } else {
      replyText = `❌ 未知指令：${cmd.command}\n发送 /help 查看可用指令`;
    }
  } else {
    replyText = await handleNormalChat(senderName);
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
};
