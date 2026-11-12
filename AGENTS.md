# 咱家小账（OurNest）：项目协作规则

本文件面向在此仓库工作的自动化协作者，以当前已验证的业务实现、`README.md` 和 `docs/` 为依据；当它与现有代码或更具体目录下的 `AGENTS.md` 冲突时，以更具体的规则和已验证的实现为准。不要将历史计划或未实现能力当作当前业务规则。

## 项目边界

- 这是微信小程序云开发项目：前端位于 `miniprogram/`，云函数位于 `cloudfunctions/`；核心业务云函数为 `ourNest`。
- 前端只能通过 `miniprogram/services/` 调用 `ourNest`。使用 `{ route, payload }` 新协议和 `{ ok, data }` / `{ ok, error }` 返回结构；不要重新引入旧的 `action + data` 协议。

## 代码与接口约定

- 产品品牌统一使用 `OurNest`，代码、缓存与日志前缀使用 `ourNest`，资源文件名使用 `our-nest`；业务集合保留中性领域命名。
- 目录、页面路由和自定义组件目录使用 `kebab-case`；变量、函数、数据字段使用 `camelCase`；常量使用 `UPPER_SNAKE_CASE`。
- 自定义业务组件使用 `tl-` 前缀。调整历史页面路径时，必须同步更新 `miniprogram/app.json` 与所有调用方，不保留失效旧路径。
- 云函数路由、前端调用参数或数据库字段发生变化时，必须同步更新全部调用方、数据文档、权限边界和相关测试；不保留旧接口。
- 使用 UTF-8、LF、2 空格缩进、双引号和分号。不要把 WXML 或页面逻辑压缩为单行。

## 数据、权限与写入安全

- 云函数是字段契约与权限判断的唯一事实来源。从微信云上下文取得身份，按接口需要读取用户，并在服务端重新读取账本判定角色；绝不信任客户端传入的权限或身份参数。
- `records.amount` 必须为大于 0、不超过 99999999 且最多两位小数的有限数值；`date` 使用有效公历 `YYYY-MM-DD`，未提供时服务端默认 UTC 当日；`type` 仅可为 `income` 或 `expense`。新建 `ledger`、`record` 必须写入 `schemaVersion: 1`。
- 记录分页使用 `{ date, id }` 游标，默认 30 条、最大 50 条，并返回 `hasMore` 与 `nextCursor`。
- 邀请领取使用 CloudBase 事务或条件更新，确保令牌至多绑定一个 OpenID。
- 账本删除、分类迁移等可能超出单事务容量的操作，必须采用“标记进行中 → 分批处理 → 完成确认”的可恢复、可重试流程。
- 涉及删除、迁移、权限或生产数据的变更，先在测试环境演练；准备备份和回滚方案后再实施。`resetDatabase` 仅限测试，严禁在生产环境调用或向生产用户暴露。
- 成员和访客可以退出，Owner 可以移除成员/访客及调整角色；退出、移除和角色变化保留历史记录及录入人。Owner 不可直接退出；共享账本可向现有成员发起所有权转移，由目标成员确认后原 Owner 成为成员，双方可取消待处理申请。
- 邀请码为 8 字符、24 小时有效，仅 Owner 可创建、列出及撤销未领取邀请；个人账本仅邀请访客，共享账本可邀请成员或访客。已有角色不因邀请升级，也不消耗未领取令牌；原领取人仍有角色时可幂等重试，退出后不可复用已领取令牌。所有权转移递增 `ownerEpoch`，使旧邀请失效。
- 分类采用按收支区分的扁平模型；Owner/成员可新建，只有 Owner 可编辑或删除，`isOther` 分类不可编辑删除。删除仅按准确 `categoryId` 迁移记录至同类型其他分类，不按旧名称推断或递归迁移旧子类。

## 云环境与发布

- 云环境配置以 `miniprogram/config/cloud-env.js` 为准：开发版和体验版使用 `test`，正式版使用 `production`。本地 `LOCAL_OVERRIDE` 仅作临时用途，提交前恢复为空。
- 不得将测试数据、用户数据或生产环境密钥写入仓库。环境切换必须避免复用登录缓存，防止测试与生产数据混用。
- 上传正式版本前，确认 `production.id` 已配置，并部署同名 `ourNest` 云函数。
- 发布前运行 `npm run verify`，并按 `docs/REGRESSION.md` 完成手工回归（登录、账本、收支 CRUD、分页筛选、邀请权限、分类迁移、预算）。

## UI 与产品一致性

- UI 设计与实现以 `docs/UI-GUIDELINES.md` 为准；新增样式优先复用 `miniprogram/app.wxss` 的语义 Token 和已有 `tl-` 公共组件。
- 保持现有温暖的暖红色设计体系：主色 `#F0442F`、浅暖背景、统一的圆角/卡片/自定义 navbar 语言。
- 除 `tl-tabbar` 外不使用阴影；渐变仅限规范允许的页面背景、Tabbar 中央操作和骨架动画，并保证端点自然衔接。
- 页面不得私有实现通用骨架、空状态、按钮、固定底部操作、Bottom Sheet 或 Dialog；同一时刻只能有一个组件负责底部安全区。
- 页面数据状态使用互斥的 Loading → Error / Empty / Ready 状态链，Loading 时不得提前渲染 Ready 内容。
- 图标继续使用本地 `ri-icon` 的 Remix Icon 线性风格；品牌 Logo 使用 `miniprogram/images/brand/our-nest-logo-256-transparent.png`。
- 未经明确要求，不要随意修改全局颜色、背景、圆角、卡片语言、图标风格或 navbar 风格。
- 只读访客不能执行写入、导入、导出等操作；共享账本成员只能编辑/删除自己的记录，创建者可管理全部记录。

## 验证与提交

- 日常修改后至少运行受影响的检查；代码改动通常运行 `npm run verify`。可按需使用 `npm run format`、`npm run lint:fix`、`npm run test`、`npm run cloud:check`。UI 修改还需运行 `npm run ui:check`，关键页面视觉变更运行 `npm run visual:check`。
- 行为、数据边界或验收预期变化时，同步更新相关文档和测试，并完成对应手工回归。
- 每次提交只处理一个明确目标。提交信息使用 `feat:`、`fix:`、`refactor:`、`docs:`、`style:`、`test:` 或 `chore:` 前缀，说明可用中文或英文。
