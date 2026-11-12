---
id: cloud-environments
type: module-design
title: 云开发环境切换
status: draft
parent: system-architecture
---

# 云开发环境切换

环境配置的唯一入口是 `miniprogram/config/cloud-env.js`。

- 开发版（`develop`）和体验版（`trial`）自动使用 `test`。
- 正式版（`release`）自动使用 `production`。
- `production.id` 当前留空；创建生产环境后只填写该配置项。
- 本地临时切换可设置 `LOCAL_OVERRIDE` 为 `test` 或 `production`，提交前必须恢复为空。
- 环境 key 改变时，小程序清除登录、账本和分类缓存。相同 key 下替换环境 ID 不保证触发清理，需显式退出并清理缓存验证；不能据此承诺清除所有导入恢复信息或历史记录副本。
- 正式版缺少环境 ID 时必须明确失败，不能回退或误连测试环境。

上传正式版本前：

1. 确认 `production.id` 已配置。
2. 在生产环境部署同名 `ourNest` 云函数。
3. 核对生产环境集合、索引和安全规则。
4. 确认测试数据、用户数据和密钥未写入仓库。
5. 运行 `npm run verify` 并完成 `docs/REGRESSION.md`。

## 显式准备集合

仓库提供 [准备脚本](../scripts/prepare-cloud-environment.mjs)，但没有 `cloud:prepare:test` npm 命令。脚本需要可用的 `wx-server-sdk`、云端认证和明确的 `--environment=test`；生产需额外 `--allow-production`，不能仅因本地校验需要就运行。它准备八个集合，不自动部署索引、安全规则或云函数。反馈接口另有按需创建 `feedbacks` 的路径，不应宣称所有业务请求绝不创建集合。

## 云函数运行约定

业务云函数为 `ourNest`，本地目录 `cloudfunctions/ourNest/` 与客户端调用名一致。

- 云端配置需核对运行时、内存、环境变量、权限、触发器和告警；仓库中的超时配置为 20 秒。
- 请求通过统一服务层调用，写请求发生网络错误时不自动重放。
- 结构化请求日志的 `type` 为 `ourNest`，`errorLogs.type` 为 `ourNestError`。
- 默认头像为 `/images/brand/our-nest-logo-256-transparent.png`，导入模板由云函数生成并上传到 `templates/our-nest-import-template.xlsx`。
- 本地缓存遵循 [缓存与同步规则](./CACHE-POLICY.md)，数据库集合使用中性领域名称。
