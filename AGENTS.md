# MoonMeter project rules

## Multi-agent collaboration (Codex × Claude Code)

- Each agent works in its own branch + worktree: Claude uses `claude/<task>`,
  Codex uses `codex/<task>`. Never edit another agent's worktree.
- One task has exactly one writer at a time.
- Share code via Git commits; share progress via `plan/handoffs/<task>.md`.
- Before starting work, read `plan/COLLABORATION.md` and the current task's
  handoff. Before finishing, update that handoff (conclusion, evidence, risks,
  next action) — do not paste raw chat logs.
- Uncommitted changes are invisible to the other side: make WIP commits at each
  verifiable checkpoint. Long-term outcomes merge into `PROGRESS.md`.

## Project

MoonMeter is a Windows/macOS Electron desktop app for aggregating LLM usage,
balances, pricing, local coding-session costs, and optional self-hosted sync.

## Run and verify

- Install dependencies: `npm install`
- Start the desktop app: `npm run dev`
- Fast gates: `npm run typecheck`, `npm test`, `npm run lint`, `npm run format:check`
- Build locally: `npm run build`
- Release and publishing rules: `.omc/RELEASE_RULE.md`

## Stack and boundaries

- Electron 31, React 19, TypeScript, Vite, Tailwind, Vitest, and Playwright.
- Main owns SQLite, secrets, provider HTTP calls, local files, and native APIs.
- Preload is the only typed `window.api` bridge.
- Renderer stays sandboxed and must not access Node, SQLite, raw IPC, or secrets.
- Server code lives under `drive/src/server/` and uses PostgreSQL.

## Layout

- `code/`: desktop, preload, shared contracts, and build helpers.
- `drive/`: sync server, Docker, deployment docs, and operations.
- `demo/`: tests, temporary verification assets, and generated builds.
- `design/`: architecture, provider, motion, screenshot, and visual assets.
- `plan/`: timestamped plans and decision records.
- `github/`: allowlisted public repository staging and audit tooling.

## Project conventions

- Run commands from the repository root; root configs intentionally remain here.
- Keep IPC channel names and schemas in `code/src/shared/`.
- Record user-visible unreleased behavior under `CHANGELOG.md` → `Unreleased`.
- Treat `package.json` as the version source; keep release surfaces synchronized
  according to `.omc/RELEASE_RULE.md`.
- Publish source only from the generated `github/repository/` staging directory.
- Keep legacy `TokenLub` / `TokenScope` identifiers only where compatibility,
  migration, or existing server operations require them.
