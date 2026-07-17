const cron = require('node-cron');
const projectService = require('../services/projectService');
const { sendDDLReport, getRandomQuote } = require('../feishu/bot');
const ddlConfirmService = require('../services/ddlConfirmService');
const config = require('../config');

const broadcastHistory = [];

const RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelay: 30 * 1000,
  maxDelay: 5 * 60 * 1000,
};

function isFrequencyLimitError(err) {
  if (!err) return false;
  const message = err.message || '';
  return message.includes('11232') || message.includes('frequency limited');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function countQualified(nodes) {
  let count = 0;
  nodes.forEach(node => {
    if (node.isQualified) count++;
    if (node.children) count += countQualified(node.children);
  });
  return count;
}

async function runDDLBroadcast() {
  console.log('[DDL播报] 开始执行每日DDL播报...');

  let attempt = 0;
  let lastError = null;

  while (attempt < RETRY_CONFIG.maxAttempts) {
    attempt++;
    try {
      // 一次性拉取所有项目，避免重复请求
      const allProjects = await projectService.getProjects();

      const quote = await getRandomQuote();
      if (quote) {
        console.log(`[DDL播报] 今日语录: "${quote.words}" by ${quote.person || '佚名'}`);
      }

      // 机器人1: 只播报 owner 有人的项目
      const ownerData = await projectService.getDDLForBroadcastWithHierarchy('owner', allProjects);
      const result1 = await sendDDLReport(ownerData.overdue, ownerData.urgent, ownerData.week, quote, {
        webhookUrl: config.bot.webhookUrl,
        mentionField: 'owner',
      });
      const ownerOverdueCount = countQualified(ownerData.overdue);
      const ownerUrgentCount = countQualified(ownerData.urgent);
      const ownerWeekCount = countQualified(ownerData.week);
      console.log(`[DDL播报] 机器人1(owner) - 逾期:${ownerOverdueCount} 紧急:${ownerUrgentCount} 本周:${ownerWeekCount}`);

      // 机器人2: 只播报 contributers 有人的项目
      if (config.bot2 && config.bot2.webhookUrl) {
        const contribData = await projectService.getDDLForBroadcastWithHierarchy('contributers', allProjects);
        const result2 = await sendDDLReport(contribData.overdue, contribData.urgent, contribData.week, quote, {
          webhookUrl: config.bot2.webhookUrl,
          mentionField: 'contributers',
        });
        const contribOverdueCount = countQualified(contribData.overdue);
        const contribUrgentCount = countQualified(contribData.urgent);
        const contribWeekCount = countQualified(contribData.week);
        console.log(`[DDL播报] 机器人2(contributers) - 逾期:${contribOverdueCount} 紧急:${contribUrgentCount} 本周:${contribWeekCount}`);
      } else {
        console.log('[DDL播报] 机器人2 未配置 webhookUrl，跳过 contributers 播报');
      }

      broadcastHistory.unshift({
        time: new Date().toISOString(),
        type: 'ddl_broadcast',
        ownerOverdue: ownerOverdueCount,
        ownerUrgent: ownerUrgentCount,
        ownerWeek: ownerWeekCount,
        success: true,
        attempts: attempt,
      });

      if (broadcastHistory.length > 50) {
        broadcastHistory.length = 50;
      }

      console.log(`[DDL播报] 播报完成 (尝试: ${attempt})`);

      // 逾期确认：基于 owner 过滤的数据，递归收集所有逾期项目
      const overdueConfirmTargets = [];
      function collectOverdue(nodes) {
        nodes.forEach(node => {
          if (node.isQualified && node.ddlCategory === 'overdue') {
            overdueConfirmTargets.push(node);
          }
          if (node.children) collectOverdue(node.children);
        });
      }
      collectOverdue(ownerData.overdue);
      if (overdueConfirmTargets.length > 0) {
        console.log(`[DDL播报] 发现 ${overdueConfirmTargets.length} 个逾期项目，向 owner 发送确认请求`);
        const confirmResults = [];
        for (const project of overdueConfirmTargets) {
          try {
            const r = await ddlConfirmService.sendOverdueConfirmation(project);
            confirmResults.push({ name: project.name, ...r });
          } catch (err) {
            console.error(`[DDL播报] 向 owner 发送确认失败 (${project.name}):`, err.message);
            confirmResults.push({ name: project.name, sent: false, reason: err.message });
          }
        }
        console.log('[DDL播报] 逾期确认发送结果:', JSON.stringify(confirmResults));
      }

      return result1;
    } catch (err) {
      lastError = err;
      if (isFrequencyLimitError(err)) {
        const delay = Math.min(RETRY_CONFIG.initialDelay * Math.pow(2, attempt - 1), RETRY_CONFIG.maxDelay);
        console.warn(`[DDL播报] 第 ${attempt} 次尝试失败，频率限制，将在 ${delay / 1000} 秒后重试...`);
        await sleep(delay);
      } else {
        console.error('[DDL播报] 播报失败:', err);
        break;
      }
    }
  }

  broadcastHistory.unshift({
    time: new Date().toISOString(),
    type: 'ddl_broadcast',
    error: lastError?.message || 'Unknown error',
    success: false,
    attempts: attempt,
  });
  throw lastError;
}

let ddlTask = null;

function startCronJobs() {
  if (ddlTask) {
    console.log('[定时任务] 定时任务已存在，先停止旧任务');
    ddlTask.stop();
  }

  ddlTask = cron.schedule(config.cron.schedule, () => {
    console.log('[定时任务] 触发DDL播报');
    runDDLBroadcast().catch(err => {
      console.error('[定时任务] DDL播报失败:', err.message);
    });
  }, {
    timezone: 'Asia/Shanghai',
  });

  console.log(`[定时任务] DDL播报已启动，调度规则: ${config.cron.schedule} (Asia/Shanghai)`);
  console.log(`[定时任务] 当前时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`[定时任务] 下次执行时间: ${ddlTask.nextDates(1)[0]?.toLocaleString('zh-CN') || '未知'}`);

  return { ddlTask };
}

function getCronStatus() {
  return {
    running: !!ddlTask,
    schedule: config.cron.schedule,
    nextExecution: ddlTask?.nextDates(1)[0]?.toISOString() || null,
  };
}

function getBroadcastHistory() {
  return broadcastHistory;
}

module.exports = {
  startCronJobs,
  runDDLBroadcast,
  getBroadcastHistory,
  getCronStatus,
};
