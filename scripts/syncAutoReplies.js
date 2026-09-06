/**
 * 关键词回答表.xlsx → server/src/config/autoReplies.json 同步脚本
 *
 * 用法：
 *   npm run sync:auto-replies   （只转存本地 JSON，不部署）
 *   npm run push                （push.js 开头自动调用本脚本，转存后随部署上线）
 *
 * 表格规则见 xlsx 的「使用说明」工作表：
 *   - 每行一条规则：关键词列 = 触发词（同义词用逗号/顿号/分号分隔），回答列 = 自动回复内容
 *   - 关键词以 # 开头的行视为注释，不同步
 *   - 两者都非空才算有效规则
 */
const fs = require('fs');
const path = require('path');

const XLSX_PATH = path.join(__dirname, '..', '关键词回答表.xlsx');
const JSON_PATH = path.join(__dirname, '..', 'server/src/config/autoReplies.json');

const DESCRIPTION = '关键词自动回复配置（由项目根目录「关键词回答表.xlsx」自动生成，请改表格后 npm run push 同步，勿手改本文件）：群内消息文本包含某个关键词时，机器人自动回复对应 answer（@机器人或私聊提问同样命中）。keywords 数组内为同义词；一条消息命中多条时合并为一条回复；匹配不分大小写。修改后即时生效，无需重启服务。';

function syncAutoReplies() {
  if (!fs.existsSync(XLSX_PATH)) {
    return { changed: false, count: 0, reason: '未找到 关键词回答表.xlsx，跳过同步' };
  }

  const XLSX = require('xlsx');
  const wb = XLSX.readFile(XLSX_PATH);
  const sheetName = wb.SheetNames.includes('关键词回答') ? '关键词回答' : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  // 直接在二维矩阵上解析（sheet_to_json 的 range 行号是工作表绝对行，
  // 与 !ref 起点无关，混用会错位——B2 起的表会整体偏移一行）
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 表头行：找「某格恰为 关键词 且另一格恰为 回答」的行（精确相等，避免标题
  // 「关键词自动回答表」两词都含而误判）；找不到再降级为包含匹配
  const findHeaderRow = (predicate) => {
    for (let r = 0; r < Math.min(10, matrix.length); r++) {
      const cells = matrix[r].map(c => String(c).trim());
      if (predicate(cells)) return r;
    }
    return -1;
  };
  const headerRowIdx = findHeaderRow(cells => cells.includes('关键词') && cells.includes('回答'))
    >= 0 ? findHeaderRow(cells => cells.includes('关键词') && cells.includes('回答'))
    : findHeaderRow(cells => cells.some(c => c.includes('关键词')) && cells.some(c => c.includes('回答')));
  if (headerRowIdx === -1) {
    throw new Error('表中未找到「关键词」「回答」表头行');
  }

  const headerCells = matrix[headerRowIdx].map(c => String(c).trim());
  const kwCol = headerCells.findIndex(c => c === '关键词') >= 0
    ? headerCells.findIndex(c => c === '关键词')
    : headerCells.findIndex(c => c.includes('关键词'));
  const ansCol = headerCells.findIndex(c => c === '回答') >= 0
    ? headerCells.findIndex(c => c === '回答')
    : headerCells.findIndex(c => c.includes('回答'));
  if (kwCol === -1 || ansCol === -1) {
    throw new Error(`表头行异常: ${JSON.stringify(headerCells)}`);
  }

  const replies = [];
  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const cells = matrix[r];
    const keywordsRaw = String(cells[kwCol] ?? '').trim();
    const answer = String(cells[ansCol] ?? '').trim();
    const rowNo = r + 1; // 1-based 展示（近似，够定位用）
    if (!keywordsRaw && !answer) continue; // 整行空
    if (keywordsRaw.startsWith('#')) continue; // 注释行
    if (!keywordsRaw || !answer) {
      console.warn(`⚠ [关键词回答表] 第 ${rowNo} 行关键词/回答缺一，已跳过`);
      continue;
    }
    const keywords = keywordsRaw.split(/[,，、;；]+/).map(s => s.trim()).filter(Boolean);
    if (keywords.length === 0) continue;
    replies.push({ keywords, answer });
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
  return { changed, count: replies.length };
}

module.exports = { syncAutoReplies };

if (require.main === module) {
  const result = syncAutoReplies();
  if (result.reason) {
    console.log('ⓘ 关键词回答表：' + result.reason);
  } else if (result.changed) {
    console.log(`✓ 关键词回答表 → autoReplies.json 同步完成（${result.count} 条规则）`);
  } else {
    console.log(`✓ 关键词回答表无变化（当前 ${result.count} 条规则）`);
  }
}
