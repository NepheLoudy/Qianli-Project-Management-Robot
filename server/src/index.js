const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const config = require('./config');
const projectService = require('./services/projectService');
const { startCronJobs, runDDLBroadcast, getBroadcastHistory, getCronStatus } = require('./cron');
const logService = require('./services/logService');
const keywordService = require('./services/keywordService');
const autoReplyService = require('./services/autoReplyService');
const lotteryService = require('./services/lotteryService');
const ddlConfirmService = require('./services/ddlConfirmService');
const workloadService = require('./services/workloadService');
const { requireApiToken } = require('./auth');
const { startEventSubscription, handleMessageEvent } = require('./feishu/eventSubscription');

const app = express();

app.use(cors());
// 网关会转发完整消息事件（长文本/富文本可能超过默认 100kb），放宽 body 限制
app.use(express.json({ limit: '2mb' }));

// DDL 逾期确认冲突提示数据源（duty-bot 18:30 询问消费）：当前有未过期确认的成员名单
app.get('/api/ddl/pending', (req, res) => {
  const stats = ddlConfirmService.getPendingStats();
  res.json({
    windowHours: Number(process.env.DDL_CONFIRM_WINDOW_HOURS || 12),
    openIds: [...new Set(stats.map((s) => s.ownerOpenId))],
    count: stats.length,
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
  });
});

app.get('/api/projects', async (req, res) => {
  try {
    const projects = await projectService.getProjects();
    res.json(projects);
  } catch (err) {
    console.error('获取项目列表失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/hierarchy', async (req, res) => {
  try {
    const projects = await projectService.getProjectsWithHierarchy();
    res.json(projects);
  } catch (err) {
    console.error('获取项目层级列表失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', requireApiToken, async (req, res) => {
  try {
    const project = await projectService.createProject(req.body);
    res.json(project);
  } catch (err) {
    console.error('创建项目失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', requireApiToken, async (req, res) => {
  try {
    const { id } = req.params;
    const project = await projectService.updateProject(id, req.body);
    res.json(project);
  } catch (err) {
    console.error('更新项目失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', requireApiToken, async (req, res) => {
  try {
    const { id } = req.params;
    await projectService.deleteProject(id);
    res.json({ success: true });
  } catch (err) {
    console.error('删除项目失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/ddl-alerts', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const alerts = await projectService.getDDLAlerts(Number(days));
    res.json(alerts);
  } catch (err) {
    console.error('获取DDL提醒失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bot/test-broadcast', requireApiToken, async (req, res) => {
  try {
    const result = await runDDLBroadcast();
    if (result === null) {
      // 今日已成功播报过被跳过：明确告知，避免前端误报「测试播报已发送」
      return res.json({
        success: true,
        skipped: true,
        message: '今日已播报过，未重复发送（需要补发请用各群 /test-ddl）',
        result: null,
      });
    }
    res.json({ success: true, result });
  } catch (err) {
    console.error('测试播报失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bot/history', (req, res) => {
  res.json(getBroadcastHistory());
});

app.get('/api/bot/cron-status', (req, res) => {
  res.json(getCronStatus());
});

app.post('/api/logs', requireApiToken, async (req, res) => {
  try {
    const { version, content } = req.body;
    if (!version || !content) {
      return res.status(400).json({ error: 'version and content are required' });
    }
    const result = await logService.createLog(version, content);
    res.json({ success: true, record: result });
  } catch (err) {
    console.error('写入维护日志失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', async (req, res) => {
  try {
    const { pageSize = 20, pageToken = '' } = req.query;
    const result = await logService.getLogs(Number(pageSize), pageToken);
    res.json(result);
  } catch (err) {
    console.error('获取维护日志失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 定制窗口（规则见顶层 AGENTS「机器人后端定制窗口」）：定制项全景只读
app.get('/api/hub/policy', (req, res) => {
  res.json({
    bot: { name: config.bot.name },
    approvalGroup: { chatId: config.approval.chatId, serviceUrl: config.approval.serviceUrl },
    duty: {
      serviceUrl: config.duty.serviceUrl,
      fallbackChatId: config.duty.chatId,
      policySource: `${config.duty.serviceUrl}/api/duty/policy`,
    },
    autoReply: { chatIdsRaw: config.autoReply.chatIdsRaw || '*', tables: ['autoReplies.json', 'autoRepliesMention.json'] },
    lottery: { enabled: lotteryService.loadLotteryConfig().enabled, chatIdsRaw: config.lottery.chatIdsRaw || '*', file: 'lottery.json / lottery.local.json' },
    keywordListening: { chatId: config.keyword.chatId || '(全部群)' },
    meetingChatIds: config.meeting.chatIds,
    p2pCommandAllow: { openIdCount: config.p2pCommandAllow.openIds.length, chatIdCount: config.p2pCommandAllow.chatIds.length },
    broadcastGroups: (config.broadcastGroups || []).map((g) => ({ key: g.key, chatId: g.chatId, label: g.label, hasWebhook: Boolean(g.webhookUrl) })),
    cron: { ddlBroadcast: config.cron.schedule },
    ddl: {
      alertDays: config.ddl.alertDays,
      // 负责人群整合播报（webhook 等同凭据，与 broadcastGroups 同口径只出布尔不出原文）
      leaderGroup: {
        label: config.ddl.leaderGroup.label,
        chatId: config.ddl.leaderGroup.chatId,
        hasWebhook: Boolean(config.ddl.leaderGroup.webhookUrl),
        mention: config.ddl.leaderGroup.mentionName,
        hasMentionOpenId: Boolean(config.ddl.leaderGroup.mentionOpenId),
      },
    },
  });
});

// 团队负载全景（工单+项目双源聚合评分）：本地运维台「团队负载」看板数据源。
// ticket-bot 不可用时降级为仅项目侧（返回内 ticketsSource='unavailable'），不 500
app.get('/api/hub/workload', async (req, res) => {
  try {
    const result = await workloadService.getTeamWorkload();
    res.json(result);
  } catch (err) {
    console.error('[API] 团队负载聚合失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/keywords/config', (req, res) => {
  try {
    const config = keywordService.loadKeywordsConfig();
    res.json(config);
  } catch (err) {
    console.error('获取关键词配置失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 关键词自动回答表（独立于关键词监听插件）
app.get('/api/autoreplies/config', (req, res) => {
  try {
    res.json(autoReplyService.loadAutoRepliesConfig());
  } catch (err) {
    console.error('获取关键词自动回答表失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// @触发回答表（仅群里 @机器人 时参与匹配，命中优先级高于 /api/autoreplies/config）
app.get('/api/autoreplies/mention-config', (req, res) => {
  try {
    res.json(autoReplyService.loadMentionRepliesConfig());
  } catch (err) {
    console.error('获取@触发回答表失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 定制窗口：关键词回答表 CRUD（顶层 AGENTS「机器人后端定制窗口」；运行时每消息重读，改动即时生效。
// 写入 .local.json；npm run push 会以本地版本覆盖，持久化批量编辑仍以本地 xlsx 为准）
const normTable = (t) => (t === 'mention' ? 'mention' : 'group');

app.get('/api/autoreplies/rules', (req, res) => {
  res.json(autoReplyService.getRules(normTable(req.query.table)));
});

app.post('/api/autoreplies/rules', requireApiToken, (req, res) => {
  try {
    const { table, rule } = req.body || {};
    res.json({ ok: true, result: autoReplyService.upsertRule(normTable(table), rule) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/autoreplies/rules/delete', requireApiToken, (req, res) => {
  try {
    const { table, keywords } = req.body || {};
    res.json({ ok: true, result: autoReplyService.deleteRule(normTable(table), keywords) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/autoreplies/enabled', requireApiToken, (req, res) => {
  try {
    const { table, enabled } = req.body || {};
    res.json({ ok: true, result: autoReplyService.setTableEnabled(normTable(table), enabled) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 定制窗口：抽奖配置 CRUD（触发词/奖品/概率；走「关键词回答」同一条全群链路且优先级最高。
// 运行时每消息重读，改动即时生效；npm run push 会以本地版本覆盖，持久批量编辑仍以本地 抽奖配置表.xlsx 为准）
app.get('/api/lottery/rules', (req, res) => {
  res.json(lotteryService.getRules());
});

app.post('/api/lottery/rules', requireApiToken, (req, res) => {
  try {
    res.json({ ok: true, result: lotteryService.upsertRule(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/lottery/rules/delete', requireApiToken, (req, res) => {
  try {
    const { keywords } = req.body || {};
    res.json({ ok: true, result: lotteryService.deleteRule(keywords) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/lottery/enabled', requireApiToken, (req, res) => {
  try {
    const { enabled } = req.body || {};
    res.json({ ok: true, result: lotteryService.setEnabled(enabled) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/keywords/records', async (req, res) => {
  try {
    const { pageSize = 100, pageToken = '', hierarchy = 'true' } = req.query;
    if (hierarchy === 'true') {
      const result = await keywordService.getKeywordRecordsWithHierarchy({
        page_size: Number(pageSize),
        page_token: pageToken,
      });
      res.json(result);
    } else {
      const result = await keywordService.getKeywordRecords({
        page_size: Number(pageSize),
        page_token: pageToken,
      });
      res.json(result);
    }
  } catch (err) {
    console.error('获取关键词记录失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/feishu/event', async (req, res) => {
  const { type, challenge, token, header, event } = req.body;

  if (config.feishuEvent.verificationToken && token !== config.feishuEvent.verificationToken) {
    return res.status(403).json({ error: 'Invalid verification token' });
  }

  // fail-closed（2026-09-24 安全复查批，同 ticket-bot 口径）：token 未配置时旧实现整段跳过校验
  // （fail-open），伪造的消息帧可直达对话管道。未配置 token 一律 403 拒绝消息事件帧；
  // url_verification 握手不受影响
  const eventType = header?.event_type || '';
  if (!config.feishuEvent.verificationToken && eventType === 'im.message.receive_v1') {
    console.error(`[HTTP回调] 未配置 FEISHU_VERIFICATION_TOKEN，拒绝 ${eventType} 事件帧（fail-closed）`);
    return res.status(403).json({ error: 'Verification token not configured; event frames rejected' });
  }

  if (type === 'url_verification') {
    return res.json({ challenge });
  }

  if (header?.event_type === 'im.message.receive_v1') {
    if (config.feishuEvent.useLongConnection) {
      console.log('[HTTP回调] 已启用长连接模式，跳过HTTP回调消息处理');
      res.json({ code: 0, msg: 'success' });
      return;
    }

    setImmediate(async () => {
      try {
        // 与长连接同一套消息处理管道（对话/指令/DDL确认/关键词/会议提醒）
        const result = await handleMessageEvent(event);
        if (result && result.handled) {
          console.log('[HTTP回调] 对话服务已处理:', result.isCommand ? '指令=' + result.command : '正常对话');
        }
      } catch (err) {
        console.error('处理消息事件失败:', err);
      }
    });
  }

  res.json({ code: 0, msg: 'success' });
});

function startServer() {
  // 仅绑定回环地址（2026-09-27 对抗审查 #6）：消费方（feishu-gateway、运维台 SSH 代理、
  // 各机器人服务转发）都在部署目标本机经 localhost 访问本服务。原先绑定全部网卡 +
  // cors 全开，写端点（有 X-API-Token 鉴权）与会话窗口直接暴露给局域网；回环绑定后暴露面闭合
  const server = app.listen(config.port, '127.0.0.1', () => {
    console.log(`🚀 服务器运行在 http://127.0.0.1:${config.port}（仅回环监听，局域网不可达）`);
    console.log(`📚 API 文档: http://127.0.0.1:${config.port}/api/health`);
  });

  startCronJobs();
  startEventSubscription();

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = app;
