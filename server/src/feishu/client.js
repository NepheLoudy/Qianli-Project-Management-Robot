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
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
  };

  if (method === 'GET') {
    const query = new URLSearchParams(params).toString();
    const fullUrl = query ? `${url}?${query}` : url;
    const res = await fetch(fullUrl, options);
    return res.json();
  } else {
    const res = await fetch(url, {
      ...options,
      body: JSON.stringify(params),
    });
    return res.json();
  }
}

module.exports = {
  getClient,
  getTenantAccessToken,
  requestAPI,
};
