---
id: ledger-cloud
type: module-design
status: draft
title: 记账云函数
parent: system-architecture
references: [database-contract, write-safety]
---

## 职责

提供记账业务的路由入口、认证、权限判定、数据校验与持久化，处理账本、记录、分类、汇总分析、邀请和反馈。

## 边界

从微信云上下文取得调用者身份，按路由分发给业务处理逻辑；数据模型与授权边界由 `database-contract` 描述，多步写入的安全要求由 `write-safety` 描述。索引与 CloudBase 安全规则需在目标环境单独核验，不由仓库自动部署。
