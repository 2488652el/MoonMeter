# 2026-08-15 DeepSeek Harness 本地用量追踪

Owner: Codex
Branch: codex/release-1.4.1
Worktree: D:\开发\tokengirl
Base: 48326ab (internal main; public origin/main remains 5bac01a)
Status: in-progress
Updated: 2026-08-15

## 结论

已新增 DeepSeek Harness 本地 Session 明文 `session.jsonl` 的发现、解析、同步与来源页展示。Harness 同步来源 ID 为 `deepseek-harness`；官方 DeepSeek provider route（`deepseek`、`deepseek-official`）才映射为 `provider_id=deepseek` 并参与 DeepSeek 定价，其他 provider 保留标识并标记 `unpriced`，避免静默错价。追加同步只读取新增字节并保存 parser state，能恢复 header/model/provider 上下文。

## 变更

- 新增 `code/src/main/log-parsers/deepseek-harness.ts`：解析首行 session header，读取官方 `assistant/message.data.usage` 中互斥的 `inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`；兼容早期实验字段但不重复相加。
- v28 为 `log_sync_state` 增加 `parser_state`；有状态追加同步按 byte range 读取，旧状态只首轮扫描前缀以恢复模型/Provider，完成行以外的尾部不会推进 offset。
- 扩展 CLI 来源 registry、IPC schema、preload 类型、平台路径、WSL/local-source 根路径和自动解析循环。
- 来源页新增 DeepSeek Harness 卡片，显示会话文件、请求、tokens、缓存读写与最近记录。
- `querySessionUsageSummaries()` 纳入 `provider_id='deepseek'` 的 session-log 汇总，供 DeepSeek Harness 卡片读取。
- `CHANGELOG.md` 的 1.4.1 已记录。

## 证据

- 官方仓库证据（`deepseek-ai/deepseek-harness`，commit `47f943859bef60e4160492346772ded9b24f765a`）：SessionEvent 使用 `seq/time`，usage 使用 `inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens`；通用 LLM adapter 可配置其他 provider，因此未知 provider 必须 unpriced。
- `npm run typecheck` 通过。
- `npm test` 通过：704 passed / 1 skipped。
- `npm run lint`、`npm run format:check`、`npm run build` 通过。
- 定向测试覆盖：`deepseek-harness.test.ts` 的 cache write 互斥、未知 provider unpriced、追加行/上下文/稳定 seq；另有 registry、platform paths、scheduler、session summary、IPC 输入测试。

## 风险

- 当前只解析明文 `session.jsonl`。官方 JSONL backend 默认可能生成 `.jsonl.zstd`，本次没有引入 zstd 解码依赖，压缩日志会被跳过。
- 默认扫描根为 `~/.dsh`；若用户把 Harness session root 配为项目内 `./.sessions`，需要后续增加手动选择目录或读取 Harness settings。
- 缺少模型或未知 provider 的记录保留 token 但标记 `unpriced`；不会猜测 `deepseek-chat` 或套用 DeepSeek 价格。

## 下一步

1. 如用户实际日志为 `.jsonl.zstd`，评估接入 zstd 解码或读取 Harness SQLite/query index。
2. 增加“选择 DeepSeek Harness session 根目录”的本地来源配置，覆盖项目级 `./.sessions`。
3. 完成 1.4.1 staging、公开 main、Windows 资产、tag、Release 与 CI 的发布核验。
