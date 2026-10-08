/**
 * stub-test-keyword-post.js — 论坛帖子判定 stub 测试（不触飞书）
 *
 * 背景：2026-10-08 论坛功能迭代（对齐「论坛机器人使用指南 v1.0.0」，张郭浩口径）——
 * 千里论坛群从「全量发言记录」改为「仅记录 #话题 开头帖子」，话题写入表格「话题」字段。
 * 判定规则：消息以 #话题 开头且话题后跟空格/换行才算（「#步兵 冲鸭」算，「#步兵冲鸭」不算）。
 * 本测试锁定：话题解析边界、清单归一化、非帖子跳过、帖子的字段落表（话题/正文）、
 * 带图帖子图片转存、话题字段写失败降级（线上表未建字段的部署窗口期）、enabled=false 关闭。
 * 运行：node scripts/stub-test-keyword-post.js
 */

// ---- 占位（必须先于 require src 模块） ----
const captured = { records: [], downloads: [] };

require.cache[require.resolve('../src/config')] = {
  id: 'config-stub', filename: 'config-stub', loaded: true, exports: {
    bitable: { keywordTableId: 'tbl_test' },
    keyword: { chatId: '' },
  },
};
require.cache[require.resolve('../src/feishu/bitable')] = {
  id: 'bitable-stub', filename: 'bitable-stub', loaded: true, exports: {
    async getAllRecords() {
      return [{ record_id: 'rec_parent_existing', fields: { 组别: '全部发言' } }];
    },
    async createRecord(tableId, fields) {
      // 故障注入：带「话题」字段的首写失败（模拟线上表未建字段），剥字段后可成功
      if (captured.failOnTopic && fields['话题'] !== undefined) {
        const err = new Error('FieldNameNotFound: 话题');
        throw err;
      }
      captured.records.push(fields);
      return { record_id: `rec_${captured.records.length}` };
    },
    async listRecords() { return { items: [] }; },
  },
};
require.cache[require.resolve('../src/feishu/client')] = {
  id: 'client-stub', filename: 'client-stub', loaded: true, exports: {
    async requestAPI(method, path) {
      if (method === 'GET' && path.startsWith('/contact/v3/users/')) {
        return { code: 0, data: { user: { name: '张三' } } };
      }
      return { code: -1, data: null };
    },
    async downloadImage(messageId, imageKey) {
      captured.downloads.push({ messageId, imageKey });
      return Buffer.from('img');
    },
    async uploadMediaToBitable() { return 'file_token_stub'; },
  },
};

const kw = require('../src/services/keywordService');

let failed = 0;
function assert(name, cond) {
  if (cond) {
    console.log('  ok -', name);
  } else {
    failed++;
    console.error('  FAIL -', name);
  }
}
function reset() {
  captured.records.length = 0;
  captured.downloads.length = 0;
  captured.failOnTopic = false;
}

// ---- matchTopic 单元断言 ----
function testMatchTopic() {
  console.log('# matchTopic 判定边界');
  const topics = kw.normalizeTopics(['#重装', '#步兵', '#空中', '#飞镖', '#征集', '#实验', '#分享', '#讨论', '#基建', '#哨兵', '#运营', '#答疑']);
  assert('清单归一化去 # 12 项', topics.length === 12 && topics.includes('步兵') && !topics.includes('#步兵'));

  let r = kw.matchTopic('#步兵 冲鸭', topics);
  assert('「#步兵 空格」判定为帖子', !!r && r.topic === '步兵' && r.content === '冲鸭');
  r = kw.matchTopic('#步兵\n冲鸭', topics);
  assert('「#步兵 换行」判定为帖子', !!r && r.topic === '步兵' && r.content === '冲鸭');
  r = kw.matchTopic('#步兵', topics);
  assert('单独 #步兵 也算帖子（无正文）', !!r && r.topic === '步兵' && r.content === '');
  r = kw.matchTopic('#步兵冲鸭', topics);
  assert('话题词后无空格/换行（#步兵冲鸭）不算帖子', r === null);
  r = kw.matchTopic('看看 #步兵 这帖子', topics);
  assert('话题不在开头不算帖子', r === null);
  r = kw.matchTopic('#英雄 旧话题', topics);
  assert('清单外话题（#英雄 已下线）不算帖子', r === null);
  r = kw.matchTopic('#重装 出装求推荐', topics);
  assert('新增话题 #重装 可判定', !!r && r.topic === '重装');
  r = kw.matchTopic('#答疑', topics);
  assert('新增话题 #答疑 可判定', !!r && r.topic === '答疑');
  r = kw.matchTopic('', topics);
  assert('空文本不算帖子', r === null);
  r = kw.matchTopic('#步兵 双话题 #讨论', topics);
  assert('正文带后续 #不干扰，只取开头话题', !!r && r.topic === '步兵' && r.content === '双话题 #讨论');
  assert('空清单返回 null', kw.matchTopic('#步兵 冲鸭', []) === null);
}

// ---- processMessageEvent 集成断言 ----
function textEvent(messageId, text) {
  return {
    message: { chat_id: 'oc_forum', message_id: messageId, message_type: 'text', content: JSON.stringify({ text }), create_time: '1700000000000' },
    sender: { sender_id: { open_id: 'ou_a' } },
  };
}

async function testProcess() {
  console.log('# processMessageEvent 帖子记录');

  reset();
  let r = await kw.processMessageEvent(textEvent('m1', '今天食堂真难吃'));
  assert('普通闲聊跳过不记录', r.skipped === true && captured.records.length === 0);

  reset();
  r = await kw.processMessageEvent(textEvent('m2', '#步兵 步兵战损求支援'));
  const child = captured.records.find(f => f['话题'] !== undefined);
  assert('帖子入库', r.matched === true && !!child);
  assert('话题字段=步兵', child['话题'] === '步兵');
  assert('消息内容=去话题前缀正文', child['消息内容'] === '步兵战损求支援');
  assert('时间/发送人照记', child['时间'] === 1700000000000 && child['发送人'][0].id === 'ou_a');
  assert('返回带 topic', r.topic === '步兵' && r.keywords[0] === '步兵');

  reset();
  r = await kw.processMessageEvent(textEvent('m3', '#步兵'));
  const childBare = captured.records.find(f => f['话题'] !== undefined);
  assert('无正文帖子入库存占位', r.matched === true && childBare['消息内容'] === '(无正文)');

  reset();
  r = await kw.processMessageEvent({
    message: {
      chat_id: 'oc_forum', message_id: 'm4', message_type: 'image',
      content: JSON.stringify({ image_key: 'img_key_x' }), create_time: '1700000000001',
    },
    sender: { sender_id: { open_id: 'ou_a' } },
  });
  assert('纯图无文本跳过（非帖子）', r.skipped === true && captured.records.length === 0);

  reset();
  r = await kw.processMessageEvent({
    message: {
      chat_id: 'oc_forum', message_id: 'm5', message_type: 'post',
      content: JSON.stringify({ zh_cn: { content: [[{ tag: 'text', text: '#分享 ' }, { tag: 'text', text: '看图' }], [{ tag: 'img', image_key: 'img_key_y' }]] } }),
      create_time: '1700000000002',
    },
    sender: { sender_id: { open_id: 'ou_a' } },
  });
  const childImg = captured.records.find(f => f['话题'] !== undefined);
  assert('富文本带图帖子入库', r.matched === true && !!childImg && childImg['话题'] === '分享');
  assert('富文本正文提取正确', childImg['消息内容'] === '看图');
  assert('图片已转存入库', childImg['图片'][0].file_token === 'file_token_stub');

  reset();
  captured.failOnTopic = true;
  r = await kw.processMessageEvent(textEvent('m6', '#讨论 部署窗口降级'));
  const childFb = captured.records.find(f => f['话题'] === undefined);
  assert('话题字段写失败降级：帖子仍入库（无话题字段）', r.matched === true && !!childFb);
  assert('降级后正文不丢', childFb['消息内容'] === '部署窗口降级');

  reset();
  r = await kw.processMessageEvent(textEvent('m7', '#步兵 第一条'));
  const cntAfterDup = captured.records.length;
  r = await kw.processMessageEvent(textEvent('m7', '#步兵 第一条'));
  assert('同 message_id 去重', r.skipped === true && captured.records.length === cntAfterDup);
}

async function main() {
  testMatchTopic();
  await testProcess();
  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
