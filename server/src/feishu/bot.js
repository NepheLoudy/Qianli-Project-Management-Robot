const config = require('../config');
const { requestAPI } = require('./client');

async function sendMessage(cardContent) {
  const webhookUrl = config.bot.webhookUrl;

  if (!webhookUrl) {
    console.warn('未配置机器人 Webhook URL，跳过消息发送');
    return null;
  }

  const res = await fetch(webhookUrl, {
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

async function sendTextMessage(text) {
  const webhookUrl = config.bot.webhookUrl;

  if (!webhookUrl) {
    console.warn('未配置机器人 Webhook URL，跳过消息发送');
    return null;
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      msg_type: 'text',
      content: {
        text: text,
      },
    }),
  });

  const data = await res.json();

  if (data.code !== 0 && data.StatusCode !== 0) {
    throw new Error(`发送消息失败: ${JSON.stringify(data)}`);
  }

  return data;
}

function buildAtTag(userId) {
  if (!userId) return '';
  return `<at id="${userId}"></at>`;
}

function buildHierarchyIndent(level) {
  if (!level || level <= 0) return '';
  return '  '.repeat(level);
}

function buildDDLReportCard(overdueProjects, urgentProjects, weekProjects) {
  const elements = [];

  elements.push({
    tag: 'markdown',
    content: `**📢 每日DDL播报**\n${new Date().toLocaleDateString('zh-CN')}`,
  });

  elements.push({ tag: 'hr' });

  if (overdueProjects.length > 0) {
    elements.push({
      tag: 'markdown',
      content: `**🔴 已逾期项目（${overdueProjects.length}个）**`,
    });
    overdueProjects.forEach(p => {
      const indent = buildHierarchyIndent(p.level);
      elements.push({
        tag: 'markdown',
        content: `${indent}${buildAtTag(p.owner)} **${p.category}组 - ${p.name}** - 已逾期 ${Math.abs(p.daysLeft)} 天\n${indent}优先级: ${p.priorityLabel}`,
      });
    });
    elements.push({ tag: 'hr' });
  }

  if (urgentProjects.length > 0) {
    elements.push({
      tag: 'markdown',
      content: `**🟠 2天内到期（${urgentProjects.length}个）**`,
    });
    urgentProjects.forEach(p => {
      const indent = buildHierarchyIndent(p.level);
      elements.push({
        tag: 'markdown',
        content: `${indent}${buildAtTag(p.owner)} **${p.category}组 - ${p.name}** - 还剩 ${p.daysLeft} 天\n${indent}优先级: ${p.priorityLabel}，截止: ${p.ddl}`,
      });
    });
    elements.push({ tag: 'hr' });
  }

  if (weekProjects.length > 0) {
    elements.push({
      tag: 'markdown',
      content: `**📋 本周到期概览（${weekProjects.length}个）**`,
    });
    const weekText = weekProjects.map(p => {
      const indent = buildHierarchyIndent(p.level);
      return `${indent}• ${buildAtTag(p.owner)} ${p.category}组 - ${p.name} - ${p.ownerName} - ${p.daysLeft}天`;
    }).join('\n');
    elements.push({
      tag: 'markdown',
      content: weekText,
    });
  }

  if (overdueProjects.length === 0 && urgentProjects.length === 0 && weekProjects.length === 0) {
    elements.push({
      tag: 'markdown',
      content: '✅ 近期没有需要关注的DDL，继续保持！',
    });
  }

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    elements,
    header: {
      template: overdueProjects.length > 0 ? 'red' : urgentProjects.length > 0 ? 'orange' : 'green',
      title: {
        content: '📅 DDL每日播报',
        tag: 'plain_text',
      },
    },
  };
}

async function sendDDLReport(overdueProjects, urgentProjects, weekProjects) {
  const card = buildDDLReportCard(overdueProjects, urgentProjects, weekProjects);
  return sendMessage(card);
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

async function sendCardToChat(chatId, cardContent) {
  const res = await requestAPI(
    'POST',
    '/im/v1/messages?receive_id_type=chat_id',
    {
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(cardContent),
    }
  );

  if (res.code !== 0) {
    throw new Error(`发送群卡片消息失败: ${res.msg} (code: ${res.code})`);
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

async function replyCardMessage(messageId, cardContent) {
  const res = await requestAPI(
    'POST',
    `/im/v1/messages/${messageId}/reply`,
    {
      msg_type: 'interactive',
      content: JSON.stringify(cardContent),
    }
  );

  if (res.code !== 0) {
    throw new Error(`回复卡片消息失败: ${res.msg} (code: ${res.code})`);
  }

  return res.data;
}

module.exports = {
  sendMessage,
  sendTextMessage,
  buildDDLReportCard,
  sendDDLReport,
  sendTextToChat,
  sendCardToChat,
  replyTextMessage,
  replyCardMessage,
};
