/**
 * 历史帖子补录工具（v129 全群特例实验批 2026-10-12）：
 * 用「获取会话历史消息」API 拉群历史 → matchGlobalScopeTopic 只滤全群特例话题 →
 * 复用 keywordService.processMessageEvent 落表（话题/正文/图片转存/发送人/时间与实时链路完全一致）。
 *
 * ⚠️ 飞书硬限制（2026-10-12 培训群实验实测）：机器人只能拉到**入群之后**的历史消息，
 * 入群前已发的帖子 API 拿不到——成员把机器人拉进群之前发的 #小贴士 无法补录，
 * 只能请原发人重发（实时链路自动收录）。本工具的适用场景是「入群后」的缺口修复：
 * 服务停机/网关抖动/闸门漏收期间流过的消息，事后按本工具补齐。
 *
 * 仅补 GLOBAL_TOPICS 特例话题：非特例话题仍属论坛群专属，其他群历史不补。
 * 用法：node scripts/backfill-topic-from-history.js <chat_id> [--dry]
 */
const serverRequire = require('module').createRequire(require('path').join(__dirname, '..', 'server', 'package.json'));
serverRequire('dotenv').config({ path: require('path').join(__dirname, '..', 'server', '.env') });

const keywordService = require('../server/src/services/keywordService');
const client = require('../server/src/feishu/client');

const CHAT_ID = process.argv[2];
const DRY = process.argv.includes('--dry');
if (!CHAT_ID) {
  console.error('用法: node scripts/backfill-topic-from-history.js <chat_id> [--dry]');
  process.exit(1);
}

const PAGE_SIZE = 50;
const MAX_PAGES = 40; // 2000 条保底，防异常分页死循环

async function fetchChatInfo() {
  const res = await client.requestAPI('GET', `/im/v1/chats/${CHAT_ID}`);
  if (res.code !== 0) throw new Error(`拉群信息失败: ${res.msg} (${res.code})`);
  return res.data;
}

async function fetchAllMessages() {
  const items = [];
  let pageToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await client.requestAPI('GET',
      `/im/v1/messages?container_id_type=chat&container_id=${CHAT_ID}&page_size=${PAGE_SIZE}&sort_type=ByCreateTimeAsc${pageToken ? `&page_token=${pageToken}` : ''}`);
    if (res.code !== 0) throw new Error(`拉历史消息失败: ${res.msg} (${res.code})`);
    const batch = (res.data && res.data.items) || [];
    items.push(...batch);
    process.stdout.write(`  已拉 ${items.length} 条\r`);
    if (!res.data || !res.data.has_more || !res.data.page_token) break;
    pageToken = res.data.page_token;
  }
  console.log('');
  if (pageToken && items.length >= MAX_PAGES * PAGE_SIZE) {
    console.warn(`⚠ 达到分页上限 ${MAX_PAGES * PAGE_SIZE} 条，历史可能未拉全（需要更多请调大 MAX_PAGES）`);
  }
  return items;
}

function historyItemToEvent(item) {
  return {
    message: {
      chat_id: item.chat_id,
      message_id: item.message_id,
      msg_type: item.msg_type,
      content: item.body && item.body.content,
      create_time: item.create_time,
    },
    sender: { sender_id: { open_id: (item.sender && item.sender.id) || '' } },
  };
}

(async () => {
  const info = await fetchChatInfo();
  console.log(`群: ${info.name} (${CHAT_ID})`);

  const items = await fetchAllMessages();
  console.log(`历史消息共 ${items.length} 条`);

  const hits = [];
  for (const item of items) {
    if (item.sender && item.sender.sender_type === 'app') continue; // 机器人/播报卡不补
    const event = historyItemToEvent(item);
    const post = keywordService.matchGlobalScopeTopic(event.message);
    if (post) hits.push({ item, event, post });
  }
  console.log(`命中全群特例话题（#${keywordService.GLOBAL_TOPICS.join(' #')}）的帖子: ${hits.length} 条`);
  for (const h of hits) {
    console.log(`  - ${new Date(Number(h.item.create_time)).toLocaleString('zh-CN')} ${(h.item.sender && h.item.sender.id) || '?'} #${h.post.topic} ${h.post.content.slice(0, 40)}`);
  }
  if (DRY) { console.log('(--dry 不落表)'); return; }

  let ok = 0, fail = 0;
  for (const h of hits) {
    const r = await keywordService.processMessageEvent(h.event);
    const success = r.matched && r.results && r.results[0] && r.results[0].success;
    if (success) ok++;
    else { fail++; console.warn(`  写入失败 ${h.item.message_id}:`, r.results && r.results[0] && r.results[0].error); }
  }
  console.log(`补录完成: 成功 ${ok} / 失败 ${fail}`);
})().catch(err => { console.error(err.message); process.exit(1); });
