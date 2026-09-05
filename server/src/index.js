const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const config = require('./config');
const projectService = require('./services/projectService');
const { startCronJobs, runDDLBroadcast, getBroadcastHistory, getCronStatus } = require('./cron');
const logService = require('./services/logService');
const keywordService = require('./services/keywordService');
const { startEventSubscription, handleMessageEvent } = require('./feishu/eventSubscription');

const app = express();

app.use(cors());
// 网关会转发完整消息事件（长文本/富文本可能超过默认 100kb），放宽 body 限制
app.use(express.json({ limit: '2mb' }));

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

app.post('/api/projects', async (req, res) => {
  try {
    const project = await projectService.createProject(req.body);
    res.json(project);
  } catch (err) {
    console.error('创建项目失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const project = await projectService.updateProject(id, req.body);
    res.json(project);
  } catch (err) {
    console.error('更新项目失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
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

app.post('/api/bot/test-broadcast', async (req, res) => {
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

app.post('/api/logs', async (req, res) => {
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

app.get('/api/keywords/config', (req, res) => {
  try {
    const config = keywordService.loadKeywordsConfig();
    res.json(config);
  } catch (err) {
    console.error('获取关键词配置失败:', err);
    res.status(500).json({ error: err.message });
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
  const server = app.listen(config.port, () => {
    console.log(`🚀 服务器运行在 http://localhost:${config.port}`);
    console.log(`📚 API 文档: http://localhost:${config.port}/api/health`);
  });

  startCronJobs();
  startEventSubscription();

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = app;
