/**
 * stub-test-ddl-retry.js — DDL 播报限频重试识别（stub，不触网）
 *
 * 背景：2026-09-18 12:00 播报第一步 getProjects 拉项目表被飞书限频
 * （bitable.js 抛「获取记录失败: TooManyRequest」），旧 isFrequencyLimitError
 * 只认 11232/frequency limited，不重试，当日播报静默丢失。
 * 本测试锁定：TooManyRequest 必须被识别为限频错误（进入退避重试）。
 */
const path = require('path');
const cron = require(path.join(__dirname, '..', 'src', 'cron'));

let failed = 0;
function assert(name, cond) {
  if (cond) {
    console.log('  ok -', name);
  } else {
    failed++;
    console.error('  FAIL -', name);
  }
}

const isFreq = cron.isFrequencyLimitError;

console.log('== stub-test-ddl-retry ==');
assert('TooManyRequest 裸词识别（bitable.js 错误形态）', isFreq(new Error('获取记录失败: TooManyRequest')));
assert('TooManyRequest 栈内嵌识别', isFreq(new Error('listRecords failed: TooManyRequest at bitable.js:21')));
assert('11232 频率码识别（既有行为回归）', isFreq(new Error('11232 frequency limited')));
assert('frequency limited 英文形态识别（既有行为回归）', isFreq(new Error('Too many request, frequency limited')));
assert('非限频错误不误判（网络断连）', !isFreq(new Error('getaddrinfo ENOTFOUND open.feishu.cn')));
assert('非限频错误不误判（表不存在）', !isFreq(new Error('创建记录失败: TableIdNotFound')));
assert('非限频错误不误判（参数错）', !isFreq(new Error('234001: Invalid request param.')));
assert('空错误不误判', !isFreq(null));
assert('undefined message 不误判', !isFreq({}));

if (failed > 0) {
  console.error(`stub-test-ddl-retry: ${failed} 项失败`);
  process.exit(1);
}
console.log('stub-test-ddl-retry: 全部通过');
