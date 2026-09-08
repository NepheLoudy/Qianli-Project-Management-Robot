/**
 * 关键词回答表.xlsx → server/src/config/autoReplies.json 同步脚本
 *
 * 用法：
 *   npm run sync:auto-replies          （只转存本地 JSON，不部署）
 *   npm run sync:auto-replies -- -f path.xlsx （指定表格文件）
 *   npm run push                       （push.js 开头自动调用本脚本，转存后随部署上线）
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
const JSON_PATH = path.join(ROOT, 'server/src/config/autoReplies.json');

const DESCRIPTION = '关键词自动回复配置（由项目根目录「关键词回答表.xlsx」自动生成，请改表格后 npm run push 同步，勿手改本文件）：群内消息文本包含某个关键词时触发，从该条回答池中按概率加权随机抽一条自动回复（@机器人或私聊提问同样命中）。keywords 数组内为同义词；answers 为候选回复及其权重（weight 归一化后即触发概率，0=不触发）；一条消息命中多条规则时逐条各抽一条合并回复；匹配不分大小写。修改后即时生效，无需重启服务。';

function parseNum(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function parseXlsx(xlsxPath, logger) {
  const warn = (msg) => (logger || console.warn)(`⚠ [关键词回答表] ${msg}`);

  const XLSX = require('xlsx');
  const wb = XLSX.readFile(xlsxPath);
  const sheetName = wb.SheetNames.includes('关键词回答') ? '关键词回答' : wb.SheetNames[0];
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
    throw new Error('表中未找到「关键词」「回答」表头行');
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

function syncAutoReplies(xlsxPath) {
  const src = xlsxPath || DEFAULT_XLSX_PATH;
  if (!fs.existsSync(src)) {
    return { changed: false, count: 0, reason: `未找到 ${src}，跳过同步` };
  }

  const replies = parseXlsx(src);

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
  return { changed, count: replies.length };
}

module.exports = { syncAutoReplies, parseXlsx };

if (require.main === module) {
  const idx = process.argv.indexOf('-f');
  const file = idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
  const result = syncAutoReplies(file);
  if (result.reason) {
    console.log('ⓘ 关键词回答表：' + result.reason);
  } else if (result.changed) {
    console.log(`✓ 关键词回答表 → autoReplies.json 同步完成（${result.count} 条规则）`);
  } else {
    console.log(`✓ 关键词回答表无变化（当前 ${result.count} 条规则）`);
  }
}
