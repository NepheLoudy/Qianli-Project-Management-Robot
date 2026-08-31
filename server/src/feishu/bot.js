const config = require('../config');
const { requestAPI } = require('./client');
const bitable = require('./bitable');

// 语录缓存（避免每次播报都重新拉取）
let quoteCache = null;
let quoteCacheTime = 0;
const QUOTE_CACHE_TTL = 60 * 60 * 1000; // 1小时缓存

async function getRandomQuote() {
  const tableId = config.bitable.quoteTableId;
  if (!tableId) {
    console.warn('[语录] 未配置语录表ID，跳过');
    return null;
  }

  const now = Date.now();
  if (quoteCache && now - quoteCacheTime < QUOTE_CACHE_TTL) {
    return pickRandomQuote(quoteCache);
  }

  try {
    const records = await bitable.getAllRecords(tableId);
    const quotes = [];
    for (const record of records) {
      const fields = record.fields;
      const wordsRaw = fields.words;
      const personRaw = fields.person;
      if (!wordsRaw) continue;

      let words = '';
      if (typeof wordsRaw === 'string') words = wordsRaw;
      else if (Array.isArray(wordsRaw) && wordsRaw.length > 0) words = wordsRaw[0]?.text || '';
      else if (wordsRaw.text) words = wordsRaw.text;

      let person = '';
      if (typeof personRaw === 'string') person = personRaw;
      else if (Array.isArray(personRaw) && personRaw.length > 0) person = personRaw[0]?.text || '';
      else if (personRaw && personRaw.text) person = personRaw.text;

      if (words) quotes.push({ words: words.trim(), person: person.trim() });
    }

    quoteCache = quotes;
    quoteCacheTime = now;
    console.log(`[语录] 已缓存 ${quotes.length} 条语录`);
    return pickRandomQuote(quotes);
  } catch (err) {
    console.error('[语录] 获取失败:', err.message);
    return null;
  }
}

function pickRandomQuote(quotes) {
  if (!quotes || quotes.length === 0) return null;
  const idx = Math.floor(Math.random() * quotes.length);
  return quotes[idx];
}

async function sendMessage(cardContent, webhookUrl) {
  const url = webhookUrl || config.bot.webhookUrl;

  if (!url) {
    console.warn('未配置机器人 Webhook URL，跳过消息发送');
    return null;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      msg_type: 'interactive',
      card: cardContent,
    }),
  });

  const data = await res.json();

  if (data.code !== 0 && data.StatusCode !== 0) {
    throw new Error(`发送消息失败: ${JSON.stringify(data)}`);
  }

  return data;
}

// 卡片 markdown 的 @ 语法是 <at id=ou_xxx>（user_id 写法仅适用于 im/v1 文本消息，卡片中不生效）
function buildAtTag(userId, name) {
  if (!userId) return '';
  return `<at id="${userId}">${name || ''}</at>`;
}

// 获取项目在指定人员字段下的成员列表（mentionField 即多维表格字段名，对应各播报群）
function getFieldMembers(project, mentionField) {
  if (mentionField === 'owner') {
    return project.owner ? [{ id: project.owner, name: project.ownerName }] : [];
  }
  const fieldMap = {
    contributers: project.contributers,
    dkyjcontributers: project.dkyjContributers,
    sjcontributers: project.sjContributers,
    xycontributers: project.xyContributers,
  };
  return fieldMap[mentionField] || [];
}

function buildMentionTags(project, mentionField) {
  return getFieldMembers(project, mentionField)
    .map(m => buildAtTag(m.id, m.name))
    .filter(tag => tag)
    .join(' ');
}

function getMentionNames(project, mentionField) {
  const members = getFieldMembers(project, mentionField);
  if (members.length === 0) return '未指派';
  return members.map(m => m.name).join(', ');
}

function buildTreePrefix(level, isLast, ancestors) {
  if (level <= 0) return '';
  let prefix = '';
  for (let i = 0; i < level - 1; i++) {
    prefix += ancestors[i] ? '   ' : '│  ';
  }
  prefix += isLast ? '└─ ' : '├─ ';
  return prefix;
}

function renderTreeNode(node, mentionField, categoryInfo, ancestors = [], isLast = true) {
  const { level, name, category, status, isQualified, daysLeft, ddlCategory, priorityLabel, ddlFormatted, children, hasChildren } = node;

  const prefix = buildTreePrefix(level, isLast, ancestors);

  let line = '';
  if (hasChildren) {
    line = `${prefix}**📁 ${category}组 - ${name}**`;
  } else if (isQualified) {
    const mentionTags = buildMentionTags(node, mentionField);
    // @ 标签为空（成员无 id 或未指派）时用纯文本指出负责人，保证任何情况都能看到责任人
    const personDisplay = mentionTags || `👤 ${getMentionNames(node, mentionField)}`;
    let statusText = '';
    if (ddlCategory === 'overdue') {
      statusText = `已逾期 ${Math.abs(daysLeft)} 天`;
    } else if (ddlCategory === 'urgent') {
      statusText = daysLeft === 0 ? '今天到期' : `还剩 ${daysLeft} 天`;
    } else if (ddlCategory === 'week') {
      statusText = `${daysLeft}天后到期`;
    }
    // waiting: 还没有人做，标注待认领
    if (status === 'waiting') {
      statusText += ' · ⏳待认领';
    }
    const checkbox = daysLeft < 0 ? '🔴' : daysLeft <= 2 ? '🟠' : '🟢';
    line = `${prefix}${checkbox} ${personDisplay} **${category}组 - ${name}** - ${statusText}\n${'   '.repeat(level)}  优先级: ${priorityLabel}，截止: ${ddlFormatted}`;
  } else {
    line = `${prefix}**${category}组 - ${name}**`;
  }

  const result = [line];

  if (children && children.length > 0) {
    children.forEach((child, index) => {
      const childIsLast = index === children.length - 1;
      const newAncestors = [...ancestors, childIsLast];
      result.push(...renderTreeNode(child, mentionField, categoryInfo, newAncestors, childIsLast));
    });
  }

  return result;
}

function countQualifiedNodes(nodes) {
  let count = 0;
  nodes.forEach(node => {
    if (node.isQualified) count++;
    if (node.children) count += countQualifiedNodes(node.children);
  });
  return count;
}

function buildDDLReportCard(overdueProjects, urgentProjects, weekProjects, quote, mentionField = 'owner', pausedProjects = [], ticketBuckets = { urgent: [], week: [] }) {
  const elements = [];

  elements.push({
    tag: 'markdown',
    content: `**📢 每日DDL播报**\n${new Date().toLocaleDateString('zh-CN')}`,
  });

  elements.push({ tag: 'hr' });

  const overdueCount = countQualifiedNodes(overdueProjects);
  if (overdueCount > 0) {
    elements.push({
      tag: 'markdown',
      content: `**🔴 已逾期项目（${overdueCount}个）**`,
    });
    overdueProjects.forEach((root, index) => {
      const isLast = index === overdueProjects.length - 1;
      const lines = renderTreeNode(root, mentionField, 'overdue', [], isLast);
      elements.push({
        tag: 'markdown',
        content: lines.join('\n'),
      });
    });
    elements.push({ tag: 'hr' });
  }

  const urgentCount = countQualifiedNodes(urgentProjects);
  if (urgentCount > 0) {
    elements.push({
      tag: 'markdown',
      content: `**🟠 2天内到期（${urgentCount}个）**`,
    });
    urgentProjects.forEach((root, index) => {
      const isLast = index === urgentProjects.length - 1;
      const lines = renderTreeNode(root, mentionField, 'urgent', [], isLast);
      elements.push({
        tag: 'markdown',
        content: lines.join('\n'),
      });
    });
    elements.push({ tag: 'hr' });
  }

  const weekCount = countQualifiedNodes(weekProjects);
  if (weekCount > 0) {
    elements.push({
      tag: 'markdown',
      content: `**📋 本周到期概览（${weekCount}个）**`,
    });
    weekProjects.forEach((root, index) => {
      const isLast = index === weekProjects.length - 1;
      const lines = renderTreeNode(root, mentionField, 'week', [], isLast);
      elements.push({
        tag: 'markdown',
        content: lines.join('\n'),
      });
    });
  }

  // ticket-bot 联动：未结单工单按理想结单时间分栏（只列处理人名字不 @，结单提醒由 ticket-bot 私聊完成）
  const ticketUrgentCount = ticketBuckets.urgent.length;
  if (ticketUrgentCount > 0) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'markdown',
      content: `**🎫 工单结单加急（2日内，${ticketUrgentCount}个）**`,
    });
    const lines = ticketBuckets.urgent.map(t => {
      const when = t.daysLeft < 0 ? `🔴 已超理想结单时间 ${Math.abs(t.daysLeft)} 天` : t.daysLeft === 0 ? '🟠 今天到达理想结单时间' : `🟠 ${t.daysLeft}天后到达理想结单时间`;
      return `🎫 👤 ${t.handlerName} **${t.title}** - ${when}`;
    });
    elements.push({ tag: 'markdown', content: lines.join('\n') });
  }

  const ticketWeekCount = ticketBuckets.week.length;
  if (ticketWeekCount > 0) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'markdown',
      content: `**🎫 工单7日内待结单（${ticketWeekCount}个）**`,
    });
    const lines = ticketBuckets.week.map(t => {
      return `🎫 👤 ${t.handlerName} **${t.title}** - ${t.daysLeft}天后到达理想结单时间`;
    });
    elements.push({ tag: 'markdown', content: lines.join('\n') });
  }

  // pending: 意外暂停的项目单独说明（只列名字不 @，避免打扰）
  const pausedCount = pausedProjects.length;
  if (pausedCount > 0) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'markdown',
      content: `**⏸️ 意外暂停项目（${pausedCount}个，需确认恢复或截止）**`,
    });
    const pausedLines = pausedProjects.map(p => {
      return `⏸️ 👤 ${getMentionNames(p, mentionField)} **${p.category || '其他'}组 - ${p.name}**`;
    });
    elements.push({
      tag: 'markdown',
      content: pausedLines.join('\n'),
    });
  }

  if (overdueCount === 0 && urgentCount === 0 && weekCount === 0) {
    elements.push({
      tag: 'markdown',
      content: '✅ 近期没有需要关注的DDL，继续保持！',
    });
  }

  // 每日语录
  if (quote) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'markdown',
      content: `> ${quote.words} by ${quote.person || '佚名'}`,
    });
  }

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    elements,
    header: {
      template: overdueCount > 0 ? 'red' : urgentCount > 0 ? 'orange' : 'green',
      title: {
        content: '📅 DDL每日播报',
        tag: 'plain_text',
      },
    },
  };
}

async function sendDDLReport(overdueProjects, urgentProjects, weekProjects, quote, options = {}) {
  const { webhookUrl, mentionField = 'owner', pausedProjects = [], ticketBuckets = { urgent: [], week: [] } } = options;
  const card = buildDDLReportCard(overdueProjects, urgentProjects, weekProjects, quote, mentionField, pausedProjects, ticketBuckets);
  return sendMessage(card, webhookUrl);
}

// 解析文本中的 @ 标签，转换为富文本元素数组
function parseTextWithAtTags(text) {
  const elements = [];
  const atRegex = /<at\s+user_id="([^"]+)"[^>]*>([^<]*)<\/at>/g;
  let lastIndex = 0;
  let match;

  while ((match = atRegex.exec(text)) !== null) {
    // 添加 @ 标签前的文本
    if (match.index > lastIndex) {
      elements.push({ tag: 'text', text: text.slice(lastIndex, match.index) });
    }
    // 添加 @ 元素
    elements.push({ tag: 'at', user_id: match[1] });
    lastIndex = match.index + match[0].length;
  }

  // 添加剩余文本
  if (lastIndex < text.length) {
    elements.push({ tag: 'text', text: text.slice(lastIndex) });
  }

  return elements;
}

// 发送群聊文本消息（支持 @ 提及）
async function sendTextToChat(chatId, text) {
  // 检查是否包含 @ 标签，如果有则使用富文本消息
  const hasAtTag = /<at\s+[^>]*>/.test(text);

  if (hasAtTag) {
    const elements = parseTextWithAtTags(text);
    // 使用富文本消息以支持 @ 解析
    const res = await requestAPI(
      'POST',
      '/im/v1/messages?receive_id_type=chat_id',
      {
        receive_id: chatId,
        msg_type: 'post',
        content: JSON.stringify({
          zh_cn: {
            title: '',
            content: [elements],
          },
        }),
      }
    );

    if (res.code !== 0) {
      throw new Error(`发送群消息失败: ${res.msg} (code: ${res.code})`);
    }

    return res.data;
  }

  // 无 @ 标签，使用普通文本消息
  const res = await requestAPI(
    'POST',
    '/im/v1/messages?receive_id_type=chat_id',
    {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }
  );

  if (res.code !== 0) {
    throw new Error(`发送群消息失败: ${res.msg} (code: ${res.code})`);
  }

  return res.data;
}

// 通过 open_id 向用户发送私聊文本消息
async function sendTextToUser(openId, text) {
  const res = await requestAPI(
    'POST',
    '/im/v1/messages?receive_id_type=open_id',
    {
      receive_id: openId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }
  );

  if (res.code !== 0) {
    throw new Error(`发送私聊消息失败: ${res.msg} (code: ${res.code})`);
  }

  return res.data;
}

async function replyTextMessage(messageId, text) {
  const res = await requestAPI(
    'POST',
    `/im/v1/messages/${messageId}/reply`,
    {
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }
  );

  if (res.code !== 0) {
    throw new Error(`回复消息失败: ${res.msg} (code: ${res.code})`);
  }

  return res.data;
}

module.exports = {
  sendMessage,
  buildDDLReportCard,
  sendDDLReport,
  getRandomQuote,
  sendTextToChat,
  sendTextToUser,
  replyTextMessage,
};
