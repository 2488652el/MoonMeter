<div align="center">
  <img src="./design/assets/icon.png" width="112" alt="MoonMeter Logo" />
  <h1>MoonMeter</h1>
  <p><strong>Every token, in a clearer light.</strong></p>
  <p>A local-first usage, balance, and cost workspace for developers.</p>

  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-1.3.1-151515?style=flat-square" />
    <img alt="React" src="https://img.shields.io/badge/React-19.2-151515?style=flat-square&logo=react" />
    <img alt="Electron" src="https://img.shields.io/badge/Electron-31-151515?style=flat-square&logo=electron" />
    <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-B59A58?style=flat-square" />
  </p>

  <p>
    <a href="./README.md">中文</a> ·
    <a href="./design/ARCHITECTURE.md">Architecture</a> ·
    <a href="./design/PROVIDERS.md">Providers</a> ·
    <a href="./drive/docs/ONE-CLICK-SERVER.md">Self-hosted sync</a> ·
    <a href="https://github.com/2488652el/MoonMeter/releases">Downloads</a>
  </p>
</div>

![MoonMeter usage dashboard](./design/screenshots/dashboard.png)

## What is MoonMeter?

When development tools, services, and billing records are spread across different products, usage, balances, plans, and real costs are hard to review together. MoonMeter brings them into one Windows and macOS desktop application while keeping data on your machine by default.

It is not another chat client. It is a focused dashboard for three questions:

- Where did the tokens go?
- How much quota is left?
- What did each service and project actually cost?

## Core capabilities

| Capability         | What it does                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Usage overview     | Combines API and local session usage with month-to-date and custom billing periods           |
| Project analytics  | Shows tokens, sessions, active dates, and normalized cost by coding project                  |
| Provider summary   | Aggregates requests, tokens, spend, and model distribution across providers                  |
| Model comparison   | Compares spend ranking, providers, token composition, request averages, and pricing coverage |
| Source health      | Checks Windows / WSL sources read-only; enable, preview, and sync actions are explicit       |
| Tasks and delivery | Associates workspaces, tasks, commits, and user-confirmed HTTPS delivery links               |
| Timeline           | Paginates events by type, status, and date while aggregating older detail by day             |
| API key management | Encrypts credentials locally with Electron `safeStorage`; the UI only sees key tails         |
| Balances and plans | Reads API balances, coding plans, token packages, organization usage, and gateway quota      |
| Request logs       | Separates occurrence-time cost from legacy current-price estimates in detail and CSV         |
| Model pricing      | Searches official and custom prices with currency conversion, scopes, and change review      |
| Usage alerts       | Sends native notifications with event history, read state, and recovery-based re-triggering  |
| Local integrations | Provides a loopback HTTP JSON receiver and separate mini panel, both disabled by default     |
| Multi-device sync  | Optionally syncs settings, prices, and balance snapshots with local backup support           |

## Moonlit paper interface

MoonMeter uses warm paper surfaces, black-and-white contrast, hairline borders, and restrained gold data accents. Appearance can follow the system or be set to light or dark. Long animations respect `prefers-reduced-motion`.

| API Keys                                      | Request logs                                           |
| --------------------------------------------- | ------------------------------------------------------ |
| ![API Keys](./design/screenshots/apikeys.png) | ![Request logs](./design/screenshots/request-logs.png) |

| Dark dashboard                                                       | Sync settings                                            |
| -------------------------------------------------------------------- | -------------------------------------------------------- |
| ![Dark dashboard](./design/screenshots/moonmeter-dashboard-dark.png) | ![Sync settings](./design/screenshots/settings-sync.png) |

## Privacy and security

- API keys are encrypted by the Electron main process with the operating system's `safeStorage` facility.
- The sandboxed renderer cannot access Node.js, the filesystem, SQLite, raw IPC, or plaintext secrets.
- Renderer-to-main payloads are validated through shared schemas.
- Local session logs are parsed incrementally and read-only; source files are never modified.
- No telemetry is added by default. Cloud sync is optional and can be self-hosted.
- The SQLite database lives under Electron's user-data directory, outside the installation directory.

See [design/ARCHITECTURE.md](./design/ARCHITECTURE.md) for the full process and trust boundaries.
See [design/LOCAL_DATA_PRIVACY.md](./design/LOCAL_DATA_PRIVACY.md) for the Windows/WSL,
project/Git, timeline, and local OTLP data boundaries.

## Public content boundary

The public repository excludes personal paths, credentials, databases, raw logs, prompts, command arguments, code snippets, tool inputs/outputs, internal plans, and generated installers. Uploads are generated from an allowlisted staging directory and pass a redacted-content audit.

## Quick start

### Requirements

- Node.js 24 (the repository includes an `.nvmrc`)
- npm
- Windows 10/11 or a supported macOS version

### Run locally

```bash
git clone https://github.com/2488652el/MoonMeter.git
cd MoonMeter
npm install
npm run dev
```

### Quality gates

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build
```

### Package for Windows

```powershell
npm run dist:win -- --change "MoonMeter-1.3.1" --model "release"
```

Output:

```text
demo/moonmeter-1.3.1-MoonMeter-1.3.1-release/
```

For macOS, use `npm run dist:mac:x64`, `npm run dist:mac:arm64`, or `npm run dist:mac`. Formal builds and historical versions are available from [GitHub Releases](https://github.com/2488652el/MoonMeter/releases).

## Services and local sessions

The built-in catalog covers compatible services, organization usage, plan quotas, and manual quota entries. See the [provider documentation](./design/PROVIDERS.md) for protocols, capabilities, and pricing sources.

Local session sources:

- Windows and WSL local CLI sessions.
- Workspace, session, token, and cost context per source.
- Incremental, deduplicated parsing that never modifies source logs.

## Data and upgrade compatibility

MoonMeter stores its local database as:

```text
moonmeter.db
```

On first launch, it can copy compatible databases and SQLite WAL/SHM sidecars from legacy TokenLub, TokenScope, or tokengirl user-data directories. Legacy files are never moved or deleted, so rollback remains possible.

Compatibility surfaces retained:

- `moonmeter://sync/bind` is the new default binding protocol.
- `tokenlub://sync/bind` remains registered and accepted.
- New `moonmeter.*` local keys can migrate values from legacy `tokenlub.*` keys.
- `MOONMETER_*` is the new environment prefix; critical release settings still accept `TOKENLUB_*` aliases.

## Repository layout

```text
code/      Electron Main, Preload, React Renderer, and shared contracts
drive/     Optional sync server, PostgreSQL, Docker, and operations
design/    Architecture, provider docs, motion, brand assets, and screenshots
demo/      Tests, verification assets, and local build output
github/    Public allowlist, staging generator, and secret audit
```

## Stack

Electron 31 · React 19 · TypeScript · Vite · Tailwind CSS · Recharts · Zustand · SQLite · Vitest · Playwright · PostgreSQL (optional sync service)

## Self-hosted sync

`drive/` includes the PostgreSQL sync service, web console, Docker Compose files, and Ubuntu scripts for installation, backup, upgrade, and uninstall. Sync is not required to use the desktop application.

Deployment guide: [drive/docs/ONE-CLICK-SERVER.md](./drive/docs/ONE-CLICK-SERVER.md)

## Contributing

Issues and pull requests are welcome. Before making changes, read:

- [Architecture boundaries](./design/ARCHITECTURE.md)
- [Provider conventions](./design/PROVIDERS.md)
- [Motion guidelines](./design/MOTION.md)
- [Changelog](./CHANGELOG.md)

Run at least `typecheck`, `test`, `lint`, and `format:check` before submitting a change.

## Version

Current source version: **MoonMeter 1.3.1**. This release brings source health, project task attribution, detailed timelines, local reports, and an optional mini panel into the same local-first workspace while keeping user data on the device. See [CHANGELOG.md](./CHANGELOG.md).
