# 飞书项目管理追踪器

飞书云文档小组件 - 项目管理与DDL播报系统

## 功能特性

### 1. 项目管理多维表格
- 项目名称、负责人、截止日期、优先级、状态管理
- 支持分组（category）
- 支持父子层级结构
- 优先级：高/中/低
- 状态：待开始/进行中/已完成
- DDL倒计时显示，临近DDL高亮提醒

### 2. 群机器人DDL播报
- 每天12:00自动播报DDL情况
- 已逾期项目提醒
- 2天内到期项目 @负责人提醒
- 本周到期项目概览
- 支持手动测试播报
- **支持父子记录层级结构**：按记录层级依序完整播报，子记录自动缩进显示

### 3. 维护日志
- 版本更新记录管理
- 每次确认版本后将功能更新内容写入日志
- 按时间倒序显示日志列表
- 存储在飞书多维表格的「维护日志」表中

### 4. 群聊关键词监听
- 监听群聊消息中带关键词的内容（如 #英雄、#实验 等）
- 关键词可通过配置文件随时修改
- **父子层级结构**：每个关键词作为父记录，匹配的消息作为子记录关联在其下
- 自动记录到多维表格，包含：时间、发送人、组别、消息内容、图片、消息链接
- 支持文本消息和富文本消息中的图片提取
- 前端可按分组折叠/展开查看，清晰展示层级关系

### 5. 机器人对话功能
- @机器人激活对话（群聊），私聊直接响应
- 支持指令系统：
  - `/help` — 显示帮助信息
  - `/status` — 查看服务运行状态
  - `/test-ddl` — 手动触发 DDL 播报测试
  - `/keywords` — 查看当前监听关键词
  - `/history` — 查看近期播报历史
- 普通对话返回欢迎语并引导使用指令
- 消息去重机制，防止重复处理
- 支持飞书长连接模式，无需公网地址

### 6. 逾期项目私聊确认
- DDL 播报时自动识别逾期超过 1 天的项目
- 向项目负责人（owner）私聊发送确认消息
- 引导用户回复「是」或「否」确认项目是否已完成
- 回复「是」自动将项目状态更新为 completed
- 回复「否」保持当前状态并记录
- 未识别回复时自动引导正确格式
- 支持多项目排队确认，自动去重避免重复发送
- 待确认记录 7 天自动过期清理

### 7. 每日随机语录
- DDL 播报卡片末尾添加语录栏目
- 从多维表格语录表随机选取一条
- 格式：「语录内容 by 作者」
- 1 小时缓存机制，减少 API 调用
- 语录表为空或读取失败时静默跳过，不影响正常播报

## 项目结构

```
knowledge-tracker/
├── widget/                 # 飞书云文档小组件（前端）
│   ├── src/
│   │   ├── components/
│   │   │   ├── ProjectTable.tsx    # 项目管理表格（支持父子层级）
│   │   │   ├── DDLBoard.tsx        # DDL看板
│   │   │   └── MaintenanceLog.tsx  # 维护日志组件
│   │   ├── api.ts                  # API接口
│   │   ├── App.tsx
│   │   └── index.tsx
│   ├── app.json             # 小组件配置
│   ├── package.json
│   ├── tsconfig.json
│   └── webpack.config.js
├── server/                 # 后端服务
│   ├── src/
│   │   ├── feishu/
│   │   │   ├── client.js        # 飞书API客户端
│   │   │   ├── bitable.js       # 多维表格API
│   │   │   └── bot.js           # 机器人消息（支持层级缩进）
│   │   ├── services/
│   │   │   ├── projectService.js # 项目服务（支持父子层级）
│   │   │   └── logService.js    # 维护日志服务
│   │   ├── cron/
│   │   │   └── index.js         # 定时任务
│   │   ├── config.js
│   │   └── index.js             # 入口
│   ├── package.json
│   └── .env.example
└── README.md
```

## 部署步骤

> ## ⚠️ v1.2.0 升级配置清单
>
> 如果你从 v1.1.0 升级，需完成以下变更：
>
> ### 1. 删除知识库同步模块
> - 删除 `tbl_updates` 表（不再需要）
> - 后端 `.env` 删除 `BITABLE_UPDATE_TABLE_ID` 配置项
> - 前端移除「知识库更新」Tab
>
> ### 2. 飞书应用权限调整
> - 可移除 `wiki:wiki`、`docx:document` 等知识库相关权限（如不再需要）

### 一、准备工作

1. **飞书开发者账号**：访问 https://open.feishu.cn/ 注册
2. **创建企业自建应用**：
   - 进入开发者后台 → 创建企业自建应用
   - 记录 `App ID` 和 `App Secret`

3. **开通权限**：
   - 云文档：`bitable:app`
   - 通讯录：`contact:user.base:readonly`
   - 机器人：`im:message`、`im:chat`

### 二、创建多维表格

1. 在飞书中创建一个多维表格（Base）
2. 记录 `App Token`（URL 中 `bascn` 开头的部分）
3. 创建两个数据表：

**表1：项目管理（表ID: tbl_project）**

| 字段名 | 字段类型 | 说明 |
|--------|----------|------|
| name | 文本 | 项目名称 |
| owner | 人员 | 负责人（飞书人员字段，自动显示姓名） |
| ddl | 日期 | 截止日期 |
| priority | 单选 | 优先级（high/medium/low） |
| status | 单选 | 状态（pending/in_progress/completed） |
| category | 文本 | 分组（如：产品组、研发组） |
| fileToken | 文本 | 关联文档Token（可选） |
| parentId | 关联/文本 | 父项目ID（支持父子层级结构，可选） |
| createdAt | 创建时间 | 创建时间 |
| updatedAt | 最后更新时间 | 更新时间 |

> **注意**：`owner` 字段使用飞书多维表格的「人员」字段类型，系统会自动获取用户的ID和姓名，无需单独设置姓名字段。
> **注意**：`parentId` 字段用于建立父子层级关系，填写父项目的 record_id 即可将当前项目设为子项目。DDL播报时会按层级依序完整播报。支持「关联字段」或「文本」类型。

**表2：维护日志（表ID: tbl_log）**

| 字段名 | 字段类型 | 说明 |
|--------|----------|------|
| version | 文本 | 版本号（如：v1.2.0） |
| content | 文本 | 更新内容描述 |
| createdAt | 创建时间 | 创建时间 |

> **注意**：维护日志表用于记录每次版本更新的功能内容，需与项目表在同一个多维表格中创建。

**表3：关键词监听（表ID: tbl_keyword）**

| 字段名 | 字段类型 | 说明 |
|--------|----------|------|
| 组别 | 文本 | 关键词分组（去掉#前缀，如：英雄、实验） |
| 时间 | 日期时间 | 消息发送时间（子记录才有） |
| 发送人 | 人员 | 发送人（飞书人员字段，子记录才有） |
| 消息内容 | 长文本 | 消息的完整文本内容 |
| 图片 | 附件 | 消息中的图片（支持多张，子记录才有） |
| 消息链接 | 超链接 | 跳转至原消息的链接（子记录才有） |
| 消息ID | 文本 | 飞书消息ID（用于去重，可选） |
| 群聊ID | 文本 | 群聊ID（可选） |
| parentId | 关联 | 父记录ID（用于建立父子层级，子记录填写父记录的record_id） |

> **注意**：
> - 关键词监听表需与项目表在同一个多维表格中创建。字段名需严格保持一致（中文）。
> - **父子层级结构**：每个关键词作为一条父记录（只需填"组别"和"消息内容"字段），匹配该关键词的每条消息作为子记录，通过 `parentId` 字段关联到对应的父记录。
> - `parentId` 字段需设置为「关联」字段类型，关联到本表自身。

**表4：每日语录（表ID: tbl_quote）**

| 字段名 | 字段类型 | 说明 |
|--------|----------|------|
| words | 文本/长文本 | 语录内容 |
| person | 文本 | 作者/出处 |

> **注意**：语录表需与项目表在同一个多维表格中创建。每次 DDL 播报随机选取一条展示在卡片末尾。`person` 字段为空时显示为"佚名"。

### 三、配置后端服务

1. 进入 server 目录：
```bash
cd server
```

2. 安装依赖：
```bash
npm install
```

3. 配置环境变量：
```bash
copy .env.example .env
```

4. 编辑 `.env` 文件，填入配置：
```env
APP_ID=cli_你的AppID
APP_SECRET=你的AppSecret

BITABLE_APP_TOKEN=bascn_多维表格AppToken
BITABLE_PROJECT_TABLE_ID=tbl_项目表ID
BITABLE_LOG_TABLE_ID=tbl_日志表ID
BITABLE_KEYWORD_TABLE_ID=tbl_关键词监听表ID
BITABLE_QUOTE_TABLE_ID=tbl_语录表ID

BOT_WEBHOOK_URL=机器人Webhook地址
BOT_NAME=爆米花机-对话型

CHAT_CHAT_ID=oc_对话群聊ID
KEYWORD_CHAT_ID=oc_关键词监听群聊ID

PORT=3000
CRON_SCHEDULE=0 0 12 * * *
DDL_ALERT_DAYS=2

FEISHU_USE_LONG_CONNECTION=true
FEISHU_VERIFICATION_TOKEN=
FEISHU_ENCRYPT_KEY=
```

5. 启动服务：
```bash
npm start
```

### 四、配置群聊关键词监听

#### 1. 配置飞书应用权限

在飞书开发者后台，为应用添加以下权限：

| 权限名称 | 权限码 | 说明 |
|----------|--------|------|
| 云文档多维表格 | bitable:app | 读写多维表格数据 |
| 获取与发送单聊、群组消息 | im:message | 接收群聊消息事件 |
| 以应用身份发送消息 | im:message:send_as_bot | 机器人主动发送私聊和群聊消息 |
| 读取用户发给机器人的单聊消息 | im:message.p2p_msg:readonly | 接收用户私聊回复 |
| 获取群组信息 | im:chat | 获取群聊信息 |
| 获取用户基本信息 | contact:user.base:readonly | 获取发送人姓名 |

#### 2. 配置事件订阅（两种方式二选一）

飞书事件订阅支持两种模式，**推荐使用长连接模式**（无需公网地址）：

##### 方式一：长连接模式（推荐 ✅）

使用飞书SDK内置的长连接（WebSocket）方式接收事件，无需公网地址，本地即可开发测试。

1. 进入飞书开发者后台 → 事件订阅
2. 事件订阅方式选择：**通过长连接接收事件**
3. 添加事件：**接收消息**（`im.message.receive_v1`）
4. 保存配置
5. 在 `.env` 中设置：
   ```env
   FEISHU_USE_LONG_CONNECTION=true
   ```

> **优势**：
> - 无需公网IP或域名
> - 无需内网穿透工具
> - SDK自动处理签名验证、重连等
> - 本地开发直接可用

##### 方式二：HTTP回调模式

传统Webhook方式，需要公网可访问的HTTPS地址。

1. 进入飞书开发者后台 → 事件订阅
2. 事件订阅方式选择：**发送通知给开发者服务器**
3. 设置请求地址：`https://你的域名/api/feishu/event`
4. 添加事件：**接收消息**（`im.message.receive_v1`）
5. 记录 Verification Token 和 Encrypt Key
6. 在 `.env` 中设置：
   ```env
   FEISHU_USE_LONG_CONNECTION=false
   FEISHU_VERIFICATION_TOKEN=你的Verification Token
   FEISHU_ENCRYPT_KEY=你的Encrypt Key（可选）
   ```

#### 3. 配置关键词

编辑 `server/src/config/keywords.json` 文件：

```json
{
  "enabled": true,
  "keywords": [
    "#英雄",
    "#实验",
    "#分享",
    "#讨论"
  ]
}
```

- `enabled`：是否启用关键词监听
- `keywords`：关键词数组，支持任意字符串，建议以 `#` 开头便于识别

> **注意**：修改配置后需重启服务生效。

#### 4. 将应用添加到群聊

1. 在飞书群聊中，点击右上角「设置」→「群设置」→「群机器人」
2. 点击「添加机器人」→ 选择你的应用
3. 确认添加后，应用即可接收该群的消息

### 五、配置群机器人

1. 在群聊中添加自定义机器人
2. 记录 Webhook 地址
3. 将 Webhook 地址填入 `.env` 的 `BOT_WEBHOOK_URL`

### 六、部署前端小组件

1. 进入 widget 目录：
```bash
cd widget
```

2. 安装依赖：
```bash
npm install
```

3. 配置 `app.json`：
- 填入从飞书开发者后台获取的 `appID` 和 `blockTypeID`

4. 本地调试：
```bash
npm start
```

5. 上传发布：
```bash
npm run upload
```

## API接口

### 项目管理

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/projects` | GET | 获取项目列表（扁平结构） |
| `/api/projects/hierarchy` | GET | 获取项目层级列表（含父子关系树） |
| `/api/projects` | POST | 创建项目 |
| `/api/projects/:id` | PUT | 更新项目 |
| `/api/projects/:id` | DELETE | 删除项目 |
| `/api/projects/ddl-alerts?days=7` | GET | 获取DDL提醒 |

### 机器人

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/bot/test-broadcast` | POST | 测试DDL播报（按层级播报） |
| `/api/bot/history` | GET | 获取播报历史 |

### 维护日志

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/logs` | POST | 写入维护日志（需要version和content） |
| `/api/logs` | GET | 获取维护日志列表 |

## 定时任务

- **DDL播报**：每天 12:00 执行（可通过 `CRON_SCHEDULE` 配置）

## 开发说明

### 技术栈
- 前端：React 18 + TypeScript + Webpack
- 后端：Node.js + Express
- 数据存储：飞书多维表格（Bitable）
- 定时任务：node-cron
- 飞书SDK：@larksuiteoapi/node-sdk

### 注意事项
1. 确保飞书应用已开通相应权限
2. 多维表格字段名需与代码中保持一致
3. 机器人 Webhook 地址请妥善保管
4. 生产环境建议使用 PM2 等进程管理工具

### 生产部署（Windows）
```bash
npm install -g pm2
pm2 start src/index.js --name knowledge-tracker
pm2 save
pm2 startup
```

## 版本历史

### v1.5.0
- 新增逾期项目私聊确认功能，自动向逾期超 1 天的项目负责人发送确认消息
- 支持回复「是/否」确认项目完成状态，自动更新多维表格
- 新增每日随机语录功能，DDL 播报卡片末尾随机展示语录
- 修复 DDL 播报卡片日期显示问题（时间戳改为格式化日期）
- 修复私聊消息未被机器人处理的问题（p2p 消息 chat_id 不匹配）
- 支持私聊对话功能，私聊直接响应无需 @

### v1.4.0
- 新增机器人对话功能，支持 @机器人 激活群聊对话
- 支持 5 个指令：/help、/status、/test-ddl、/keywords、/history
- 支持飞书长连接事件订阅模式，无需公网地址
- 消息去重机制，防止重复处理
- 长连接与 HTTP 回调互斥，避免双重响应

### v1.3.0
- 新增群聊关键词监听功能，支持自定义关键词（如 #英雄、#实验 等）
- 自动将匹配关键词的消息记录到多维表格（时间、发送人、组别、图片、消息链接）
- 关键词配置文件 `keywords.json` 可随时修改，重启服务生效
- 前端新增「关键词监听」Tab，可查看监听记录和配置状态
- 支持飞书事件订阅，实时接收群聊消息

### v1.2.0
- 移除知识库同步模块
- 精简项目结构，聚焦项目管理与DDL播报

### v1.1.0
- 新增维护日志功能，记录每次版本功能更新
- 新增项目父子层级结构支持，DDL播报按层级依序完整播报
- 知识库更新表字段优化：updatedBy改为人员字段，删除updatedByName和spaceId，spaceName改为文档链接
- 修复webpack配置process.env未定义问题

### v1.0.0
- 初始版本，知识库更新追踪 + 项目管理 + DDL播报
