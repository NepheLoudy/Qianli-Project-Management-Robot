const lark = require('@larksuiteoapi/node-sdk');
const config = require('../config');
const keywordService = require('../services/keywordService');
const autoReplyService = require('../services/autoReplyService');
const chatService = require('../services/chatService');
const ddlConfirmService = require('../services/ddlConfirmService');
const meetingReminderService = require('../services/meetingReminderService');

let wsClient = null;

/**
 * 消息事件处理管道（长连接与 HTTP 回调/网关转发共用）
 * 依次经过：p2p DDL确认 → 对话/指令 → 群聊 DDL确认 → 关键词自动回复 → 关键词监听 → 会议提醒
 */
async function handleMessageEvent(data) {
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
      console.log('[事件订阅] p2p 消息处理完毕:', chatResult.isCommand ? '指令=' + chatResult.command : (chatResult.handled ? '正常对话' : '未命中对话'));
      // p2p 到此结束：后续环节（群 DDL 确认/关键词/会议）均为群聊专属，
      // 不 return 会再次调用 chatService，靠消息去重副作用短路
      return;
    }

    // @机器人对话：所有群都响应 @ 提及（不再限制为配置的群）
    const chatCtx = config.getChatContext(chatId);
    const chatResult = await chatService.processChatMessage(data);
    if (chatResult.handled) {
      console.log('[事件订阅] 对话服务已处理:', chatResult.isCommand ? '指令=' + chatResult.command : '正常对话', chatCtx ? `(${chatCtx.label})` : '');
      return;
    }

    // 群聊中检查 DDL 逾期确认回复（降级到群聊后，用户在群里回复）
    if (chatType === 'group' && chatCtx) {
      const confirmResult = await ddlConfirmService.handleReply(data);
      if (confirmResult.handled) {
        console.log('[事件订阅] DDL确认服务已处理:', confirmResult.reply || confirmResult.reason);
        return;
      }
    }

    // 关键词自动回复：未@机器人的群消息命中本地回答表时自动回答
    // （@机器人/私聊的命中在 chatService 内处理，不会走到这里；回复后不 return，发言记录照常）
    const autoResult = await autoReplyService.processMessageEvent(data);
    if (autoResult.matched) {
      console.log('[事件订阅] 关键词自动回复命中:', autoResult.keywords.join('/'), autoResult.replied ? '已回复' : '回复失败');
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

    // 会议提醒：仅检测会议卡片（video_chat / share_calendar / interactive 等，不含 share_chat 群聊分享）
    if (chatType === 'group') {
      const meetingResult = await meetingReminderService.processMeetingMessage(data);
      if (meetingResult.handled && meetingResult.triggered) {
        console.log('[事件订阅] 会议提醒已触发 (会议卡片)');
      } else if (meetingResult.handled && !meetingResult.triggered) {
        console.log('[事件订阅] 会议提醒跳过:', meetingResult.reason);
      }
    }
  } catch (err) {
    console.error('[事件订阅] 处理消息事件失败:', err.message);
  }
}

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
      await handleMessageEvent(data);
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
  handleMessageEvent,
};
