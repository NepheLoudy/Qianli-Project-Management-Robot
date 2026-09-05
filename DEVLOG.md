# DEVLOG · project-management-robot（knowledge-tracker · 对话枢纽/项目管理机器人）

版本隔离单位：一次 `npm run push`（= 一次 git 提交 + 一次部署）。v1~v47 于 2026-09-04 按提交历史回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](../../AGENTS.md)）。

当前最新：**v57**（2026-09-06，随本提交落地）。

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
- `server/src/config.js` 新增 `p2pCommandAllow` 白名单配置；`.env.example` 补充说明；本地 .env 已配置管理员 open_id（张国皓 ou_249993fe…，经 git 提交邮箱手机号反查飞书账号确认）。
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
