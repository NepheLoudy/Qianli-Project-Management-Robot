# project-management-robot 开发边界（防需求发错会话）

## 本项目职能
爆米花机（对话枢纽 / hub / knowledge-tracker）：各群 @机器人对话与指令分发、关键词监听、DDL 播报（含"未结单工单"分栏**展示**）与逾期确认、会议提醒、每日语录、项目多维表格读写。


## 顶层规则与交互性（每次开工先读）

本会话是独立工作区，**不会自动加载外层规则**——开工前先读一遍 `../AGENTS.md`（ticket+项目管理联动工作区：边界速览 + 联动契约，重点读），再读 `../../AGENTS.md`（顶层职能总表 + 架构铁律 + DEVLOG 规则）；涉及消息路由、@识别、指令转发的改动，再读 `../../.agents/skills/qianli-chat-architecture/SKILL.md`。

与其它机器人/服务的交互契约（改接口前先对顶层文档）：
- 五个机器人**共用同一个飞书应用**；长连接只属于 feishu-gateway，本项目事件一律 `FEISHU_USE_LONG_CONNECTION=false`，由网关转发到本项目的 `POST /api/feishu/event`；
- 指令交互契约：`POST /api/chat/command`，入参 `{command, args}`，回 `{reply}`（回复由调用方——网关或 hub——代发）；
- 群播报走群自定义机器人 webhook，对话回复走飞书 IM API；
- 部署一律项目内 `npm run push "说明"`（规则见 qianli-deploy skill 与顶层 AGENTS.md），NAS 凭证在 .env 的 NAS_*；
- 通用坑：@识别要兼容 mentioned_type='bot'；多维表格字段值先过 fieldText 类工具再拼字符串；express.json 建议放宽到 2mb。

工作区与顶层职能速览（需求跨项目即停，走上方"发错时的规定动作"）：
本目录（ticket-pm）= 工单+项目管理联动开发区：project-management-robot=对话枢纽+DDL｜ticket-bot=工单域（同工作区 `../ticket-bot`）。其余在顶层：approval-bot=财务审批｜bambu-print-reservation=打印预约｜feishu-gateway=事件接入｜qianli 顶层=部署/架构/整理。

## 只管这些（归属信号）
DDL、逾期、项目表字段、对话能力、指令分发、关键词、会议提醒、语录、播报卡片样式、逾期确认流程。

## 不管这些（发错信号 → 立即停手）
- **工单数据口径：未结单分栏的负责人取值/分桶规则、工单播报、接单、结单** → ticket-bot 会话（同工作区 `../ticket-bot`；本项目通过其 API `GET /api/tickets/unclosed-by-group` 取数，口径改动在 ticket-bot 做）
- **审批、发票、报销、财务催办** → approval-bot 会话
- **3D 打印、预约、打印机** → bambu-print-reservation 会话
- **事件路由、连接、消费者登记（跨项目）** → feishu-gateway 会话
- **部署链路、push.js、架构、工作区整理** → qianli 顶层会话

## 易混裁定
DDL 卡片分两半：**"未结单工单分栏"的数据口径在 ticket-bot**（含"播报对象应为负责人而非发起人"这类取值需求）；**卡片里分栏怎么展示、其它栏目（项目逾期/紧急/语录）在本项目**。

## 发错时的规定动作
用户需求落在"不管这些"时，必须：
1. **停止开发，不写任何代码、不改任何文件**；
2. 回复：「⚠️ 这个需求属于 <X 项目>（负责 <…>），当前会话是 project-management-robot——你可能发错会话了。请到对应会话发送；如确认要在本项目做，请回复"就在本项目做"。」
3. 用户明确确认后才继续；模糊回答时再确认一次。
4. 边界模糊时：先列分工与建议归属，等用户指定后再动手。
