/**
 * 抽奖配置表.xlsx → server/src/config/lottery.json 同步脚本
 *
 * 工作表「抽奖配置」（表头：触发词 / 奖品 / 概率1 / 概率2 …），解析复用
 * syncAutoReplies.js 的 parseXlsx（自定义表头名），概率口径与「关键词回答」表完全一致。
 *
 * 用法：
 *   npm run sync:lottery                        （转存本地 JSON，不部署）
 *   npm run sync:lottery -- -f path.xlsx        （指定表格文件）
 *   npm run push                                （push.js 开头自动调用，转存后随部署上线）
 *
 * 表格规则见 xlsx 的「使用说明」工作表：
 *   - 一行 = 一个抽奖触发；「触发词」列 = 触发词（同义词用逗号/顿号/分号分隔放同一格，任一命中即抽一次）
 *   - 「奖品」列用 / 分隔多个候选奖品；触发时按概率加权随机抽一条作为回复原文
 *   - 「概率1/2/3…」列（奖品列右侧顺延）依次对应第 1/2/3… 个候选，填 0-100 整数
 *   - 留空的候选自动均分剩余概率；全留空 = 等概率；总和不必凑满 100（自动归一化）；
 *     总和超 100 = 按比例压缩；填 0 = 永不抽中
 *   - 触发词以 # 开头的行视为注释，不同步；触发词/奖品缺一则该行跳过并告警
 */
const fs = require('fs');
const path = require('path');
const { parseXlsx } = require('./syncAutoReplies');

const ROOT = path.join(__dirname, '..');
const DEFAULT_XLSX_PATH = path.join(ROOT, '抽奖配置表.xlsx');
const JSON_PATH = path.join(ROOT, 'server/src/config/lottery.json');

const DESCRIPTION = '抽奖配置（由项目根目录「抽奖配置表.xlsx」自动生成，请改表格后 npm run push 同步，勿手改本文件）：群消息文本包含某个触发词即抽一次（无需@机器人，全群生效，命中优先级最高——先于「@触发回答」「关键词回答」两张表），从该奖池按概率加权随机抽一条奖品文字原文回复。keywords 数组内为同义词；answers 为候选奖品及其权重（weight 归一化后即抽中概率，0=永不抽中）；一条消息命中多条抽奖规则时逐条各抽一条合并回复；匹配不分大小写。修改后即时生效，无需重启服务。';

/**
 * 同步抽奖表（读工作表 → 写 JSON），失败只记 reason 不抛
 * @param {string} [xlsxPath] 覆盖表格文件路径（默认项目根目录「抽奖配置表.xlsx」）
 * @returns {{ key: string, label: string, jsonPath: string, changed: boolean, count: number, reason?: string }}
 */
function syncLottery(xlsxPath) {
  const src = xlsxPath || DEFAULT_XLSX_PATH;
  const base = { key: 'lottery', label: '抽奖配置表', jsonPath: JSON_PATH };

  if (!fs.existsSync(src)) {
    return { ...base, changed: false, count: 0, reason: `未找到 ${path.basename(src)}，跳过同步` };
  }

  let replies;
  try {
    replies = parseXlsx(src, {
      sheetNames: ['抽奖配置'],
      kwHeader: '触发词',
      ansHeader: '奖品',
      label: '抽奖配置表',
    });
  } catch (err) {
    return { ...base, changed: false, count: 0, reason: `抽奖配置表同步失败：${err.message}` };
  }

  const prev = fs.existsSync(JSON_PATH)
    ? JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'))
    : {};
  const next = {
    enabled: prev.enabled !== false,
    replies,
    description: DESCRIPTION,
  };

  const changed = JSON.stringify(next) !== JSON.stringify(prev);
  if (changed) {
    fs.writeFileSync(JSON_PATH, JSON.stringify(next, null, 2) + '\n');
  }
  return { ...base, changed, count: replies.length };
}

module.exports = { syncLottery };

if (require.main === module) {
  const idx = process.argv.indexOf('-f');
  const file = idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
  const r = syncLottery(file);
  if (r.reason) {
    console.log(`ⓘ ${r.label}：${r.reason}`);
  } else if (r.changed) {
    console.log(`✓ ${r.label} → ${path.basename(r.jsonPath)} 同步完成（${r.count} 条触发规则）`);
  } else {
    console.log(`✓ ${r.label} 无变化（当前 ${r.count} 条触发规则）`);
  }
}
