# DEVLOG · project-management-robot（knowledge-tracker · 对话枢纽/项目管理机器人）

版本隔离单位：一次 `npm run push`（= 一次 git 提交 + 一次部署）。v1~v47 于 2026-09-04 按提交历史回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](../../AGENTS.md)）。

当前最新：**v82**（2026-09-13，随本提交落地）。

## 阶段十二 · 评审批修（2026-09-05）

### v53 · 2026-09-05 · fix（随本提交落地，无独立哈希）
**DDL 确认防误判 + 降级口径对齐 + 播报状态后置落盘（跨项目评审批修）**
- `server/src/services/ddlConfirmService.js`：p2p 发出的逾期确认**只能私聊回复**（原 `sentMode==='p2p'` 接受任意来源，群里含「是」的日常消息会被当成确认直接把项目状态改成 completed）；`parseConfirmationReply` 删除 contains 宽松分支（≤10 字含「是」即 yes）、只认整句确认/否认词表（新增常用变体：做完了/搞定了/好/没问题/还没 等），防"你是谁""是的（附和他人）"误判。
- `server/src/services/ticketCloseService.js`：降级直读链路（ticket-bot 不可用时）的工单分栏播报对象改**指定负责人 → 补充负责人**（原取「当前处理人」，与 ticket-bot 主链路 `unclosedService` 及两项目文档约定不一致，降级日分栏负责人口径会漂移）；多人并集「、」拼接。`config.js` 新增 `TICKET_ASSIGNEE_FIELD`/`TICKET_SUPPLEMENT_FIELD`（默认值即用，NAS .env 无需必配）。
- `server/src/cron/index.js`：DDL 播报「今日已播报」标记改**至少一群送达后落盘**（原进门即写状态文件，当天发送全败也会被标记吞掉、播报静默丢失）；全部失败当天可 /test-broadcast 重跑，部分成功用各群 /test-ddl 补发（不受标记限制）。
- `server/src/services/chatService.js`：`/test-ddl` 在未配置播报的群聊里拒绝执行（防测试卡经 owner webhook 兜底跨群打到 owner 群）；私聊管理员保留 owner 群兜底；指令 handler 透传 chatType。
- 联动备注：ticket-bot v49 同批修复多组别工单漏播（审批节点「；」拼接拆段匹配）+ 多人接单续接窗口 + 接单整句匹配等；本仓库改动与其无接口变更，仅行为修正。

## 阶段十一 · 工单分栏接口超时兜底（2026-09-05）

### v52 · 2026-09-05 · fix（随本提交落地，无独立哈希）
**DDL 播报工单分栏：ticket-bot 分组 API 请求加 10s 超时**
- `server/src/services/ticketCloseService.js`：`getGroupedBuckets` 的 fetch 加 `AbortSignal.timeout(10s)`。此前 ticket-bot 假死（端口存活但不响应）时要等 undici 默认 ~300s 头部超时才降级，正午播报会被拖住；现在 10s 未响应即走「全群共用同一份」降级，最终兜底（不含工单分栏）不变。
- 10s 为冷缓存余量：分组接口对无 `USER_GROUPS` 映射的负责人要逐人查通讯录部门。超时/拒连均由 cron 既有 try/catch 捕获，降级链路与日志行为不变。

## 阶段十 · 私聊失败群聊降级移除（2026-09-05）

### v51 · 2026-09-05 · fix（随本提交落地，无独立哈希）
**DDL 逾期确认移除"私聊不成→群聊 @ 降级"链路**
- 实测确认机器人可直达所有在册员工私聊（无需先建联），230013 仅出现在离队/未激活账号，群聊降级失去存在场景。
- `server/src/services/ddlConfirmService.js`：删除 `sendOverdueConfirmation` 的 230013→`sendTextToChat` 群聊降级分支及配套 `groupText`/`getOwnerGroup` 调用；230013 改为安静失败日志（疑离队/未激活）。私聊成功路径与 `sentMode: 'p2p'` 回复匹配不变。
- 保留（无害残留）：`handleReply` 的 group 分支与 `config.getOwnerGroup`——降级不再产生 `sentMode: 'group'` 记录后自动失效，未删以减少对 hub 管道的触碰面。

## 阶段九 · 指令边界收紧（2026-09-05）

### v50 · 2026-09-05 · docs（随本提交落地，无独立哈希） · fix
**会议提醒卡片识别对非 JSON 字符串 content 安全降级（消除 error 日志噪音）**
- 全量 debug 发现：meetingReminderService 扫群消息时，system 等消息形态的 content 是非 JSON 字符串，JSON.parse 抛错刷 `[会议提醒] 解析会议卡片失败` error（有 catch 兜底、功能无损）。改为解析失败直接按无卡片处理，行为不变、日志恢复干净。

### v49 · 2026-09-05 · docs（随本提交落地，无独立哈希） · feat
**指令仅群内触发；私聊指令仅管理员白名单可用（对话枢纽统一门禁）**
- `server/src/services/chatService.js`：私聊（p2p）收到 / 指令时先过白名单（`P2P_COMMAND_OPEN_IDS`/`P2P_COMMAND_CHAT_IDS`，sender open_id 与 p2p chat_id 任一命中），未命中回复「指令仅支持在群聊中 @机器人 使用」；群聊照旧（@机器人门禁 + 回复到来源群）；私聊普通对话不受限。
- `server/src/config.js` 新增 `p2pCommandAllow` 白名单配置；`.env.example` 补充说明；本地 .env 已配置管理员 open_id。
- /approval-* 与 /print-* 指令由此在转发前统一收口，approval-bot / bambu 的 `/api/chat/command` 契约不变。
- 同批补交 v48 建档条目（昨日「当前最新」头部与阶段七段落遗留未提交）。

## 阶段七 · 开发历史建档（2026-09-04）

### v48 · 2026-09-04 · `b57fae5` · docs
**新增 DEVLOG 开发历史 v1~v47（按 push 回溯建档）；.env.example BOT_NAME 示例修正为爆米花机-对话型**
- 本 DEVLOG 诞生：v1~v47 按提交历史回溯编号，此后每次 push 追加一版（规则见顶层 AGENTS.md「开发日志（DEVLOG）」节）；
- `server/.env.example` 的 BOT_NAME 示例从「爆米花机_财务型」修正为真实对话型机器人名（与 approval-bot v10 同源修正）。

## 阶段一 · 立项与 CI/部署链路（2026-07-09 ~ 07-10）

### v1 · 2026-07-09 · `ad952c2` · init
**Initial commit - 千里项目管理机器人**
- server（飞书长连接 + 关键词/项目/日志 service + cron）与 widget（DDL 看板小程序）双端齐发。

### v2 · 2026-07-09 · `038ddbb` · chore
**Add GitHub Actions CI workflow**

### v3 · 2026-07-09 · `e0bb0aa` · chore
**Update deploy workflow - add production flag**

### v4 · 2026-07-09 · `79c1457` · fix
**Update deploy workflow - support custom SSH port**

### v5 · 2026-07-10 · `01bcf33` · feat
**添加NAS部署脚本和机器人对话功能**

## 阶段二 · DDL 播报/逾期确认/语录/会议提醒成形（2026-07-12 ~ 07-15）

### v6 · 2026-07-12 · `cc54e36` · feat
**添加逾期项目owner私聊确认功能**
- `ddlConfirmService.js` 诞生。

### v7 · 2026-07-12 · `9969252` · fix
**p2p消息未被chatService处理**

### v8 · 2026-07-12 · `3b8890f` · fix
**DDL播报卡片日期显示**

### v9 · 2026-07-12 · `57313c7` · feat
**DDL播报卡片增加随机语录栏目**

### v10 · 2026-07-12 · `ca1e6e1` · fix
**语录改为单行 by 格式**

### v11 · 2026-07-12 · `d4ac019` · docs
**更新README，补充v1.4.0和v1.5.0功能说明**
- README 内曾自有 v1.x 语义版本，本 DEVLOG 统一改按 push 序号编号。

### v12 · 2026-07-12 · `a001b8a` · fix
**DDL播报频率限制重试 + 逾期确认条件修复**

### v13 · 2026-07-15 · `bf14d46` · feat
**新增会议提醒功能**
- `meetingReminderService.js` 诞生。

### v14 · 2026-07-15 · `5852414` · fix
**会议提醒@所有人格式修正，移除多余的关键词提示行**

### v15 · 2026-07-15 · `6dd080e` · feat
**双机器人DDL播报 - owner过滤和contributers过滤**

### v16 · 2026-07-15 · `70e67a9` · feat
**群聊指令隔离 - 不同群触发不同机器人播报**

### v17 · 2026-07-15 · `b05e88f` · fix
**会议提醒@所有人使用飞书正确的at格式**

## 阶段三 · 稳定性修复期（2026-07-18 ~ 07-28）

### v18 · 2026-07-18 · `d6f5a21` · fix
**修复DDL播报重复和定时任务启动问题**
- 部署脚本在这轮膨胀出 auto/deploy-cleanup/deploy-tree 多套并存。

### v19 · 2026-07-18 · `df181bb` · fix
**修复定时任务 nextDates API 兼容性问题**

### v20 · 2026-07-20 · `e1c4194` · fix
**修复重复播报和会议提醒去重问题**

### v21 · 2026-07-22 · `7ff8a90` · fix
**修复群聊逾期确认@mention格式和反复触发问题**

### v22 · 2026-07-22 · `2d1ceea` · fix
**修复DDL播报重复触发问题**

### v23 · 2026-07-25 · `05aeddd` · feat
**将关键词监听改为记录所有发言**

### v24 · 2026-07-25 · `e6669e2` · feat
**优化项目层级播报逻辑**

### v25 · 2026-07-25 · `1611f63` · fix
**独立项目与大项目同级播报**

### v26 · 2026-07-25 · `35da99c` · chore
**remove temporary deploy script**

### v27 · 2026-07-28 · `ec25ad7` · fix
**持久化DDL播报去重状态，防止重启后重复播报**

## 阶段四 · 4 群播报与会议卡片识别（2026-08-28 ~ 08-29）

### v28 · 2026-08-28 · `a605ce4` · feat
**4群播报框架 + @修复 + 群聊问询隔离**

### v29 · 2026-08-28 · `30279ae` · fix
**修正 NAS SSH 端口为 8500**

### v30 · 2026-08-28 · `b8073d8` · fix
**机器人对话功能在所有群响应@提及**

### v31 · 2026-08-28 · `fed0609` · refactor
**会议提醒仅监听会议卡片消息**

### v32 · 2026-08-28 · `bd9b44a` · debug
**添加会议卡片类型调试日志**

### v33 · 2026-08-28 · `f315627` · feat
**添加 video_chat 类型检测（群聊视频会议卡片）**

### v34 · 2026-08-28 · `312ff94` · chore
**添加一键部署脚本 push.js**
- 部署链路从此统一为 `npm run push`，本 DEVLOG 的版本隔离单位自此严格成立。

### v35 · 2026-08-28 · `2170277` · chore
**移除临时调试脚本**

### v36 · 2026-08-28 · `5f82435` · fix
**修复会议提醒因 message 变量未定义导致 @全体 不触发**

### v37 · 2026-08-29 · `942eaf3` · docs
**更新 README，移除失效内容并同步 4 群播报与会议提醒等最新功能**

## 阶段五 · DDL 联动工单域（2026-08-31 ~ 09-01）

### v38 · 2026-08-31 · `4b317e1` · fix
**修复DDL播报卡片@人失效——卡片at标签改回 id= 属性并增加负责人名回退**

### v39 · 2026-08-31 · `63b2733` · feat
**DDL播报状态语义扩充——无DDL不播报、died截止不管理、pending暂停单独说明、waiting待认领并联动ticket-bot未接单播报**

### v40 · 2026-08-31 · `0d99993` · feat
**审批群指令能力切换为财务相关（转发 approval-bot）**
- hub 分发职责成形：/approval-* → approval-bot。

### v41 · 2026-08-31 · `04cfd5b` · feat
**每日播报联动ticket-bot未结单工单——按理想结单时间加2日内加急与7日内待结单分栏**
- `ticketCloseService.js` 诞生，消费 ticket-bot 分桶 API。

### v42 · 2026-09-01 · `7917e9b` · feat
**统一事件网关接入（HTTP 消费 + 完整消息管道）；push.js 升级与密钥分离**
- 架构转折点：自有长连接下线，成为 feishu-gateway 之下的对话枢纽（hub）。

### v43 · 2026-09-01 · `b8cf383` · fix
**DDL播报重试只补发失败群（避免重复卡片）；移除联动工单汇总播报；放宽body限制**

### v44 · 2026-09-01 · `60cf237` · fix
**push.js 增加 NAS git fetch 失败自动转 SFTP 直传的兜底**

### v45 · 2026-09-01 · `f7c1c64` · feat
**DDL 未结单工单分栏改为按负责人组别分组播报（各组只看本组工单，播报对象为指定/补充负责人）**

## 阶段六 · 会话边界文档（2026-09-02 ~ 09-03）

### v46 · 2026-09-02 · `d0c8db9` · docs
**增加项目职能边界声明（发错会话防护，需求错位即提醒停手）**

### v47 · 2026-09-03 · `a39f982` · docs
**AGENTS.md 增加「顶层规则与交互性」段（独立会话内联交互契约，开工先读顶层总表）**

## 阶段七 · 全项目审查修复批次（2026-09-06）

### v54 · 2026-09-06 · 随本提交落地 · fix
**全项目审查修复：停用冲突的 Actions 部署 + p2p 双调 + /test-ddl 等价补发 + 文档对齐**
- deploy.yml 触发改 workflow_dispatch：原 push 自动部署与 npm run push 双链路并存，且其生成的 .env 模板（PORT=2174、FEISHU_USE_LONG_CONNECTION=true、缺 TICKET_*/P2P_* 等键）会覆盖 push 上传的正确配置，属生产隐患。
- eventSubscription：p2p 消息处理完显式 return（原先落到群聊管道再次调用 chatService，靠消息去重副作用短路，日志连打两条干扰排障）。
- /test-ddl 补齐「未结单工单分栏」与「意外暂停项目」区块（与正式播报同数据源、同降级链路），部分失败补发卡与正式卡等价；widget 测试播报对「今日已播报过」如实提示（原弹「已发送」假成功）；/status 网关模式下事件接入不再显示 ❌；/help 补 /approval-* 财务指令说明。
- requestAPI 加 15s 超时与非 JSON 响应可读报错（原 fetch 无超时可无限挂起，网关错误页会以 SyntaxError 掩盖真实错误）。
- 文档对齐：README/LOGIC-MAP 关键词监听描述改为「记录全部发言」（v23 起现状，keywords.json 仅展示兼容）、问询走私聊（v51 起）、waiting 联动 ticket-bot 播报的过时描述删除、API 表/env 模板补全（TICKET_* 两键、MEETING_CHAT_IDS 不生效标注）；widget KeywordTracker 文案同步。
- 版本线备注：v48~v53 期间条目未及时入档，版本号以 git 提交消息为准（b0a3608=v53），本条起恢复逐 push 记录。

## 阶段八 · 晚间静默——播报时段限制（2026-09-06）

### v55 · 2026-09-06 · 随本提交落地 · feat
**02:00–09:00（Asia/Shanghai）静默窗口：DDL 播报（含逾期确认私聊）积压到 09:00 统一补跑（可配可关）**
- 新增 `server/src/utils/quietHours.js`（顶层 AGENTS.md「晚间静默」规则的本仓实现）：DDL 每日播报 cron 触发落在窗口（`QUIET_HOURS_START/END` 默认 2→9，支持跨午夜写法，`QUIET_HOURS_DISABLED=1` 关闭）内时登记积压（`.quiet-backlog.json` 持久化，重启不丢），窗口结束整点重跑整个 `runDDLBroadcast`——以补发时刻的项目/工单数据重查并逐群重播，逾期确认私聊（同一任务流后续步骤）一并顺延；启动时过点立即补冲刷，冲刷失败保留重试 ≤3 次。
- 「今日已播报」标记本就在至少一群送达后才落盘，冲刷补跑与当天正常触发天然互斥（补跑成功即标记，当天正点触发自动跳过）。
- 现状默认调度 12:00 不在窗口内，本改动为规则兜底：调度改进窗口或积压跨重启时自动生效。
- 豁免：`/test-ddl`、`/test-broadcast` 人工触发与对话/指令回复（DDL 确认"是/否"）不受限；`getCronStatus` 附 `quietHours` 状态。
- 文档：ticket-pm/LOGIC-MAP.md §2.2 补第 6 条；顶层 AGENTS.md 新增「晚间静默」规则段。

## 阶段九 · DDL 卡「无人接单」分栏（2026-09-06）

### v56 · 2026-09-06 · 随本提交落地 · feat
**DDL 播报新增「无人接单工单」分栏（取数 ticket-bot unclosed API 新增 unclaimed 桶；v55 晚间静默同批上线）**
- `server/src/feishu/bot.js`：`buildDDLReportCard` 在结单分栏前新增「🆘 无人接单工单（超6小时无人响应）」——只列标题与已发布时长（≥24h 按天、否则按小时）不 @（群内问询/组长私聊升级由 ticket-bot 超时检查承担），降级链路的工单附带组别名；`sendDDLReport` 默认桶补 `unclaimed: []`，旧结构无该键按空处理（渲染处 `|| []` 兜底）。
- `server/src/cron/index.js`、`chatService.js`（/test-ddl）：分栏数据初始化与汇总日志补 `unclaimed`；主链路按群分组、降级链路全群共用，行为与结单分栏一致。
- `server/src/services/ticketCloseService.js` 降级直读链路补同款无人接单分桶（触发节点拆段匹配 + 补充负责人为空 + 距发起 ≥6h，口径与 ticket-bot unclosedService 对齐）；顺带把服务端等值过滤改全量拉取 + 本地拆段匹配（「；」拼接节点值等值过滤静默漏桶，与 ticket-bot v50/v52 同款整改）；`config.js` 新增 `TICKET_ACCEPT_VALUES`/`TICKET_ROUTE_FIELD`（默认值即用，NAS .env 无需必配）。
- 联动部署顺序：ticket-bot v52 先上（API 提供方），本仓 v56 随后。

## 阶段十 · 例行维护纠偏（2026-09-06）

### v57 · 2026-09-06 · 随本提交落地 · fix
**全仓例行 debug 扫描——降级直读链路拆段分隔符与 ticket-bot 对齐 + README/文案对齐**
- `ticketCloseService.matchNodeAny` 拆段分隔符原为 `/[；;、]/`，比 ticket-bot `config.splitNodeValues`（`;；,，、|`）少 `,` `，` `|` 三种：节点值若以这三者拼接，主链路（API）命中而降级直读链路整串匹配不上、分栏静默漏桶——补齐字符类（LOGIC-MAP §5#9「两边降级直读链路口径必须一致」契约）。
- README：ticket-bot 联动段从「直接读源表」改写为 v45 后实际链路（主链路 unclosed-by-group API + 降级直读 + 双层降级），补 🆘 无人接单分栏（v56）与晚间静默说明（v55）；§结构树补 `ticketCloseService.js` 与 `utils/quietHours.js`。
- `server/.env.example` 补 `TICKET_ACCEPT_VALUES` / `TICKET_ROUTE_FIELD`（config.js 已读取、有默认值，此前清单缺漏）。
- 文案纠偏：`keywords.json` description 与 `/keywords` 指令提示去掉过时的「#标签触发」「需重启生效」说法（v23 起发言全量记录、loadKeywordsConfig 每次调用重读即改即生效）；widget 端 KeywordTracker 同款文案未随批改（需重新构建上传小组件，下次一并）。
- 已知边界（意图不明，未动）：API 成功路径下未命中 GROUP_ROUTES 的群回落空桶（降级路径却共用全群桶）；静默冲刷进行中新登记积压的调度窗口可能排到下一个 end 整点；`QUIET_HOURS_DISABLED=1` 时遗留积压不冲刷不清理（四仓同款行为，保持一致）。

## 阶段十一 · 关键词自动回复 + 监听插件带图修复（2026-09-06）

### v58 · 2026-09-06 · 随本提交落地 · feat
**新增「关键词自动回复」独立功能（本地回答表，命中即自动回答）+ 修复关键词监听插件带图消息整条丢失**
- 新增 `server/src/config/autoReplies.json`（关键词→回答本地表，改完即时生效无需重启）与 `server/src/services/autoReplyService.js`：群消息文本包含关键词即自动引用回复（@机器人/私聊提问同样命中且优先于欢迎语；同义词放同一条；多条命中合并一条回复）。防误伤：其他应用/机器人发出的消息不触发（防互答循环）、消息去重、指令优先、审批群始终排除。回复走 `replyTextMessage`，失败降级 `sendTextToChat`。
- **与原关键词监听插件分立**（用户要求）：自动回复群范围走新 env `AUTO_REPLY_CHAT_IDS`（逗号分隔，空或 `*` = 所有群，与 `KEYWORD_CHAT_ID` 无关）；指令 `/autoreply` 查看回答表，`/keywords` 还给监听插件；新增 `GET /api/autoreplies/config`。属对话回路，不受晚间静默限制。
- **监听插件故障修复**（NAS pm2 日志实锤：9/2 起带图消息持续 `WrongRequestBody: file token is invalid`，整条记录连文本一起丢）：根因是 IM 消息 `image_key` 不能直接作多维表格附件 file_token（飞书限制）。`client.js` 新增 `downloadImage`（GET /im/v1/images 二进制）+ `uploadMediaToBitable`（drive upload_all，parent_type=bitable_file，parent_node=base app_token）转存入库；单张失败只跳过该张，全部失败降级为无图记录（文本/时间/发送人保住）；保留 WrongRequestBody 兜底降级。需应用开通 `im:image`、`drive:file:upload` 权限（用户自行开通后自动生效，无需再部署）。
- 性能：`findOrCreateKeywordParent` 的「全部发言」父记录 ID 改内存缓存（原实现每条群消息全量分页扫整表，随发言增长必然拖垮），父记录被删时写入失败路径清缓存自动重扫。
- 文档：README 功能 §4（图片转存说明）/§9（自动回复）、API 表、项目结构树、`.env.example` 补 `AUTO_REPLY_CHAT_IDS`；`/help`、`/status` 同步。

### v59 · 2026-09-06 · 随本提交落地 · feat
**关键词回答表.xlsx 本地填写入口（push 自动转 JSON）+ 图片转存权限实测生效**
- 新增项目根目录 `关键词回答表.xlsx`：「关键词回答」工作表两列（关键词｜回答，同义词逗号/顿号/分号分隔放同一格，`#` 开头行=注释）+「使用说明」工作表；作为自动回答规则的**唯一填写入口**。
- 新增 `scripts/syncAutoReplies.js`（devDependency `xlsx@0.18.5`，仅本地转存用，NAS 生产不装）：xlsx → `autoReplies.json`，自动探测表头行（精确匹配「关键词」「回答」两格，防标题「关键词自动回答表」含词误判；直接按二维矩阵+列索引解析，规避 sheet_to_json 的 range 绝对行号与 `!ref` 起点错位坑——openpyxl 重存后 `!ref` 从 A1 变 B2，混用两套坐标系曾整表静默读空）；`enabled` 总开关沿用现有 JSON。`npm run sync:auto-replies` 可单独转存。
- `push.js` 部署流程开头新增 [0/4] 同步步骤：填表 → `npm run push` 一条命令转存+部署；同步失败仅告警不阻断部署（沿用现有 JSON）。JSON description 注明为生成物勿手改。
- 图片转存权限实测（用户已在开放平台开通）：伪造 image_key 探针报 234001 Invalid param 而非无权限（`im:image` ✅）；1px PNG 真实 upload_all 拿到 file_token（`drive:file:upload` ✅，multipart 链路端到端通）。本次部署重启 pm2 即刷新 token，带图消息图片即刻开始转存入库。
- README §9/结构树同步；`/autoreply` 指令、群范围 `AUTO_REPLY_CHAT_IDS` 说明不变。

### v60 · 2026-09-06 · ebfa332 · feat
**关键词回答表首条真实规则上线（近看石头大→远看大石头）+ GitHub 补推 v58/v59**
- 用户在 `关键词回答表.xlsx` 填入首条真实规则，sync 脚本转存 2 条规则（示例+真实）随部署生效；`npm run push` 全链路验证：表格→JSON→提交→部署，一条命令完成。
- Watt Toolkit 加速开启后 GitHub 恢复可达，补推 v58（029b511）/v60（ebfa332）两笔本地提交；NAS 拉取 GitHub 失败属常态，SFTP 兜底照常工作。
- 群内可直接验证：在任意群发「近看石头大」，机器人自动回复「远看大石头」（对话回路，不受晚间静默限制）。

### v61 · 2026-09-06 · 随本提交落地 · docs
**DEVLOG 补记 v60 锚点（ebfa332）**
- v60 代码随 push 落地时漏附 DEVLOG 条目，本条补记并随 docs 提交入库。

## 阶段十七 · 播报父子归属——父项目负责人归并到子项目（2026-09-08）

### v62 · 2026-09-08 · 随本提交落地 · feat
**项目看板父子归属：父项目负责人是总负责人，DDL 播报时视为其名下所有子项目也有他（按字段归并、id 去重，子项目自身负责人照旧）**
- 问题：DDL 播报按群过滤「对应人员字段有人」的项目，父子项目各算各的——子项目没自配某字段（如 owner）时，即使父项目该字段有总负责人，该子项目也不会出现在总负责人所在群的播报里，卡片行也无从 @ 总负责；逾期确认同样因「项目无 owner」静默跳过。
- 规则（按用户裁定）：播报时每个项目的「有效成员」= 自身各人员字段成员 ∪ 沿 parentId 链向上各祖先（父/爷…）同字段成员，按 id 去重（自身成员在前）。「视为所有子项目都有他」：父项目负责人在某字段 → 其名下未自配该字段的子项目也命中该群过滤；子项目自己配了的照旧生效（自身成员优先、合并显示不互踩）。
- 实现（`server/src/services/projectService.js`）：
  - `recordToProject` 保留 owner 完整列表（`ownerMembers`，User 多选原先是只取首个丢数组）；
  - 新增 `buildEffMembers`：扁平列表上沿 parentId 链按 5 个成员字段（owner/contributers/dkyjcontributers/sjcontributers/xycontributers）归并去重，结果挂 `item.effMembers`（记忆化，按项目 id 缓存）；播报副本节点经 ...spread 天然携带；
  - `mentionFieldChecks`（各群过滤）改用 `effMembers` 判断——父项目成员在字段 X → 其全部未自配 X 的后代项目进入 X 群播报树；无父项目时 eff=自身，行为与旧版完全一致；
  - 卡片行渲染（`server/src/feishu/bot.js` `getFieldMembers`）优先读 `effMembers`：叶子行 @/显示 = 子 ∪ 父同字段成员（去重后），同一行不重复 @ 同一人；
  - 逾期确认（`server/src/services/ddlConfirmService.js`）：`sendOverdueConfirmation` 的 owner 解析增加 eff 回退——子项目自身无 owner 时私聊确认发给父项目总负责（effMembers.owner 首位），ownerName 同步回退。
- 影响面：DDL 播报（cron）、`/test-ddl`（chatService）、逾期确认共用同一取数函数，一处改动全链路生效；`getDDLAlerts` 等其它接口不动；归并只作用于播报归属与卡片 @，不改写看板数据。
- 文档：README §2 DDL 播报补「父项目负责人归并（v62）」、§6 逾期确认补「子项目无 owner 回退父项目 owner」；DEVLOG 头部当前最新修正 v57→v62（v58~v61 期间头部指针未同步的历史遗留，一并修正）。
- 验证：离线桩测试 17 项断言全过——自身无 owner 的子项目因父总负责进 owner 群并渲染 @ 总负责；自身 owner 与父同人去重为 1 人；dkyj 成员归并 = 自身 ∪ 父（自身在前）；独立项目行为不变；逾期确认 A3（无自身 owner）私聊发父总负责、独立项目照旧发自身 owner。部署验证记录随部署补记。

### v62 · 2026-09-09 · 随本提交落地 · feat
**关键词回答表支持概率候选回复：回答列 / 分隔多候选 + 概率列加权随机抽取**
- 表格 v2（xlsx 重生成，保留用户全部现有规则）：表头扩为 关键词｜回答｜概率1/2/3…（回答列右侧顺延，可自行加列）；「使用说明」sheet 重写为 9 条规则；注释示例行说明写法。
- sync 脚本：回答列按 `/` 拆候选；概率列按候选顺序读取（0-100 整数校验，非法按留空告警）；权重规则——全留空=等概率、部分填=空候选均分剩余、全填未满 100=归一化、超 100=按比例压缩并告警、填 0=该候选永不触发；关键词/回答缺一仍告警跳过、`#` 注释保留。JSON schema 升级为 `replies[].answers[{text, weight}]`。
- 服务端 autoReplyService：新增 `pickAnswer`（权重累积随机抽取）与 `displayWeights`（展示层概率换算，单候选/等权显示均分百分比）；`buildReplyForText` 命中多条规则时逐条各抽一条合并；旧 `answer` 字符串格式兼容保留。`/autoreply` 展示升级为 候选+概率（如 `你好 20% / 哈喽 30% / 嗨 50%`）。
- 验证：解析分支（补全 60/20/20、等权、超和压缩、0 权重）实测通过；加权抽取 3 万次分布 59.9%/30.0%/10.1%±2% 通过；单测 7/7。
- 使用注意：回答内容勿含 `/`（候选分隔符）；改动表格后 `npm run push` 即生效。
- 附：补推用户提交 82ebe56（update: 代码更新，NAS 已含，GitHub 侧此前因网络未推）。

### v63 · 2026-09-09 · 随本提交落地 · feat
**关键词自动回复范围扩到机器人所在全部群（含财务审批群），与其他功能范围严格分立**
- `autoReplyService.processMessageEvent` 移除「审批群跳过」；`chatService` @机器人命中不再因 isApproval 置空——财务审批群内普通消息命中关键词同样自动回复；**指令路由不受影响**：审批群 `/approval-*` 仍整体转发 approval-bot，未命中关键词的对话仍回财务引导语。
- 范围分立确认（本次未动）：原关键词监听插件（KEYWORD_CHAT_ID=千里论坛 全量写多维表格）、会议提醒、DDL 逾期确认的监听范围逻辑保持原样；`AUTO_REPLY_CHAT_IDS` 留空 = 全群，可收窄。
- 文档：README §9 生效范围/防干扰改写（审批群不再排除、指令照常）；config.js 注释同步。本地验证：审批群与普通群命中均回复，3/3 通过。

### v64 · 2026-09-10 · 随本提交落地 · feat
**新增「@触发回答」表：只有群里 @机器人 才命中的第二张关键词表；私聊命中改为只提示面向群聊**
- 表格：`关键词回答表.xlsx` 新增「@触发回答」工作表（与「关键词回答」同构：关键词｜回答｜概率1-3、`#` 注释行、示例行），表序为 关键词回答 → @触发回答 → 使用说明；「使用说明」追加第 10-12 条（触发条件、命中顺序、私聊口径）。原有工作表数据逐行校验一致。
- 同步脚本 `scripts/syncAutoReplies.js`：改为「工作表 → JSON」显式映射，同一 xlsx 出两个 JSON——「关键词回答」→ `autoReplies.json`（内容不变）、「@触发回答」→ `autoRepliesMention.json`（新生成物，随仓库提交）；**去掉旧的“回落到第一个工作表”兜底**（三个工作表并存时会把 @触发表静默写进原 JSON）；工作表缺失只记提示跳过，不阻断部署、不动既有 JSON；导出 `syncAutoReplies()`（签名与返回兼容既有调用）+ `syncMentionReplies()` + `syncAllTables()`，CLI 与 push.js [0/4] 均按表逐行打印。
- `autoReplyService`：新增 `loadMentionRepliesConfig()`（缺文件静默当空表）、`buildMentionReplyForText()`（先 @触发表，命中即止；未命中回落原表；**跨表不合并**）、`hasKeywordHitForText()`（私聊检测用）；`processMessageEvent`（未@群消息路径）**只读原表**——@触发表在未@路径完全不参与。
- `chatService`：群里 @机器人 走 `buildMentionReplyForText`（命中日志带 `表: mention|group`）；**私聊改为不返回回答内容**——命中任一表只回「⚠️ 关键词自动回复仅面向群聊开放，请在群里 @我 使用。」，未命中仍是欢迎语，私聊指令白名单不变；`/autoreply` 分两段展示两张表（含概率）、`/status` 显示两表条数、`/help` 补一行。
- 接口：新增 `GET /api/autoreplies/mention-config`；原 `/api/autoreplies/config` 语义与返回不变。
- 文档：README §5 指令表补 `/autoreply`、§9 改写为双表（入口/命中顺序/私聊口径/双接口/工作表缺失降级）、结构树与 API 表同步、env 样例注明 `AUTO_REPLY_CHAT_IDS` 只作用于原表；`ticket-pm/LOGIC-MAP.md` §2.1 消息管道补上两个自动回复节点（此前完全缺载）。
- 验证：本地桩测试 31 项断言全过——两表解析 11/2 条；@时同名词取 @触发表那份、未命中回落原表、两表都不命中回欢迎语；未@路径对新表词不命中且不发任何消息、对原表词照旧命中；@触发表词在 `processMessageEvent` 下不命中；私聊命中任一表均只回提示语、未命中回欢迎语；`/autoreply`、`/status` 文案；@触发表 JSON 缺失静默降级并回落原表；工作表缺失时同步记 reason 且不改动既有 JSON。
- 随本批补交：`关键词回答表.xlsx` 新增「@触发回答」工作表（同样式副本：标题字体/表头填充/列宽/合并保留，正文在 B 列起），「使用说明」补第 10-12 条；写入用 openpyxl，保存后追加一步把各 XML 部件的非 ASCII 数字实体还原成 UTF-8 原文——**openpyxl 会把所有非 ASCII 写成 `&#N;`，而同步脚本用的 SheetJS 解析星平面字符（emoji 如 🐖）会读成空串，会让规则静默失效**；写入前后逐格比对（含坐标）一致，重写后解析结果与原件逐字节一致，🐖 规则完好。不用其它工具随意重写本工作簿。
- 部署后补记：本次 push 时 GitHub 不可达（`Failed to connect to github.com:443`），NAS 侧走 SFTP 直传兜底（NAS git HEAD 停在上一提交，内容一致）；后经 Watt Toolkit 加速恢复可达后补推成功。

### v65 · 2026-09-11 · 随本提交落地 · feat

**hub 值日分支（duty-bot :3006 联动）+ 值日专用群限制 + 隐私整改**

- `chatService.handleDutyBranch`（先于其它能力）：① p2p 图片最小转发 `{type:'image', openId, imageKey, messageId}`（duty-bot 自行下载转存）② 值日专用群（`DUTY_CHAT_ID`，快递申领群）hub 基础指令与对话整体关闭、仅放行「值日助手」看板 ③ p2p 值日指令（值日助手/我要请假/查询我的下一次值日/绑定 X/是/否/生成排班表）**不受 P2P 指令白名单限制**放行（名册成员人人可用）
- `config.duty`：serviceUrl（DUTY_SERVICE_URL，默认 :3006）+ chatId（DUTY_CHAT_ID，兼播报目标群）；/help 补值日指令段
- 隐私整改：关键词回答表支持 `.local.json` 私有覆盖（真实回答不入 git，push.js 显式 SFTP 上 NAS），仓库模板脱敏；`server/.env.example` 与 `config.js` 移除硬编码审批群号（.env 必配）；DEVLOG 人名脱敏
- `server/.env` 新增 `DUTY_CHAT_ID` / `DUTY_WEBHOOK_URL` / `DUTY_BROADCAST_SCHEDULE`（值日播报 M4 备用，随本批上 NAS）
- 测试：`server/scripts/stub-test-duty-branch.js` 10 项（占位 duty 服务 + bot 回复捕获），全过

### v66 · 2026-09-11 · 随本提交落地 · fix

**全仓审计 debug 批：/test-ddl 参数错位修复（P1）+ 值日群关键词回答关闭 + 健壮性**

- P1：`handleTestDDLCommand` 签名改为 (args, chatCtx, chatType)——v53 改调用约定时漏改函数签名，导致「非播报群守卫」恒失效（任意群 /test-ddl 都会把测试卡打进 owner 群）、各群补发不等价、工单分栏恒缺
- 值日专用群（DUTY_CHAT_ID）未@消息的「关键词回答」关闭（isChatAllowed 排除），与 AGENTS「该群仅放行值日助手」声明对齐
- DDL 确认：p2p 图片消息不再误回「未识别你的回复」，静默交后续链路（值日照片凭证）
- p2p 值日指令转发透传 messageId（duty-bot 侧做消息幂等）
- `.env.example` 补 DUTY_SERVICE_URL / DUTY_CHAT_ID / DUTY_WEBHOOK_URL / DUTY_BROADCAST_SCHEDULE
- quietHours 积压文件支持 QUIET_BACKLOG_FILE 挪出项目目录（SFTP 部署清目录不再丢积压；本次仅加能力，生产路径待运维定）
- 回归：stub-test-duty-branch 10 项全过

### v67 · 2026-09-11 · 随本提交落地 · fix

**DDL 播报「已逾期 / 2天内到期」两栏内容重复修复（跨栏泄漏）**

- 根因：`getDDLForBroadcastWithHierarchy` 三栏返回的是同一棵剪枝树按「根节点有无该类后代」（`hasQualifiedDescendant`）过滤的结果——父组名下跨类（既有逾期子项又有临期子项，或父项自身逾期、子项临期）时，同一根节点同时进多个数组；而 `renderTreeNode` 只看节点自身 `ddlCategory`、永远画整棵子树 → 同一棵子树在两栏逐字节重复，连分栏计数（`countQualifiedNodes` 数整棵子树合格节点）都一样。
- 修复：`server/src/services/projectService.js` 新增 `filterTreeByCategory`——三个分栏（overdue/urgent/week）改为各自按类过滤后的独立子树：只保留本类合格节点与通往它们的祖先容器（容器照旧渲染 📁 组头）；`hasChildren` 按过滤结果重算（自身合格但子项全被滤掉的节点降级为叶子行，保住自己的状态文案，不再渲染成空组头）；`isQualified` 同步收敛为本类合格（跨类充当容器的节点不再被计入本栏数量，分栏标题 N 与栏内可见行数一致）。
- 删除死代码：`collectByCategory`（早期平铺方案残留，全仓无调用者）、`hasQualifiedDescendant`（被新函数取代）。
- 不受影响（已核对）：逾期确认链路（cron 只收 `ddlCategory==='overdue'`，overdue 树仍完整含全部逾期节点）；工单分栏（ticket-bot 域，超期+临期混栏是既有设计，未动）；`/test-ddl` 补发与 `/history` 计数（口径变得更准）。
- 验证：本地桩测 15 项断言全过（传 `preloadedProjects` 不触网：机械组式跨类容器两栏互斥、合格父项跨类当容器、分栏计数一致、逾期确认仍收全、`fullHierarchy`/`paused` 不变）；`node -e "require('./src/config')"` 通过。

### v68 · 2026-09-11 · 3501bb5 · feat

**值日专用群（快递申领群）关键词自动回答放行——群监听"占得太死"松绑**

- 背景：v65/v66 把 DUTY_CHAT_ID 群设为"仅放行值日助手"后，群里 @机器人发关键词彩蛋被 🧹 提示顶掉（NAS 日志实录：@「大狗大狗请叫叫」→ 值日分支拦截）、未@关键词也全哑火；用户反馈"占得太死"，要求恢复之前的关键词自动回答能力。
- `chatService.handleDutyBranch` 分支②：@消息先认「值日助手」出看板（不变）；新增 `buildMentionReplyForText` 关键词命中照常回答（先「@触发回答」后「关键词回答」，与他群 @ 命中同款，日志行「值日群关键词自动回复命中」）；未命中回改写后的值日群引导语（不再声称"仅开放看板"，改为"关键词彩蛋照常有效"）。基础指令（/help、/print-* 等）仍在分支②被拦，保持关闭。
- `autoReplyService.isChatAllowed`：删除 DUTY_CHAT_ID 硬排除（v66 引入），值日群未@关键词命中照常回答，与他群口径一致（未命中静默）。
- 不受影响：p2p 值日指令/图片转发、「值日助手」看板 1h 限流、审批群财务路由、晚间静默（关键词回答属对话回路，不在播报闸门范围）、网关层（duty-bot 仍不消费消息事件，改动全在 hub 内部闸门）。
- 文档同步：根 AGENTS.md 值日专用群裁定行、qianli-chat-architecture SKILL.md 架构图、dashboard/registry.js hub permissions、README §9 生效范围（值日群例外说明）、ticket-pm/LOGIC-MAP §2.4 值日分支条目、server/.env.example 与 config.js 注释。
- 回归：stub-test-duty-branch 扩至 17 项断言全过（新增：@关键词回答且不转发 duty、未@关键词命中并回复、/help 与普通对话回新引导语、/help 不再返回帮助内容；原有值日助手看板/p2p 指令/图片转发/私聊白名单断言不变）。

### v69 · 2026-09-11 · 5f0add5 · feat

**值日域权限改策略驱动——hub 值日分支与关键词闸门全部接 duty-bot 管辖策略**

- 需求：值日域权限管辖范畴/生效范畴归位 duty-bot 后端（v4 新增 `GET /api/duty/policy`），hub 不再硬编码值日群口径。
- 新增 `server/src/services/dutyPolicyService.js`：拉取 duty-bot 管辖策略（60s 缓存；失联时按本仓 `DUTY_CHAT_ID` + 内置默认规则短暂兜底，15s 后自动重试）。
- `chatService.handleDutyBranch` 策略化：管辖判定 `isManagedGroup(policy, chatId)`、看板触发词 `groupBoardCommand`、关键词放行 `keywordPassthrough`、指令关闭 `closeBasicCommands` + 引导语文本、p2p 指令清单 `p2pCommands/p2pCommandPrefixes` 全部来自策略（原 `isDutyGroup`/`isDutyCommand` 硬编码删除）；策略声明不关基础指令时交还 hub 常规流程。
- `autoReplyService.processMessageEvent`：未@关键词路径接 `keywordAllowedInGroup` 策略闸门（非管辖群恒放行）。
- 不受影响：审批群路由、p2p 私聊指令白名单、晚间静默、网关层（duty-bot 仍不消费消息事件）。
- 回归：stub-test-duty-branch 扩至 27 项断言全过（新增：策略扩管辖群、非管辖群落常规流程、关键词开关 @与未@ 双路径、指令关闭开关、p2p 清单变更、duty-bot 失联兜底）。
- 文档：README §9、LOGIC-MAP §2.4、config.js/.env.example 注释同步"管辖权威在 duty-bot"。

### v70 · 2026-09-11 · 2c33716 · feat

**定制窗口 GET /api/hub/policy（顶层「机器人后端定制窗口」规则首批落地）**

- 只读全景：审批群 chat/服务地址、值日策略源（duty-bot /api/duty/policy）与兜底 chatId、关键词回答表范围（AUTO_REPLY_CHAT_IDS）、关键词监听群、会议群、私聊指令白名单计数、播报群（chatId/label/webhook 有无）、DDL cron 与预警天数。
- 既有 /api/autoreplies/config、/api/autoreplies/mention-config 不变；窗口只读，定制修改仍走对应机制（回答表走 xlsx→push，管辖口径在 duty-bot）。

### v71 · 2026-09-11 · a45d87b · feat

**关键词回答表定制窗口（CRUD，即时生效）+ 运维台「定制中心」接入**

- 新增 `GET /api/autoreplies/rules?table=group|mention`（读当前生效规则，`.local.json` 优先）、`POST /api/autoreplies/rules`（新增/更新，keywords 数组或逗号串；answers 数组或 answersText 每行一条 `回答|权重`，权重缺省 1）、`POST /api/autoreplies/rules/delete`、`POST /api/autoreplies/enabled`。
- 写入目标 = `.local.json`（运行时每消息重读，**改动即时生效**）；push 会用本地 xlsx 派生版覆盖——持久批量编辑仍以本地 `关键词回答表.xlsx` 为准，窗口改动需保留时 push 前先 GET 取回回填。
- 代码归位：`autoReplyService` 新增 getRules/upsertRule/deleteRule/setTableEnabled + 规则输入归一化（关键词组排序匹配、同组覆盖）。
- 验证：NAS 实测 加规则→生效文件含该词→删规则→文件复原 全闭环；运维台「定制中心」已内置该编辑器（规则列表/删除/保存/启停/切表）。

### v72 · 2026-09-11 · e7871f9 · feat

**/help 值日段统一斜杠风格 + 兜底策略清单同步**

- `/help` 值日段改为 `/值日助手` 等斜杠形态（与基础指令风格一致），注明带不带 / 均可。
- `dutyPolicyService` 兜底 p2pCommands 补 / 变体、前缀补 `/绑定`，与 duty-bot 下发策略对齐（断联兜底时斜杠形态同样放行）。

### v73 · 2026-09-11 · fix（随本提交落地，无独立哈希）

**会议卡片播报误识别群聊分享卡片（share_chat）——整支移除**

- 现象：群里分享任意群聊卡片都触发会议提醒 @所有人（用户报「会议卡片播报识别到群聊卡片链接」）。根因：v31 引入的 share_chat 识别分支里，`content.chat_id` 以 oc_ 开头即判为会议卡片——而每张群聊分享卡片都带 oc_ chat_id，等同「凡 share_chat 必触发」；群名/描述带「会议」的次级判定同属误伤（分享的是群，不是会议）。
- `meetingReminderService.containsMeetingCard`：整支删除 share_chat 分支；`interactive` 卡片按钮匹配「加入」收紧为「加入会议」（原两字「加入」会命中任何带「加入群聊」按钮的卡片，同类误报源）。
- 顺手排雷 `containsMeetingLink`：MEETING_URL_REGEX 带 g 标志，连续 `test` 会因 lastIndex 残留漏判，改走 `extractMeetingLinks`（match）实现（当前主链路未用到，属潜伏 bug）。
- 文档同步：README §8 检测类型去掉 share_chat（注明不触发）；eventSubscription.js 注释同步。
- 回归：node 内联断言 11 项全过（share_chat 带/不带「会议」群名均不触发；video_chat / share_calendar / interactive 会议卡仍触发；按钮「加入群聊」不触发；containsMeetingLink 连续调用无状态残留）。

### v74 · 2026-09-12 · 106bc46 · fix

**值日分支修复：群看板 / 形态可触发 + 载荷 messageId + 非管辖群提示 + 空群口径对齐 + 回答表保留词校验**

- 群看板触发词双形态：`handleDutyBranch` 管辖群分支由全等 `值日助手` 改为同时接受 `/值日助手`——此前带斜杠形态在 hub 被拦成引导语，duty-bot v7「指令风格统一」只统一了 duty-bot 侧与 p2p 清单，hub 群门漏了，policy「容忍 / 前缀」声明与真实链路不符（当时 NAS 实测系直 POST 绕过 hub 门）。/help 值日段「带不带 / 均可」的既有承诺自此为真。
- 群看板转发载荷补 `messageId`（此前仅 p2p 带）：duty-bot 消息级幂等在群路径生效，不再纯靠 1h 限流兜底。
- `handleDutyForward` 返回 `{reply, handled}`：duty-bot 未接管（无会话打卡口语变体，reply 空）时 p2p 落回常规流程（欢迎语），不吞消息也不误发。
- 非管辖群 @ 值日指令（p2pCommands 精确词，不含「绑定」前缀防误拦）回「请到值日专用群或私信办理」提示，不再落项目管理欢迎语/未知指令；管辖群 @+纯图片（text 空）静默吞掉，不再回引导语噪音。
- `dutyPolicyService.isManagedGroup` 空数组语义改为「不限制」，与 duty-bot 判定口径对齐（原「空=无管辖群」，env 漏配时全群失效、与 duty-bot 行为分叉）；失联兜底仍按本仓 `DUTY_CHAT_ID`。兜底 p2pCommands 同步镜像打卡变体。
- 回答表写窗口保留词校验：`autoReplyService.upsertRule` 拒绝与值日域保留词（`dutyPolicyService.dutyReservedWords()`：看板/打卡/请假/绑定等，去斜杠归一）互为子串的关键词，路由 400 返回——防往关键词回答表加含「值日/是」的词后在管辖群截胡值日语义。
- stub 测试（scripts/stub-test-duty-branch.js）扩到 34 项：斜杠形态、载荷 messageId、@+纯图片静默、非管辖群提示、空群口径、变体接管/落回、保留词拒绝（拒绝发生在落盘前）全断言，全过。

### v75 · 2026-09-12 · 17d17bf · feat

**DDL 播报事件写入动态广场 + push.js 运行时数据保护**

- 动态广场：DDL 播报成功送达后写机器人项目看板「动态广场」表（送达群数/逾期/紧急/本周，`config.plaza` 默认表内置可覆盖）；失败仅 warn 不影响播报。
- 【运行时数据保护】push.js 上传 `autoReplies.local.json` 前：①NAS 现网版本自动备份到 `/home/qianli/knowledge-tracker-data/backup/`；②本地条目数少于现网时跳过上传并自动回填本地（`PUSH_FORCE_PRIVATE=1` 才强制覆盖）——运维台定制窗口直写 NAS 的回答表不再可能被本地种子覆盖（同 duty-bot whitelist 事故整改，规则见顶层 AGENTS「运行时数据保护」）。

### v76 · 2026-09-12 · af964c9 · docs

**.env.example 标注 M4 预留键（全仓规则复核批次）**

- `server/.env.example` 的 `DUTY_WEBHOOK_URL`/`DUTY_BROADCAST_SCHEDULE` 加注：为 pm-robot M4「昨日值日播报」预留（代码未接线）；数据接口 duty-bot `GET /api/duty/brief` 已就绪待消费。防止后续清理误删或误当死键。
- 同批：顶层 AGENTS 新增「机器人项目看板数据联动」节与定制窗口现状纠偏、deploy skill 补 duty-bot 行/私有配置守卫/顶层远端说明、ticket-pm AGENTS 补契约 6/7（均为顶层文档，随顶层 v48 归档）。

### v77 · 2026-09-12 · f5febd8 · fix

**tar 打包排除回答表 .local.json（堵住 SFTP 兜底路径绕过守卫的漏洞）**

- 同 duty-bot v12：SFTP 兜底部署先清 `server/*` 再解 tar，本地 autoReplies.local.json 会抢在守卫前覆盖 NAS 现网（v76 恰走该路径）。两份回答表 .local.json 加入 tar 排除，改由 uploadPrivateConfigs 的备份+守卫路径唯一写入。

### v78 · 2026-09-12 · 6328555 · fix

**值日群兜底引导语同步 duty-bot v13 纯行动指引口径**

- DEFAULT_GUIDANCE 与 duty-bot GROUP_GUIDANCE 改为同一句：删「本群为值日/快递申领专用群」「关键词彩蛋照常有效」说明性内容，只留看板触发 + 私信办理（策略下发正常时本兜底不参与，断联时才生效，仍须与下发口径一致）。
- stub-test-duty-branch：mock 策略 fallbackGuidance 随更；6 处引导语断言指纹「值日/快递申领专用群」→「查看今日值日」，全过。

### v79 · 2026-09-12 · 随本提交落地 · fix

**值日管辖群会议提醒关闭 + 静默积压外迁落地（全量 debug 批）**

- 会议提醒补管辖闸门：eventSubscription 群聊管道末端的会议卡片提醒此前对含值日管辖群在内的所有群照常运行，与「值日群群级功能全关（仅值日助手+关键词彩蛋）」口径不符。现按 duty-bot 下发 groupChatIds **严格命中**跳过（空列表=未配置管辖群，不放大到全群）。
- 静默积压外迁：`.env` 配置 `QUIET_BACKLOG_FILE=/home/qianli/hub-data/quiet-backlog.json`（此前只有代码能力未配路径，SFTP 兜底清目录仍会丢积压）；quietHours 补启动自动建目录（对齐 ticket-bot v61 版本）+ 换址一次性迁移（项目内旧积压文件存在且新文件未落下时自动搬运，旧文件保留不删）；`.env.example` 补键。
- DEVLOG 哈希回填：v74（106bc46）/ v75（17d17bf）/ v76（af964c9）/ v77（f5febd8）/ v78（6328555）；头部「当前最新」指针 v67 → v79。
- 回归：stub-test-duty-branch 全过。

### v80 · 2026-09-13 · 随本提交落地 · docs

**M4 预留键注释口径更新（docs，无代码改动）**

- M4「昨日值日播报」已由 duty-bot 自身看板卡实现（昨日战报段，值日群播报，duty v15）；`.env.example` 的 `DUTY_WEBHOOK_URL`/`DUTY_BROADCAST_SCHEDULE` 注释改为「保留备用：如未来把播报迁到 hub 再启用」。hub 无代码改动。

### v81 · 2026-09-13 · 随本提交落地 · feat

**DDL 逾期确认 12 小时时效 + 冲突提示数据源（用户拍板，配 duty-bot v16 打卡主词）**

- 确认时效：确认私信发出后 **12 小时**内回复「是/否」才认（`DDL_CONFIRM_WINDOW_HOURS` 可配，默认 12；原 7 天）——超时记录清除，**项目保持原状态，次日 12:00 播报重新询问**（发送去重只对未过期记录生效，发送前顺手清该 owner 的过期记录，无人回复也能次日照常重播）。
- 新增 `GET /api/ddl/pending`：当前有未过期确认的成员 open_id 名单（duty-bot 18:30 询问冲突提示消费）。
- 确认私信文案补时效说明与「超时未回复明日再提醒」。
- 背景：值日打卡主词改「打卡」（duty v16）后「是」基本只剩 DDL 确认一个语义；时效把陈旧确认的误抢窗口从 7 天压缩到 12 小时。

### v82 · 2026-09-13 · 随本提交落地 · refactor

**未@关键词回答全群统一 + 值日助手仅 @/私聊（用户拍板，配 duty v18）**

- 关键词回答不再有值日群专属放行开关：autoReplyService 删除 `keywordAllowedInGroup` 门禁——未@关键词回答**全群统一**（值日群与其他群行为一致）；chatService ② 分支的 @关键词回答同步去掉 `keywordPassthrough` 条件。
- 保留词撞车校验移除：`assertNoDutyConflict`/`dutyReservedWords`/`keywordAllowedInGroup` 整链删除（hub + duty policy 双侧的 `keywordPassthrough` flag 一并清理）——撞车根源已随「值日助手仅 @/私聊」消失：看板是 @ 精确词、p2p 指令是私聊专属，群内未@关键词回答与之无交集，回答表用词不再受限。
- 值日助手触发口径不变的事实收敛：群看板本来就只在 @ 路径（processChatMessage 未@早退），本次把口径成文并清除与之冲突的旧机制。
- 测试：stub-test-duty-branch 重写 ⑩ 场景（管辖群 @/未@ 关键词照常回答）、⑭ 改为「含值日助手的规则不再被拒」（upsert 后 deleteRule 清理，不污染真实回答表）；duty stub-test-policy 同步去 flag 断言；两套全过。
- README（回答表校验说明）、LOGIC-MAP §2.4、registry hub notes 同步。

### v83 · 2026-09-13 · 随本提交落地 · docs

**文档重审订正：README DDL 确认时效口径（全量文档重审批，无代码改动）**

- README「待确认记录 7 天自动过期清理」→「12 小时时效（可配）过期清除；超时次日 12:00 播报重新询问」——v81 改代码后 README 未跟，全量文档重审发现订正。stub-test-duty-branch 的 keywordPassthrough fixture 与注释同步标记为已移除机制。

### v84 · 2026-09-13 · 随本提交落地 · fix

**深度代码审查批：DDL 确认服务三处修复**

1. getPendingStats 不清理过期记录——不活跃 owner 的过期确认永久混进 /api/ddl/pending，值日询问被无限期附加错误冲突提示（且 Map 泄漏）——统计前先 cleanupExpired。
2. 更新项目失败后 pending 回塞排在失败通知发送之后——通知再失败时记录丢失且异常逃逸——先回塞、通知单独 try/catch。
3. p2p 待确认匹配不区分项目——同 owner 多项目时「是」恒完成第一条（写错项目）——同来源多条取最近发送的一条。

### v85 · 2026-09-13 · 随本提交落地 · feat

**统计归因上报 + 管理端点鉴权 + 部署前测试闸门（体系推荐 R2/R4/统计覆盖规则）**

- 关键词回答命中（@与未@）与 DDL 确认回复上报网关 /api/usage/report（usageReport.js，fire-and-forget）——队员活跃/功能统计自动覆盖这两类此前不可见的交互。
- 新增 src/auth.js：/api/autoreplies/rules*、/api/autoreplies/enabled、/api/keywords/config、/api/projects、/api/bot/test-broadcast、/api/logs 写/配置端点需 X-API-Token（fail-closed）。运维台代理自动带头。
- push.js 加部署前测试闸门：stub-test-duty-branch 全过才部署。
