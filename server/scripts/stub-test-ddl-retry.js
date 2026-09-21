/**
 * stub-test-ddl-retry.js — DDL 播报重试识别（stub，不触网）
 *
 * 背景1：2026-09-18 12:00 播报第一步 getProjects 拉项目表被飞书限频
 * （bitable.js 抛「获取记录失败: TooManyRequest」），旧 isFrequencyLimitError
 * 只认 11232/frequency limited，不重试，当日播报静默丢失。
 * 本测试锁定：TooManyRequest 必须被识别为限频错误（进入退避重试）。
 *
 * 背景2：2026-09-21 12:05 播报撞上校园网链路劣化窗口（网关侧 self-signed
 * certificate 指纹），requestAPI 抛 TimeoutError——不属限频，旧逻辑直接
 * break 放弃，当日播报再次丢失。本测试锁定：瞬时网络错误必须被
 * isTransientNetworkError 识别（进入同一退避重试），业务性错误不误判。
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

const isTransient = cron.isTransientNetworkError;

console.log('== stub-test-ddl-retry（网络瞬时错误） ==');
assert('undici 超时识别（2026-09-21 12:05 实际失败形态）', isTransient(new Error('The operation was aborted due to timeout')));
assert('fetch failed 识别（undici 连接层失败外壳）', isTransient(new Error('fetch failed')));
assert('自签证书劫持识别（校园网认证页指纹）', isTransient(new Error('self-signed certificate')));
assert('DNS 失败识别', isTransient(new Error('getaddrinfo ENOTFOUND open.feishu.cn')));
assert('连接被重置识别', isTransient(new Error('read ECONNRESET')));
assert('连接被拒绝识别', isTransient(new Error('connect ECONNREFUSED 10.253.33.233:443')));
assert('socket hang up 识别', isTransient(new Error('socket hang up')));
assert('socket 断连识别（TLS 握手中断形态）', isTransient(new Error('Client network socket disconnected before secure TLS connection was established')));
assert('ETIMEDOUT 识别', isTransient(new Error('connect ETIMEDOUT 1.2.3.4:443')));
assert('业务性错误不误判（表不存在，重试无意义）', !isTransient(new Error('创建记录失败: TableIdNotFound')));
assert('业务性错误不误判（参数错）', !isTransient(new Error('234001: Invalid request param.')));
assert('非限频也不误判为瞬时（凭证类）', !isTransient(new Error('app ticket invalid (code: 99991663)')));
assert('空错误不误判', !isTransient(null));
assert('undefined message 不误判', !isTransient({}));

if (failed > 0) {
  console.error(`stub-test-ddl-retry: ${failed} 项失败`);
  process.exit(1);
}
console.log('stub-test-ddl-retry: 全部通过');
