# 云函数接口契约

## 入口与响应

业务云函数为 `ourNest`，路由事实源为 [云端入口](../cloudfunctions/ourNest/index.js)。前端只通过 [services](../miniprogram/services/api.js) 封装业务请求，不直接操作业务集合。

```js
// 请求
{ route: "record/list", payload: { ledgerId, limit: 30, cursor: null } }
// 成功
{ ok: true, data: {} }
// 失败
{ ok: false, error: { code: "REQUEST_FAILED", message: "..." } }
```

身份来自 `cloud.getWXContext().OPENID`，不能通过 payload 指定调用人。服务端按照账本当前关系授权；本地角色只用于交互。未注册路由返回 `ROUTE_NOT_FOUND`。客户端 API 无网络自动重试。

## 路由目录

下表枚举当前公开路由；不是完整 JSON Schema，字段细节以对应 Handler、校验器及测试为准。

| 领域     | 路由                                                                                            | 主要用途与权限                            |
| -------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 认证     | `auth/login`、`auth/profile/update`                                                             | 当前微信用户登录、资料维护                |
| 账本     | `ledger/create`、`ledger/list`、`ledger/current/set`                                            | 创建、列出可访问账本、选择当前账本        |
| 同步     | `ledger/sync`                                                                                   | 比较 `revisions` 映射与当前可访问账本版本 |
| 账本管理 | `ledger/update`、`ledger/delete`                                                                | Owner 修改资料、可恢复删除                |
| 成员读取 | `ledger/members/get`                                                                            | 有读取权限者获取成员信息                  |
| 成员治理 | `ledger/members/remove`、`ledger/members/role`                                                  | Owner 移除成员/访客及调整角色             |
| 退出     | `ledger/members/leave`                                                                          | 成员或访客退出，Owner 不可直接退出        |
| 所有权   | `ledger/owner-transfer/request`、`ledger/owner-transfer/accept`、`ledger/owner-transfer/cancel` | Owner 发起、目标成员接受、任一相关方取消  |
| 首页     | `ledger/dashboard/get`                                                                          | 当前月度汇总与最近记录                    |
| 分析     | `ledger/analysis/get`、`ledger/analysis/compare`                                                | 聚合分析与多期比较，须有读取权限          |
| 预算     | `ledger/budget/update`                                                                          | Owner 配置当前月度预算                    |
| 设置     | `ledger/quick-amounts/update`、`ledger/accounts/update`                                         | Owner/成员更新账本快捷金额、账户名称      |
| 记录     | `record/create`、`record/get`、`record/list`、`record/update`、`record/delete`                  | 读写边界见下文                            |
| 导入上传 | `record/import/upload-ticket`、`record/import/upload-abandon`                                   | 签发上传路径、放弃未领取上传              |
| 导入预览 | `record/import/preview`、`record/import/previews`、`record/import/cancel`                       | 解析预览、列出预览、取消尚未开始批次      |
| 导入执行 | `record/import`、`record/import/template`                                                       | 批次执行、获取模板                        |
| 文件清理 | `record/import/cleanup`、`record/import/cleanup/sweep`                                          | 重试受限范围内的导入文件清理              |
| 分类     | `category/list`、`category/save`、`category/delete`                                             | 读取、新建/编辑、迁移删除扁平分类         |
| 邀请     | `invite/create`、`invite/list`、`invite/revoke`                                                 | Owner 创建、查看有效邀请及撤销            |
| 领取     | `invite/preview`、`invite/join-token`                                                           | 当前用户预览并确认加入                    |
| 反馈     | `feedback/create`、`feedback/list`                                                              | 提交及读取自己的反馈                      |

没有账单导出、数据库重置或反馈状态管理路由。`ledger/analysis/compare` 当前没有前端服务封装，接口存在不等于 UI 入口已接入。

## 关键调用契约

### 记录列表

- `ledgerId` 指定已授权账本；`limit` 默认 30，最大 50。
- `cursor: { date, id }`；排序为 `date DESC, createdAt DESC, _id DESC`，服务端根据游标记录回读 `createdAt`。
- 日期范围使用起始含、结束不含的边界。可组合类型、分类、账户及家庭维度筛选。
- `categoryFilter`：`{ kind: "id", id }` 或旧记录 `{ kind: "legacy", parent, name }`；`accountFilter`：`{ kind: "name", name }` 或 `{ kind: "missing" }`。这两类筛选需明确收支类型。
- `familyFilter`：`{ dimension: "payer" | "consumer" | "creator", openid }`。
- `metadataMode` 为 `full`、`range` 或 `none`，续页可用 `none` 避免重复汇总。
- 返回 `hasMore`、`nextCursor`、`snapshotRevision`；范围统计使用 `rangeSummary`、`rangeRecordCount`，不是当前分页求和。
- 续页可传 `expectedRevision`。版本或读取上下文变化时拒绝混合快照，遇到 `RECORD_SNAPSHOT_CHANGED` 应重新首屏加载。

### 记录写入

Owner 可管理全部记录，成员仅可编辑/删除自己的记录，访客不可写。记录字段、金额、分类和家庭归属由服务端校验；带 `categoryId` 时由服务端读取分类生成快照。编辑使用 `syncVersion` 防止覆盖；删除只有传入非零版本时才进行版本比较，不应声称所有删除均强制乐观锁。

### 分类

`category/save` 使用 `ledgerId`、可选 `categoryId`、`type`、`name`、`icon`。Owner/成员可创建，只有 Owner 可编辑；`isOther` 分类不可编辑删除。删除响应 `hasMore: true` 时继续调用同一删除操作，直到完成；不会递归删除旧子分类。

### 邀请

创建传 `ledgerId` 和 `mode`（`member` 或 `visitor`）；仅共享账本可以邀请成员。预览使用 `inviteCode`，领取使用 `inviteToken`；列表和撤销使用账本及邀请 ID。

邀请码 8 字符、24 小时有效，输入支持规范化。预览和领取共享每用户每 60 秒 10 次的限流。已有角色不会被邀请码升级，也不会消耗未领取邀请码。原领取人仍有角色时可幂等重试；退出后不能用已领取令牌重新加入。已领取邀请不可撤销，所有权转移使旧邀请失效。

### 分析与导入

分析时间及导入批次字段见 [数据契约](./DATABASE.md)。常规分析不具有统一 5000 条上限；该保护仅用于多期比较。比较周期不得重复，最多 12 个月或 5 年，不能选择未来周期。

导入必须先获取上传凭证再预览。执行需要批次 ID、固定的 `selectedRows`、必要的人工方向及分类确认；每次事务最多处理 10 行，按 `hasMore` 继续。不要把业务写入当作可任意重放的读取请求。

## 失败处理

服务层将云端失败转为带 `code`、`route` 的 Error。部分 Handler 未显式设置 `error.code`，错误码可能归一为通用错误；不要假定每条错误消息都有同名稳定错误码。网络失败时先查询或恢复操作状态，避免重复创建普通记录。关键恢复边界见 [写安全说明](./WRITE-SAFETY.md)。
