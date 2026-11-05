# 咱家小账 (OurNest)

OurNest 意为“我们的小窝”，中文名为“咱家小账”，是一个基于微信小程序云开发的家庭与个人记账应用。支持个人账本与家庭共享账本：夫妻/家庭成员共同记账、实时同步与多维度消费对比；数据、权限和核心业务逻辑统一由云函数安全处理。

项目支持离线缓存优先、账单导入、多级分类管理及双人/家庭消费趋势分析。

## 功能概览

- 微信登录与个人资料维护（免密码，唯一标识绑定）
- 个人账本、家庭共享账本切换与预算设置
- 收入/支出记录的新建、编辑、删除与分类、账户、标签管理
- 首页月度汇总、预算进度、最近记录与消费明细
- 明细按账本周期浏览，支持按日期/分类筛选、月份切换及触底翻页
- 多级分类维护；删除分类时支持关联记录平滑迁移
- 一键邀请伴侣/家庭成员加入共享账本
- 支持微信/支付宝等账单文件导入与智能归类
- 离线优先与版本增量同步机制

## 技术结构

```text
miniprogram/                         小程序前端
  pages/                              页面与页面级状态
  components/                         tl-* 通用业务组件
  services/                           云函数路由调用封装与本地缓存
  utils/                              金额、日期、映射等纯工具函数
  config/cloud-env.js                测试/生产环境配置
cloudfunctions/ourNest/              业务云函数
  index.js                            路由入口、统一响应、结构化日志
  actions/                            认证、账本、记录、分类、邀请入口
  shared/ validators/ policies/       响应、校验、权限边界
  handlers/                           核心业务实现与数据访问逻辑
scripts/                              本地质量检查脚本
tests/                                Node 内置单元测试
docs/                                 数据库、权限安全与协作规则
plan/PENDING.md                       待办清单
```

## 云函数接口

前端通过 `miniprogram/services/` 统一调用业务云函数 `ourNest`。

请求使用路由协议：

```js
wx.cloud.callFunction({
  name: "ourNest",
  data: {
    route: "record/list",
    payload: { ledgerId, start, end, cursor },
  },
});
```

云函数统一返回结构：

```js
{ ok: true, data: {} }
// 或
{ ok: false, error: { code, message } }
```

## 本地启动与部署

1. 使用微信开发者工具导入项目根目录 `D:\CRRC\OurNest`。
2. 确认 `miniprogram/config/cloud-env.js` 中的测试环境 ID 为你自己的 CloudBase 环境 ID。
3. 在微信开发者工具中展开 `cloudfunctions` 目录。
4. 右键点击 `ourNest` 云函数，选择 **“上传并部署：云端安装依赖”**。
5. 点击 **“编译”**（Ctrl + B）即可启动。

## 质量与测试验证

本地运行测试：

```bash
npm test
```

## 测试与生产环境

环境配置在 [miniprogram/config/cloud-env.js](./miniprogram/config/cloud-env.js)：

- `test`：开发版与体验版自动使用。
- `production`：正式版自动使用；当前 `id` 留空。

创建生产云环境后，只填写 `production.id`，并部署同名 `ourNest` 云函数。若正式版未配置生产 ID，应用会明确报错，不会误连测试库。

环境切换时会清除本地登录缓存，避免测试与生产数据混用。详见 [云环境说明](./docs/CLOUD-ENVIRONMENTS.md)。

## 数据与一致性

核心集合：`users`、`ledgers`、`records`、`categories`、`ledgerInvites`、`ledgerOperations`。

- 记录列表使用 `{ date, id }` 游标，默认 30 条、最大 50 条。
- 新建账本和记录写入 `schemaVersion: 1`。
- 云函数始终重新校验用户、账本归属和角色，不信任客户端权限参数。
- 邀请令牌领取使用事务，令牌绑定和成员写入保持一致。
- 账本删除使用 `records → categories → ledger → complete` 阶段记录；中断后重复请求可续跑。

索引和字段约束见 [数据库文档](./docs/DATABASE.md)，跨集合写操作策略见 [写安全说明](./docs/WRITE-SAFETY.md)。

## 质量检查

日常改动后运行：

```powershell
npm run verify
```

它会依次执行：

- JavaScript、JSON、WXSS、WXML 格式检查
- ESLint
- 金额、映射、云路由、环境选择等核心测试
- 所有云函数模块语法检查

相关命令：

```powershell
npm run format       # 格式化全部文件（包括 WXML）
npm run test         # 仅运行测试
npm run cloud:check  # 仅检查云函数语法
npm run ui:check     # 检查 UI 规则与 Token 使用
npm run visual:check # 对比关键页面视觉基线
```

WXML 已纳入格式检查；不要再将模板压缩成单行。

UI 修改遵循 [UI 视觉与语义规则](./docs/UI-GUIDELINES.md)。视觉基线只在人工确认差异正确后使用 `npm run visual:update` 更新；运行截图回归前需开启微信开发者工具服务端口。

## 日志与排错

- 前端错误：微信开发者工具“调试器 → Console”。
- 云函数错误：CloudBase 控制台 → 云函数 → `ourNest` → 日志。

云函数日志以 JSON 输出，包含 `requestId`、`route`、`ledgerId`、耗时、状态和错误码，不记录完整请求 payload。部署新云函数后日志格式才会生效。

## 发布前手工回归

除 `npm run verify` 外，在微信开发者工具中至少检查：登录、创建/切换账本、记录 CRUD、预算、明细分页、邀请领取、分类迁移和账本删除。完整清单见 [REGRESSION.md](./docs/REGRESSION.md)。

## 当前待决业务规则

以下规则尚未定义，因此没有擅自实现：

- 成员退出后历史记录的归属与可见性。
- Owner 是否可退出及其账本归属处理。
- 邀请过期、撤销和重复领取的产品规则。

规则确定后，应先补充数据约束、云函数实现和对应测试，再发布。

## 相关文档

- [协作规则](./AGENTS.md)
- [工程与提交规范](./docs/CONTRIBUTING.md)
- [数据库模型与索引](./docs/DATABASE.md)
- [云环境切换](./docs/CLOUD-ENVIRONMENTS.md)
- [写操作一致性](./docs/WRITE-SAFETY.md)
- [发布前回归清单](./docs/REGRESSION.md)
- [UI 视觉与语义规则](./docs/UI-GUIDELINES.md)
- [当前待办](./plan/PENDING.md)

文档职责：`README.md` 描述当前项目入口与已实现能力；`docs/` 保存长期规则；`plan/PENDING.md` 只保存未完成事项；已完成记录以 Git 历史为准。
