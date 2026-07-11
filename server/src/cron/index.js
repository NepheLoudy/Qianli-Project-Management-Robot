const cron = require('node-cron');
const projectService = require('../services/projectService');
const { sendDDLReport } = require('../feishu/bot');
const ddlConfirmService = require('../services/ddlConfirmService');
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

    // 对逾期超过 1 天的项目，向 owner 私聊发送确认请求
    const overdueConfirmTargets = overdue.filter(p => p.daysLeft < -1);
    if (overdueConfirmTargets.length > 0) {
      console.log(`[DDL播报] 发现 ${overdueConfirmTargets.length} 个逾期超1天的项目，向 owner 发送确认请求`);
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
