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

## 新增记账入口与分类

- Tabbar、首页、明细空态和创建账本后的新增入口直接打开 `record-edit` 新增模式；支出/收入及现有分类树在同页选择，分类管理为次级入口。
- 新增模式初始分类为空，不从默认名称或路由元数据隐式选中分类；切换收支类型清空分类但保留金额、日期、备注、账户等输入。金额有效且明确选择分类后才能保存，提交前再次校验。
- 分类读取与管理返回后的同步复用 category service/store；刷新后已删除的分类清空，分类加载失败可重试，加载中或失败时不可新增提交。
- 保存后继续记账保留用户明确选择的分类、账本、日期、账户和家庭归属，清空本笔金额、备注及标签；编辑模式保留既有分类重选与服务端权限判断。
