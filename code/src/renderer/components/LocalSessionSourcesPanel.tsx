import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from './Card'
import { Icon } from './Icon'
import { ProviderIcon } from './ProviderIcon'
import { AnimatedNumber, MotionGroup } from './motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { fmtCount } from '../../shared/utils/money'
import type { SessionUsageSummary } from '../../shared/types/usage'
import type { CliDisplayPaths } from '../../shared/types/platform'

type SessionSource = 'claude-code' | 'codex' | 'kimi-code' | 'gemini-cli' | 'opencode'

type SessionCounts = {
  claude: number
  codex: number
  kimiCode: number
  gemini: number
  opencode: number
}

type SessionSyncTotals = {
  lines: number
  tokens: number
  inserted: number
}

type SessionStats = Record<
  SessionSource,
  {
    requests: number
    tokens: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    sessions: number
    models: number
    lastCapturedAt?: string
  }
>

const SESSION_AUTO_SYNC_KEY = 'session_auto_parse_enabled'

const SESSION_LABEL: Record<SessionSource, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex CLI',
  'kimi-code': 'Kimi Code CLI',
  'gemini-cli': 'Gemini CLI',
  opencode: 'OpenCode'
}

const SESSION_COUNT_KEY: Record<SessionSource, keyof SessionCounts> = {
  'claude-code': 'claude',
  codex: 'codex',
  'kimi-code': 'kimiCode',
  'gemini-cli': 'gemini',
  opencode: 'opencode'
}

const EMPTY_SESSION_STATS: SessionStats = {
  'claude-code': {
    requests: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    sessions: 0,
    models: 0
  },
  codex: {
    requests: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    sessions: 0,
    models: 0
  },
  'kimi-code': {
    requests: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    sessions: 0,
    models: 0
  },
  'gemini-cli': {
    requests: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    sessions: 0,
    models: 0
  },
  opencode: {
    requests: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    sessions: 0,
    models: 0
  }
}

/** 本地 Session 来源面板：发现、解析、同步和统计全部集中在“来源”页面。 */
export function LocalSessionSourcesPanel() {
  const [sessionCounts, setSessionCounts] = useState<SessionCounts | null>(null)
  const [sessionPaths, setSessionPaths] = useState<CliDisplayPaths | null>(null)
  const [sessionPathsLoading, setSessionPathsLoading] = useState(true)
  const [sessionPathsError, setSessionPathsError] = useState(false)
  const [sessionStats, setSessionStats] = useState<SessionStats>(EMPTY_SESSION_STATS)
  const [sessionAutoParse, setSessionAutoParse] = useState(false)
  const [sessionAutoLoaded, setSessionAutoLoaded] = useState(false)
  const [sessionSyncing, setSessionSyncing] = useState<Set<SessionSource>>(() => new Set())
  const [sessionProgress, setSessionProgress] = useState<
    Partial<Record<SessionSource, { file: string; lines: number; tokens: number }>>
  >({})
  const [sessionDone, setSessionDone] = useState<
    Partial<Record<SessionSource, { totals: SessionSyncTotals; error?: string }>>
  >({})
  const unsubProgress = useRef<(() => void) | null>(null)
  const unsubDone = useRef<(() => void) | null>(null)
  const reducedMotion = useReducedMotion()

  /** 刷新 Session 统计：发现会话文件并重新构建用量统计。 */
  const refreshSessionStats = useCallback(async () => {
    const [files, summaries] = await Promise.all([
      window.api.log
        .discover()
        .catch(() => ({ claude: [], codex: [], kimiCode: [], gemini: [], opencode: [] })),
      window.api.usage.getSessionSummaries().catch(() => [])
    ])
    setSessionCounts({
      claude: files.claude.length,
      codex: files.codex.length,
      kimiCode: files.kimiCode?.length ?? 0,
      gemini: files.gemini?.length ?? 0,
      opencode: files.opencode?.length ?? 0
    })
    setSessionStats(buildSessionStats(summaries))
  }, [])

  /** 同步指定来源的 Session 日志：发现文件、触发解析、更新统计。 */
  const syncSessionSource = useCallback(
    async (source: SessionSource) => {
      setSessionSyncing((prev) => new Set(prev).add(source))
      setSessionDone((prev) => {
        const next = { ...prev }
        delete next[source]
        return next
      })
      setSessionProgress((prev) => {
        const next = { ...prev }
        delete next[source]
        return next
      })

      try {
        const files = await window.api.log.discover()
        setSessionCounts({
          claude: files.claude.length,
          codex: files.codex.length,
          kimiCode: files.kimiCode?.length ?? 0,
          gemini: files.gemini?.length ?? 0,
          opencode: files.opencode?.length ?? 0
        })
        const count = files[SESSION_COUNT_KEY[source]]?.length ?? 0
        if (count === 0) {
          setSessionSyncing((prev) => {
            const next = new Set(prev)
            next.delete(source)
            return next
          })
          return
        }
        await window.api.log.sync(source)
        await refreshSessionStats()
      } catch (error) {
        setSessionDone((prev) => ({
          ...prev,
          [source]: {
            totals: { lines: 0, tokens: 0, inserted: 0 },
            error: (error as Error).message
          }
        }))
      } finally {
        setSessionSyncing((prev) => {
          const next = new Set(prev)
          next.delete(source)
          return next
        })
      }
    },
    [refreshSessionStats]
  )

  /** 同步全部来源的 Session 日志。 */
  const syncAllSessions = useCallback(async () => {
    await syncSessionSource('claude-code')
    await syncSessionSource('codex')
    await syncSessionSource('kimi-code')
    await syncSessionSource('gemini-cli')
    await syncSessionSource('opencode')
  }, [syncSessionSource])

  /** 加载 Session 面板：读取自动解析设置并刷新统计。 */
  const loadSessionPanel = useCallback(async () => {
    try {
      const [settings] = await Promise.all([window.api.settings.get(), refreshSessionStats()])
      setSessionAutoParse(settings[SESSION_AUTO_SYNC_KEY] === true)
    } finally {
      setSessionAutoLoaded(true)
    }
  }, [refreshSessionStats])

  useEffect(() => {
    void loadSessionPanel()
  }, [loadSessionPanel])

  useEffect(() => {
    unsubProgress.current = window.api.log.onSyncProgress((payload) => {
      if (
        payload.source !== 'claude-code' &&
        payload.source !== 'codex' &&
        payload.source !== 'kimi-code' &&
        payload.source !== 'gemini-cli' &&
        payload.source !== 'opencode'
      )
        return
      setSessionProgress((prev) => ({
        ...prev,
        [payload.source]: {
          file: payload.file,
          lines: payload.lines,
          tokens: payload.tokens
        }
      }))
    })

    unsubDone.current = window.api.log.onSyncDone((payload) => {
      if (
        payload.source !== 'claude-code' &&
        payload.source !== 'codex' &&
        payload.source !== 'kimi-code' &&
        payload.source !== 'gemini-cli' &&
        payload.source !== 'opencode'
      )
        return
      const source = payload.source
      setSessionDone((prev) => ({
        ...prev,
        [source]: {
          totals: payload.totals,
          ...(payload.error ? { error: payload.error } : {})
        }
      }))
      setSessionSyncing((prev) => {
        const next = new Set(prev)
        next.delete(source)
        return next
      })
      void refreshSessionStats()
    })

    return () => {
      unsubProgress.current?.()
      unsubDone.current?.()
    }
  }, [refreshSessionStats])

  useEffect(() => {
    void window.api.log
      .locations()
      .then(setSessionPaths)
      .catch(() => setSessionPathsError(true))
      .finally(() => setSessionPathsLoading(false))
  }, [])

  /** 切换自动解析开关并持久化设置。 */
  async function changeSessionAutoParse(enabled: boolean) {
    const previous = sessionAutoParse
    setSessionAutoParse(enabled)
    try {
      await window.api.settings.set(SESSION_AUTO_SYNC_KEY, enabled)
      if (enabled) await refreshSessionStats()
    } catch (error) {
      setSessionAutoParse(previous)
      window.alert(`更新自动解析开关失败：${(error as Error).message}`)
    }
  }

  return (
    <section data-local-session-sources aria-labelledby="local-session-sources-title">
      <div className="mb-3">
        <h2
          id="local-session-sources-title"
          className="text-[16px] font-semibold text-text-primary"
        >
          本地 Session 来源
        </h2>
        <p className="mt-1 text-[12px] text-text-muted">
          在来源页发现目录、解析本机会话并查看统计；解析结果会进入请求日志和用量概览。
        </p>
      </div>
      <Card className="mb-3" bodyClassName="py-3" motion="status">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-text-primary">会话目录与解析</div>
            <p className="mt-1 text-[12px] text-text-muted">
              只读发现 Claude Code、Codex、Kimi、Gemini 与 OpenCode 的本地日志。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors ${
                sessionAutoParse
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'border-neutral-200 bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
              onClick={() => void changeSessionAutoParse(!sessionAutoParse)}
              disabled={!sessionAutoLoaded}
              title={sessionAutoParse ? '点击关闭自动解析' : '点击开启自动解析'}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  sessionAutoParse ? 'bg-emerald-500' : 'bg-neutral-400'
                }`}
              />
              自动解析：{sessionAutoParse ? '开' : '关'}
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => void syncAllSessions()}
              disabled={sessionSyncing.size > 0}
            >
              <Icon
                name={sessionSyncing.size > 0 ? 'fa-arrows-rotate' : 'fa-code-branch'}
                className={sessionSyncing.size > 0 && !reducedMotion ? 'icon-spin' : ''}
              />{' '}
              解析全部
            </button>
          </div>
        </div>
      </Card>
      <MotionGroup className="mb-3 grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <SessionUsageCard
          source="claude-code"
          counts={sessionCounts}
          stats={sessionStats['claude-code']}
          syncing={sessionSyncing.has('claude-code')}
          progress={sessionProgress['claude-code']}
          done={sessionDone['claude-code']}
          path={sessionPaths?.claudeProjects}
          pathLoading={sessionPathsLoading}
          pathError={sessionPathsError}
          onSync={syncSessionSource}
        />
        <SessionUsageCard
          source="gemini-cli"
          counts={sessionCounts}
          stats={sessionStats['gemini-cli']}
          syncing={sessionSyncing.has('gemini-cli')}
          progress={sessionProgress['gemini-cli']}
          done={sessionDone['gemini-cli']}
          path={sessionPaths?.geminiTemp}
          pathLoading={sessionPathsLoading}
          pathError={sessionPathsError}
          onSync={syncSessionSource}
        />
        <SessionUsageCard
          source="opencode"
          counts={sessionCounts}
          stats={sessionStats.opencode}
          syncing={sessionSyncing.has('opencode')}
          progress={sessionProgress.opencode}
          done={sessionDone.opencode}
          path={sessionPaths?.opencodeMessages}
          pathLoading={sessionPathsLoading}
          pathError={sessionPathsError}
          onSync={syncSessionSource}
        />
        <SessionUsageCard
          source="codex"
          counts={sessionCounts}
          stats={sessionStats.codex}
          syncing={sessionSyncing.has('codex')}
          progress={sessionProgress.codex}
          done={sessionDone.codex}
          path={sessionPaths?.codexSessions}
          pathLoading={sessionPathsLoading}
          pathError={sessionPathsError}
          onSync={syncSessionSource}
        />
        <SessionUsageCard
          source="kimi-code"
          counts={sessionCounts}
          stats={sessionStats['kimi-code']}
          syncing={sessionSyncing.has('kimi-code')}
          progress={sessionProgress['kimi-code']}
          done={sessionDone['kimi-code']}
          path={sessionPaths?.kimiCodeSessions}
          pathLoading={sessionPathsLoading}
          pathError={sessionPathsError}
          onSync={syncSessionSource}
        />
      </MotionGroup>
    </section>
  )
}

/** 从请求日志构建按来源汇总的 Session 用量统计。 */
function buildSessionStats(summaries: SessionUsageSummary[]): SessionStats {
  const out: SessionStats = {
    'claude-code': { ...EMPTY_SESSION_STATS['claude-code'] },
    codex: { ...EMPTY_SESSION_STATS.codex },
    'kimi-code': { ...EMPTY_SESSION_STATS['kimi-code'] },
    'gemini-cli': { ...EMPTY_SESSION_STATS['gemini-cli'] },
    opencode: { ...EMPTY_SESSION_STATS.opencode }
  }
  for (const summary of summaries) {
    const source: SessionSource | null =
      summary.providerId === 'claude-code'
        ? 'claude-code'
        : summary.providerId === 'codex'
          ? 'codex'
          : summary.providerId === 'kimi-coding'
            ? 'kimi-code'
            : summary.providerId === 'gemini-cli'
              ? 'gemini-cli'
              : summary.providerId === 'opencode'
                ? 'opencode'
                : null
    if (!source) continue
    const stat = out[source]
    stat.requests = summary.requests
    stat.inputTokens = summary.inputTokens
    stat.outputTokens = summary.outputTokens
    stat.cacheReadTokens = summary.cacheReadTokens
    stat.cacheCreationTokens = summary.cacheCreationTokens
    stat.tokens = summary.totalTokens
    stat.sessions = summary.sessions
    stat.models = summary.models
    if (summary.lastCapturedAt) stat.lastCapturedAt = summary.lastCapturedAt
  }

  return out
}

/** 单个来源的 Session 用量卡片：展示会话文件数、请求、Token 与同步状态。 */
function SessionUsageCard({
  source,
  counts,
  stats,
  syncing,
  progress,
  done,
  path,
  pathLoading,
  pathError,
  onSync
}: {
  source: SessionSource
  counts: SessionCounts | null
  stats: SessionStats[SessionSource]
  syncing: boolean
  progress?: { file: string; lines: number; tokens: number } | undefined
  done?: { totals: SessionSyncTotals; error?: string } | undefined
  path?: string | undefined
  pathLoading: boolean
  pathError: boolean
  onSync: (source: SessionSource) => Promise<void>
}) {
  const fileCount = counts?.[SESSION_COUNT_KEY[source]] ?? 0
  const hasUsage = stats.requests > 0 || stats.tokens > 0
  const pathLabel = pathLoading ? '正在读取本机路径' : pathError ? '路径读取失败' : `扫描 ${path}`

  return (
    <Card
      title={SESSION_LABEL[source]}
      subtitle={pathLabel}
      motionOrder={
        source === 'claude-code'
          ? 0
          : source === 'codex'
            ? 1
            : source === 'kimi-code'
              ? 2
              : source === 'gemini-cli'
                ? 3
                : 4
      }
      iconNode={
        <ProviderIcon
          providerId={source === 'kimi-code' ? 'kimi-coding' : source}
          title={SESSION_LABEL[source]}
          size={18}
        />
      }
      action={
        <button
          className="btn btn-outline btn-sm"
          onClick={() => void onSync(source)}
          disabled={syncing}
        >
          {syncing ? '解析中…' : '解析入库'}
        </button>
      }
    >
      <div className="space-y-3 text-[13px]">
        <div className="grid grid-cols-3 gap-2">
          <MiniMetric label="会话文件" value={counts === null ? '—' : fileCount} />
          <MiniMetric label="请求记录" value={stats.requests} />
          <MiniMetric label="Tokens" value={stats.tokens} />
        </div>
        <div className="space-y-1 rounded border border-border-light bg-bg-base/40 px-2 py-1.5">
          <StatRow
            label="输入 / 输出"
            value={`${fmtCount(stats.inputTokens)} / ${fmtCount(stats.outputTokens)}`}
          />
          <StatRow
            label="缓存读 / 写"
            value={`${fmtCount(stats.cacheReadTokens)} / ${fmtCount(stats.cacheCreationTokens)}`}
          />
          <StatRow
            label="Session / 模型"
            value={`${fmtCount(stats.sessions)} / ${fmtCount(stats.models)}`}
          />
          <StatRow
            label="最近记录"
            value={stats.lastCapturedAt ? stats.lastCapturedAt.slice(0, 16).replace('T', ' ') : '—'}
          />
        </div>
        <SessionStatus
          source={source}
          fileCount={fileCount}
          hasUsage={hasUsage}
          syncing={syncing}
          progress={progress}
          done={done}
        />
      </div>
    </Card>
  )
}

/** 小型指标块：标签 + 等宽数值。 */
function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded border border-border-light bg-bg-base/40 px-2 py-2">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="truncate font-mono text-[13px] font-medium text-text-primary">
        {typeof value === 'number' ? (
          <AnimatedNumber value={value} format={(next) => fmtCount(next)} />
        ) : (
          value
        )}
      </div>
    </div>
  )
}

/** 统计行：标签 + 等宽值。 */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-text-muted">{label}</span>
      <span className="text-right font-mono text-text-secondary">{value}</span>
    </div>
  )
}

/** Session 同步状态文本：按解析中/完成/失败/空等状态展示对应提示。 */
function SessionStatus({
  source,
  fileCount,
  hasUsage,
  syncing,
  progress,
  done
}: {
  source: SessionSource
  fileCount: number
  hasUsage: boolean
  syncing: boolean
  progress?: { file: string; lines: number; tokens: number } | undefined
  done?: { totals: SessionSyncTotals; error?: string } | undefined
}) {
  if (done?.error) {
    return (
      <p role="alert" aria-live="assertive" className="text-[12px] text-status-red">
        {SESSION_LABEL[source]} 解析失败：{done.error}
      </p>
    )
  }

  if (syncing && progress) {
    return (
      <p role="status" aria-live="polite" className="animate-pulse text-[12px] text-text-secondary">
        正在解析 {progress.file}：{progress.lines.toLocaleString('en-US')} 行 /{' '}
        {progress.tokens.toLocaleString('en-US')} tokens
      </p>
    )
  }

  if (syncing) {
    return (
      <p role="status" aria-live="polite" className="animate-pulse text-[12px] text-text-secondary">
        正在解析本机会话日志…
      </p>
    )
  }

  if (done) {
    return (
      <p role="status" aria-live="polite" className="text-[12px] text-status-green">
        解析完成：{done.totals.lines.toLocaleString('en-US')} 行 /{' '}
        {done.totals.tokens.toLocaleString('en-US')} tokens，新增{' '}
        {done.totals.inserted.toLocaleString('en-US')} 条记录
      </p>
    )
  }

  if (fileCount === 0) {
    return (
      <p role="status" aria-live="polite" className="text-[12px] text-text-muted">
        未发现会话文件。
      </p>
    )
  }

  if (!hasUsage) {
    return (
      <p role="status" aria-live="polite" className="text-[12px] text-text-muted">
        已发现日志，点击“解析入库”后显示用量。
      </p>
    )
  }

  return (
    <p role="status" aria-live="polite" className="text-[12px] text-text-muted">
      已解析入库，可在请求日志和用量概览中继续查看。
    </p>
  )
}
