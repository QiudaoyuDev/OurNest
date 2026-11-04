---
id: system-architecture
type: architecture-design
status: draft
title: 系统架构与边界
parent: product-goal
---

## 系统结构

微信小程序 `miniprogram` 负责交互与客户端状态，通过服务层调用 `ledger-cloud`；云函数 `tomatoLedger` 负责业务、身份、权限及 CloudBase 数据访问。前端不直接绕过服务层调用业务云函数。请求使用 `{ route, payload }`，响应使用 `{ ok, data }` 或 `{ ok, error }`。

## 关键边界

- 云端重新读取用户和账本并判断权限；客户端显示控制和缓存不是安全边界。数据契约及角色约束见 `database-contract`，跨集合一致性见 `write-safety`。
- 缓存不能代替云端数据与权限，写入需云端确认；生命周期与失效规则见 `cache-policy`。
- 测试与生产环境隔离，发布前的环境约束见 `cloud-environments`。
- UI 的语义、公共组件和安全区边界见 `ui-guidelines`。

## 离线能力边界

本地缓存用于改善读取体验，不代表支持离线写入队列。
