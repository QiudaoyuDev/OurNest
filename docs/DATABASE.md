---
id: database-contract
type: module-design
title: 数据模型与索引
status: draft
parent: ledger-cloud
references:
  - write-safety
---

# 数据模型与索引

云函数是字段契约和权限判断的唯一事实来源。修改集合、字段、索引或角色边界时，必须同步更新云函数、全部调用方、相关测试和本文。

## 业务集合

| 集合               | 用途                             | 关键约束                                 |
| ------------------ | -------------------------------- | ---------------------------------------- |
| `users`            | 用户资料与当前账本               | `openid` 唯一                            |
| `ledgers`          | 账本、成员、访客、预算、账户配置 | 账户名称去重且为 1–12 个                 |
| `records`          | 收支记录                         | 必须包含有效金额、日期、类型及账本归属   |
| `categories`       | 账本扁平分类                     | 按账本与收支类型组织，新建无层级和父分类 |
| `ledgerInvites`    | 单次领取邀请码及邀请令牌         | `token` 唯一且至多绑定一个 OpenID        |
| `ledgerOperations` | 可恢复的账本批处理进度           | 用于删除等分阶段、可重试操作             |
| `feedbacks`        | 用户反馈                         | 仅当前 OpenID 可查询自己的反馈           |
| `errorLogs`        | 云端错误日志                     | 含脱敏截断后的请求内容，需限制访问       |

仓库提供显式集合准备脚本，使用方式见 [环境说明](./CLOUD-ENVIRONMENTS.md)，没有 `cloud:prepare:test` npm 命令。反馈接口仍有按需创建 `feedbacks` 的路径。集合存在不等于索引和生产安全规则已经配置完成。

## 字段约束

- `users.avatarUrl` 默认写入 `/images/brand/our-nest-logo-256-transparent.png`，用户上传头像使用云文件 ID；读取资料和成员信息时，打包品牌头像路径在响应中统一为当前 Logo，不直接改写数据库原记录。`errorLogs.type` 写入 `ourNestError`。
- 新建 `ledger`、`record` 写入 `schemaVersion: 1`。
- `records.amount` 必须为有限正数，不超过 99,999,999，最多两位小数。
- `records.date` 使用 `YYYY-MM-DD`。
- `records.type` 仅可为 `income` 或 `expense`。
- 记录分页使用 `{ date, id }` 游标，默认 30 条、最大 50 条，并返回 `hasMore` 与 `nextCursor`。`record/list` 的 `metadataMode` 可为 `full`、`range` 或 `none`：后续页以 `none` 跳过全量统计；首屏返回 `snapshotRevision`，后续页可带 `expectedRevision`，不匹配时返回 `RECORD_SNAPSHOT_CHANGED`。
- `categories.source`：`system` 表示系统分类，`custom` 表示用户创建的分类。
- `isOther` 分类不可编辑删除（支出“其他”、收入“其它”）；其他系统默认分类可由 Owner 编辑。当前默认支出 36 个、收入 5 个，不提供新建多级分类。
- `ledgers.accounts` 保存 1–12 个不重复的支付账户名称；`accountsConfigured` 区分已保存配置与旧数据默认值。
- `ledgers.name` 为 1–8 个字符，`ledgers.remark` 最多 80 个字符；只有 Owner 可通过 `ledger/update` 编辑，服务端会重新读取账本并校验角色。
- `ledgers.syncRevision` 是服务端维护的单调递增同步版本。记录、预算、设置和分类保存等写入与版本递增采用事务；分页和分析还需读取前后版本与权限检查，不能将版本号视作任意跨接口全局快照。旧账本缺失版本时通过重新授权的事务按需初始化；客户端不得提交或覆盖该字段。

## 客户端同步

- `ledger/sync` 接收客户端缓存的 `{ ledgerId: syncRevision }` 映射，只读取当前用户有权访问账本的 ID 与版本进行比较。
- 版本未变化时不返回账本完整数据；版本变化、新增或移除时，同一响应返回最新账本列表及变化账本 ID。
- 小程序有缓存时立即展示；前台按 2 分钟间隔后台校验。只有检测到变化时，当前可见的首页、明细或分析模块才重新请求业务数据。
- “我的 → 同步数据”提供强制校验入口。所有业务数据仍通过 `ourNest` 获取，缓存和版本号都不能替代云函数权限判断。
- `ledger/analysis/get` 按月、年或全部时间一次返回概览、上期对比、补齐零值时间桶的趋势、收支分类、支付账户、共享成员录入支出及账本级预算执行。当前月/年使用上期同期对比，历史周期使用完整上期；账本预算仅代表当前配置，因此只在当前月展示。成员维度依据记录创建者统计支出金额与支出笔数（`recordCount`），不代表实际付款人或消费归属。客户端在渲染前校验分析响应的账本上下文、有限金额及金额守恒，缺字段或不守恒时拒绝显示，不补零。
- 分析响应的 `comparisonRange` 为上期查询范围，包含起始日期 `start`（含）和结束日期 `end`（不含）；全部时间为 `null`。当前月和当前年对应上期同期，日期超过上期月末时截断至月末；历史月、年使用完整上期，日历和自定义范围使用紧邻的等天数上期。即使本期无记录也查询上期。
- 年度模式的 `recentYearTrend` 补齐以所选年度为终点的 5 个自然年；所选年度处于未来时不返回趋势，避免把未来年份误作零值。当前年尚未结束，金额是截至已录入记录的累计值。
- `feedbacks.content` 必填且最多 200 字；`type` 必填，取 `feature`、`bug`、`improvement`、`other`；`images` 最多 9 个云文件；提交写入 `submitted`，当前没有更新处理状态的公开路由。

## 收入归属人

- `records.incomeOwnerOpenid` 是共享账本收入的真实归属人，与 `ownerOpenid` 录入人独立。历史记录和导入记录缺失或空值均为未指定，绝不推断为录入人；无需迁移。个人账本和支出不指定收入归属。
- `record/create`、`record/update` 可传 `incomeOwnerOpenid`：字符串为空或 `null` 表示清除；非空必须是当前共享账本 Owner 或成员，访客及其他账本用户不可选。更新未传保留已有收入归属；历史已离开成员的原值可保留或原样提交，但不能重新选择其他已离开成员。收入改为支出时清空，支出改收入不会继承。服务端在事务内重新读取账本及记录并复核成员和写入权限；现有 Owner、成员及访客权限不变。无效输入返回 `INVALID_INCOME_OWNER`。
- `record/get` 返回 `record.incomeOwnerOpenid` 和 `record.incomeOwnerName`：未指定显示“未指定”，有资料显示昵称，本人缺昵称显示“我”，其他缺资料显示“历史成员”；此展示不修改历史数据。

## 家庭付款与消费归属

- `records.ownerOpenid` 始终由云端记录实际录入人；共享账本支出可附带 `familyAttribution: { payerOpenid, consumerKind, consumerOpenid }`。`payerOpenid` 空字符串表示其他；`consumerKind` 为 `personal`、`public`、`multiple` 或 `unknown`，仅 `personal` 使用 `consumerOpenid`。
- 新手工记录的个人账本默认本人付款及本人消费；共享账本表单默认本人，但允许选择其他成员、公共、多人或其他。导入账单和未包含字段的历史记录均按未知处理，不推断录入人是付款人。未执行历史数据迁移，`schemaVersion: 1` 保持不变。
- 服务端根据当前账本重新验证付款人与个人消费成员为 Owner 或成员，访客不能作为新指定成员；历史记录里原有的已移除成员 ID 可以保持原值，但不能借此选择其他账本成员。Owner 可管理全部记录，成员只能编辑自己的记录，访客只读。
- 家庭汇总只覆盖所选共享账本，付款、消费归属、录入是独立视角。`public` 和 `multiple` 消费按记录人展示，每笔支出在消费视角只计一次；未知归入其他。`record/list` 可用 `familyFilter: { dimension: "payer" | "consumer" | "creator", openid }` 与日期、分类组合查询，付款/消费/录入筛选都由服务端在已授权账本范围内执行。
- 成员或访客可以退出；Owner 可以移除成员/访客及调整共享账本成员与访客的角色。以上操作保留历史记录与创建者字段，撤权后的访问由云函数重新校验。Owner 不能退出；唯一 Owner 可使用现有账本删除流程。
- 共享账本 Owner 可向现有成员发起所有权转移，接收方确认后在事务中更新 Owner，原 Owner 成为成员；双方可取消待处理申请。转移后旧邀请失效，`ownerEpoch` 防止所有权再次转回时旧邀请恢复有效；旧账本及邀请码缺省按版本 0 处理。

## 统计下钻

- `ledger/analysis/get` 支持 `week`、`month`、`year` 等时间模式。周度以周一开始，当前周截至当天，比较上周相同天数；周锚点为不晚于当天的 `YYYY-MM-DD`。可传 `analysisType` 为 `income` 或 `expense`，未传时默认支出。
- `analysisView: true` 时，分析响应新增 `dashboard`：包含所选类型总额、笔数、日均、分类及上期金额、账户、每日收支和最多五笔排名；月度还返回最近六个月汇总，周度返回上周每日趋势。金额以分累计，账户的 `missing` 区分空账户与同名的实际账户；原有响应字段保留。此响应为聚合快照，账目变动后需重新读取。

- 分类统计优先按 `categoryId` 汇总，同一 ID 的改名记录合并；未关联分类按 `parentCategory` 与 `categoryName` 的组合分别汇总，不凭同名合并。
- 分析页分类图标优先读取当前账本中对应分类 ID 的图标，并按时间从近到远返回该分类的不同记录快照图标作为回退；无 ID 的历史分类仅使用记录快照。客户端依次选择本地图标库中有效的名称，同一分类的预览记录统一显示该图标。图标只是展示属性，不修改记录和分类身份。
- `record/list` 的可选 `categoryFilter` 为 `{ kind: "id", id }` 或 `{ kind: "legacy", parent, name }`，分类筛选时必须指定 `income` 或 `expense`。服务端先判账本读权限，并用相同条件计算列表、数量与金额；`summaryFiltered` 可使时间下钻的类型筛选同样作用于汇总。
- `record/list` 可用 `accountFilter` 指定 `{ kind: "name", name }` 或 `{ kind: "missing" }`，须指定收入或支出。明细、总金额和笔数使用相同筛选；字面名称“未设置账户”与空账户分别统计。
- 目标环境需评估 `records` 的 `ledgerId, type, categoryId, date, createdAt, _id` 组合索引；未关联记录的父分类和子分类组合也需按实际查询计划建立索引。索引及空字段匹配行为必须在 CloudBase 测试环境核验。
- 分类删除先记录操作并标记处理中，仅按准确 `categoryId` 迁移记录，每次最多 250 条，再事务清理分类并确认完成；按 `hasMore` 重试。不会按旧名称猜测归属或递归迁移旧子类。该流程仍需在测试环境验证并发创建、断网重试和回滚；历史未关联记录若名称早已变更，无法可靠推断其原分类。
- 分类迁移进行时账本的 `categoryDeletionId` 记录正在处理的分类 ID，普通记账、编辑和导入事务暂时拒绝写入；清理完成后在同一事务中确认操作并清空该字段。迁移中断时应从分类管理再次执行删除以续传，不应手工清空标记。

## 多期比较

- `ledger/analysis/compare` 接收当前账本、`unit`（`month` 或 `year`）和不得重复的自然周期数组（重复输入拒绝，不自动去重）；最多 12 个月或 5 年，周期不早于当前年往前 10 年，不可选择未来周期。接口先重新校验账本读取权限。
- 按所选周期最早开始日至最晚结束日查询，最多读取 5000 条，超过上限返回错误而不截断；记录按日期及 ID 稳定排序。当前未结束周期仅统计截至当天的记录并标注 `partial`，历史周期按完整自然周期统计。返回各期收支、结余与按稳定分类身份聚合的金额。
- 当前前端服务没有多期比较封装，不能将云端接口能力描述为已上线页面。5000 条保护按最早至最晚的连续范围计算，包含未选中间周期的记录；常规分析没有这一统一上限。
- 测试环境需配置并评估 `records` 的 `ledgerId, date, _id` 索引，并测量 5000 条内的实际耗时；限额是保护边界，不代表性能验收已完成。金额汇总以分累计再转换为元；明细汇总使用聚合表达式逐条换算为分，其 CloudBase 执行结果仍需测试环境核对。

## 模板导入接口

- `record/import/upload-ticket` 为有写权限的调用者签发绑定账本与用户的随机上传路径；`record/import/preview` 校验凭证与文件路径并在事务内再次校验，领取后绑定完整文件 ID。`record/import/upload-abandon` 只能放弃未领取的上传并清理，已领取的上传按批次取消规则处理。预览最多读取 5 MB、200 行，返回有效行、原始行号、错误说明和文件 SHA-256，不写入账单记录。文件内相同日期、类型、金额及账户条目提示疑似重复，允许保留；未关联的分类名称明确提示。
- 已适配具备识别表头的微信支付和支付宝 CSV/XLSX 账单，支持 UTF-8、GB18030 与 UTF-16 文本；关闭或失败记录不可导入，退款、转账、还款、充值、提现和未知状态需人工确认成功及收支方向。来源账单分类暂不自动映射到已有分类，预览明确提示。
- 来源记录写入 `source`、`sourceTransactionId`、`sourceKind`、`sourceMerchant`、`sourceStatus`、`importBatchId`；缺失或精度不可靠的交易号不作为确定去重依据。`ledgerOperations` 中的来源身份标记按账本、来源、交易种类和交易号生成，用事务防止同源重复写入；退款与原交易使用不同种类，跨来源同日期、金额和交易对方只作为疑似重复提示。若日期范围内超过 2000 条记录，不进行跨来源比对并提示用户。
- 预览在 `ledgerOperations` 中创建 `record-import` 批次，记录操作人、账本、文件、文件哈希、选中行与已处理行；不存储账单行内容。客户端按环境、用户和账本保存未完成批次标识与所选行。
- `record/import` 接收批次 ID、选中的行号 `selectedRows`、需人工确认的收支方向及来源分类选择；服务端重新读取文件和账本，校验权限、文件哈希和每一行。选中行在首次提交后固定；每次事务最多写入 10 行，记录与进度及同步版本原子更新，返回 `hasMore` 供客户端继续。重复提交只处理未完成行；完成批次在操作日志保存结果摘要，同一操作者拥有写权限且选择一致时可在原文件不可用后重试获取相同结果。旧批次没有摘要时仍依赖原文件。
- 新预览使用 `import-file-reference` 事务标记记录同一文件的活动批次数。批次完成或未开始的预览取消时释放引用；最后一个引用释放后将文件标记为待删除并调用云存储删除，失败保留待删除标记供用户重试或再次进入导入页时扫描。未完成的批次保留文件直至用户继续或明确取消预览；已开始的批次不能通过取消预览接口取消。历史无引用标记的批次不自动删除文件；上传成功但客户端因中断未收到文件 ID 时，孤儿文件仍需管理员按环境核查处理。
- 已完成或已取消批次、文件引用标记及来源去重标记当前长期保留，以支持幂等重试和同源去重；它们不保存完整账单行。`ledgerOperations` 与导入文件必须通过云端权限规则限制访问；本地模拟测试不能替代 CloudBase 事务、权限、文件删除和中断恢复演练。部署前须核对现有活动旧批次与新引用标记不能并行争用同一文件，并配置文件引用及预览查询所需索引。

## CloudBase 索引

以下索引需要在目标 CloudBase 环境中配置并在发布前核对：

- `records`：`ledgerId ASC, date DESC, createdAt DESC, _id DESC`，用于记录游标分页。
- `records`：`ledgerId ASC, createdAt DESC`，用于最近记录查询。
- `ledgerInvites`：`token ASC`，唯一。
- `users`：`openid ASC`，唯一。
- `feedbacks`：`ownerOpenid ASC, createdAt DESC`，用于反馈历史。
- `ledgerOperations`：`type ASC, fileId ASC, _id ASC`，用于核查同一文件的历史批次；`type ASC, ownerOpenid ASC, status ASC, references ASC, updatedAt ASC` 用于待删除文件扫描；`type ASC, ledgerId ASC, ownerOpenid ASC, status ASC, createdAt ASC` 用于未确认预览列表。具体排序与索引可用性须在目标测试环境核验。

索引和 CloudBase 安全规则不由当前仓库自动部署；测试与生产环境需分别确认。

## 一致性边界

- 云函数从微信上下文取得身份，按接口需要读取用户，并重新读取账本判定角色，不信任客户端身份或权限字段。
- Owner 和成员的记录、账户等写入权限在云函数中重新校验；只读访客不能写入。
- 邀请领取、分类迁移和账本删除的具体一致性要求见 [WRITE-SAFETY.md](./WRITE-SAFETY.md)。
- 仓库没有 `plan/PENDING.md`。生产备份、迁移和恢复需要独立演练证据，不能由本文或本地测试推断已完成。

- `ledger/analysis/get` 的累计模式可传 `autoTrend: true`：记录跨度不超过 24 个自然月时返回逐月趋势，否则按年；`trendMeta.granularity` 标明 `month` 或 `year`。`recordRange` 为首条记录日期至末条记录次日的前闭后开范围，空账本为 `null`。未传该参数时保留累计按年的旧行为。自定义趋势按日，范围最多 366 天。

- 邀请码保存在 `ledgerInvites.token`，以安全随机数生成，`expiresAt` 为毫秒时间戳，24 小时有效。共享账本可邀请成员或访客，个人账本仅可邀请只读访客；领取与成员关系更新在同一事务内完成。邀请码预览和领取按 OpenID 在 `ledgerOperations` 中限制频率。固定账本邀请码接口已移除。`ledgerInvites.token` 唯一索引是创建邀请的必要条件，部署前在测试环境确认。
- Owner 可列出和撤销未使用邀请码；撤销标记为 `revokedAt`，预览及领取均检查此标记。邀请列表按 `ledgerId`、`ownerOpenid`、`expiresAt` 和 `_id` 查询，部署前在测试环境核验所需索引、权限及分页。分享链接和手工输入均需预览确认后加入；已有角色不会因邀请码改变。

- 新版不再给账本写入 `inviteCode` 和 `readonlyShareCode`。若测试环境保留了这两个字段的旧唯一索引，应在清空测试数据后的部署准备中核对并移除旧索引，避免缺失字段影响创建账本；索引调整需在测试环境验证，不能仅凭本地代码推断已生效。
