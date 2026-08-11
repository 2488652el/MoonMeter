# 仪表盘新组件全 App 落地与 1.4.0 发布

## 元信息

- Owner: Codex（承接 Claude Code）
- Claude branch: `claude/dashboard-v2-rollout`
- Release branch: `codex/release-1.4.0`
- Public base: `origin/main@c27cd5a`（MoonMeter 1.3.9）
- Status: done
- Updated: 2026-08-11

## 结论

MetricCard 与 SegmentedProgress 已落地到 Dashboard、额度、预算、分析、设置和告警页面；
业务 JSX 中旧 `ProgressBar` / `StatTile` 调用均已清零。首页四张主指标卡已在 desktop
和 compact 双断点按行验证等高。MoonMeter 1.4.0 已通过公开源码 staging 审计并发布。

## 集成记录

Claude 提交：

- `f8cbb08`：核心仪表盘落地与主卡齐平。
- `9858123`：全 App 进度/统计卡统一及初版等高断言。
- `e170330`：等待动画稳定并按行校验等高。

Codex 终审后追加：

- `09cb3ce`：修复 Provider 排行 `w-full + ml-8` 横向溢出、窄告警阈值 20 段不可读，
  并修正按 `Math.round(y)` 分组可能让错位卡片拆成单元素行而假通过的问题。
- `7aa68b5`：同步 1.4.0 版本面与发布说明。

本地 `main` 以 cherry-pick 方式整合为 `ed5932b`、`4863e5d`、`4c61c17`、
`47e6652`、`1530338`，保留本地协作骨架且没有合并旧 public staging 历史。

## 验证证据

- `npm run typecheck`：通过。
- `npm test`：132 个文件、691 passed、1 skipped、0 failed。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- `npm run build`：通过。
- Electron `motion-accessibility.spec.ts`：最终 8/8 通过；失败焦点用例额外连续重复 3 次通过。
- `npm run github:prepare` / `npm run github:audit`：通过，协作文件未进入 staging。
- Windows x64 NSIS 与 portable 打包：通过。

## 发布结果

- Public main: `5bac01a`（`release: v1.4.0`）
- Tag: `v1.4.0`
- Release: <https://github.com/2488652el/MoonMeter/releases/tag/v1.4.0>
- Installer SHA-256: `1EA96B315C273C3C578082A217D16BA763464E93B6F339B7FC5A164B186B8A04`
- Portable SHA-256: `9AC3B39BDDD32D03339377041A09B496B8F55AFF3E5903F9856DFB9BEF574F8A`

## 残余风险与下一步

- Windows EXE 当前未做代码签名。
- 构建仍有 `pricing-repo.ts` 同时静态/动态导入的既有 Vite 分块警告，不阻塞本次发布。
- Electron 侧栏焦点断言曾出现一次时序波动，随后连续 3 次及完整 8 项均通过；后续若再次出现，
  应单独收敛焦点测试时序，不要放宽功能断言。
- 后续公开发布继续只从 `github/repository/` staging 生成、审计与推送。
