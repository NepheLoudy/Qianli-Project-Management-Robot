/**
 * 论坛发言表加「话题」字段（一次性、幂等）：给关键词监听表（BITABLE_KEYWORD_TABLE_ID）
 * 补建「话题」单选字段——2026-10-08 论坛迭代（v125）起机器人只记录 #话题 帖子，
 * 话题写入该字段供仪表盘按话题出热力图/统计。已存在则打印类型直接跳过。
 * 选项预置指南 v1.0.0 的 12 话题；单选字段默认允许自动添加新选项，
 * keywords.json 后续加话题时无需重跑本脚本（写入会自动建选项）。
 * 运行：node scripts/add-keyword-topic-field.js（本地或部署目标均可，需 .env 凭据）
 */
const path = require('path');
const { requestAPI } = require('../server/src/feishu/client');

require('dotenv').config({ path: path.join(__dirname, '..', 'server', '.env') });

const APP_TOKEN = process.env.BITABLE_APP_TOKEN;
const TABLE_ID = process.env.BITABLE_KEYWORD_TABLE_ID;
if (!APP_TOKEN || !TABLE_ID) {
  console.error('未配置 BITABLE_APP_TOKEN / BITABLE_KEYWORD_TABLE_ID（server/.env）');
  process.exit(1);
}

// 与 server/src/config/keywords.json 的论坛话题清单一致（使用指南 v1.0.0）
const TOPICS = ['重装', '步兵', '空中', '飞镖', '征集', '实验', '分享', '讨论', '基建', '哨兵', '运营', '答疑'];

async function listFields() {
  const res = await requestAPI('GET', `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/fields?page_size=100`);
  if (res.code !== 0) throw new Error(`拉字段失败: ${res.msg} (${res.code})`);
  return res.data.items || [];
}

(async () => {
  const fields = await listFields();
  const existing = fields.find(f => f.field_name === '话题');
  if (existing) {
    console.log(`✓ 「话题」字段已存在（type=${existing.type}），跳过`);
    return;
  }
  const res = await requestAPI('POST', `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/fields`, {
    field_name: '话题',
    type: 3, // 单选：热力图/透视按话题分组更友好；写入未预置的值时自动建选项
    property: { options: TOPICS.map(name => ({ name })) },
  });
  if (res.code !== 0) throw new Error(`建「话题」字段失败: ${res.msg} (${res.code})`);
  console.log(`✓ 已创建「话题」单选字段（预置 ${TOPICS.length} 个话题选项）: ${res.data.field.field_id}`);
})().catch(err => { console.error(err.message); process.exit(1); });
