/**
 * 抽奖配置表.xlsx → server/src/config/lottery.json 同步脚本
 *
 * 工作表「抽奖配置」，格式（一行 = 一个奖品，适合奖池内容很多）：
 *   触发词 | 奖品 | 概率
 *   - 同一「触发词」写多行 = 同一个奖池（每行一个奖品，行序即奖池顺序）
 *   - 「触发词」格内可用逗号/顿号/分号分隔同义词，任一别名都触发同一奖池
 *   - 「概率」= 相对权重份数：填 0-100 的数（如 5 和 95 → 5%/95%）；留空 = 1（等概率参与）；0 = 永不抽中
 *   - 总和不必凑满 100（自动归一化为百分比）；触发词以 # 开头的行 = 注释行不同步
 *
 * 用法：
 *   npm run sync:lottery                        （转存本地 JSON，不部署）
 *   npm run sync:lottery -- -f path.xlsx        （指定表格文件）
 *   npm run push                                （push.js 开头自动调用，转存后随部署上线）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_XLSX_PATH = path.join(ROOT, '抽奖配置表.xlsx');
const JSON_PATH = path.join(ROOT, 'server/src/config/lottery.json');

const DESCRIPTION = '抽奖配置（由项目根目录「抽奖配置表.xlsx」自动生成，请改表格后 npm run push 同步，勿手改本文件）：群里 @机器人 发「/触发词」即从对应奖池按概率加权随机抽一条奖品文字原文回复（指令名=触发词，别名均可触发）。一行=一个奖品，同一触发词多行=同一奖池；answers 为候选奖品及其权重（weight 归一化后即抽中概率，0=永不抽中，留空=1 等概率）；匹配不分大小写。修改后即时生效，无需重启服务。';

function parseNum(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 解析「抽奖配置」工作表：一行=一个奖品，同触发词多行聚合为同一奖池（保持行序）
 * @param {string} xlsxPath 表格文件
 * @param {{ logger?: Function }} [opts]
 */
function parseLotteryXlsx(xlsxPath, opts) {
  const options = opts || {};
  const warn = (msg) => (options.logger || console.warn)(`⚠ [抽奖配置表] ${msg}`);

  const XLSX = require('xlsx');
  const wb = XLSX.readFile(xlsxPath);
  const sheetName = ['抽奖配置'].find(n => wb.SheetNames.includes(n));
  if (!sheetName) {
    throw new Error(`未找到工作表「抽奖配置」（当前工作表：${wb.SheetNames.join('、')}）`);
  }
  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 表头行：某格恰为「触发词」且另一格恰为「奖品」（精确相等，避免标题含词误判）
  let headerRowIdx = -1;
  for (let r = 0; r < Math.min(10, matrix.length); r++) {
    const cells = matrix[r].map(c => String(c).trim());
    if (cells.includes('触发词') && cells.includes('奖品')) { headerRowIdx = r; break; }
  }
  if (headerRowIdx === -1) {
    throw new Error(`工作表「${sheetName}」中未找到「触发词」「奖品」表头行`);
  }
  const headerCells = matrix[headerRowIdx].map(c => String(c).trim());
  const kwCol = headerCells.indexOf('触发词');
  const ansCol = headerCells.indexOf('奖品');
  // 概率列：表头恰为「概率」或以其开头（如「概率(选填)」）；找不到则全部按留空处理
  let probCol = headerCells.findIndex(c => c === '概率' || c.startsWith('概率'));
  if (probCol === -1) {
    warn('未找到「概率」列，所有奖品按等概率处理');
  }

  // 按触发词组聚合（行序保持）；key = 别名小写排序拼接
  const pools = new Map();
  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const cells = matrix[r] || [];
    const rowNo = r + 1;
    const kwRaw = String(cells[kwCol] ?? '').trim();
    const prize = String(cells[ansCol] ?? '').trim();
    if (!kwRaw && !prize) continue;            // 整行空
    if (kwRaw.startsWith('#')) continue;        // 注释行
    if (!kwRaw || !prize) {
      warn(`第 ${rowNo} 行触发词/奖品缺一，已跳过`);
      continue;
    }

    const keywords = kwRaw.split(/[,，、;；]+/).map(s => s.trim()).filter(Boolean);
    if (keywords.length === 0) continue;

    const rawProb = probCol === -1 ? null : parseNum(cells[probCol]);
    let weight = 1;
    if (rawProb !== null) {
      if (Number.isNaN(rawProb) || rawProb < 0) {
        warn(`第 ${rowNo} 行概率「${cells[probCol]}」不是 ≥0 的数，按留空（权重 1）处理`);
      } else {
        weight = rawProb;
      }
    }

    const key = keywords.map(k => k.toLowerCase()).sort().join('|');
    if (!pools.has(key)) pools.set(key, { keywords, answers: [] });
    pools.get(key).answers.push({ text: prize, weight });
  }
  return [...pools.values()];
}

/**
 * 同步抽奖表（读工作表 → 写 JSON），失败只记 reason 不抛
 * @param {string} [xlsxPath] 覆盖表格文件路径（默认项目根目录「抽奖配置表.xlsx」）
 * @returns {{ key: string, label: string, jsonPath: string, changed: boolean, count: number, prizes: number, reason?: string }}
 */
function syncLottery(xlsxPath) {
  const src = xlsxPath || DEFAULT_XLSX_PATH;
  const base = { key: 'lottery', label: '抽奖配置表', jsonPath: JSON_PATH };

  if (!fs.existsSync(src)) {
    return { ...base, changed: false, count: 0, prizes: 0, reason: `未找到 ${path.basename(src)}，跳过同步` };
  }

  let replies;
  try {
    replies = parseLotteryXlsx(src, { logger: console.warn });
  } catch (err) {
    return { ...base, changed: false, count: 0, prizes: 0, reason: `抽奖配置表同步失败：${err.message}` };
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
  return { ...base, changed, count: replies.length, prizes: replies.reduce((s, r) => s + r.answers.length, 0) };
}

module.exports = { syncLottery, parseLotteryXlsx };

if (require.main === module) {
  const idx = process.argv.indexOf('-f');
  const file = idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
  const r = syncLottery(file);
  if (r.reason) {
    console.log(`ⓘ ${r.label}：${r.reason}`);
  } else if (r.changed) {
    console.log(`✓ ${r.label} → ${path.basename(r.jsonPath)} 同步完成（${r.count} 个奖池 / ${r.prizes} 个奖品）`);
  } else {
    console.log(`✓ ${r.label} 无变化（当前 ${r.count} 个奖池 / ${r.prizes} 个奖品）`);
  }
}
