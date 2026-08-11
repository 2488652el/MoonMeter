# 双 Agent 协作流程(Codex × Claude Code)

Codex 与 Claude Code 共用同一个 Git 仓库，但各自使用**独立的 worktree 与分支**，
通过 **Git 提交**共享代码，通过**仓库内的 handoff 文档**共享开发记录。

> 不要尝试互通两边的聊天历史或私有 memory——格式不同、易过期，也无法可靠映射到具体代码版本。

## 目录约定

```text
AGENTS.md              项目规则的唯一事实源(Codex 自动读取)
CLAUDE.md              薄桥接文件,要求 Claude 阅读 AGENTS.md 与 handoff
PROGRESS.md            合并后的项目级长期进展(不记逐步操作)
plan/
  COLLABORATION.md     本文件:分支、worktree、交接、测试流程
  handoffs/
    <任务>.md          每个任务一份实时开发记录,当前负责人维护
```

## 分支与 worktree

- Claude 用 `claude/<task>` 分支 + 独立 worktree。
- Codex 用 `codex/<task>` 分支 + 独立 worktree。
- **一个任务同一时间只有一个写入负责人**;不要让两个 Agent 同时改同一个 worktree。
- worktree 之间共享 Git 提交与分支元数据,但**文件副本彼此独立**——未提交改动不会出现在另一边。
- 不建议用 `.worktreeinclude` 同步开发记录:它只是创建 worktree 时复制一次文件,不是实时共享。

## 开工前

1. 读 `AGENTS.md`、`plan/COLLABORATION.md` 与对应 `plan/handoffs/<任务>.md`。
2. 确认基线:`git log --all --oneline --decorate -20`,把分支 rebase/对齐到最新 `main`。

## 进行中

- 每到可验证节点,把**代码 + 该任务 handoff** 一起做 WIP commit。
- 另一边无需切换 worktree 即可读取:
  ```bash
  git log --all --oneline --decorate -20
  git diff main...claude/<task>
  git show claude/<task>:plan/handoffs/<任务>.md
  ```

## 审查另一边的改动

- 已提交:直接读对方分支(见上)。
- 未提交(需显式审查时):
  ```bash
  git -C "D:/开发/tokengirl/.claude/worktrees/<name>" status --short
  git -C "D:/开发/tokengirl/.claude/worktrees/<name>" diff
  ```
  或生成 `.codex-review/` 自包含审查包(diff + 新增文件副本 + 说明)。

## 结束 / 交接

- 更新本任务 handoff:**结论、证据、风险、下一步**;不存整段聊天原文。
- handoff 顶部维护元信息:Owner / Branch / Worktree / Base / Status / Updated。
- Status 取值:`in-progress` → `review-needed` → `done`(或 `blocked`)。
- 验收门禁:`npm run typecheck`、`npm test`、`npm run lint`、`npm run format:check`(详见 `.omc/RELEASE_RULE.md`)。
- 任务合并后,把长期进展并入 `PROGRESS.md`,handoff 可归档留存。
