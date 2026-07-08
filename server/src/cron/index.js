const cron = require('node-cron');
const projectService = require('../services/projectService');
const { sendDDLReport } = require('../feishu/bot');
const config = require('../config');

const broadcastHistory = [];

async function runDDLBroadcast() {
  console.log('[DDL播报] 开始执行每日DDL播报...');

  try {
    const { overdue, urgent, week } = await projectService.getDDLForBroadcastWithHierarchy();

    const result = await sendDDLReport(overdue, urgent, week);

    broadcastHistory.unshift({
      time: new Date().toISOString(),
      type: 'ddl_broadcast',
      overdueCount: overdue.length,
      urgentCount: urgent.length,
      weekCount: week.length,
      success: true,
    });

    if (broadcastHistory.length > 50) {
      broadcastHistory.length = 50;
    }

    console.log(`[DDL播报] 播报完成 - 逾期:${overdue.length} 紧急:${urgent.length} 本周:${week.length}`);
    return result;
  } catch (err) {
    console.error('[DDL播报] 播报失败:', err);
    broadcastHistory.unshift({
      time: new Date().toISOString(),
      type: 'ddl_broadcast',
      error: err.message,
      success: false,
    });
    throw err;
  }
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
