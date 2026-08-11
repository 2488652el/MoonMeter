# CLAUDE.md

> 这是给 Claude Code 的桥接文件。项目规则的唯一事实源是 [AGENTS.md](./AGENTS.md)——先读它。

## 开工前必读

1. [AGENTS.md](./AGENTS.md) —— 项目规则、进程/目录边界、gate 命令。
2. [plan/COLLABORATION.md](./plan/COLLABORATION.md) —— 分支、worktree、交接与测试流程。
3. 当前任务对应的 `plan/handoffs/<任务>.md` —— 上一任负责人留下的实时记录。

## 关键约束（摘自 AGENTS.md，细节以原文为准）

- 渲染层保持沙箱：不访问 Node、SQLite、原始 IPC 或密钥。
- IPC 通道名与 schema 集中在 `code/src/shared/`。
- 发布前必过门禁：`npm run typecheck`、`npm test`、`npm run lint`、`npm run format:check`。
- 用户可见的未发布行为记录到 `CHANGELOG.md` → `Unreleased`。

## 协作要点

- 用独立 `claude/<task>` 分支 + 独立 worktree 开发，不要动 Codex 的 worktree。
- 每个可验证节点把代码和 handoff 一起做 WIP commit——未提交改动不会出现在另一边。
- 结束前更新本任务的 handoff（结论、证据、风险、下一步），不要保存整段聊天原文。
- 项目级长期进展合并进 [PROGRESS.md](./PROGRESS.md)，逐步操作不写进去。
