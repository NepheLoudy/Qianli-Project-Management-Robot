# DEVLOG · project-management-robot（knowledge-tracker · 对话枢纽/项目管理机器人）

版本隔离单位：一次 `npm run push`（= 一次 git 提交 + 一次部署）。v1~v47 于 2026-09-04 按提交历史回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](../../AGENTS.md)）。

当前最新：**v115**（2026-09-25，随本提交落地；部署待实验室网段恢复后 npm run push 补上并回填哈希）。上一版 v114（`4fb1388`）。上一版 v113（发票转发超时 60s，`046174e`）。上一版 v112（发票采集观察转发，`4739bd7`）。更早：v111（duty fallback 词形同步，`c06277a`）、v110（负载算法升级批，`dbc33e8`）、v109（团队负载聚合端点，`a2fea48`）、v108（event fail-closed + usage 上报收口）、v107（正经活跃口径批，`5b80e39`）。

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

### v83 · 2026-09-13 · a601bc2 · docs

**文档重审订正：README DDL 确认时效口径（全量文档重审批，无代码改动）**

- README「待确认记录 7 天自动过期清理」→「12 小时时效（可配）过期清除；超时次日 12:00 播报重新询问」——v81 改代码后 README 未跟，全量文档重审发现订正。stub-test-duty-branch 的 keywordPassthrough fixture 与注释同步标记为已移除机制。

### v84 · 2026-09-13 · 2a7c8d5 · fix

**深度代码审查批：DDL 确认服务三处修复**

1. getPendingStats 不清理过期记录——不活跃 owner 的过期确认永久混进 /api/ddl/pending，值日询问被无限期附加错误冲突提示（且 Map 泄漏）——统计前先 cleanupExpired。
2. 更新项目失败后 pending 回塞排在失败通知发送之后——通知再失败时记录丢失且异常逃逸——先回塞、通知单独 try/catch。
3. p2p 待确认匹配不区分项目——同 owner 多项目时「是」恒完成第一条（写错项目）——同来源多条取最近发送的一条。

### v85 · 2026-09-13 · 69b82ce · feat

**统计归因上报 + 管理端点鉴权 + 部署前测试闸门（体系推荐 R2/R4/统计覆盖规则）**

- 关键词回答命中（@与未@）与 DDL 确认回复上报网关 /api/usage/report（usageReport.js，fire-and-forget）——队员活跃/功能统计自动覆盖这两类此前不可见的交互。
- 新增 src/auth.js：/api/autoreplies/rules*、/api/autoreplies/enabled、/api/keywords/config、/api/projects、/api/bot/test-broadcast、/api/logs 写/配置端点需 X-API-Token（fail-closed）。运维台代理自动带头。
- push.js 加部署前测试闸门：stub-test-duty-branch 全过才部署。

### v86 · 2026-09-14 · 00bcbaa · feat

**抽奖系统上线：走关键词回答全群链路 + 本地抽奖配置表（触发词/奖品/概率）**

- 新增 `抽奖配置表.xlsx`（「抽奖配置」+「使用说明」两张工作表）：一行=一个抽奖触发；**首发表格示例行为注释行（# 开头不同步），首次部署奖池为空、功能空转**——用户照示例格式填完触发词/奖品/概率再 push 即激活（避免示例奖品直接上线被抽走）；「触发词」列同义词分隔、任一命中即抽一次；「奖品」列 `/` 分隔候选，抽中的文字**原文回复**（表情/祝贺语写进奖品文字）；「概率1/2/3…」列与「关键词回答」表完全同口径（留空均分剩余、全空等概率、不足 100 归一化、超 100 按比例压缩、0=永不抽中）。`scripts/syncLottery.js`（`npm run sync:lottery`）转存 `server/src/config/lottery.json`，解析复用 syncAutoReplies 的 parseXlsx（表头列名泛化为可配参数）。
- 新增 `lotteryService.js`：走「关键词回答」同一条全群链路（未@群消息触发、@机器人时同样命中、私聊不触发），命中优先级**最高**——抽奖 > @触发回答 > 关键词回答，抽奖命中后同条消息不再回回答表（互斥不双回）；按概率加权随机抽一条奖品引用回复（失败降级直接发送）；命中上报网关 `/api/usage/report`（feature=抽奖，队员活跃归因）；`LOTTERY_CHAT_IDS` 可收窄群范围（默认全群）。
- 接线：eventSubscription 未@路径抽奖先行（命中跳过回答表，发言记录照常）；chatService @路径与值日管辖群分支同样抽奖最优先（先于回答表/引导语）；新增 `/lottery` 指令查看奖池与概率，/help、/autoreply 尾注、/status 口径同步。
- 定制窗口：`GET /api/lottery/rules` 读 + `POST /api/lottery/rules|rules/delete|enabled`（X-API-Token）热改写 `.local.json` 即时生效；`/api/hub/policy` 补 lottery 概览；push.js 私有上传泛化为清单（autoReplies + lottery，同套现网备份+条数守卫），tar 排除 lottery.local.json，部署前自动同步抽奖表。
- 测试：stub-test-duty-branch 新增抽奖场景（奖池抽取/权重 0 永不中、未@命中回复、管道级与回答表互斥、普通群/值日群 @ 路径、/lottery、启停窗口、CRUD；测试写的 lottery.local.json 结束按原状恢复，防残留随 push 覆盖现网种子），全量通过。
- 文档：README 新增第 10 节 + 项目树 + API 表 + 「测试」节；registry.js hub 窗口/指令/监听同步；.env.example 增 LOTTERY_CHAT_IDS；顶层 AGENTS 窗口现状行与用户指南 HTML/MD 同批更新。

### v87 · 2026-09-14 · 8744ce7 · refactor

**抽奖改版：奖池一行=一个奖品 + 触发词升级为 /指令 + /help 精简运维指令（用户反馈三连改）**

- **表格格式重做**（抽奖内容会很多）：`抽奖配置表.xlsx`「抽奖配置」改为**一行 = 一个奖品**（触发词 | 奖品 | 概率 三列），同一触发词写多行 = 同一奖池（Excel 下拉填充触发词即可）；触发词格内逗号/顿号/分号分隔别名。`scripts/syncLottery.js` 自带专用解析器（不再复用 syncAutoReplies 的 parseXlsx，后者还原）；概率=相对权重（留空=1、0=永不中、总和自动归一化）。
- **触发方式改指令**（原「消息包含触发词」易误伤闲聊）：群里 @机器人 发「`/触发词`」即抽一次，别名均可触发、精确匹配。`lotteryService` 删除未@消息路径（processMessageEvent/buildDrawForText），新增 `drawForCommand(commandText, chatId)`（静态指令表未命中 → 抽奖动态指令 → /print-* → 未知指令）与 `listCommandHelp()`（动态进 /help，每奖池一行、别名并列）；值日管辖群同样放行（先于基础指令关闭引导语）；**审批群不开放**；私聊按指令白名单口径；eventSubscription 还原为仅关键词回答。`LOTTERY_CHAT_IDS` 口径不变。
- **/help 精简**（有些功能不需要向群聊展示）：`/status /test-ddl /keywords /autoreply /history` 五个运维/诊断指令不再出现在群聊帮助里（仍可直接使用，README/registry 照登）；帮助分组改为「群聊指令（@我使用）+ 财务/打印/值日转发段」。
- 测试：stub 抽奖场景重写为指令口径（指令抽取/权重 0、普通群与值日群 @指令、未注册指令不误吞、/lottery、/help 动态段与运维指令隐藏断言、启停、CRUD），全量通过。
- 文档：README §5/§10、LOGIC-MAP 管道图与指令路径、registry、顶层 AGENTS、用户指南 HTML/MD 同批。

### v88 · 2026-09-15 · ffae397 · refactor

**抽奖收敛为单指令大奖池：表格只填 奖品|概率，行数不限（用户澄清三连改②）**

- 用户澄清需求：一个抽奖指令对应无穷可填的奖品和概率，不需要表格里逐行写触发词。`抽奖配置表.xlsx`「抽奖配置」瘦身为**奖品|概率两列**——整张表 = `/抽奖` 指令的一个大奖池，一行=一个奖品、往下加行即可。
- 指令名从表格抽出：`server/.env` 新增 `LOTTERY_COMMAND`（默认「抽奖」，逗号分隔可配别名如 抽奖,来一发）；syncLottery 直接读该键写进 lottery.json 的 keywords。多奖池能力保留在定制窗口（.local.json 可另加指令），表格只管主奖池。
- 解析器兼容旧格式（v87 触发词|奖品|概率）：注释判定=奖品列或行首非空列以 # 开头——旧表立即安全（示例行全注释，同步 0 有效奖品），旧表手工填的奖品行也能正常识别。
- 测试全过；README §10/LOGIC-MAP/registry/顶层 AGENTS/用户指南 HTML+MD 同批改口径。

### v89 · 2026-09-15 · 03ccfe5 · docs

**抽奖配置表.xlsx 换两列格式（v88 表格资产落地，纯本地资产无运行时影响）**

- `抽奖配置表.xlsx`「抽奖配置」工作表由 v87 旧格式（触发词|奖品|概率）正式换成 v88 两列格式（奖品|概率，整表=/抽奖 大奖池，行数不限），示例行保持 # 注释态；「使用说明」同步重写。v88 上线时该文件被 Excel 占用未能替换，用户关闭后本批补上。sync 产物与线上 lottery.json 完全一致（同步显示无变化，0 有效奖品空转态），部署仅为刷新一致性。

### v90 · 2026-09-15 · 随本提交落地 · refactor

**抽奖多奖池版：一个工作表 = 一个抽奖指令 = 一个奖池（用户定稿）**

- `抽奖配置表.xlsx` 按 sheet 组织：**工作表名即指令名**（sheet「抽奖」→ /抽奖；复制表改名即新抽奖，如 /转发抽奖）；表内仍是「奖品|概率」两列、一行=一个奖品、行数不限。syncLottery 遍历全簿——带「奖品」表头的表=奖池，无表头的表（使用说明/草稿）自动忽略并提示；空表（无有效奖品行）指令暂不生效并提示。LOTTERY_COMMAND 废弃（.env.example 同步清理），表格即指令全集；定制窗口仍可表格之外另加奖池。
- 服务层无改动（drawForCommand 本就按池 keywords 精确匹配，多池天然支持）；stub 测试全过。
- 文档：README §10/LOGIC-MAP/registry/顶层 AGENTS/用户指南 HTML+MD 同批改口径。

### v91 · 2026-09-15 · 随本提交落地 · fix

**全项目深度审查修复批：DDL 确认 usageReport 漏 require**

- ddlConfirmService.js 调用 `usageReport.report(senderId, 'DDL确认')` 但从未引入该模块——每条 DDL 确认回复在状态已更新、回复已发出之后抛 ReferenceError：功能统计从未到达网关，且群聊路径异常会中断 eventSubscription 的 try 块，吞掉同消息的关键词监听/会议提醒环节。补一行 require（与 chatService 同款）。
- AGENTS.md 指令交互契约文档修正：duty 载荷实为 `{command, openId, chatType, chatId?, imageKey?, messageId?, args?}`（图片载荷独立形态），原 `{command, args}` 描述以偏概全。
- 部署前 stub 测试（stub-test-duty-branch）通过。

### v92 · 2026-09-15 · 随本提交落地 · fix

**R9 值日词表让位 + R10 写端点鉴权补齐（全项目审查推荐落地批）**

- DDL 确认在 p2p 对值日词表让位（R9）：DDL 确认词表（是/是的/好/完成…）与值日打卡口语变体完全重叠，12h 窗口内有待确认项目时值日打卡被抢成「项目 completed」。现「打卡/打卡了」主词恒让位 duty-bot（本模块不再发「请回复是/否」误导提示）；口语变体先转 duty-bot（chatService.handleDutyForward，已导出），duty-bot 有当日活跃值日会话才接管，否则回落 DDL 确认、行为与此前一致。经第三方模块回到本模块的循环加载链用调用时惰性 require（顶层 require 会捕获未绑定完成的导出对象）。
- 写端点补 X-API-Token（R10④）：POST/PUT/DELETE /api/projects、POST /api/logs、POST /api/bot/test-broadcast（未鉴权即可触发全群真实播报+逾期确认私聊，风险最高）。GET 保持开放（外部只读小组件不受影响）；运维台代理 POST 自动带头不受影响。
- stub-test-duty-branch 新增 6 组 R9 断言（打卡接管/变体让位/待确认项不被消耗/回执转达），bot mock 增 sendTextToUser 捕获；全套通过。

### v93 · 2026-09-16 · 6a3e228 · docs

**push.js 部署目标文案清扫（docs，无行为变更）**

- 「上传/连接到 NAS」等 15 处用户可见文案 → 「部署目标」；实际目标一直是小电脑 192.168.31.57（server/.env 的 NAS_HOST，历史命名语义=部署目标），路径 /c/qianli/opt/knowledge-tracker 无误。NAS_* 变量名保留（历史命名，顶层 AGENTS 已成文）。
- 版本号说明：v92 之后并行会话的抽奖相关提交（ffcdb38/f001ba6）未记 DEVLOG，本条按提交哈希锚定，如有撞号以哈希为准。

### v94 · 2026-09-17 · 随本提交落地 · fix

**全量 debug 批：值日分支④误拦修复 + 快递助手路由 + P0 私有文件防护 + 六处审查修复**

- 值日分支④修复：非管辖群 @ 值日指令改吃策略 `groupCommands` 指令子集（旧逻辑吃整份 p2pCommands，把「是/好/完成」打卡口语词也拦成「请私信办理」，误伤项目群 @ 口语回复）；旧版 duty-bot 无该字段回落 p2pCommands 兼容。
- 快递助手路由（duty v29 联动）：管辖群 @ 指令子集（快递助手/快递/查询当前快递，裸词与带 / 双形态）与取件词形（已取n/全部已取，策略 p2pCommandPatterns）转发 duty-bot；@+纯图片转图片载荷（快递窗口登记素材，duty-bot 无窗口静默）；非@消息经 `maybeForwardExpressObserve` 观察转发（eventSubscription 挂管道，fire-and-forget，sender_type=app 跳过防回环）；handleDutyForward 补 8s 超时（duty-bot 半死不再拖住 hub 消息管线）；dutyPolicyService 兜底策略同步补字段+词形判定。
- P0 私有文件防护：.gitignore 改 `server/src/config/*.local.json` 通配（autoRepliesMention/lottery 此前裸奔，按文档回填后 push 会把真实姓名推上 git）；push.js 私有上传清单补 autoRepliesMention.local.json（备份+守卫同款）。
- plaza appToken 死配置修活：bitable.createRecord 支持可选 appToken，plaza 显式传 config.plaza.appToken（此前广场表指到别的 base 会静默写错地方）。
- auth.js 废除 ?token= 查询串（与 gateway R10② 同口径，token 不再进访问日志）。
- @触发回答表权重 0 语义修复（parseWeight：0=永不触发，与 lottery 同语义，此前被静默改成 1）。
- DDL 卡 ticketBuckets 三桶解构默认（API 形状漂移不再炸整轮播报）；broadcast-state 文件可经 BROADCAST_STATE_FILE 外迁项目外。
- .env.example NAS 三键（host/port/user）迁小电脑实值（顶层 v64 清扫漏网，本批义务收口）；nas-e2e-test.js 补 GATEWAY_API_TOKEN（R10 fail-closed 后必 403 失效）。
- 测试：stub-test-duty-branch 更新到新契约（@+图片转发断言、p2p 图片按 messageId 精确取），全部通过；全部改动文件 node --check 过。
- 文档：LOGIC-MAP 修正（share_chat 排除、/lottery 补录、R9 值日让位补记、值日分支快递助手/④修复描述）；feishu-permissions.txt 过期导出警示注。

### v95 · 2026-09-17 · 随本提交落地 · fix

**DDL 卡工单分栏细则扩充 + TDZ 回归修复（v94 引入即修）**

- 修复 v94 三桶解构默认的位置错误：`buckets` 声明在无人接单分栏之后，该分栏引用触发 TDZ ReferenceError，整张 DDL 卡渲染崩溃（node --check 查不出，无渲染层测试所致）——解构上移到分栏之前并注释警示。
- 工单分栏行渲染细则（配合 ticket-bot v74 字段）：结单两栏 `👤负责人 「编号」**需求** - DDL 状态（📅 理想结单日期）`，无人接单栏 `🆘（组别）「编号」**需求** - 已发布时长`；编号缺省时不出「」占位。
- 降级直读链路（ticketCloseService.getUnclosedBuckets）同批对齐标题口径与 code/groups 字段（两链路契约一致）。
- 验证：buildDDLReportCard 三分栏冒烟渲染（编号/需求/日期/组别/无编号不占位）全过。

### v96 · 2026-09-17 · 随本提交落地 · feat

**DDL 卡新增「⏳ 等回执待结单」分栏（ticket-bot v75 联动）**

- 消费 ticket-bot `waiting` 桶（additive，缺省不渲染）：回执节点上无负责人/未填结单时间/超 7 日的工单单独成栏，不再静默消失。
- 行渲染：`⏳ 👤负责人（或 无负责人） 「编号」**需求** - 📅日期（N天后）/已超期/未填理想结单时间`。
- 降级直读链路（ticketCloseService）同批产出 waiting 桶；cron 默认桶形状同步。
- 验证：buildDDLReportCard waiting 冒烟渲染（标题/无负责人/未填时间/超期+日期/编号）全过。

### v97 · 2026-09-17 · 随本提交落地 · fix

**值日/快递图片转发多图全量透传（duty v31 联动）**

- p2p 值日照片、快递群 @ 图片、非@观察转发三条链路均改为透传 `imageKeys` 全量数组（此前富文本一次多张只转发第一张，其余静默丢失）——duty 侧逐张下载合并收录。


### v98 · 2026-09-17 · 随本提交落地 · feat

**DDL 播报·僵尸父项目召回（用户口径：子项目全收尾的未完成父项目不许静默消失）**

- 原规则下父项目只当 📁 容器不单独播报；当名下子项目全部收尾后被剪枝，父项目若自身未完成且有 DDL，会整棵从播报树消失——变成僵尸项目。
- 新增僵尸召回：子项目全部终态（completed/died）+ 父项目未完成（in_progress/waiting）+ 父项目 DDL 已进播报窗口（逾期/加急/7 日内）→ 父项目恢复为叶子行参与对应分栏，行尾标注「🧟 子项目均已收尾，父项目待结」。
- 反例边界：有进行中/待认领子项目（父仍是容器）、父项目自身已完成、子项目仅暂停（pending 非终态）、DDL 在 7 日窗口外（临近自动浮现）——均维持原行为。
- 新增 `server/scripts/stub-test-ddl-zombie.js`（7 项：召回/标记/分栏归位 + 4 组反例），入 push.js 测试闸门。

### v99 · 2026-09-18 · 随本提交落地 · fix

**DDL 播报限频重试修复——2026-09-18 12:00 播报被 TooManyRequest 炸掉且不重试，当日播报丢失（本会话排查并已手动补发）**

- 事故还原：12:00:28 cron 准点触发，第一步 `getProjects()` 全量拉项目表（221 条）被飞书 bitable 限频（`获取记录失败: TooManyRequest`）抛错；`isFrequencyLimitError` 只认 `11232`/`frequency limited`，不认 `TooManyRequest`，非限频错误走 break 不重试——当日 4 群播报+12 个逾期确认私聊全部未发。去重标记按「至少一群送达才落盘」设计未误标，本会话经 `/api/bot/test-broadcast` 手动补发成功（4 群送达、12 确认私聊发出、state 更新 2026/9/18）。
- 修复：`server/src/cron/index.js` `isFrequencyLimitError` 补 `TooManyRequest` 匹配——限频类错误进入既有指数退避重试（30s/60s/120s，deliveredGroups 只补失败群），整点多机器人齐发拉表的限频尖峰可自愈；并导出该函数供测试。
- 新增 `server/scripts/stub-test-ddl-retry.js`（9 项：TooManyRequest 两形态/11232/frequency limited 回归 + 网络/表不存在/参数错/空值不误判），入 push.js 测试闸门。
- 遗留并入：`抽奖配置表.xlsx`（2026-09-17 会话遗留改动，随本批入库）。
- 排查旁证记录：9-16/9-17 12:00 的 error 日志均为「动态广场 TableIdNotFound 写入失败（忽略）」——动态广场表（tbld1zHXkTzko20p）在 9-16 前已不存在于「机器人项目看板」base，plaza.append 天天失败但不阻塞播报；表重建待另行处理（建表脚本 create-plaza-tables.js 幂等可重建）。
- 运维提示：本机笔记本系统时钟曾慢约 1h47m（部署目标与飞书 Date 头核对为准），已提醒校时；排查期间笔记本不在实验室网段导致 SSH 不可达属网络位置问题，非故障。

### v100 · 2026-09-19 · 随本提交落地 · fix

**DDL 播报错峰 12:00→12:05 + duty 转发超时治理（R25 + 杨杨文琦请假事件修复）**

- **错峰**：`CRON_SCHEDULE` 默认与现网值 `0 0 12 * * *` → `0 5 12 * * *`（config.js 默认 + server/.env + .env.example 三处同步）——与 duty-bot 12:00 值日看板播报同秒拉 bitable 互踢 429（09-18 12:00 当日播报被限频炸掉的治本补丁，v99 重试为双保险）。该键只影响 DDL 播报调度。
- **转发超时 8s→15s**（chatService `handleDutyForward`）：请假/看板链路含多趟表读写+私信，常规即 >8s；仍设上限防 duty 半死拖住 hub 消息管线。
- **超时文案改口径**：TimeoutError 时回「⏳ 值日服务响应较慢：指令可能已在后台受理，以机器人私信回执为准」，其它错误（连接拒绝等）仍回「暂不可用」——超时≠失败，duty 侧通常已受理。
- **事件复盘（09-18）**：杨杨文琦私聊请假（09-19/09-27 两天+连续缺勤加罚共 3 条补偿义务 20:06 登记成功），hub 20:07/21:56×3 共 4 次转发超时误报失败，用户重试 3 次全扑空——duty 侧提速见 duty-bot v32（回执不再 await 被抽调人私信）。
- 文档：README 4 处 12:00→12:05、ticket-pm/LOGIC-MAP §2.2、指南 MD/桌面 HTML DDL 播报时刻。
- 测试：duty-branch/ddl-zombie/ddl-retry 三套全绿。

## v101 · 2026-09-20 · 随本提交落地 · fix

**全量 debug 批：图片转存 234001 根因修复 + 快递观察图文分离 + DDL 卡 week 桶 + 转发超时收口**

- **P1 · 关键词监听图片转存换消息资源接口**：`downloadImage` 仍用旧 `GET /im/v1/images/{key}`（只能下机器人自传图，用户图一律 234001，生产 error 日志持续刷屏、发言表图片静默丢失）。换 `GET /im/v1/messages/{message_id}/resources/{key}?type=image`（duty-bot v28 同款修复，共用应用权限已生产验证），调用点补传 message_id。
- **快递观察转发图文分离**：v97 的「富文本多图透传」实为无操作（`imageKeys = undefined` 赋值本来就有），post 图文消息只转文字、图全丢。改为先文本后图两次顺序转发——duty `observeImage` 的配对逻辑会把图补挂到本窗口本人最新「无图」记录（即刚登记的取件码记录）。
- **DDL 卡 week 桶修复**：`getUnclosedBuckets` 此前 `daysLeft<=7` 全进 urgent，week 桶恒空——降级链路下 3-7 日工单错标「2日内加急」、「7日内」栏永不显示。改为 urgent=2 日内（含超期）、week=3-7 日、waiting=其余，与注释口径一致。
- **三处转发/发送补 15s 超时**：`bot.sendMessage`（webhook 卡片，挂起会拖死整个 DDL 播报循环）、`handleApprovalCommand`、`handlePrintCommand` 补 `AbortSignal.timeout(15000)`，与 duty 转发超时口径一致。
- 测试：server 三套桩（ddl-retry / ddl-zombie / duty-branch）全过。

## v102 · 2026-09-20 · 随本提交落地 · chore

**用户拍板：动态广场机器人停写（PLAZA_ENABLED 开关）**

- 2026-09-20 用户拍板：动态广场相关功能由用户自维护，机器人只对各自现有业务看板负责。plaza.js `enabled()` 加 `PLAZA_ENABLED` 开关（默认关，显式设 `1` 才恢复写入）——停写后即使用户把「动态广场」表从回收站恢复/重建，机器人也不会往里灌数据；TableIdNotFound warn 同步终结。DDL 播报等广场钩子保留代码不动，仅由开关关断。
- gateway 的「网关日活跃」表是另一张仍在役的表，不在本次停写范围。`.env.example` 补注释。duty-branch 桩套件全过。

## v103 · 2026-09-21 · 随本提交落地 · fix

**DDL 播报：瞬时网络错误纳入退避重试（2026-09-21 12:05 播报丢失修复）**

- 事故：2026-09-21 12:05 DDL 播报撞上校园网链路劣化窗口（网关侧 `self-signed certificate` 指纹、飞书 API 面性超时），`getProjects` 抛 `TimeoutError`——旧 `RETRY_CONFIG` 重试只认限频错误（`isFrequencyLimitError`：11232/frequency limited/TooManyRequest），超时走 `else break` 直接放弃，当日播报丢失（当晚已用 `/api/bot/test-broadcast` 手动补播）。
- 修复：`server/src/cron/index.js` 新增 `isTransientNetworkError`（超时/aborted/自签证书/证书错误/ECONNRESET/ECONNREFUSED/ETIMEDOUT/EHOSTUNREACH/ENETUNREACH/ENOTFOUND/EAI_AGAIN/socket hang up/fetch failed/disconnected/network），与限频同走既有退避重试（30s/60s，最多 3 次）；末次失败不空睡直接落败。重试全程留在 12:05 后数分钟内，不触晚间静默闸门；已送达群跨重试去重（`deliveredGroups`）与「至少一群送达才落盘」的当日标记语义不变，不会重复播报。
- 测试：`stub-test-ddl-retry.js` 扩 14 条瞬时网络错误断言（含 2026-09-21 实际失败形态 `The operation was aborted due to timeout`）；三套桩（ddl-retry/ddl-zombie/duty-branch）全过。
- 文档：README「定时任务」节补失败重试行为。

## v104 · 2026-09-21 · 随本提交落地 · feat

**DDL 逾期确认：多项目编号定向回复（2026-09-21 用户反馈区分性缺失）**

- 痛点：同一人多个项目同时逾期时各收一条确认私聊（项目名还可能雷同，如实例中两条「（基建支持项目）」），裸回「是」按 2026-09-13 口径恒完成「最近发送的一条」——用户无法定向，可能完成错的项目。
- 发送侧：`ddlConfirmService.sendOverdueConfirmation` 文案头部带「确认编号 N」（同 owner 内按发送序递增，12h 窗口内稳定），并新增教学行「多个项目待确认时，回复『编号+是/否』定向确认」。
- 回复侧：新增 `parseTargetedReply`（`2 是`/`2是`/`2：还没`/`#2 是`；编号限 1-3 位且必须紧跟确认/否认词，防普通文本如日志串 "234001: ..." 误判）；私聊裸回复且候选 >1 时不再猜最新一条，改回编号清单引导定向（不消费待确认记录）；编号不存在时提示当前清单；单项目裸回复与群聊行为不变。未识别回复提示在多项目场景同步改为列清单形态。
- 测试：新增 `stub-test-ddl-confirm-targeted.js`（24 断言：编号解析纯用例、发送编号入文案与记录、裸回复引导不写库、定向完成/否认、编号不存在提示、单项目裸回复兼容、日志串不误判、getPendingStats 暴露 seq）；四套桩（ddl-retry/ddl-zombie/duty-branch/confirm-targeted）全过，R9 值日让位用例无回归。
- 文档：README「逾期项目私聊确认」节补定向回复口径。

## v105 · 2026-09-21 · 随本提交落地 · feat

**/status 增舰队健康快照——管理员不连开发内网也能远程看状态（用户需求）**

- 需求：用户希望不在开发内网时也能看运维状态。运维台（笔记本 127.0.0.1:3100）依赖内网，而飞书长连接是出站的——机器人活在小电脑上，飞书私聊天然是远程通道。
- 实现：`chatService` 新增 `probeFleetHealth`/`fleetHealthLines`——对部署目标本机 7 服务（3010/3000/3001/3002/3003/3006/3007）并发 health 探测（3s 超时），逐行 ✅/❌（僵死显示「无响应」）；网关附深度行（ws running/异常 + 投递 ok/failed 计数，详情读取失败降级 ⚠️ 不抛错）。`/status` 输出在该段落拼入。入口=既有运维指令 `/status`（p2p 管理员白名单 `P2P_COMMAND_OPEN_IDS`，群聊仍可用）。
- 测试：新增 `stub-test-status-fleet.js`（劫持 global fetch，8 断言：7 服务逐行、单服务僵死、ws 异常形态、详情降级）；五套桩全过。
- 文档：README 指令清单补 /status 新口径。配套：桌面版《机器人总成使用指南.html》同日重建（成员向），FAQ 提及管理员 /status。

## v106 · 2026-09-22 · `211ce96` · feat

**DDL 播报新增负责人群整合播报——逾期+临期跨群汇总再播一遍，卡头 @章子赫（用户需求）**

- 需求：项目 DDL 播报时，把逾期和将要逾期的在负责人群再播报一遍，整合所有播报群的口径，并 @章子赫（要求先核实其 open_id 保障 @ 有效）。
- **@ 有效性核验**：`ou_e4f36d2152270436b25703f14ede86f0` 经通讯录接口直接核验（`GET /contact/v3/users/:open_id` 返回姓名=章子赫、在职激活、未离队），与 duty-bot 名册一致；负责人群（oc_3d6a26f6…）经 `GET /im/v1/chats` 确认机器人在群。上线前已真发一张明确标注的测试卡到负责人群 webhook（code 0），卡片 @ 语法 `<at id="ou_xxx">` 与现网各群 owner @ 同款。
- 实现（`server/src/config.js` + `feishu/bot.js` + `cron/index.js`）：
  - config 新增 `ddl.leaderGroup`（`LEADER_WEBHOOK_URL` 优先 / `LEADER_CHAT_ID` 走 im API 发卡兜底 / `LEADER_MENTION_OPEN_ID`+`LEADER_MENTION_NAME` 卡头 @ 对象；两者都空=功能关闭）；群 id/open_id 只存 .env 不进仓库（同审批群先例）。
  - bot 新增 `buildLeaderDDLReportCard`/`sendLeaderDDLReport`/`sendCardToChat`：整合卡只含「🔴 已逾期 + 🟠 N 天内到期」两栏，整合口径= `getDDLForBroadcastWithHierarchy('all')`（不按人员字段过滤，即各播报群内容并集，仅 dkyj 等单字段项目也入卡）；各项目行仍按 owner 字段 @ 责任人，无主项目回退「未指派」纯文本不丢行；周概览/工单分栏/语录不上此卡；有逾期红头、仅临期橙头。
  - cron 主流程在各群常规卡之后追加负责人群步骤：与各群同一轮重试（`leaderDelivered` 跨重试去重，瞬时网络/限频错误同待遇）；目标 webhook/chat_id 与播报群重复时自动跳过防双卡；**两栏全空当日不发送**（负责人群只收升级事项）；负责人群失败则本轮按失败处理（当日标记不落盘，可整轮重跑）——播报丢失事故（v99/v103）的教训方向是宁可重跑不可静默丢。
  - 静默闸门：负责人群卡在 `runDDLBroadcast` 内，天然随 `gateTask('ddl_broadcast')` 整任务重跑（挤压冲刷以补发时刻数据重查），无新增闸门点。
- 配套：`/api/hub/policy` 定制窗口补 `ddl.leaderGroup` 全景（webhook 等同凭据只出 hasWebhook 布尔，同 broadcastGroups 口径）；`/status` 播报群段补负责人群行（未配置显示关闭态）；push.js 测试闸门补齐全量六套桩（v104/v105 两套此前漏挂，一并入闸）。
- 测试：新增 `stub-test-ddl-leader.js`（30 断言：卡头 @ 标签、跨字段并集整合口径、周概览/工单/语录不上卡、分栏计数、无主项目回退、红/橙头、主流程发送一次、全空跳过、目标重复跳过、业务性失败当日标记不落盘且群卡不重发）；六套桩全过。
- 文档：README §2 播报节改「4 群分组 + 负责人群整合」、环境变量样例与晚间静默节同步；`server/.env.example` 补 `LEADER_*` 键说明。
- 部署备注：本版随 v105（/status 舰队快照，8b743af，因用户离站挂起）一并上线。

## v107 · 2026-09-22 · 随本提交落地 · feat

**统计归因上报配合活跃口径修正：娱乐功能带 fun 标记、抽奖带 learn 触发词**

- 配合网关 v29「队员活跃只算正经使用」（用户拍板：运维台队员活跃不再统计抽奖/关键词回答等娱乐功能）：`usageReport.report(openId, feature, opts)` 扩展可选 `opts.fun`（娱乐标记，网关把功能名学进娱乐清单 `funFeats`）与 `opts.learn`（触发词数组，网关归一化 `/触发词` 学进 `funCmds`——堵住抽奖动态触发词在路由层被记成正经 `/指令` 的漏洞）；旧网关忽略新字段，向后兼容。
- 四处调用点同步：抽奖两处（chatService 值日群分支/普通群指令分支）带 `{ fun: true, learn: lotteryDraw.keywords }`；关键词回答两处（chatService 值日群分支/autoReplyService）带 `{ fun: true }`。DDL 确认为正经使用，上报不变。
- 测试：`stub-test-duty-branch.js` 新增全局 fetch 捕获与统计上报三断言（抽奖/关键词回答全带 fun 标记、抽奖带 learn 触发词、关键词回答 fun 标记）；六套桩全过。
- 规则成文：顶层 AGENTS 全局工程规则新增「队员活跃口径=正经使用（2026-09-22）」条（实现约定与静态清单位置都在该条）。

### v108 · 2026-09-24 · 随本提交落地 · fix

**事件端点 fail-closed + 普通群 @关键词命中补 usage 上报（全仓复查批）**

- 提交说明：fix: /api/feishu/event 未配置 verificationToken 时 fail-closed + 普通群@关键词命中补 usage 上报
- **fail-closed**：server/src/index.js 的 /api/feishu/event 原为 fail-open（token 未配置即整段跳过校验，LAN 可伪造消息帧直达对话管道、伪造 owner 私聊写项目状态）。照 ticket-bot v78 口径补「未配置 FEISHU_VERIFICATION_TOKEN 一律 403 拒绝 im.message.receive_v1 帧」；url_verification 握手不受影响。现网 .env 已配 token，行为无实际变化。
- **usage 上报收口**：普通群 @机器人 命中回答表（chatService 非值日群分支）此前漏报，补 usageReport.report(senderId, 关键词回答, fun:true)——与值日群分支 / 未@路径 / autoReplyService 三处对齐，v107 口径全覆盖。
- 随本提交入库：README「等回执待结单」分栏补行（v75 文档欠账，09-23 遗留批）。
- 测试：六套桩全过（duty-branch / ddl-zombie / ddl-retry / ddl-confirm-targeted / status-fleet / ddl-leader）。

## v109 · 2026-09-24 · `a2fea48` · feat

**新增 /api/hub/workload 团队负载聚合（工单+项目双源评分，运维台「团队负载」看板数据源）**

- 提交说明：feat: 新增团队负载聚合端点（workloadService 双源评分）
- **新建 `server/src/services/workloadService.js`**：聚合本项目项目表全量（`buildEffMembers` 父项目负责人归并，`projectService` 顺带导出该函数）+ ticket-bot 新端点 `/api/tickets/workload-by-person`（v82，open_id 对齐；10s 超时照 ticketCloseService 模式，失败降级仅项目侧并在返回标 `ticketsSource:'unavailable'`，不 500）。
- **评分=复核算法（非计数）**：单任务分 = 状态折减(in_progress 1.0/waiting 0.6/pending 0.3，completed/died 不计) × DDL 时效(时间消耗比 p=已耗÷(发起→DDL全窗)：≤0.5→0.8/≤0.8→1.0/≤1→1.3/逾期 1.3+min(天,14)×0.1 封顶 2.7/无DDL 0.5；工单无DDL按滞留 <24h 0.8/<72h 1.0/≥72h 1.2) × 重要性(项目 priority high1.5/medium1.0/low0.7；工单无优先级字段以分桶代理 urgent1.5/week1.0/waiting0.8) × 角色(项目 owner 1.3)；**多人协作工单按 shareCount 摊薄**；unclaimed 无人接单不计个人分、按面向组别归入组切面待接。输出：persons（按分降序，含项目/工单明细）/groups（均值/峰值/待接数）/unclaimedTop/orphanTickets/summary，权重随 `weights` 透出可核对。
- 计算核心 `computeWorkload(projects, ticketData, nowMs)` 为纯函数（无 IO），stub 直测。
- 测试：`server/scripts/stub-test-workload.js` 31 断言（时效系数边界 13 项/双源聚合与权重/父归并/摊薄/降级路径），**入 push.js 部署闸门（七套桩）**；全套全过。README（API 行+测试节）同步；registry.js 登记 windows 条目（随顶层仓）。

## v110 · 2026-09-24 · `dbc33e8` · feat

**负载算法升级：组别系数（宣运×0.5、重装/步兵/哨兵×1.2）+ 被@接量（每被@一次 +0.01 分，三源聚合）**

- 提交说明：feat: workloadService 组别系数表 + 网关被@计数第三源
- **组别系数（用户拍板）**：`GROUP_COEFF`——宣经/宣运/宣运组 ×0.5（宣传运营类任务密度高但单项压力轻）、重装/步兵/哨兵 ×1.2（机械兵种装配压力重）。按**任务归属组别**判定：项目乘 category、工单乘单级「面向组别」（ticket-bot workload-by-person 同批补 groups 字段，只动自家新端点不碰 unclosed-by-group 契约）；兵种分组只存在于项目 category（工单面向组别是职能组枚举），故兵种系数天然只作用于项目侧；多组命中连乘。
- **被@接量（用户拍板）**：`MENTION_SCORE=0.01` 分/次、近 7 天自然日滑窗；`fetchMentionCounts()` 拉网关 `GET /api/usage/mentions?days=7`（gateway v31 同批上线，5s 超时，失败缺该维度并标 `mentionsSource:'unavailable'` 不 500）。被@数据**先入榜再算任务**——零任务但被@密集的协调型角色也显形（groups 留空）；persons 输出加 mentionCount/mentionScore，summary 加 mentionTotal，weights 透出 groupCoeff 与 mention 规则。
- config.js 新增 `gateway.url`（GATEWAY_URL，默认 localhost:3010），server/.env.example 同步。
- 测试：stub-test-workload.js 扩到 41 断言（新增 D 组组别系数 4 项/E 组被@接量 4 项/C 组网关降级 2 项，fetch mock 按 URL 分流）；七套桩全过。README workload 行更新。

## v111 · 2026-09-24 · `c06277a` · chore

**duty 域 fallback 词形同步：请假两步确认新词形（duty-bot v36 联动批）**

- dutyPolicyService.buildFallbackPolicy 的 p2pCommands 补 `确认请假`/`取消请假` + 斜杠变体共 4 词——duty-bot v36 请假改两步确认后，其 policy 下发清单已含新词形；本仓仅在 duty-bot 失联兜底时用内置清单，不同步则兜底期间「确认请假」会被当未识别指令拦下。
- 精确词匹配（cmds.includes(text)），逐字清单故须逐字同步；下发策略正常时本清单不参与匹配。
- 测试：stub-test-duty-branch.js 全过（该测试自带 stub 清单，不随 fallback 变化）。

## v112 · 2026-09-25 · `4739bd7` · feat

**hub 发票采集观察转发：p2p 图片/文件 fire-and-forget 转 approval-bot（发票全链路 hub 侧入口，对接 approval-bot v45）**

- 提交说明：feat: hub 发票采集观察转发——p2p 图片/文件 fire-and-forget 转 approval-bot /api/invoice/collect(token 头),帮助文案补 /approval-batch
- `server/src/services/chatService.js` `handleDutyBranch`：p2p 图片 → `forwardInvoiceCollect`（不 await）+ duty 照片凭证直传**双线并行**；p2p 文件 → 仅走发票采集。载荷 `{openId, messageId, fileKey, msgType}`，带 `X-API-Token` 头（复用全局共享 token）；fire-and-forget 不阻塞消息管线，**回执一律由 approval-bot 私聊发送**（hub 不代答，保持「谁的业务谁回话」）。
- `/help` 帮助文案补 `/approval-batch`（财务报销批次三件套入口，approval-bot v45 新指令）。
- 设计定位：与快递观察转发同款「观察转发模式」——hub 只搬运不判业务，发票合法性/查重/打回全在 approval-bot 侧。

## v113 · 2026-09-25 · `046174e` · fix

**hub 发票采集转发超时 15s→60s（采集链路可超 30s，approval-bot v46 复查 P2-1 联动修复）**

- 提交说明：fix: hub 发票采集转发超时 15s→60s(采集链路可超 30s,复查 P2-1)
- `forwardInvoiceCollect` 超时 15s→60s：采集链路带 OCR 兜底（飞书 basic_recognize）时端到端可超 30s，15s 超时会让 hub 侧日志误报失败（fire-and-forget 不影响用户回执，但监控口径失真）；与 approval-bot 侧 60s 口径对齐。
- **已知遗留（2026-09-25 全量审查发现，待下批修）**：`extractFileContent` 读 `message.body?.content`，但 hub 事件帧形状是 `message.content`（JSON 字符串，无 `body` 包装）——`message.body` 恒为 undefined，**p2p 文件（数电票 PDF）分支实际是死代码**；图片分支不受影响（走 keywordService.extractImageKeys 读 `message.content`）。修复时改读 `message.content` 并补 file 分支桩断言；同时发票采集作为新成员交互尚无 `POST /api/usage/report` 上报（铁律⑧缺口），可同批补。

## v114 · 2026-09-25 · `4fb1388` · fix+docs

**发票采集文件分支死代码修复（P1）+ 采集 usage 上报（铁律⑧）+ 全量审查文档批**

- 提交说明：fix: extractFileContent 双形状兼容（p2p 文件发票采集死代码修复）+ 发票采集 usage 上报 + 桩断言 + 文档批
- **P1 修复**：`extractFileContent` 原只读 `message.body?.content`，但 hub 事件帧形状是 `message.content`（网关原样转发的 JSON 字符串，无 body 包装）→ `message.body` 恒 undefined，**p2p 文件（数电票 PDF）的发票采集分支自 v112 上线起就是死代码**（静默失效、无日志）。改为 `message.content ?? message.body?.content` 双形状兼容（body 形态仅 IM REST item 有，保留兜底）。2026-09-25 全量审查发现，v113 条目已预告。
- **铁律⑧补齐**：`forwardInvoiceCollect` 命中点补 `usageReport.report(openId, '发票采集')`——交票是新成员交互，网关路由层看不见，hub 侧归因上报（正经口径，无 fun 标记）。
- **桩断言**：stub-test-duty-branch 新增 4 断言——p2p 图片发票转发载荷（fileKey/openId/msgType）、p2p 文件（事件帧 content 形状）转发载荷（死代码修复回归）、文件不误入 duty 转发、采集命中上报 feature=发票采集；fetch mock 增 /api/invoice/collect 离线捕获。
- **文档批（全量审查对齐）**：README §5 补发票观察转发条目、API 表补 /api/ddl/pending 与 /api/hub/policy；LOGIC-MAP §2.1 管道补发票双线、§2.2 补 v106 负责人群整合卡、§2.4 补 /status 舰队健康与 workload 端点、§0/§1.3/§1.4/§1.6 补 workload-by-person 契约/全局锁口径/搬运缺行修补任务；v112/v113 两提交补档（同批）；DEVLOG 头部指针维护。
- **测试**：七套桩全过（duty-branch / ddl-zombie / ddl-retry / ddl-confirm-targeted / status-fleet / workload / ddl-leader）。

## v115 · 2026-09-25 · 随本提交落地 · feat

**审批群裸词「接取」转发（approval-bot 交付卡领取回路）**

- 提交说明：feat: 审批群裸词「接取」转发 approval-bot（交付卡领取登记，透传发送者身份）
- `matchApprovalTake`（chatService 导出，桩断言用）：审批群裸词「接取」/「接取 <批次号>」匹配，容忍首尾空白与尾部标点（。！!？?～~）；非 `/` 指令路径，先于 parseCommand 分支处理（duty 分支之后）。
- `handleApprovalCommand` 扩展第三参 `sender`：转发载荷新增 `senderName`/`senderId`（approval-bot 用 senderName 登记批次接取人）；既有 `/approval-*` 调用方不传 sender → 身份字段空串，完全向后兼容。
- 链路：财务 @机器人 回「接取」→ hub 转发 `{command:'接取', args, senderName}` → approval-bot `claimBatch` 登记接取人并回执（approval-bot v49）。审批群 @机器人前置门槛不变。
- 测试：新增 `server/scripts/stub-test-approval-take.js`（matchApprovalTake ×11 用例 + fetch 桩断言转发契约身份字段/既有调用兼容），README 测试节已登记；既有 stub（duty-branch/status-fleet/workload）回归全绿。
- 部署状态：随本提交入库；**部署待实验室网段恢复后 `npm run push` 补上**（下一批回填哈希）。
