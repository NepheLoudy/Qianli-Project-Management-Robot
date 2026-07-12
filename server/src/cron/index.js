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

async function runDDLBroadcast() {
  console.log('[DDL播报] 开始执行每日DDL播报...');

  let attempt = 0;
  let lastError = null;

  while (attempt < RETRY_CONFIG.maxAttempts) {
    attempt++;
    try {
      const { overdue, urgent, week } = await projectService.getDDLForBroadcastWithHierarchy();

      const quote = await getRandomQuote();
      if (quote) {
        console.log(`[DDL播报] 今日语录: "${quote.words}" by ${quote.person || '佚名'}`);
      }

      const result = await sendDDLReport(overdue, urgent, week, quote);

      broadcastHistory.unshift({
        time: new Date().toISOString(),
        type: 'ddl_broadcast',
        overdueCount: overdue.length,
        urgentCount: urgent.length,
        weekCount: week.length,
        success: true,
        attempts: attempt,
      });

      if (broadcastHistory.length > 50) {
        broadcastHistory.length = 50;
      }

      console.log(`[DDL播报] 播报完成 - 逾期:${overdue.length} 紧急:${urgent.length} 本周:${week.length} (尝试: ${attempt})`);

      const overdueConfirmTargets = overdue.filter(p => p.daysLeft <= -1);
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

      return result;
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

function startCronJobs() {
  const ddlTask = cron.schedule(config.cron.schedule, () => {
    runDDLBroadcast().catch(console.error);
  }, {
    timezone: 'Asia/Shanghai',
  });

  console.log(`[定时任务] DDL播报已启动，调度规则: ${config.cron.schedule} (Asia/Shanghai)`);

  return { ddlTask };
}

function getBroadcastHistory() {
  return broadcastHistory;
}

module.exports = {
  startCronJobs,
  runDDLBroadcast,
  getBroadcastHistory,
};
