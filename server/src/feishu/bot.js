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

function buildAtTag(userId, name) {
  if (!userId) return '';
  return `<at id="${userId}">${name || ''}</at>`;
}

function buildMentionTags(project, mentionField) {
  if (mentionField === 'contributers') {
    if (!project.contributers || project.contributers.length === 0) return '';
    return project.contributers.map(c => buildAtTag(c.id, c.name)).join(' ');
  }
  return buildAtTag(project.owner, project.ownerName);
}

function getMentionNames(project, mentionField) {
  if (mentionField === 'contributers') {
    if (!project.contributers || project.contributers.length === 0) return '未指派';
    return project.contributers.map(c => c.name).join(', ');
  }
  return project.ownerName || '未指派';
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
  const { level, name, category, isQualified, daysLeft, ddlCategory, priorityLabel, ddlFormatted, children, hasChildren } = node;

  const prefix = buildTreePrefix(level, isLast, ancestors);

  let line = '';
  if (hasChildren && !isQualified) {
    line = `${prefix}**📁 ${category}组 - ${name}**`;
  } else if (isQualified) {
    const mentionTags = buildMentionTags(node, mentionField);
    let statusText = '';
    if (ddlCategory === 'overdue') {
      statusText = `已逾期 ${Math.abs(daysLeft)} 天`;
    } else if (ddlCategory === 'urgent') {
      statusText = daysLeft === 0 ? '今天到期' : `还剩 ${daysLeft} 天`;
    } else if (ddlCategory === 'week') {
      statusText = `${daysLeft}天后到期`;
    }
    const checkbox = daysLeft < 0 ? '🔴' : daysLeft <= 2 ? '🟠' : '🟢';
    line = `${prefix}${checkbox} ${mentionTags} **${category}组 - ${name}** - ${statusText}\n${'   '.repeat(level)}  优先级: ${priorityLabel}，截止: ${ddlFormatted}`;
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

function buildDDLReportCard(overdueProjects, urgentProjects, weekProjects, quote, mentionField = 'owner') {
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
  const { webhookUrl, mentionField = 'owner' } = options;
  const card = buildDDLReportCard(overdueProjects, urgentProjects, weekProjects, quote, mentionField);
  return sendMessage(card, webhookUrl);
}

async function sendTextToChat(chatId, text) {
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
