/**
 * 抽奖配置表.xlsx → server/src/config/lottery.json 同步脚本
 *
 * 工作表「抽奖配置」，格式（一行 = 一个奖品，行数不限）：
 *   奖品 | 概率
 *   - 整张表就是 /抽奖 指令的一个大奖池：抽中哪行回哪行的文字
 *   - 「概率」= 相对权重份数：填 0-100 的数（如 5 和 95 → 5%/95%）；留空 = 1（等概率参与）；0 = 永不抽中
 *   - 总和不必凑满 100（自动归一化为百分比）；奖品以 # 开头的行 = 注释行不同步
 * - 指令名由 server/.env 的 LOTTERY_COMMAND 决定（逗号分隔别名），默认「抽奖」→ /抽奖
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

// 轻量读 server/.env 的 LOTTERY_COMMAND（根目录无 dotenv 依赖，不额外安装）
function loadCommandNames() {
  let raw = '';
  try {
    const envText = fs.readFileSync(path.join(ROOT, 'server', '.env'), 'utf8');
    raw = (envText.match(/^\s*LOTTERY_COMMAND\s*=\s*(.*)\s*$/m) || [])[1] || '';
  } catch { /* 无 .env 时用默认 */ }
  const names = String(raw).split(/[,，、;；]+/).map(s => s.trim()).filter(Boolean);
  return names.length ? names : ['抽奖'];
}

const DESCRIPTION = '抽奖配置（由项目根目录「抽奖配置表.xlsx」自动生成，请改表格后 npm run push 同步，勿手改本文件）：整张表是 /抽奖 指令（指令名见 LOTTERY_COMMAND）的一个大奖池——群里 @机器人 发 /抽奖 即按概率加权随机抽一条奖品文字原文回复。一行=一个奖品，行数不限；answers 为候选奖品及其权重（weight 归一化后即抽中概率，0=永不抽中，留空=1 等概率）。修改后即时生效，无需重启服务。';

function parseNum(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 解析「抽奖配置」工作表：一行=一个奖品（奖品|概率），聚合为 LOTTERY_COMMAND 指令的单一大奖池
 * @param {string} xlsxPath 表格文件
 * @param {{ logger?: Function, commandNames?: string[] }} [opts]
 */
function parseLotteryXlsx(xlsxPath, opts) {
  const options = opts || {};
  const warn = (msg) => (options.logger || console.warn)(`⚠ [抽奖配置表] ${msg}`);
  const commandNames = options.commandNames || loadCommandNames();

  const XLSX = require('xlsx');
  const wb = XLSX.readFile(xlsxPath);
  const sheetName = ['抽奖配置'].find(n => wb.SheetNames.includes(n));
  if (!sheetName) {
    throw new Error(`未找到工作表「抽奖配置」（当前工作表：${wb.SheetNames.join('、')}）`);
  }
  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 表头行：某格恰为「奖品」（概率列可选，表头以「概率」开头即可）
  let headerRowIdx = -1;
  for (let r = 0; r < Math.min(10, matrix.length); r++) {
    const cells = matrix[r].map(c => String(c).trim());
    if (cells.includes('奖品')) { headerRowIdx = r; break; }
  }
  if (headerRowIdx === -1) {
    throw new Error(`工作表「${sheetName}」中未找到「奖品」表头行`);
  }
  const headerCells = matrix[headerRowIdx].map(c => String(c).trim());
  const ansCol = headerCells.indexOf('奖品');
  let probCol = headerCells.findIndex(c => c === '概率' || c.startsWith('概率'));
  if (probCol === -1) {
    warn('未找到「概率」列，所有奖品按等概率处理');
  }

  const answers = [];
  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const cells = matrix[r] || [];
    const rowNo = r + 1;
    const prize = String(cells[ansCol] ?? '').trim();
    if (!prize) continue;                       // 整行空（奖品列空即跳过）
    // 注释行：奖品列以 # 开头，或行首非空格（兼容旧格式触发词列）以 # 开头
    const firstCell = String(cells.find(c => String(c ?? '').trim() !== '') ?? '').trim();
    if (prize.startsWith('#') || firstCell.startsWith('#')) continue;

    const rawProb = probCol === -1 ? null : parseNum(cells[probCol]);
    let weight = 1;
    if (rawProb !== null) {
      if (Number.isNaN(rawProb) || rawProb < 0) {
        warn(`第 ${rowNo} 行概率「${cells[probCol]}」不是 ≥0 的数，按留空（权重 1）处理`);
      } else {
        weight = rawProb;
      }
    }
    answers.push({ text: prize, weight });
  }

  return [{ keywords: commandNames.slice(), answers }];
}

/**
 * 同步抽奖表（读工作表 → 写 JSON），失败只记 reason 不抛
 * @param {string} [xlsxPath] 覆盖表格文件路径（默认项目根目录「抽奖配置表.xlsx」）
 * @returns {{ key: string, label: string, jsonPath: string, changed: boolean, count: number, prizes: number, command: string, reason?: string }}
 */
function syncLottery(xlsxPath) {
  const src = xlsxPath || DEFAULT_XLSX_PATH;
  const base = { key: 'lottery', label: '抽奖配置表', jsonPath: JSON_PATH };

  if (!fs.existsSync(src)) {
    return { ...base, changed: false, count: 0, prizes: 0, command: '', reason: `未找到 ${path.basename(src)}，跳过同步` };
  }

  let replies;
  try {
    replies = parseLotteryXlsx(src, { logger: console.warn });
  } catch (err) {
    return { ...base, changed: false, count: 0, prizes: 0, command: '', reason: `抽奖配置表同步失败：${err.message}` };
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
  return {
    ...base,
    changed,
    count: replies.length,
    prizes: replies.reduce((s, r) => s + r.answers.length, 0),
    command: replies[0] ? '/' + replies[0].keywords.join('/、/') : '',
  };
}

module.exports = { syncLottery, parseLotteryXlsx };

if (require.main === module) {
  const idx = process.argv.indexOf('-f');
  const file = idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
  const r = syncLottery(file);
  if (r.reason) {
    console.log(`ⓘ ${r.label}：${r.reason}`);
  } else if (r.changed) {
    console.log(`✓ ${r.label} → ${path.basename(r.jsonPath)} 同步完成（${r.command} 奖池 ${r.prizes} 个奖品）`);
  } else {
    console.log(`✓ ${r.label} 无变化（${r.command} 奖池当前 ${r.prizes} 个奖品）`);
  }
}
