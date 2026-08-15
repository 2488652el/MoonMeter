# 2026-08-15 对抗式审查与 1.4.1 发布

Owner: Codex
Branch: codex/release-1.4.1
Worktree: D:\开发\tokengirl
Base: 48326ab (internal main; public origin/main remains 5bac01a)
Status: in-progress
Updated: 2026-08-15

## 结论

对抗式审查发现的 P0/P1/P2 问题已修复，当前工作树进入 1.4.1 发布验证阶段。公开源码仍必须从 `github/repository/` 生成并在临时 clone 中基于 `origin/main` 发布；内部完整历史保留在 `codex/release-1.4.1`。

## 修复内容

- **P0-1 自动更新强制重启**：`code/src/main/services/app-updater.ts` 移除下载完成 1 秒后 `quitAndInstall` 的定时器；新增 `installAppUpdate()` + IPC `app-update:install`（`ipc-channels.ts` / `preload/index.ts`），设置页新增「安装并重启」按钮（`Settings.tsx`）。`autoInstallOnAppQuit` 保留——退出时自动装，不强制重启。
- **P0-2 auth 限流**：`drive/src/server/http.ts` 新增 `AUTH_RATE_LIMITED_PATHS`（login/register/refresh/bind/verify-email/password）独立限流（默认 10 次/分钟，可经 `authRateLimit` 覆盖）；限流身份优先 Bearer → refreshToken → email（均哈希），不再信任可伪造的 `X-Forwarded-For`。
- **P0-3 limiter Map 淘汰**：`drive/src/server/rate-limit.ts` 增加 `maxTrackedKeys`（默认 50k），清理过期窗口后仍按插入序淘汰最旧 key，活动高基数也保持硬上限。
- **P0-4 ACCESS_TOKEN_SECRET**：核实无需改动——`drive/src/server/index.ts` 启动即走 `readPhase1Config()`，`z.string().min(32)` fail-fast。
- **P0-5 newapi-generic HTTP**：`code/src/main/providers/endpoint-policy.ts` 新增 `isPrivateNetworkHost()`（回环/RFC1918/链路本地/IPv6 ULA），HTTP 仅允许私网，公网必须 HTTPS。
- **P0-6 deep-link HTTP**：`code/src/main/sync/deep-link.ts` 的 `parseSyncBindingLink` 增加 `{ allowHttp }` 参数（默认拒绝 HTTP）；`code/src/main/index.ts` 仅在 `!app.isPackaged` 或 `MOONMETER_ALLOW_HTTP_SYNC=1` 时放行。
- **P2 更新器重复安装**：`installAppUpdate()` 增加 `installScheduled` 防重，连续 IPC 请求只安排一次 `quitAndInstall`，并补回归测试。
- **P2 Harness 增量同步**：`log_sync_state.parser_state` 保存 line/model/provider，追加同步只读新增 range，保留 header 上下文并避免重复统计；补 cache/unknown-provider/追加同步测试。
- **P2 认证绕过**：身份桶之外增加每认证路由共享桶；在没有可信 remoteAddress 的 Request adapter 中，轮换 bearer/refresh token 仍受实例级路由上限约束。

## 证据

- `demo/tests/unit/app-updater.test.ts`：改为断言「下载后 60s 不自动安装 + IPC install 触发安装 + 非 downloaded 状态 no-op」。
- `demo/tests/unit/server/rate-limit.test.ts`：新增淘汰测试（真实实现，`maxTrackedKeys: 100` 注入）。
- `demo/tests/unit/sync/server-http.test.ts`：新增同账号连续登录第 4 次 429 且不影响其他账号的测试。
- `demo/tests/unit/endpoint-policy.test.ts`：新增公网 HTTP（域名/8.8.8.8/172.32.x/172.15.x）拒绝断言。
- `demo/tests/unit/sync/deep-link.test.ts`：新增 HTTP 默认拒绝 + `allowHttp: true` 放行断言。
- 门禁：`npm run typecheck` ✓；`npm test -- --run` 696 passed / 1 skipped ✓；`npm run lint` ✓；`npm run format:check` ✓。
- `CHANGELOG.md` → Unreleased 已记录 4 条安全条目。

## 风险

- auth 限流仍无真实客户端 IP（web 标准 Request 不携带 socket 地址）；当前由身份桶 + 可配置共享路由桶共同防护，默认单路由 120/min，轮换 token 不能无限绕过，但同一实例的合法用户仍可能与攻击流量共享路由桶。后续可在 `runtime.ts` 的 `toRequest` 注入可信 `remoteAddress`，再按 IP/identity 分层限流。
- 已存在的 HTTP 型 newapi 私网配置不受影响；若有用户此前用「公网 HTTP」newapi 端点，升级后会被拒绝并提示改用 HTTPS（预期行为）。
- 内部 WIP 已提交于 `759172b`、`6cf98fa`；版本与发布面正在本分支继续提交。

## 下一步

1. 完成 `github:prepare` / `github:audit` 后，在临时 clone 中从 `origin/main` 发布公开源码。
2. 完成 Windows NSIS/portable 打包、校验文件、annotated tag、GitHub Release 和 CI 核验。
3. 如需按 IP 限流，在 `toRequest` 注入 remoteAddress 并更新 `authRateLimitIdentity`。

## P1 修复追加（2026-08-15）

### 已完成

- **P1 CI 缺失**：新增 `.github/workflows/ci.yml`（windows-latest，Node 跟随 `.nvmrc`=24，push/PR 触发，步骤：npm ci → typecheck → lint → format:check → test）；`github/manifest.txt` 增加 `.github` 并清除 trailing whitespace。
- **P1 https-proxy-agent 陈旧**：v5.0.1 → ^7.0.6（唯一使用点 `code/src/main/services/catalog-network.ts` API 兼容，typecheck + catalog-network 测试通过）。
- **P1 SQL 注入测试缺失**：`demo/tests/unit/sync/postgres-store.test.ts` 新增注入回归——恶意 email / 设备名 / 令牌哈希穿过 8 个 auth 存储方法，断言 SQL 文本零载荷、载荷全部走 params。

### 明确延期（需独立任务）

- **Electron 31 → 当前支持版**：跨 6+ 个 major（API 变更 + better-sqlite3 ABI + electron-vite 兼容矩阵），必须配合 Windows/macOS 双平台运行时冒烟验证，不适合与本次批量修复混做。
- **安全边界 Playwright e2e**（沙箱逃逸、preload 暴露面回归）：需要构建产物与专用环境，建议与 Electron 升级同任务排期。

### 证据

- 门禁：`npm run typecheck` ✓ / `npm test` 704 passed, 1 skipped ✓ / `npm run lint` ✓ / `npm run format:check` ✓ / `npm run build` ✓。
- 官方 Harness 源码核验：`deepseek-ai/deepseek-harness` commit `47f943859bef60e4160492346772ded9b24f765a`，确认 usage 字段与多 provider adapter 范围；未知 provider 不静默计价。
