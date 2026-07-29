<div align="center">
  <img src="./design/assets/icon.png" width="112" alt="MoonMeter Logo" />
  <h1>MoonMeter</h1>
  <p><strong>Every token, in a clearer light.</strong></p>
  <p>面向开发者的本地优先用量、余额与成本工作台。</p>

  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-1.3.1-151515?style=flat-square" />
    <img alt="React" src="https://img.shields.io/badge/React-19.2-151515?style=flat-square&logo=react" />
    <img alt="Electron" src="https://img.shields.io/badge/Electron-31-151515?style=flat-square&logo=electron" />
    <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-B59A58?style=flat-square" />
  </p>

  <p>
    <a href="./README.en-US.md">English</a> ·
    <a href="./design/ARCHITECTURE.md">架构</a> ·
    <a href="./design/PROVIDERS.md">Provider</a> ·
    <a href="./drive/docs/ONE-CLICK-SERVER.md">自托管同步</a> ·
    <a href="https://github.com/2488652el/MoonMeter/releases">下载</a>
  </p>
</div>

![MoonMeter 使用统计](./design/screenshots/dashboard.png)

## MoonMeter 是什么

当开发工具、服务和账单分散在不同平台时，用量、余额、资源包和真实成本很难统一查看。MoonMeter 把这些信息集中到一款 Windows / macOS 桌面应用中，并默认将数据留在本机。

它不是另一个聊天客户端，而是一块专注于回答三个问题的仪表盘：

- Token 用到哪里了？
- 还剩多少额度？
- 不同服务和项目实际花了多少钱？

## 核心能力

| 能力          | 说明                                                          |
| ------------- | ------------------------------------------------------------- |
| 使用统计      | 汇总 API 请求与本地会话，支持本月至今与自定义账期             |
| 项目分析      | 按项目查看 Token、会话、活跃日期和折算后的统一成本            |
| Provider 汇总 | 聚合不同服务商的请求量、Token、费用与模型分布                 |
| 模型对比      | 对比费用排名、Provider、Token 构成、单次均值与计价覆盖        |
| 来源健康      | 只读检查 Windows / WSL 来源，所有启用、预览和同步均由用户触发 |
| 任务与交付    | 关联工作区、任务、提交和手工确认的 HTTPS 交付链接             |
| 时间线        | 按类型、状态和时间查看分页事件，旧详情自动按日聚合            |
| API Key 管理  | 使用 Electron `safeStorage` 本地加密，界面只显示 Key 尾号     |
| 余额与套餐    | 查询 API 余额、Coding Plan、Token 包、组织用量及聚合网关额度  |
| 请求日志      | 区分发生时成本与旧记录当前估算，并导出请求级价格口径          |
| 模型价格      | 搜索和筛选官方或自定义价格，支持币种换算、范围与变更审核      |
| 用量告警      | 原生系统通知、事件历史、已读状态与恢复后再次触发              |
| 本地集成      | 默认关闭的回环 HTTP JSON 接收器和独立 mini panel              |
| 多设备同步    | 可选同步设置、价格和余额快照，并支持本地备份及自托管服务      |

## 月光纸感界面

MoonMeter 采用米白纸面、黑白对比、发丝线和克制金色数据强调。主题支持“跟随系统 / 浅色 / 深色”，所有长动画都会服从 `prefers-reduced-motion`。

| API Keys                                      | 请求日志                                           |
| --------------------------------------------- | -------------------------------------------------- |
| ![API Keys](./design/screenshots/apikeys.png) | ![请求日志](./design/screenshots/request-logs.png) |

| 深色概览                                                       | 云端同步设置                                        |
| -------------------------------------------------------------- | --------------------------------------------------- |
| ![深色概览](./design/screenshots/moonmeter-dashboard-dark.png) | ![同步设置](./design/screenshots/settings-sync.png) |

## 隐私与安全

- API Key 由 Electron 主进程使用系统 `safeStorage` 加密，Renderer 不接触明文凭据。
- Renderer 保持沙箱隔离，不能访问 Node.js、文件系统、SQLite 或原始 IPC。
- 所有 Renderer → Main 输入均通过共享 schema 校验。
- 本地会话日志仅做只读增量解析，不修改原始文件。
- 默认不发送遥测；云端同步为可选功能，可使用自己的服务器。
- SQLite 数据库位于 Electron 用户数据目录，不会写进安装目录。

更完整的边界说明见 [design/ARCHITECTURE.md](./design/ARCHITECTURE.md)。
Windows/WSL 来源、项目/Git、时间线和本地 OTLP 的细粒度边界见
[design/LOCAL_DATA_PRIVACY.md](./design/LOCAL_DATA_PRIVACY.md)。

## 公开内容边界

公开仓库不包含个人路径、凭据、数据库、日志正文、提示词、命令参数、代码片段、工具输入输出、内部计划或构建安装包。上传前会从白名单 staging 目录生成并执行脱敏审计。

## 快速开始

### 环境要求

- Node.js 24（推荐使用仓库中的 `.nvmrc`）
- npm
- Windows 10/11，或受支持的 macOS 版本

### 本地运行

```bash
git clone https://github.com/2488652el/MoonMeter.git
cd MoonMeter
npm install
npm run dev
```

### 质量检查

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build
```

### Windows 打包

```powershell
npm run dist:win -- --change "MoonMeter-1.3.1" --model "release"
```

输出目录：

```text
demo/moonmeter-1.3.1-MoonMeter-1.3.1-release/
```

macOS 可使用 `npm run dist:mac:x64`、`npm run dist:mac:arm64` 或 `npm run dist:mac`。正式构建与历史版本请前往 [GitHub Releases](https://github.com/2488652el/MoonMeter/releases)。

## 服务与本地会话

内置目录覆盖多种兼容服务、组织用量、套餐额度和手动额度类型。具体能力、协议和价格来源见 [Provider 文档](./design/PROVIDERS.md)。

本地会话支持：

- Windows 与 WSL 本地 CLI 会话。
- 按来源上下文记录工作区、会话、Token 和成本。
- 日志按增量解析、去重并保留原始文件不变。

## 数据与升级兼容

MoonMeter 使用：

```text
moonmeter.db
```

首次启动时会从旧 TokenLub、TokenScope 或 tokengirl 用户目录复制兼容数据库及 SQLite WAL/SHM 边车文件。旧文件不会被移动或删除，因此可安全回滚。

同时保留以下兼容入口：

- `moonmeter://sync/bind` 为新的默认绑定协议。
- `tokenlub://sync/bind` 继续注册和解析。
- 新的 `moonmeter.*` 本地设置键会在需要时读取旧 `tokenlub.*` 值。
- `MOONMETER_*` 为新的环境变量前缀，关键发布变量继续接受 `TOKENLUB_*` 别名。

## 项目结构

```text
code/      Electron Main、Preload、React Renderer 与共享契约
drive/     可选同步服务、PostgreSQL、Docker 与运维脚本
design/    架构、Provider、动效、Logo、图标和产品截图
demo/      测试、验证资产与本地构建输出
github/    可公开上传的 allowlist、生成脚本与安全审计
```

## 技术栈

Electron 31 · React 19 · TypeScript · Vite · Tailwind CSS · Recharts · Zustand · SQLite · Vitest · Playwright · PostgreSQL（可选同步服务）

## 自托管同步

`drive/` 提供 PostgreSQL 同步服务、Web 控制台、Docker Compose，以及 Ubuntu 一键安装、备份、升级和卸载脚本。同步不是使用桌面端的前置条件。

部署说明：[drive/docs/ONE-CLICK-SERVER.md](./drive/docs/ONE-CLICK-SERVER.md)

## 参与开发

欢迎提交 Issue 和 Pull Request。修改前请先阅读：

- [架构边界](./design/ARCHITECTURE.md)
- [Provider 规范](./design/PROVIDERS.md)
- [动效规范](./design/MOTION.md)
- [更新日志](./CHANGELOG.md)

提交前请至少运行 `typecheck`、`test`、`lint` 与 `format:check`。

## 版本

当前源码版本：**MoonMeter 1.3.1**。本版将来源健康、项目任务归属、详细时间线、本地报告与可选 mini panel 收进同一套本地优先工作台，并继续保持所有本地数据控制在用户设备上。详见 [CHANGELOG.md](./CHANGELOG.md)。
