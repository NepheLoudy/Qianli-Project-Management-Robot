const lark = require('@larksuiteoapi/node-sdk');
const config = require('../config');

let client = null;
let tenantAccessToken = '';
let tokenExpireTime = 0;

function getClient() {
  if (!client) {
    client = new lark.Client({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.FeiShu,
    });
  }
  return client;
}

async function getTenantAccessToken() {
  const now = Date.now();
  if (tenantAccessToken && now < tokenExpireTime - 60000) {
    return tenantAccessToken;
  }

  const client = getClient();
  const res = await client.auth.tenantAccessToken.internal({
    data: {
      app_id: config.feishu.appId,
      app_secret: config.feishu.appSecret,
    },
  });

  if (res.code !== 0) {
    throw new Error(`获取 tenant_access_token 失败: ${res.msg}`);
  }

  tenantAccessToken = res.tenant_access_token;
  tokenExpireTime = now + res.expire * 1000;
  return tenantAccessToken;
}

async function requestAPI(method, path, params = {}) {
  const token = await getTenantAccessToken();
  const url = `https://open.feishu.cn/open-apis${path}`;

  const options = {
    method,
    // 无超时的 fetch 挂起会拖住事件管道与定时任务；网关/代理错误页非 JSON 时给出可读错误
    signal: AbortSignal.timeout(15000),
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
  };

  const parseJson = async (res) => {
    try {
      return await res.json();
    } catch (err) {
      throw new Error(`飞书 API 返回非 JSON 响应 (HTTP ${res.status})`);
    }
  };

  if (method === 'GET') {
    const query = new URLSearchParams(params).toString();
    const fullUrl = query ? `${url}?${query}` : url;
    const res = await fetch(fullUrl, options);
    return parseJson(res);
  } else {
    const res = await fetch(url, {
      ...options,
      body: JSON.stringify(params),
    });
    return parseJson(res);
  }
}

// 下载 IM 消息图片（二进制）。用户发送的图片不能用 GET /im/v1/images/{image_key}
//（该接口只能下载机器人自己上传的图片，用户图一律 234001），必须走消息资源接口
// GET /im/v1/messages/{message_id}/resources/{file_key}?type=image（duty-bot v28 同款修复）；
// 未开通或失败时抛错，由调用方降级（如关键词监听降级为无图记录，不阻塞发言入库）。
async function downloadImage(messageId, imageKey) {
  if (!messageId) {
    throw new Error('下载图片失败: 缺少 message_id（消息资源接口必填）');
  }
  const token = await getTenantAccessToken();
  const res = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(imageKey)}?type=image`,
    {
      method: 'GET',
      signal: AbortSignal.timeout(30000),
      headers: { 'Authorization': `Bearer ${token}` },
    }
  );

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || contentType.includes('application/json')) {
    // 出错时飞书返回 JSON 错误体（如权限未开通）
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = `${body.code || res.status}: ${body.msg || ''}`;
    } catch (err) { /* 非 JSON 错误体，保留 HTTP 状态 */ }
    throw new Error(`下载图片失败: ${msg}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) {
    throw new Error('下载图片失败: 空响应');
  }
  return buf;
}

// 上传媒体到多维表格，返回可直接写入附件字段的 file_token。
// parent_type=bitable_file（多维表格附件字段），parent_node=多维表格 base 的 app_token。
// 需应用开通 drive:file:upload（上传、下载文件到云空间）权限。
async function uploadMediaToBitable(buffer, fileName) {
  const token = await getTenantAccessToken();
  const form = new FormData();
  form.append('file_name', fileName);
  form.append('parent_type', 'bitable_file');
  form.append('parent_node', config.bitable.appToken);
  form.append('size', String(buffer.length));
  form.append('file', new Blob([buffer]), fileName);

  const res = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: { 'Authorization': `Bearer ${token}` },
    body: form,
  });

  const data = await res.json().catch(() => null);
  if (!data || data.code !== 0 || !data.data || !data.data.file_token) {
    const msg = data ? `${data.code}: ${data.msg}` : `HTTP ${res.status} 非 JSON 响应`;
    throw new Error(`上传图片到多维表格失败: ${msg}`);
  }
  return data.data.file_token;
}

module.exports = {
  getClient,
  getTenantAccessToken,
  requestAPI,
  downloadImage,
  uploadMediaToBitable,
};
