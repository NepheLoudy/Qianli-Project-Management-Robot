const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const projectService = require('../services/projectService');
const { sendDDLReport, getRandomQuote } = require('../feishu/bot');
const ddlConfirmService = require('../services/ddlConfirmService');
const ticketCloseService = require('../services/ticketCloseService');
const config = require('../config');
const quietHours = require('../utils/quietHours');
const plaza = require('../services/plaza');

const broadcastHistory = [];

const STATE_FILE = path.join(__dirname, '..', '..', '.broadcast-state.json');

function loadBroadcastState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      return data.lastBroadcastDate || null;
    }
  } catch (err) {
    console.warn('[DDL播报] 读取状态文件失败:', err.message);
  }
  return null;
}

function saveBroadcastState(date) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastBroadcastDate: date }));
  } catch (err) {
    console.warn('[DDL播报] 写入状态文件失败:', err.message);
  }
}

let lastBroadcastDate = loadBroadcastState();

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
  const today = new Date().toLocaleDateString('zh-CN');
  if (lastBroadcastDate === today) {
    console.log('[DDL播报] 今日已播报过，跳过重复触发');
    return null;
  }

  console.log('[DDL播报] 开始执行每日DDL播报...');

  let attempt = 0;
  let lastError = null;
  // 已成功发送的群（跨重试持久）：重试只补发失败的群，避免已发过的群收到重复卡片
  const deliveredGroups = new Set();

  while (attempt < RETRY_CONFIG.maxAttempts) {
    attempt++;
    try {
      // 一次性拉取所有项目，避免重复请求
      const allProjects = await projectService.getProjects();

      const quote = await getRandomQuote();
      if (quote) {
        console.log(`[DDL播报] 今日语录: "${quote.words}" by ${quote.person || '佚名'}`);
      }

      // 未结单工单：优先按「负责人所属组别」分组（ticket-bot 计算，各组只看到自己的工单，
      // 播报对象为指定负责人/补充负责人）；分组数据失败时降级为全群共用同一份（不分组），
      // 仍失败则本次不含工单分栏，均不影响 DDL 播报本身
      let ticketBuckets = { urgent: [], week: [], unclaimed: [] };
      let groupedTickets = null;
      try {
        groupedTickets = await ticketCloseService.getGroupedBuckets();
        const total = Object.values(groupedTickets).reduce((n, b) => n + b.urgent.length + b.week.length + (b.unclaimed || []).length, 0);
        console.log(`[DDL播报] 未结单工单(按组分桶): 群数=${Object.keys(groupedTickets).length} 工单数=${total}`);
      } catch (err) {
        console.warn(`[DDL播报] 按组工单读取失败，降级为全群同一份: ${err.message}`);
        try {
          ticketBuckets = await ticketCloseService.getUnclosedBuckets();
          console.log(`[DDL播报] 未结单工单: 2日内加急:${ticketBuckets.urgent.length} 7日内:${ticketBuckets.week.length} 无人接单:${(ticketBuckets.unclaimed || []).length}`);
        } catch (err2) {
          console.warn(`[DDL播报] 未结单工单读取失败（本次播报不含工单分栏）: ${err2.message}`);
        }
      }

      // 逐群播报：每个群只播报对应人员字段有人的项目
      // 同一 webhook / 同一群聊ID 只发送一次，避免同一群被重复播报；
      // 重试时跳过已成功发送的群
      const broadcastTargets = config.broadcastGroups.filter(g => g.webhookUrl);
      const seenWebhooks = new Set();
      const seenChatIds = new Set();
      const groupStats = [];
      let result1 = null;
      let ownerData = null;

      for (const group of broadcastTargets) {
        if (deliveredGroups.has(group.webhookUrl)) {
          console.log(`[DDL播报] ${group.label} 此前尝试已发送成功，重试时跳过`);
          continue;
        }
        if (seenWebhooks.has(group.webhookUrl)) {
          console.warn(`[DDL播报] ${group.label} 的 webhook 与其他群重复，跳过以避免重复播报`);
          continue;
        }
        if (group.chatId && seenChatIds.has(group.chatId)) {
          console.warn(`[DDL播报] ${group.label} 的群聊ID与其他群重复，跳过以避免同一群收到多张播报卡`);
          continue;
        }
        seenWebhooks.add(group.webhookUrl);
        if (group.chatId) seenChatIds.add(group.chatId);

        const groupData = await projectService.getDDLForBroadcastWithHierarchy(group.mentionField, allProjects);
        const sendResult = await sendDDLReport(groupData.overdue, groupData.urgent, groupData.week, quote, {
          webhookUrl: group.webhookUrl,
          mentionField: group.mentionField,
          pausedProjects: groupData.paused,
          // 按组分桶的未结单工单：各组只看负责人属于本群的工单；分组数据不可用时降级为共用
          ticketBuckets: (groupedTickets && groupedTickets[group.chatId]) || ticketBuckets,
        });
        deliveredGroups.add(group.webhookUrl);

        if (group.mentionField === 'owner') {
          result1 = sendResult;
          ownerData = groupData;
        }

        const overdueCount = countQualified(groupData.overdue);
        const urgentCount = countQualified(groupData.urgent);
        const weekCount = countQualified(groupData.week);
        groupStats.push({ label: group.label, overdue: overdueCount, urgent: urgentCount, week: weekCount });
        console.log(`[DDL播报] ${group.label} - 逾期:${overdueCount} 紧急:${urgentCount} 本周:${weekCount}`);
      }

      if (broadcastTargets.length === 0) {
        console.warn('[DDL播报] 未配置任何播报群 webhook，跳过群播报');
      }

      // 今日标记：至少一群送达后才落盘。不能提前标记——提前落盘后当天发送全败
      // 也不会再重试，播报会静默丢失。全部失败时当天可手动 /test-broadcast 重跑；
      // 部分成功的补发用各群 /test-ddl（它不受本标记限制）
      if (deliveredGroups.size > 0) {
        lastBroadcastDate = today;
        saveBroadcastState(today);
        plaza.append({
          event: 'DDL 播报',
          title: `DDL 播报送达 ${deliveredGroups.size} 群：逾期 ${groupStats[0]?.overdue ?? 0} · 紧急 ${groupStats[0]?.urgent ?? 0} · 本周 ${groupStats[0]?.week ?? 0}`,
          count: groupStats[0]?.overdue ?? 0,
        });
      }

      broadcastHistory.unshift({
        time: new Date().toISOString(),
        type: 'ddl_broadcast',
        groups: groupStats,
        success: true,
        attempts: attempt,
      });

      if (broadcastHistory.length > 50) {
        broadcastHistory.length = 50;
      }

      console.log(`[DDL播报] 播报完成，共 ${groupStats.length} 个群 (尝试: ${attempt})`);

      // 逾期确认：基于 owner 字段过滤的数据，递归收集所有逾期项目
      if (!ownerData) {
        ownerData = await projectService.getDDLForBroadcastWithHierarchy('owner', allProjects);
      }
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

      return result1 || { groups: groupStats };
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
    // 晚间静默：触发落在播报静默窗口（默认 02:00–09:00）内时登记积压，
    // 窗口结束整点重跑整个播报任务（含逾期确认私聊，以补发时刻数据重查）
    quietHours.gateTask('ddl_broadcast', quietHours.shanghaiStamp(), runDDLBroadcast, 'DDL播报').catch(err => {
      console.error('[定时任务] DDL播报失败:', err.message);
    });
  }, {
    timezone: 'Asia/Shanghai',
  });

  console.log(`[定时任务] DDL播报已启动，调度规则: ${config.cron.schedule} (Asia/Shanghai)`);
  console.log(`[定时任务] 当前时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`[定时任务] 下次执行时间: ${getNextExecutionTime(config.cron.schedule)}`);

  // 晚间静默：注册积压任务的冲刷执行器，并按启动时点调度积压补跑（有积压才调度）
  quietHours.registerTask('ddl_broadcast', runDDLBroadcast);
  quietHours.initQuietHoursFlush();

  return { ddlTask };
}

function getNextExecutionTime(schedule) {
  try {
    const [second, minute, hour, day, month, weekday] = schedule.split(' ');
    const now = new Date();
    const next = new Date(now);
    
    next.setSeconds(parseInt(second) || 0);
    next.setMinutes(parseInt(minute) || 0);
    next.setHours(parseInt(hour) || 0);
    
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    
    return next.toLocaleString('zh-CN');
  } catch (e) {
    return '未知';
  }
}

function getCronStatus() {
  return {
    running: !!ddlTask,
    schedule: config.cron.schedule,
    nextExecution: getNextExecutionTime(config.cron.schedule),
    quietHours: quietHours.getStatus(),
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
