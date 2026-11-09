---
id: ledger-cloud
type: module-design
status: draft
title: 记账云函数
parent: system-architecture
references: [database-contract, write-safety, cloud-environments]
---

## 职责

提供记账业务的路由入口、认证、权限判定、数据校验与持久化，处理账本、记录、分类、汇总分析、邀请和反馈。

## 边界

业务云函数以 `ourNest` 部署，客户端统一通过服务层使用同名调用；请求与响应遵循路由协议，运行环境约束见 `cloud-environments`。

从微信云上下文取得调用者身份，按路由分发给业务处理逻辑；数据模型与授权边界由 `database-contract` 描述，多步写入的安全要求由 `write-safety` 描述。业务热路径不创建集合，测试环境通过显式准备脚本初始化集合；索引与 CloudBase 安全规则仍需在目标环境单独核验，不由仓库自动部署。

分析和记录列表在服务端形成字段契约：分析返回真实聚合结果，不能用缺失字段或伪零值代替；记录列表支持首屏/后续页分级元数据。分析和列表在读取前后检查账本版本与权限，迁移中拒绝稳定快照；分批迁移保留可恢复阶段边界。分类默认修复及部分分类写入尚未和版本原子提交，版本围栏仍有盲区，完整一致性与发布验证见 `write-safety`。父分类改名在事务内更新子分类但对超出批量上限的扇出返回可重试错误，不产生部分改名。
