// ============================================================
// 官方卡文本消毒（2026-09-27 对抗审查 #1）：项目名/category、语录 words/person、
// 工单 title/组别 等字段由队员直接改表写入，原样拼进卡片 markdown 会让四播报群+
// 负责人群官方卡渲染 <at id=all></at>（@所有人）或 [文本](url) 钓鱼链。
// 只剥三类注入语法，正常中文/括号/书名号文本不受影响：
//   ① <at ...> / </at> 标签（卡片 @ 语法，含无引号属性写法 <at id=all>）
//   ② [文本](url) 链接语法 → 还原为「文本」纯文本（图片语法 ![alt](url) 同式剥除）
//   ③ 行首 # 标题符（# 后必须跟空白才算标题，「#1 号机」这类普通文本不受影响）
// 注意：只用于「表格数据」拼接处；内部 buildAtTag 构造的 @ 标签是有意发送的，不经过本函数。
// 独立成 util 模块：ddlConfirmService 等直接 require 使用（stub 测试会整体 mock
// feishu/bot 模块，经 bot 转发会被 mock 掉导致 sanitizeCardText 缺失）。
// ============================================================
function sanitizeCardText(text) {
  return String(text ?? '')
    .replace(/<\/?at\b[^>]*>/gi, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');
}

module.exports = { sanitizeCardText };
