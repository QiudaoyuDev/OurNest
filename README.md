# 咱家小账（OurNest）

OurNest 是基于微信小程序云开发的个人与家庭共享记账应用。核心业务运行在 `ourNest` 云函数中，客户端负责交互、展示和有限缓存，身份与账本权限由服务端重新校验。

> 本文描述当前仓库源码中已实现的能力，不代表已完成真机、CloudBase 环境或正式发布验证。

## 当前业务能力

| 领域       | 当前实现                                                                        |
| ---------- | ------------------------------------------------------------------------------- |
| 登录与资料 | 微信云端 OpenID 身份、昵称和头像维护、退出登录                                  |
| 账本       | 个人/共享账本创建与切换，Owner 编辑名称和备注、删除账本                         |
| 收支       | 新增、编辑、删除、详情；金额表达式、快捷金额、账户、备注和标签                  |
| 首页与明细 | 当月收支与预算、最近记录；日期、类型、分类、账户及家庭维度筛选，游标分页        |
| 分类       | 按收入/支出组织的扁平分类；自定义名称和图标；删除时将关联记录迁移到同类型“其他” |
| 分析       | 周/月/年等周期统计、趋势、分类/账户占比、日历及明细下钻；云端另有多期比较接口   |
| 家庭协作   | 录入人、付款人、消费归属分开记录；成员/只读访客；邀请码预览确认、过期与撤销     |
| 成员治理   | 成员/访客退出，Owner 移除及调整角色，共享账本所有权申请转移与接收确认           |
| 导入       | 模板及微信支付/支付宝 CSV、XLSX 账单预览、选行、人工确认、分批写入与恢复        |
| 反馈       | 文字、类型及图片反馈，查看自己的反馈历史                                        |

### 明确边界

- **不是完整离线记账应用**：仅缓存登录资料、账本和分类，记录及统计从云端读取；没有离线写入队列。
- **不是实时推送同步**：前台约每 2 分钟检查账本版本，本机写入后主动刷新，也可手动同步。
- **不是自动智能归类**：来源账单分类不会自动映射到已有分类，特殊交易需人工确认；导出账单入口仅占位。
- 支付账户是账本内的名称配置，不是银行账户连接、账户余额或资金划转系统。
- 家庭付款/消费归属用于统计；当前差额提示只取前两名付款人差额的一半，不是多人通用拆账或实际债务结算。录入人统计不能解释为实际付款人。
- 当前分类模型为扁平结构；旧记录的父分类快照字段仍可能存在，不代表仍支持维护多级分类。
- 预算是账本当前月度配置，不是历史月份独立预算档案。

## 技术结构

```text
miniprogram/
  app.js / app.json             生命周期、会话、环境初始化与页面注册
  pages/                       登录、账本、成员、记录、导入、设置、反馈页面
  components/tl-tab-*/          首页、明细、分析、我的四个主面板
  components/                  tl-* 公共组件及 ECharts 适配
  services/                    统一 API、业务服务、缓存与刷新协调
  utils/                       金额、日期、事件、展示映射等工具
  config/cloud-env.js          测试/生产环境选择
cloudfunctions/ourNest/
  index.js                     路由、统一响应、请求与错误日志
  handlers/                    认证、账本、记录、分类、统计、预算和设置
  actions/feedback.js          反馈处理
  shared/ validators/ policies/ 数据访问辅助、校验和权限规则
scripts/                       格式、UI、云函数语法、视觉与集合准备脚本
tests/                         Node 内置测试与本地模拟
docs/                         当前业务、接口、数据、安全和验证说明
```

主界面使用一个页面承载四个自定义 Tab 面板，非原生 TabBar 多页面架构。业务读取链路为：页面/组件 → `services` → `ourNest` 路由 → Handler → CloudBase；头像、导入文件和反馈图片另使用云存储。

详见 [业务与实现](./docs/BUSINESS-AND-IMPLEMENTATION.md) 和 [接口说明](./docs/API.md)。

## 本地启动

1. 安装可运行 Node 内置测试及 ESLint 9 的现代 Node.js，执行 `npm ci` 安装根目录开发依赖。
2. 用微信开发者工具导入仓库根目录，核对项目 AppID 和云开发权限。
3. 在 [环境配置](./miniprogram/config/cloud-env.js) 填写自己的 CloudBase 环境 ID，不将真实凭证或用户数据写入文档。
4. 在目标测试环境显式准备集合、索引和安全规则，见 [环境说明](./docs/CLOUD-ENVIRONMENTS.md) 与 [数据模型](./docs/DATABASE.md)。根目录目前没有 `cloud:prepare:test` npm 命令。
5. 在开发者工具中将 `cloudfunctions/ourNest` 上传并部署，选择云端安装依赖；根目录依赖不替代云函数依赖。
6. 编译小程序，先验证登录和新建账本，再进行业务回归。

集合准备脚本会写入目标云环境，不应当作本地检查运行；需要凭证、明确目标及授权。本次文档维护不执行部署或云端写入。

## 接口与权限

客户端业务调用统一经过 [API 服务](./miniprogram/services/api.js)：

```js
const { callApi } = require("./miniprogram/services/api");
const result = await callApi("record/list", {
  ledgerId,
  limit: 30,
  cursor: null,
});
```

底层协议为 `{ route, payload }`，成功返回 `{ ok: true, data }`，失败返回 `{ ok: false, error: { code, message } }`。不支持旧 `action + data` 协议。

- Owner 可管理账本、预算、成员、邀请及全部记录。
- 共享成员可新增记录、编辑/删除自己录入的记录、新建分类和维护账户/快捷金额；不能修改他人记录或管理账本权限。
- 访客角色为 `readonly`，只能读取有权访问的账本，不可写入或导入。
- 新建账本和记录使用 `schemaVersion: 1`；分页使用 `{ date, id }` 游标，默认 30 条、最多 50 条。
- 邀请领取采用事务；分类迁移、账本删除和导入使用操作状态支持继续处理。网络失败不能简单等同于服务端未写入。

详见 [写入与权限安全](./docs/WRITE-SAFETY.md)。

## 缓存与同步

账目和统计以云端为准。登录、账本和分类缓存按会话/环境隔离；导入页另保存按环境、用户和账本隔离的恢复标识及清理队列，不保存完整账单内容。记录和统计不是持久离线副本。

前台自动检查 `syncRevision`，检测到变化后刷新可见面板；写入成功主动失效相关视图。该机制不是记录级增量下载，也不能替代服务端授权。详见 [缓存策略](./docs/CACHE-POLICY.md)。

## 质量检查

```powershell
npm run verify
```

依次执行格式检查（含 WXML）、ESLint、UI 规则、显式列出的 Node 测试和云函数 JavaScript 语法检查。

```powershell
npm run format:check
npm run lint
npm run ui:check
npm test
npm run cloud:check
npm run visual:check
npm run visual:analysis:check
```

视觉检查依赖已开启服务端口的微信开发者工具、对应工程与可用基线，并未包含在 `verify` 中。只有人工确认视觉差异后才能更新基线。新增测试文件时检查是否已加入 [测试命令](./package.json)。

本地模拟测试不能证明真实云事务、索引、文件权限、弱网恢复和真机渲染。发布前按 [回归清单](./docs/REGRESSION.md) 验证。

## 环境、日志与发布

开发版和体验版使用 `test`，正式版使用 `production`。当前源码 `production.id` 为空，正式版会明确失败，不会回退测试库；`LOCAL_OVERRIDE` 提交前应为空。环境与账号切换不可复用旧会话结果。

云函数使用当前部署环境，超时配置为 20 秒。请求日志输出结构化 JSON；失败请求还尝试写入 `errorLogs`，其中包含经过字段名脱敏、截断的 payload。账单、反馈等业务文本仍可能进入错误日志，不能宣称日志完全不含业务数据；需单独控制访问及保留策略。

部署、生产索引、安全规则、备份恢复和发布状态需在各自环境确认；配置文件及本地测试不代表已发布。

## 文档导航

- [业务现状与代码实现](./docs/BUSINESS-AND-IMPLEMENTATION.md)
- [云函数路由与调用契约](./docs/API.md)
- [数据模型与索引](./docs/DATABASE.md)
- [写入、权限及恢复边界](./docs/WRITE-SAFETY.md)
- [缓存与同步规则](./docs/CACHE-POLICY.md)
- [云环境与部署准备](./docs/CLOUD-ENVIRONMENTS.md)
- [手工回归清单](./docs/REGRESSION.md)
- [UI 维护规范](./docs/UI-GUIDELINES.md)
- [工程协作规范](./docs/CONTRIBUTING.md)
- [自动化协作规则](./AGENTS.md)

当前工作区没有 `plan/PENDING.md`，不将其作为有效待办入口。未完成验证与已知边界记录在对应主题文档中；历史过程以 Git 历史为准。
