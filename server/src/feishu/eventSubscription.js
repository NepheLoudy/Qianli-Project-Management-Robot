const lark = require('@larksuiteoapi/node-sdk');
const config = require('../config');
const keywordService = require('../services/keywordService');
const chatService = require('../services/chatService');
const ddlConfirmService = require('../services/ddlConfirmService');

let wsClient = null;

function startEventSubscription() {
  if (!config.feishuEvent.useLongConnection) {
    console.log('[事件订阅] 已配置为不使用长连接模式，跳过启动');
    return null;
  }

  if (!config.feishu.appId || !config.feishu.appSecret) {
    console.warn('[事件订阅] 未配置飞书应用凭证，跳过事件订阅');
    return null;
  }

  const baseConfig = {
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.FeiShu,
    loggerLevel: lark.LoggerLevel.info,
  };

  wsClient = new lark.WSClient(baseConfig);

  const eventDispatcher = new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      try {
        const chatId = data.message?.chat_id;
        const chatType = data.message?.chat_type || data.message?.chatMode;
        console.log('[事件订阅] 收到消息事件:', data.message?.message_id, 'chat_id:', chatId, 'chat_type:', chatType);

        // 优先处理 owner 私聊回复（DDL逾期确认）
        if (chatType === 'p2p') {
          const confirmResult = await ddlConfirmService.handleP2PReply(data);
          if (confirmResult.handled) {
            console.log('[事件订阅] DDL确认服务已处理:', confirmResult.reply || confirmResult.reason);
            return;
          }
          // p2p 消息未被 DDL确认处理，直接交给 chatService（不检查 chatId）
          const chatResult = await chatService.processChatMessage(data);
          if (chatResult.handled) {
            console.log('[事件订阅] 对话服务已处理(p2p):', chatResult.isCommand ? '指令=' + chatResult.command : '正常对话');
            return;
          }
        }

        // @机器人对话：如果配置了 CHAT_CHAT_ID，则只处理指定群的消息
        if (!config.chat.chatId || chatId === config.chat.chatId) {
          const chatResult = await chatService.processChatMessage(data);
          if (chatResult.handled) {
            console.log('[事件订阅] 对话服务已处理:', chatResult.isCommand ? '指令=' + chatResult.command : '正常对话');
            return;
          }
        }

        // 关键词监听：如果配置了 KEYWORD_CHAT_ID，则只处理指定群的消息
        if (!config.keyword.chatId || chatId === config.keyword.chatId) {
          const kwResult = await keywordService.processMessageEvent(data);
          if (kwResult.skipped) {
            console.log('[事件订阅] 跳过:', kwResult.reason);
          } else if (kwResult.matched) {
            console.log('[事件订阅] 关键词匹配成功:', kwResult.keywords, '结果:', kwResult.results);
          }
        } else {
          console.log('[事件订阅] 关键词监听跳过：非目标群 (chat_id:', chatId, ')');
        }
      } catch (err) {
        console.error('[事件订阅] 处理消息事件失败:', err.message);
      }
    },
  });

  wsClient.start({
    eventDispatcher,
  });

  console.log('📡 飞书事件订阅（长连接模式）已启动');
  console.log('   监听事件: im.message.receive_v1 (接收消息)');

  return wsClient;
}

function stopEventSubscription() {
  if (wsClient) {
    wsClient.stop();
    wsClient = null;
    console.log('📡 飞书事件订阅已停止');
  }
}

module.exports = {
  startEventSubscription,
  stopEventSubscription,
};
