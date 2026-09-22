# 飞书项目管理追踪器

飞书云文档小组件 + 后端服务 - 项目管理与 DDL 播报系统

## 功能特性

### 1. 项目管理多维表格
- 项目名称、负责人、截止日期、优先级、状态管理
- 支持分组（category）
- 支持父子层级结构（parentId）
- 优先级：high（高）/ medium（中）/ low（低）
- 状态：pending（意外暂停）/ in_progress（进行中）/ waiting（待认领）/ completed（已完成）/ died（已截止）
- DDL 倒计时显示，临近 DDL 高亮提醒

### 2. 群机器人 DDL 播报（4 群分组 + 负责人群整合）
- 每天 12:05 自动播报 DDL 情况（2026-09-19 起，与 duty-bot 12:00 值日播报错峰防 bitable 限频）
- **4 个播报群对应 4 个人员字段**：owner 群 / dkyj 组 / sj 组 / xy 组
- 每个群只播报「对应人员字段有人的项目」，避免重复通知
- **负责人群整合播报（2026-09-22 起）**：各群播报后，把**逾期 + 临期（`DDL_ALERT_DAYS` 内）**跨播报群汇总（各人员字段并集，不分群口径）再在负责人群播一遍，卡头 **@ 指定负责人**（`LEADER_MENTION_OPEN_ID/MENTION_NAME`，现=章子赫，open_id 已过通讯录核验）；只含逾期/临期两栏（周概览/工单分栏/语录不上此卡），两栏全空当日不发送；与各群同轮重试去重，目标与播报群重复时自动跳过
- **父项目负责人归并**（v62）：父项目负责人是总负责人，播报时其各人员字段的成员视为名下**所有子项目**也有他——子项目自身负责人维持原有逻辑（自身成员优先），父项目成员沿父子链归并进子项目后按人去重；归并只作用于播报归属与卡片 @，不改写看板数据
- 仅播报 `in_progress` 和 `waiting` 状态的项目
- 已逾期项目提醒、2 天内到期项目 @负责人提醒、本周到期项目概览
- 支持父子层级结构，按层级依序完整播报，子记录自动缩进
- 同一 webhook / 群聊 ID 自动去重，防止同一群收到多张播报卡
- 支持 `/test-ddl` 手动测试播报（测试卡只发对应播报群，**不含负责人群整合卡**；整轮重跑走 `POST /api/bot/test-broadcast`（运维台按钮，受「今日已播报」标记限制）——负责人群卡只随整轮播报/静默补跑发送）

### 3. 维护日志
- 版本更新记录管理
- 每次确认版本后将功能更新内容写入日志
- 按时间倒序显示日志列表
- 存储在飞书多维表格的「维护日志」表中

### 4. 群聊发言记录（原关键词监听）
- 监听指定群聊（`KEYWORD_CHAT_ID`）的**全部消息**（自 v23 起不再按关键词过滤，父记录固定为「全部发言」；`keywords.json` 与 `/keywords` 指令仅作展示兼容）
- 记录到多维表格：时间、发送人、组别（全部发言）、消息内容、图片
- 图片真入库：IM `image_key` 不能直接作附件 file_token（飞书限制），自动走「下载消息图片 → 重传多维表格」转存（需应用开通 `im:image`、`drive:file:upload` 权限）；单张转存失败只跳过该张，全部失败降级为**无图记录**，文本/时间/发送人不丢
- 前端可按分组折叠/展开查看
- 注意：群里 @机器人的消息走对话链路，不会被本功能记录

### 5. 机器人对话功能
- @机器人激活对话（群聊），私聊直接响应
- 支持指令系统（2026-09-14 起 `/help` 只向群聊展示成员相关指令，运维/诊断类仍可直接使用但不展示）：
  - `/help` — 显示帮助信息
  - `/lottery` — 查看抽奖奖池与概率；`/<触发词>`（如 `/抽奖`）— 抽一次奖（触发词在 抽奖配置表.xlsx 定义，动态进 /help）
  - `/status` — 查看服务运行状态 + 舰队健康快照（部署目标本机 7 服务 health 探测 + 网关长连接/投递统计，2026-09-21 v105 起——管理员私聊即可远程看状态，不依赖开发内网）（运维，不在 /help 展示）
  - `/test-ddl` — 手动触发 DDL 播报测试（与正式播报同内容，可作部分失败后的补发）（运维，不在 /help 展示）
  - `/keywords` — 查看关键词配置（仅展示）（运维，不在 /help 展示）
  - `/autoreply` — 查看关键词自动回答表（群消息表 / @触发表两张）（运维，不在 /help 展示）
  - `/history` — 查看近期播报历史（运维，不在 /help 展示）
  - `/print-*` — 3D 打印指令转发（bambu）
  - `/approval-*` — 财务指令转发（approval-bot；审批群内指令整体切换为财务）
- 消息去重机制，防止重复处理
- 事件由 feishu-gateway（本机唯一长连接）转发到 `/api/feishu/event`，本服务 `FEISHU_USE_LONG_CONNECTION=false`

### 6. 逾期项目私聊确认
- DDL 播报时自动识别逾期项目，向负责人（owner）私聊发送确认消息
- 子项目自身无 owner 时，确认私聊回退给父项目 owner（总负责人，v62 起）
- 每条确认私聊带**确认编号 N**（同 owner 内按发送序递增，12h 窗口内稳定）
- 引导用户回复「是」或「否」确认项目是否已完成；回复「是」自动将项目状态更新为 completed
- **多项目定向回复（2026-09-21 起）**：同一人多个项目同时逾期时，回复「编号+是/否」定向确认（如 `2 是`、`1 还没`，支持 `2是`/`2：是`/`#2 是` 形态）；私聊裸回「是/否」且有多条待确认时**不再猜最近一条**，改为回编号清单引导定向；单项目裸回复行为不变；编号不存在时提示当前清单
- @提及文本通过富文本（post）渲染，确保正常显示无乱码
- **问询走私聊**：DDL 播报后向 owner 私聊发确认消息，回复也在私聊里识别（v51 起群聊问询已下线）
- 待确认记录 **12 小时**时效（`DDL_CONFIRM_WINDOW_HOURS` 可配）过期清除；超时未回复项目保持原状态，次日 12:05 播报重新询问

### 7. 每日随机语录
- DDL 播报卡片末尾添加语录栏目
- 从多维表格语录表随机选取一条
- 1 小时缓存机制，减少 API 调用
- 语录表为空或读取失败时静默跳过

### 8. 会议卡片提醒
- 监听机器人所在**所有群聊**的会议卡片消息
- 检测类型：`video_chat`（群聊视频会议卡片）、`share_calendar`、`calendar_event`、`interactive`
  （`share_chat` 群聊分享卡片与会议无关，不触发）
- 检测到会议卡片后自动 @所有人 提醒参会
- 5 分钟内同一群不重复触发

### 9. 关键词自动回复（本地回答表）
- **填写入口：项目根目录 `关键词回答表.xlsx`**（两个工作表，填写规则完全相同；详细规则见表内「使用说明」工作表）
  - 「**关键词回答**」工作表 → 群消息（未@机器人）命中即回，同时是 @我 时的**回落表**
  - 「**@触发回答**」工作表 → **只有群里 @机器人 才会命中**，优先级高于「关键词回答」（先查它，未命中再回落）
  - 「关键词」列：触发词，同义词用逗号/顿号/分号分隔放同一格，`#` 开头行=注释
  - 「回答」列：支持 `/` 分隔**多个候选回复**，触发时按概率加权随机抽一条
  - 「概率1/2/3…」列：回答列右侧顺延，按候选顺序填 **0-100 整数**（总和 100）；留空候选自动均分剩余概率，全留空=等概率，填 0=永不触发，总和超 100 自动按比例压缩（同步时警告）
- `npm run push` 开头自动把两个工作表各转成一个 JSON 再部署（`server/src/config/autoReplies.json` 与 `autoRepliesMention.json`；转换脚本 `scripts/syncAutoReplies.js`，也可 `npm run sync:auto-replies` 只转存不部署）；**JSON 是生成物，勿手改**
  - 工作表按名字精确匹配（不再回落到第一个工作表）；某个工作表不存在时只跳过该表（记提示、不阻断部署、不动既有 JSON）
- 运行时每次收到消息都重读 JSON，**部署完成后改动即时生效，无需重启**
- 触发：消息文本**包含**关键词即命中（不分大小写）；一张表内命中多条规则时，每条规则各抽一条回复合并发送；跨表不合并——先命中的表胜出
- 生效范围（与原关键词监听插件**分立**，互不依赖）：
  - 群消息（未@）：只查「关键词回答」表，**机器人所在的全部群**（含财务审批群、值日专用群）命中即回复；`AUTO_REPLY_CHAT_IDS` 可收窄（逗号分隔 chat_id，留空或 `*` = 所有群）
  - 群里 @机器人：先查「@触发回答」表，未命中回落「关键词回答」表；两表都没命中才回默认欢迎语（审批群的 `/approval-*` 指令路由不受影响）。**值日管辖群例外**：@消息先经值日分支——看板触发词（带不带 `/` 均可）出看板、@+纯图片静默吞掉、关键词命中照常回答，其余回策略下发的引导语（基础指令关闭，不会到欢迎语）；**非管辖群**里 @ 值日指令回「请到值日专用群或私信办理」提示；管辖群与规则由 duty-bot `GET /api/duty/policy` 下发（断联时按本仓 `DUTY_CHAT_ID` 兜底；groupChatIds 空=不限制，与 duty-bot 判定口径一致）
  - 私聊：**不返回回答内容**——命中任一表只回「⚠️ 关键词自动回复仅面向群聊开放，请在群里 @我 使用。」；没命中仍是欢迎语（私聊指令白名单不受影响）
- 指令/接口：`/autoreply` 分两段查看两张表（含概率）；`GET /api/autoreplies/config` 读「关键词回答」表、`GET /api/autoreplies/mention-config` 读「@触发回答」表；`/keywords` 仍只管原监听插件
- 定制窗口（顶层 AGENTS「机器人后端定制窗口」）：`GET /api/autoreplies/rules?table=group|mention` 读当前生效规则（`.local.json` 优先）；`POST /api/autoreplies/rules`（`{table, rule:{keywords:[], answersText:"每行一条 回答|权重"}}`）新增/更新——写入不再做值日域保留词校验（2026-09-13 口径：值日助手仅 @ 与私聊触发、未@关键词回答全群统一，无撞车面）；`POST /api/autoreplies/rules/delete`（`{table, keywords:[]}`）删除；`POST /api/autoreplies/enabled`（`{table, enabled}`）启停整表。**改动写 NAS `.local.json` 即时生效**；`npm run push` 会用本地版本覆盖该文件，持久批量编辑仍以本地 `关键词回答表.xlsx` 为准（运维台「定制中心」已内置这套编辑器）
- 回复方式：引用回复原消息，失败降级为直接发送
- 防干扰：其他应用/机器人发出的消息（如 webhook 播报卡片）不触发；指令优先于自动回复（审批群 `/approval-*` 照常转发）
- 属对话回路（用户消息触发的即时应答），不受晚间静默窗口限制
- `/status` 显示启用状态与两张表的条数

### 10. 抽奖（一个工作表 = 一个抽奖指令 = 一个奖池）
- **玩法**：`抽奖配置表.xlsx` 里**每个工作表对应一个独立的抽奖指令**，**工作表名即指令名**——sheet「抽奖」→ 群里 @机器人 发 `/抽奖` 即从该表奖池按概率抽一条奖品文字原文回复；复制工作表改名（如「转发抽奖」）→ `/转发抽奖`，就是新抽奖
- **奖池表只有「奖品」「概率」两列：一行 = 一个奖品**，行数不限，往下加行即可
  - 「奖品」列填奖品文字，抽中的文字**原文回复**（表情/祝贺语直接写进奖品文字）；以 `#` 开头的行 = 注释行不同步（兼容旧格式：行首任意列以 `#` 开头都视为注释）
  - 「概率」列 = 相对权重份数：0-100 的数（如 5 和 95 → 5%/95%）；留空 = 1（等概率参与）；0 = 永不抽中；总和不必凑满 100（自动归一化）
  - 工作表没有有效奖品行时该指令暂不生效（填上再 push 即生效）；**没有「奖品」表头的表（如「使用说明」）自动忽略**——说明/草稿随便放
- 触发路径：chatService 指令分支的**动态指令**——静态指令表（/help /lottery 等）优先，未命中再查各抽奖指令，仍未命中才落 /print-* 与未知指令；值日管辖群同样可用（先于基础指令关闭的引导语）；**审批群不开放**（指令面固定 /approval-*）；私聊按指令白名单口径
- 全部奖池动态进 `/help`；`/lottery` 查看所有奖池与概率；`LOTTERY_CHAT_IDS` 可收窄生效群范围（留空或 `*` = 所有群）；定制窗口（`.local.json`）可临时另加表格之外的奖池
- `npm run push` 开头自动同步（`scripts/syncLottery.js`，也可 `npm run sync:lottery` 只转存不部署）→ `server/src/config/lottery.json`（生成物，勿手改）；运行时每消息重读，**部署后改动即时生效，无需重启**
- 定制窗口（顶层 AGENTS「机器人后端定制窗口」）：`GET /api/lottery/rules` 读当前生效规则（`.local.json` 优先）；`POST /api/lottery/rules`（`{keywords:[], answersText:"每行一条 奖品|概率"}`）新增/更新、`POST /api/lottery/rules/delete`（`{keywords:[]}`）删除、`POST /api/lottery/enabled`（`{enabled}`）启停（写端点均需 `X-API-Token`）。**改动写 `.local.json` 即时生效**；`npm run push` 会用本地版本覆盖该文件（备份+条数守卫同回答表），持久批量编辑仍以本地 `抽奖配置表.xlsx` 为准
- 其它：命中向网关上报统计（feature=`抽奖`，队员活跃归因）；回复走指令统一回复链路（引用回复，失败降级直接发送）；属对话回路，不受晚间静默窗口限制

## 项目结构

```
project-management-robot/
├── widget/                       # 飞书云文档小组件（前端）
│   ├── src/
│   │   ├── components/
│   │   │   ├── ProjectTable.tsx      # 项目管理表格（父子层级）
│   │   │   ├── DDLBoard.tsx          # DDL 看板
│   │   │   ├── MaintenanceLog.tsx    # 维护日志
│   │   │   └── KeywordTracker.tsx    # 关键词监听记录
│   │   ├── api.ts                    # API 接口
│   │   ├── App.tsx
│   │   └── index.tsx
│   ├── app.json
│   ├── package.json
│   ├── tsconfig.json
│   └── webpack.config.js
├── server/                       # 后端服务
│   ├── src/
│   │   ├── feishu/
│   │   │   ├── client.js            # 飞书 API 客户端
│   │   │   ├── bitable.js           # 多维表格 API
│   │   │   ├── bot.js               # 机器人消息（@标签 / 富文本）
│   │   │   └── eventSubscription.js # 事件订阅（长连接）
│   │   ├── services/
│   │   │   ├── projectService.js    # 项目服务（层级 / 4 群过滤）
│   │   │   ├── logService.js        # 维护日志服务
│   │   │   ├── keywordService.js    # 关键词监听服务
│   │   │   ├── autoReplyService.js  # 关键词自动回复服务（autoReplies.json + autoRepliesMention.json）
│   │   │   ├── lotteryService.js    # 抽奖服务（lottery.json/.local.json，一个工作表=一个指令=一个奖池）
│   │   │   ├── chatService.js       # 对话 / 指令服务
│   │   │   ├── ddlConfirmService.js # 逾期确认服务
│   │   │   ├── ticketCloseService.js # 工单分栏取数（主链路 API + 降级直读）
│   │   │   └── meetingReminderService.js # 会议卡片提醒
│   │   ├── cron/
│   │   │   └── index.js             # 定时任务
│   │   ├── utils/
│   │   │   └── quietHours.js        # 晚间静默闸门（播报积压补跑）
│   │   ├── config.js                # 配置（4 群播报 + 负责人群整合播报）
│   │   └── index.js                 # 入口
│   ├── package.json
│   └── .env.example
├── 关键词回答表.xlsx             # 关键词自动回答填写入口（「关键词回答」+「@触发回答」两个工作表，push 时各转一个 JSON）
├── 抽奖配置表.xlsx               # 抽奖填写入口（一个工作表=一个抽奖指令=一个奖池，push 时转 lottery.json）
├── scripts/
│   ├── syncAutoReplies.js        # 关键词回答表.xlsx → autoReplies(.Mention).json 转换脚本
│   └── syncLottery.js            # 抽奖配置表.xlsx → lottery.json 转换脚本（一个工作表=一个指令=一个奖池）
├── push.js                       # 一键部署脚本（Git + NAS）
├── auto-deploy.js                # GitHub Actions 时代旧部署脚本（已不用，仅存档）
└── README.md
```

## 部署步骤

### 一、准备工作

1. **飞书开发者账号**：访问 https://open.feishu.cn/ 注册
2. **创建企业自建应用**：进入开发者后台 → 创建企业自建应用，记录 `App ID` 和 `App Secret`
3. **开通权限**：
   - 云文档多维表格：`bitable:app`
   - 获取用户信息：`contact:user.base:readonly`
   - 机器人消息：`im:message`、`im:message:send_as_bot`、`im:message.p2p_msg:readonly`
   - 群组信息：`im:chat`

### 二、创建多维表格

1. 在飞书中创建多维表格（Base），记录 `App Token`（URL 中 `bascn` 开头部分）
2. 创建数据表：

**表1：项目管理（表ID: tbl_project）**

| 字段名 | 字段类型 | 说明 |
|--------|----------|------|
| name | 文本 | 项目名称 |
| owner | 人员 | 负责人（对应 owner 群播报） |
| dkyjcontributers | 人员 | dkyj 组人员（对应 dkyj 组播报） |
| sjcontributers | 人员 | sj 组人员（对应 sj 组播报） |
| xycontributers | 人员 | xy 组人员（对应 xy 组播报） |
| contributers | 人员 | 通用贡献者（保留字段） |
| ddl | 日期 | 截止日期 |
| priority | 单选 | 优先级（high/medium/low） |
| status | 单选 | 状态（pending/in_progress/waiting/completed/died） |
| category | 文本 | 分组（如：产品组、研发组） |
| fileToken | 文本 | 关联文档 Token（可选） |
| parentId | 关联/文本 | 父项目 ID（父子层级，可选） |
| createdAt | 创建时间 | 创建时间 |
| updatedAt | 最后更新时间 | 更新时间 |

> **注意**：`owner`、`dkyjcontributers`、`sjcontributers`、`xycontributers` 使用飞书多维表格「人员」字段类型。播报时每个群只播报对应字段有人的项目。

**status 状态语义与播报规则**：

| 状态 | 含义 | 播报规则 |
|------|------|----------|
| in_progress | 进行中 | 正常参与 DDL 播报（逾期/紧急/本周） |
| waiting | 还没有人做 | 参与 DDL 播报并标注「⏳待认领」 |
| pending | 出现意外暂停 | 不进 DDL 分类，在卡片「⏸️ 意外暂停项目」区块单独说明（只列名字不 @） |
| died | 项目已截止 | 不播报，不再管理 |
| completed | 已完成 | 不播报 |
| ddl 未填写 | —— | 不参与 DDL 播报（暂停 pending 项目除外，其单独说明区块不看 DDL） |

**ticket-bot 工单联动（未结单播报）**：每日 DDL 播报卡片还包含工单分栏。取数主链路调 ticket-bot `GET /api/tickets/unclosed-by-group`（10s 超时），按群取各负责人分桶（各组只看到自己负责人的工单）；API 失败自动降级直读工单源表（同一多维表格 base，口径与主链路对齐：指定负责人→补充负责人、节点值拆段匹配），再失败才降级为不带工单分栏，均不影响 DDL 播报本身。分栏口径与 ticket-bot unclosedService 对齐：

- 🎫 **工单结单加急（2日内）**：理想结单时间在 2 日内，已超期的标注超期天数（节点处于未审批的最后一层「回执单：是否结单」= 工作已交付但未结单）
- 🎫 **工单7日内待结单**：理想结单时间在 2 日外、7 日内
- 🆘 **无人接单工单（超6小时）**：节点处于任一触发节点 + 补充负责人为空 + 距发起 ≥6 小时，按已发布时长降序（v56 新增）

工单分栏只列处理人名字不 @（临近结单的私聊提醒与无人接单的问询/组长升级由 ticket-bot 负责）。相关配置见 `server/.env.example` 的 `TICKET_*` 项，字段/节点值改动需与 ticket-bot 侧同步。

**晚间静默（播报时段限制）**：每日 DDL 播报（含负责人群整合播报与逾期确认私聊）触发落在 02:00–09:00（Asia/Shanghai，`QUIET_HOURS_START/END` 可配、`QUIET_HOURS_DISABLED=1` 关闭）内时不直接执行，积压到 09:00 整点以补发时刻数据重跑；`/test-ddl`、`/test-broadcast` 等人工触发与对话/指令回复不受限。实现见 `server/src/utils/quietHours.js`。

**表2：维护日志（表ID: tbl_log）**

| 字段名 | 字段类型 | 说明 |
|--------|----------|------|
| version | 文本 | 版本号（如 v1.6.0） |
| content | 文本 | 更新内容描述 |
| createdAt | 创建时间 | 创建时间 |

**表3：关键词监听（表ID: tbl_keyword）**

| 字段名 | 字段类型 | 说明 |
|--------|----------|------|
| 组别 | 文本 | 恒为「全部发言」（v23 起记录群内全部消息，不再按关键词分组） |
| 时间 | 日期时间 | 消息发送时间（子记录） |
| 发送人 | 人员 | 发送人（子记录） |
| 消息内容 | 长文本 | 消息完整文本 |
| 图片 | 附件 | 消息图片（子记录） |
| 消息链接 | 超链接 | 原消息链接（表内可建列，服务端暂不写入） |
| 消息ID | 文本 | 表内可建列，服务端暂不写入 |
| 群聊ID | 文本 | 表内可建列，服务端暂不写入 |
| parentId | 关联 | 父记录 ID（关联本表自身） |

**表4：每日语录（表ID: tbl_quote）**

| 字段名 | 字段类型 | 说明 |
|--------|----------|------|
| words | 文本/长文本 | 语录内容 |
| person | 文本 | 作者/出处 |

### 三、配置后端服务

1. 安装依赖并配置环境变量：
```bash
cd server
npm install
copy .env.example .env
```

2. 编辑 `.env` 文件：

```env
# 飞书应用
APP_ID=cli_你的AppID
APP_SECRET=你的AppSecret

# 多维表格
BITABLE_APP_TOKEN=bascn_多维表格AppToken
BITABLE_PROJECT_TABLE_ID=tbl_项目表ID
BITABLE_LOG_TABLE_ID=tbl_日志表ID
BITABLE_KEYWORD_TABLE_ID=tbl_关键词表ID
BITABLE_QUOTE_TABLE_ID=tbl_语录表ID

# 事件订阅（统一由 feishu-gateway 持有长连接，本服务走 HTTP 回调）
FEISHU_USE_LONG_CONNECTION=false

# 机器人名称
BOT_NAME=爆米花机-对话型

# === 4 个播报群（对应 4 个人员字段）===
OWNER_WEBHOOK_URL=owner群机器人webhook
OWNER_CHAT_ID=owner群聊ID

DKYJ_WEBHOOK_URL=dkyj组机器人webhook
DKYJ_CHAT_ID=dkyj组群聊ID

SJ_WEBHOOK_URL=sj组机器人webhook
SJ_CHAT_ID=sj组群聊ID

XY_WEBHOOK_URL=xy组机器人webhook
XY_CHAT_ID=xy组群聊ID

# === 负责人群整合播报（2026-09-22 起；两者都空 = 功能关闭）===
LEADER_WEBHOOK_URL=负责人群机器人webhook（优先）
LEADER_CHAT_ID=负责人群群聊ID（webhook 为空时走 im API 发卡）
LEADER_MENTION_OPEN_ID=卡头@对象open_id（如章子赫）
LEADER_MENTION_NAME=卡头@对象名字

# 关键词监听群聊 ID（该群的全部发言会被记录）
KEYWORD_CHAT_ID=

# 关键词回答表的监听群范围（只作用于未@机器人的群消息；逗号分隔，'*' 或留空 = 所有群，与 KEYWORD_CHAT_ID 无关）
# @触发回答表不读本项：它靠「群里@机器人」这个门禁，全群可用
# AUTO_REPLY_CHAT_IDS=

# 会议提醒监控群（已不生效：当前实现监听所有群）
MEETING_CHAT_IDS=

# 服务器
PORT=3000

# 定时任务（默认每天 12:05——与 duty-bot 12:00 看板播报错峰防 bitable 限频）
CRON_SCHEDULE=0 5 12 * * *

# DDL 预警天数
DDL_ALERT_DAYS=2

# 3D 打印服务（/print-* 转发目标）
PRINT_SERVER_URL=http://localhost:3001

# 审批群（群内指令整体切换为 /approval-*，转发 approval-bot）
APPROVAL_CHAT_ID=
APPROVAL_SERVICE_URL=http://localhost:3002

# ticket-bot（DDL 卡「未结单工单」按组分栏取数）
TICKET_BOT_URL=http://localhost:3003

# 私聊指令白名单（留空 = 私聊指令对所有人关闭，fail-closed）
P2P_COMMAND_OPEN_IDS=
P2P_COMMAND_CHAT_IDS=
```

3. 启动服务：
```bash
npm start
```

### 四、配置事件订阅

**统一网关模式（2026-09 起，推荐）**：

1. 飞书开发者后台 → 事件订阅：订阅方式选择「通过长连接接收事件」，添加事件 `im.message.receive_v1`
2. 长连接由 **feishu-gateway**（本机 :3010）统一持有，事件转发到本服务 `POST /api/feishu/event`
3. 本服务 `.env` 设置 `FEISHU_USE_LONG_CONNECTION=false`（长连接与 HTTP 回调同一套消息处理管道，见 `eventSubscription.js` 的 `handleMessageEvent`）

> 不要再让本服务自己开长连接：共用应用的多条长连接会被飞书**随机分发**事件，导致指令时灵时不灵。HTTP 回调模式（公网 HTTPS 直连）仍可用：设置 `FEISHU_USE_LONG_CONNECTION=false` 并配置 `FEISHU_VERIFICATION_TOKEN` / `FEISHU_ENCRYPT_KEY`。

### 五、配置发言记录

编辑 `server/src/config/keywords.json`：`enabled` 控制记录开关。自 v23 起记录目标群的**全部发言**（父记录固定「全部发言」），`keywords` 数组仅保留展示兼容，不再参与过滤。

### 六、配置群机器人

1. 在 4 个播报群中分别添加「自定义机器人」
2. 记录各群的 Webhook 地址和群聊 ID
3. 分别填入 `.env` 的 `OWNER_/DKYJ_/SJ_/XY_` 对应变量
4. 将应用（机器人本体）添加到需要对话/监听回复的群

### 七、部署前端小组件

```bash
cd widget
npm install
# 配置 app.json 中的 appID 和 blockTypeID
npm start        # 本地调试
npm run upload   # 上传发布
```

> **注意**：小组件的 API 地址是构建期内联常量（`src/api.ts` 的 `API_BASE`，webpack 注入），
> 默认 `http://localhost:3000/api`。小组件在用户浏览器的飞书文档内嵌页里运行，
> 发布前必须把 `API_BASE` 改成用户可达的地址（并注意 HTTPS 页面调 HTTP 接口的 mixed-content 限制）。

## 一键部署（Git + NAS）

修改代码后，在项目根目录运行：

```bash
node push.js "提交说明"
```

脚本会自动完成：`git add` → `commit` → `push` → NAS `git pull` → `pm2 restart`。

## API 接口

### 项目管理
| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/projects` | GET | 获取项目列表 |
| `/api/projects/hierarchy` | GET | 获取项目层级列表（父子树） |
| `/api/projects` | POST | 创建项目 |
| `/api/projects/:id` | PUT | 更新项目 |
| `/api/projects/:id` | DELETE | 删除项目 |
| `/api/projects/ddl-alerts?days=7` | GET | 获取 DDL 提醒 |

### 机器人
| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/bot/test-broadcast` | POST | 测试 DDL 播报（今日已播报过时返回 `skipped:true` 不重复发送） |
| `/api/bot/history` | GET | 获取播报历史 |
| `/api/bot/cron-status` | GET | 定时任务状态 |

### 关键词/发言记录
| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/keywords/config` | GET | 查看记录配置 |
| `/api/keywords/records` | GET | 获取记录列表（支持层级） |
| `/api/autoreplies/config` | GET | 查看关键词自动回答表（「关键词回答」表，独立功能） |
| `/api/autoreplies/mention-config` | GET | 查看 @触发回答表（仅群里 @机器人 命中，优先级高于上表） |
| `/api/lottery/rules` | GET | 查看抽奖配置（触发词/奖品/概率，`.local.json` 优先） |
| `/api/lottery/rules` | POST | 新增/更新奖池（需 `X-API-Token`；`{keywords:[], answersText:"奖品\|概率 每行一条"}`） |
| `/api/lottery/rules/delete` | POST | 删除奖池（需 `X-API-Token`；`{keywords:[]}`） |
| `/api/lottery/enabled` | POST | 启停抽奖（需 `X-API-Token`；`{enabled}`） |

### 维护日志
| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/logs` | POST | 写入维护日志 |
| `/api/logs` | GET | 获取维护日志列表 |

## 定时任务

- **DDL 播报**：每天 12:05 执行（2026-09-19 起，与 duty-bot 12:00 值日播报错峰；可通过 `CRON_SCHEDULE` 配置，时区 Asia/Shanghai）
- **失败重试**：限频错误（11232/TooManyRequest）与瞬时网络错误（超时/断连/自签证书劫持/DNS 失败，2026-09-21 v103 起）同走退避重试，最多 3 次（30s/60s），全程留在白天窗口不触晚间静默；已送达群跨重试去重（`deliveredGroups`），不会重复播报；全部失败当日可用 `/api/bot/test-broadcast` 或各群 `/test-ddl` 补发

## 开发说明

### 技术栈
- 前端：React 18 + TypeScript + Webpack
- 后端：Node.js + Express
- 数据存储：飞书多维表格（Bitable）
- 定时任务：node-cron
- 飞书 SDK：@larksuiteoapi/node-sdk

### 测试
```bash
node server/scripts/stub-test-duty-branch.js   # 值日分支 + 关键词回答 + 抽奖链路 stub 测试（不触飞书）
```
`npm run push` 部署前自动跑（测试不过不部署，`SKIP_TESTS=1` 可跳过）；新增行为须带新断言。

### 注意事项
1. 确保飞书应用已开通相应权限
2. 多维表格字段名需与代码严格一致（尤其 `dkyjcontributers` / `sjcontributers` / `xycontributers`）
3. 机器人 Webhook 地址请妥善保管
4. 生产环境使用 PM2 管理进程

### 生产部署（PM2）
```bash
npm install -g pm2
pm2 start src/index.js --name knowledge-tracker
pm2 save
pm2 startup
```

## 版本历史

### v1.6.0
- 播报群扩展为 4 个（owner / dkyj / sj / xy），对应 4 个人员字段，逐群只播报相关项目
- DDL 播报仅针对 `in_progress` 和 `waiting` 状态
- 同一 webhook / 群聊 ID 自动去重，修复机械组重复播报问题
- 新增会议卡片提醒：监听机器人所在所有群，检测到会议卡片自动 @所有人
- 修复 @提及文本乱码，改用富文本（post）渲染
- 逾期确认群聊问询隔离，仅在原群监听回复，避免串群
- 新增 `push.js` 一键部署脚本（Git + NAS）

### v1.5.0
- 新增逾期项目私聊确认功能
- 新增每日随机语录功能
- 修复 DDL 播报卡片日期显示、私聊消息未被处理等问题

### v1.4.0
- 新增机器人对话功能，支持 /help、/status、/test-ddl、/keywords、/history 指令
- 支持飞书长连接事件订阅模式

### v1.3.0
- 新增群聊关键词监听功能
- 前端新增「关键词监听」Tab

### v1.2.0
- 移除知识库同步模块，精简项目结构

### v1.1.0
- 新增维护日志功能
- 新增项目父子层级结构支持

### v1.0.0
- 初始版本
