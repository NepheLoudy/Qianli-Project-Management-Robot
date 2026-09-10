/**
 * 关键词回答表.xlsx → server/src/config/*.json 同步脚本
 *
 * 一个 xlsx 里两张表，各自转成一个 JSON（工作表名显式指定，不再回落到第一个工作表，
 * 避免表被改名时把「@触发回答」静默写进 autoReplies.json）：
 *   「关键词回答」 → server/src/config/autoReplies.json        未@机器人 的群消息命中即回
 *   「@触发回答」 → server/src/config/autoRepliesMention.json  仅群里 @机器人 时命中（先查它，未命中再查上表）
 *
 * 用法：
 *   npm run sync:auto-replies                  （两张表都转存本地 JSON，不部署）
 *   npm run sync:auto-replies -- -f path.xlsx  （指定表格文件）
 *   npm run push                               （push.js 开头自动调用本脚本，转存后随部署上线）
 *
 * 表格规则见 xlsx 的「使用说明」工作表：
 *   - 一行 = 一个触发槽；「关键词」列 = 触发词（同义词用逗号/顿号/分号分隔放同一格，任一命中即触发）
 *   - 「回答」列用 / 分隔多个候选回复；触发时按概率加权随机抽一条
 *   - 「概率1/2/3…」列（回答列右侧顺延）依次对应第 1/2/3… 个候选，填 0-100 整数，总和 100
 *   - 留空不填的候选自动均分剩余概率；全留空 = 等概率；总和超 100 = 按比例压缩；填 0 = 永不触发
 *   - 关键词以 # 开头的行视为注释，不同步；关键词/回答缺一则该行跳过并告警
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_XLSX_PATH = path.join(ROOT, '关键词回答表.xlsx');

const GROUP_DESCRIPTION = '关键词自动回复配置（由项目根目录「关键词回答表.xlsx」自动生成，请改表格后 npm run push 同步，勿手改本文件）：群内消息文本包含某个关键词时触发，从该条回答池中按概率加权随机抽一条自动回复（@机器人或私聊提问同样命中）。keywords 数组内为同义词；answers 为候选回复及其权重（weight 归一化后即触发概率，0=不触发）；一条消息命中多条规则时逐条各抽一条合并回复；匹配不分大小写。修改后即时生效，无需重启服务。';

const MENTION_DESCRIPTION = '@触发回答配置（由项目根目录「关键词回答表.xlsx」的「@触发回答」工作表自动生成，请改表格后 npm run push 同步，勿手改本文件）：只在群里 @机器人 时参与匹配——先查本表，未命中再查 autoReplies.json，两表都没命中才回默认欢迎语；未@机器人的群消息不会命中本表。私聊命中关键词只提示到群里使用，不返回回答内容。匹配与概率规则同 autoReplies.json（keywords 内为同义词；answers 权重 0=不触发；一条消息命中多条规则时逐条各抽一条合并）。修改后即时生效，无需重启服务。';

// 一张工作表 → 一个 JSON。sheetNames 为候选工作表名（取第一个存在的）
const TABLES = [
  {
    key: 'group',
    label: '关键词回答表',
    sheetNames: ['关键词回答'],
    jsonPath: path.join(ROOT, 'server/src/config/autoReplies.json'),
    description: GROUP_DESCRIPTION,
  },
  {
    key: 'mention',
    label: '@触发回答表',
    sheetNames: ['@触发回答'],
    jsonPath: path.join(ROOT, 'server/src/config/autoRepliesMention.json'),
    description: MENTION_DESCRIPTION,
  },
];

function parseNum(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 解析一个工作表的规则（解析口径与原实现一致）
 * @param {string} xlsxPath 表格文件
 * @param {{ sheetNames?: string[], logger?: Function }|Function} [opts] 传函数 = 兼容旧签名（logger）
 */
function parseXlsx(xlsxPath, opts) {
  const options = typeof opts === 'function' ? { logger: opts } : (opts || {});
  const warn = (msg) => (options.logger || console.warn)(`⚠ [关键词回答表] ${msg}`);

  const XLSX = require('xlsx');
  const wb = XLSX.readFile(xlsxPath);
  const wanted = options.sheetNames || [];
  const sheetName = wanted.find(n => wb.SheetNames.includes(n));
  if (!sheetName) {
    throw new Error(`未找到工作表「${wanted.join(' / ')}」（当前工作表：${wb.SheetNames.join('、')}）`);
  }
  const ws = wb.Sheets[sheetName];

  // 直接在二维矩阵上解析（sheet_to_json 的 range 行号是工作表绝对行，
  // 与 !ref 起点无关，混用会错位——B2 起的表会整体偏移一行）
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 表头行：找「某格恰为 关键词 且另一格恰为 回答」的行（精确相等，避免标题含词误判）
  let headerRowIdx = -1;
  for (let r = 0; r < Math.min(10, matrix.length); r++) {
    const cells = matrix[r].map(c => String(c).trim());
    if (cells.includes('关键词') && cells.includes('回答')) { headerRowIdx = r; break; }
  }
  if (headerRowIdx === -1) {
    throw new Error(`工作表「${sheetName}」中未找到「关键词」「回答」表头行`);
  }

  const headerCells = matrix[headerRowIdx].map(c => String(c).trim());
  const kwCol = headerCells.indexOf('关键词');
  const ansCol = headerCells.indexOf('回答');
  if (kwCol === -1 || ansCol === -1) {
    throw new Error(`表头行异常: ${JSON.stringify(headerCells)}`);
  }
  // 概率列 = 回答列右侧的全部列（D/E/F…顺延，以整表最大宽度为界），填几个算几个
  const maxWidth = matrix.reduce((m, row) => Math.max(m, row.length), 0);
  const probCols = [];
  for (let c = ansCol + 1; c < maxWidth; c++) {
    probCols.push(c);
  }

  const replies = [];
  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const cells = matrix[r];
    const rowNo = r + 1;
    const kwRaw = String(cells[kwCol] ?? '').trim();
    const ansRaw = String(cells[ansCol] ?? '').trim();
    if (!kwRaw && !ansRaw) continue;           // 整行空
    if (kwRaw.startsWith('#')) continue;        // 注释行
    if (!kwRaw || !ansRaw) {
      warn(`第 ${rowNo} 行关键词/回答缺一，已跳过`);
      continue;
    }

    const keywords = kwRaw.split(/[,，、;；]+/).map(s => s.trim()).filter(Boolean);
    if (keywords.length === 0) continue;

    // 回答列 / 分隔候选（候选内不允许 /，文档已注明）
    const texts = ansRaw.split('/').map(s => s.trim()).filter(Boolean);
    if (texts.length === 0) continue;

    // 概率：取前 texts.length 个概率列
    const rawProbs = texts.map((_, i) => parseNum(cells[probCols[i]]));
    rawProbs.forEach((v, i) => {
      if (v === null) return;
      if (v === NaN || !Number.isInteger(v) || v < 0 || v > 100) {
        warn(`第 ${rowNo} 行 候选${i + 1} 的概率「${cells[probCols[i]]}」不是 0-100 的整数，按留空处理`);
        rawProbs[i] = null;
      }
    });

    // 计算权重
    let weights;
    const defined = rawProbs.map(v => v !== null);
    const filledSum = rawProbs.reduce((s, v) => s + (v === null ? 0 : v), 0);
    const nEmpty = defined.filter(d => !d).length;

    if (nEmpty === texts.length) {
      // 全留空 = 等概率
      weights = texts.map(() => 1);
    } else if (filledSum > 100) {
      // 超 100：按比例压缩（空候选 = 0）
      warn(`第 ${rowNo} 行概率和 ${filledSum} > 100，已按比例压缩为 100`);
      weights = rawProbs.map(v => (v === null ? 0 : Math.round(v * 100 / filledSum * 100) / 100));
    } else if (nEmpty > 0) {
      // 空候选均分剩余
      const each = Math.round((100 - filledSum) / nEmpty * 100) / 100;
      weights = rawProbs.map(v => (v === null ? each : v));
    } else {
      // 全部已填（和 <=100）：不足 100 时归一化到 100
      weights = rawProbs.map(v => (filledSum === 100 ? v : Math.round(v * 100 / filledSum * 100) / 100));
    }

    replies.push({
      keywords,
      answers: texts.map((text, i) => ({ text, weight: weights[i] })),
    });
  }
  return replies;
}

/**
 * 同步单张表（读工作表 → 写 JSON），失败只记 reason 不抛
 * @param {object} table TABLES 中的一项
 * @param {string} [xlsxPath] 覆盖表格文件路径
 * @returns {{ key: string, label: string, jsonPath: string, changed: boolean, count: number, reason?: string }}
 */
function syncTable(table, xlsxPath) {
  const src = xlsxPath || DEFAULT_XLSX_PATH;
  const base = { key: table.key, label: table.label, jsonPath: table.jsonPath };

  if (!fs.existsSync(src)) {
    return { ...base, changed: false, count: 0, reason: `未找到 ${path.basename(src)}，跳过同步` };
  }

  let replies;
  try {
    replies = parseXlsx(src, { sheetNames: table.sheetNames });
  } catch (err) {
    return { ...base, changed: false, count: 0, reason: `${table.label}同步失败：${err.message}` };
  }

  const prev = fs.existsSync(table.jsonPath)
    ? JSON.parse(fs.readFileSync(table.jsonPath, 'utf-8'))
    : {};
  const next = {
    enabled: prev.enabled !== false,
    replies,
    description: table.description,
  };

  const changed = JSON.stringify(next) !== JSON.stringify(prev);
  if (changed) {
    fs.writeFileSync(table.jsonPath, JSON.stringify(next, null, 2) + '\n');
  }
  return { ...base, changed, count: replies.length };
}

/**
 * 同步全部表（默认「关键词回答」+「@触发回答」）
 * @param {string} [xlsxPath] 覆盖表格文件路径（默认项目根目录「关键词回答表.xlsx」）
 */
function syncAllTables(xlsxPath) {
  return TABLES.map(t => syncTable(t, xlsxPath));
}

/** 只同步「关键词回答」表（返回旧的结构，兼容既有调用） */
function syncAutoReplies(xlsxPath) {
  const r = syncTable(TABLES[0], xlsxPath);
  return { changed: r.changed, count: r.count, reason: r.reason };
}

/** 只同步「@触发回答」表 */
function syncMentionReplies(xlsxPath) {
  const r = syncTable(TABLES[1], xlsxPath);
  return { changed: r.changed, count: r.count, reason: r.reason };
}

module.exports = { syncAutoReplies, syncMentionReplies, syncAllTables, parseXlsx, TABLES };

if (require.main === module) {
  const idx = process.argv.indexOf('-f');
  const file = idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
  for (const r of syncAllTables(file)) {
    if (r.reason) {
      console.log(`ⓘ ${r.label}：${r.reason}`);
    } else if (r.changed) {
      console.log(`✓ ${r.label} → ${path.basename(r.jsonPath)} 同步完成（${r.count} 条规则）`);
    } else {
      console.log(`✓ ${r.label} 无变化（当前 ${r.count} 条规则）`);
    }
  }
}
