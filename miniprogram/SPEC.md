---
id: miniprogram
type: module-design
status: draft
title: 小程序客户端
parent: system-architecture
depends-on: [ledger-cloud]
references: [cache-policy, ui-guidelines, cloud-environments]
---

## 职责

承载微信小程序的页面、共享组件和客户端状态，完成账本与记录的交互、展示和同步。

## 边界

页面和组件通过服务层访问云端业务；服务层封装请求、状态和缓存，不拥有服务端权限裁决。通用视觉和交互遵循 `ui-guidelines`，缓存隔离与刷新遵循 `cache-policy`。
