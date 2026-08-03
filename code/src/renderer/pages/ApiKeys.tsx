/**
 * API Keys 管理页面：展示密钥卡片、搜索与按供应商筛选，
 * 以及创建/编辑/导入/测试/删除/刷新/用量查询开关等操作。
 */
import { Icon } from '../components/Icon'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { ApiKeyCard, providerLabel } from '../components/ApiKeyCard'
import { CreateKeyModal } from '../components/CreateKeyModal'
import { EditKeyModal } from '../components/EditKeyModal'
import { Modal } from '../components/Modal'
import { ProviderIcon } from '../components/ProviderIcon'
import { AnimatedNumber, SortableCardGrid } from '../components/motion'
import { useCardOrder } from '../hooks/useCardOrder'
import type { ApiKeyCreateInput, ApiKeyRecord, ApiKeyUpdateInput } from '../../shared/types/api-key'
import type { BalanceSnapshot, ProviderManifest } from '../../shared/types/provider'
import type { ProviderCatalogEntry } from '../../shared/provider-catalog'

type TestConnectionDialogState = {
  alias: string
  status: 'testing' | 'success' | 'error'
  message?: string
  hint?: string
}

const API_KEY_CARD_ORDER_KEY = 'moonmeter.api-key-card-order.v1'

function apiKeyId(key: ApiKeyRecord): string {
  return key.id
}

function apiKeyLabel(key: ApiKeyRecord): string {
  return key.alias
}

/**
 * API Keys 管理页面组件。
 * 管理密钥列表、筛选与增删改查操作。
 */
export default function ApiKeys() {
  const [searchParams] = useSearchParams()
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [providers, setProviders] = useState<ProviderManifest[]>([])
  const [catalog, setCatalog] = useState<readonly ProviderCatalogEntry[]>([])
  const [balances, setBalances] = useState<
    Array<BalanceSnapshot & { id: number; apiKeyId?: string }>
  >([])
  const [createOpen, setCreateOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<ApiKeyRecord | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<ApiKeyRecord | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [testDialog, setTestDialog] = useState<TestConnectionDialogState | null>(null)
  const testRunRef = useRef(0)
  const [importing, setImporting] = useState(false)
  const [loading, setLoading] = useState(true)
  // simplest possible filter — a single text query + a single
  // providerId chip selection. No debounce; the list is bounded (<200 rows).
  const [search, setSearch] = useState(searchParams.get('account') ?? '')
  const [providerFilter, setProviderFilter] = useState<string | null>(searchParams.get('provider'))
  const { orderedItems: orderedKeys, reorderVisible } = useCardOrder(
    API_KEY_CARD_ORDER_KEY,
    keys,
    apiKeyId
  )

  /** 刷新密钥、供应商目录与余额列表 */
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [k, p, c, b] = await Promise.all([
        window.api.keys.list(),
        window.api.providers.list().catch(() => []),
        window.api.providers.catalog().catch(() => []),
        window.api.balance.latest().catch(() => [])
      ])
      setKeys(k)
      setProviders(p)
      setCatalog(c)
      setBalances(b)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** 计算可选供应商筛选列表(去重并排序) */
  const providerOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const k of keys) seen.add(k.providerId)
    return Array.from(seen).sort()
  }, [keys])

  /** 按搜索词与供应商筛选后的密钥列表 */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orderedKeys.filter((k) => {
      if (providerFilter && k.providerId !== providerFilter) return false
      if (
        q &&
        !k.id.toLowerCase().includes(q) &&
        !k.alias.toLowerCase().includes(q) &&
        !k.providerId.toLowerCase().includes(q)
      )
        return false
      return true
    })
  }, [orderedKeys, search, providerFilter])

  /** 创建新 Key 的保存回调 */
  async function handleSave(
    input: ApiKeyCreateInput,
    notes: { adminKeyStored: boolean; platformCookieStored: boolean }
  ) {
    try {
      await window.api.keys.add(input)
      setCreateOpen(false)
      await refresh()
      if (notes.platformCookieStored) {
        window.alert(
          '已保存。LongCat 平台 Cookie 已通过本机加密存储,刷新时会读取 Token 资源包余额。'
        )
        return
      }
      if (notes.adminKeyStored) {
        window.alert('已保存。Admin Key 已通过本机加密存储,刷新和测试连接会优先使用它。')
      }
    } catch (e) {
      window.alert(`创建失败：${(e as Error).message}`)
    }
  }

  /** 编辑 Key 的保存回调 */
  async function handleUpdate(input: ApiKeyUpdateInput) {
    try {
      await window.api.keys.update(input)
      setEditingKey(null)
      await refresh()
    } catch (e) {
      window.alert(`更新失败：${(e as Error).message}`)
    }
  }

  /** 打开删除确认弹窗。 */
  function handleDelete(k: ApiKeyRecord) {
    setDeleteError(null)
    setDeleteCandidate(k)
  }

  /** 确认删除 Key；错误留在弹窗内，便于用户决定是否重试。 */
  async function confirmDelete() {
    if (!deleteCandidate) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await window.api.keys.delete(deleteCandidate.id)
      setDeleteCandidate(null)
      await refresh()
    } catch (e) {
      setDeleteError((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  /** 测试 Key 连通性，并在应用内弹窗展示进行中与结果状态。 */
  function handleTest(id: string, alias: string) {
    const run = ++testRunRef.current
    setTestDialog({ alias, status: 'testing' })
    void window.api.keys
      .test(id)
      .then((result) => {
        if (testRunRef.current !== run) return
        if (result.ok) {
          setTestDialog({ alias, status: 'success', message: result.message })
          return
        }
        setTestDialog({
          alias,
          status: 'error',
          message: result.message,
          hint: hintForError(result.message)
        })
      })
      .catch((e) => {
        if (testRunRef.current !== run) return
        const message = (e as Error).message
        setTestDialog({ alias, status: 'error', message, hint: hintForError(message) })
      })
  }

  function closeTestDialog() {
    testRunRef.current += 1
    setTestDialog(null)
  }

  // cheap string-match hint for common HTTP error codes. Not a real
  // parser - just enough to nudge the user toward the obvious next step.
  //
  // 根据常见 HTTP 错误码给出简要提示文本。
  function hintForError(message: string): string {
    if (message.includes('401')) return ' → 检查 API key 是否正确 / 余额是否充足'
    if (message.includes('403')) return ' → 该 key 可能无权访问此资源'
    if (message.includes('429')) return ' → 调用频率过高,稍后重试'
    return ''
  }

  /** 从本机 CLI 凭据导入 Key */
  async function handleImportCLI(source: 'claude' | 'codex') {
    setImporting(true)
    try {
      const r = await window.api.keys.importFromCLI(source)
      if (r.imported && r.key) {
        window.alert(
          `已导入 ${source === 'claude' ? 'Claude Code' : 'Codex CLI'} 密钥 → "${r.key.alias}"`
        )
        await refresh()
      } else {
        window.alert(r.reason ?? '未找到已安装的 CLI 密钥')
      }
    } catch (e) {
      window.alert(`导入失败：${(e as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  // PR-3/4 wiring — per-key usage toggle round-trips through
  // window.api.keys.setUsageQuery and re-reads the list so the in-memory
  // record stays consistent with the repo.
  //
  // 切换单个 Key 的用量查询开关。
  async function handleToggleUsage(id: string, enabled: boolean) {
    try {
      await window.api.keys.setUsageQuery(id, enabled)
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, usageQueryEnabled: enabled } : k)))
    } catch (e) {
      window.alert(`更新用量查询开关失败：${(e as Error).message}`)
    }
  }

  // PR-4 only ships `refreshAll` (no per-key IPC). We invoke it
  // without an alert - treat it as a lightweight nudge and silently reload
  // so the user can see whether the bar moved.
  //
  // 刷新单个 Key 余额:实际调用 refreshAll 并静默重载列表。
  async function handleRefreshOne() {
    try {
      await window.api.usage.refreshAll()
      await refresh()
    } catch (e) {
      window.alert(`刷新失败：${(e as Error).message}`)
    }
  }

  // latest-by-key map for the balance summary field. Mirrors the
  // same pattern used in BalanceQuery so the two pages never disagree.
  //
  // 按 apiKeyId 保留最新一条余额快照,供卡片展示。
  const latestByKey = useMemo(() => {
    const m = new Map<string, BalanceSnapshot & { id: number; apiKeyId?: string }>()
    for (const b of balances) {
      if (!b.apiKeyId) continue
      const prev = m.get(b.apiKeyId)
      if (!prev || Date.parse(b.capturedAt) > Date.parse(prev.capturedAt)) {
        m.set(b.apiKeyId, b)
      }
    }
    return m
  }, [balances])

  const anyFilter = !!providerFilter || search.trim() !== ''

  return (
    <div className="page-content">
      <PageHeader
        title="API Keys"
        desc="管理你的 API 密钥,Windows DPAPI 加密存储"
        action={
          <div className="flex items-center gap-2">
            <button
              className="btn btn-outline btn-sm"
              onClick={() => handleImportCLI('claude')}
              disabled={importing}
              title="从 ~/.claude/.credentials.json 或 ANTHROPIC_API_KEY 环境变量检测"
            >
              <Icon name="fa-file-import" /> 导入 Claude
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => handleImportCLI('codex')}
              disabled={importing}
              title="从 ~/.codex/auth.json 或 OPENAI_API_KEY 环境变量检测"
            >
              <Icon name="fa-file-import" /> 导入 Codex
            </button>
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Icon name="fa-plus" /> 创建新 Key
            </button>
          </div>
        }
      />

      {loading ? (
        <Card>
          <EmptyState icon="fa-spinner" title="加载中…" hint="读取本地加密数据库" />
        </Card>
      ) : keys.length === 0 ? (
        <Card>
          <EmptyState
            icon="fa-key"
            title="尚未添加任何 Key"
            hint="点击右上角 '创建新 Key' 或 '导入 Claude/Codex'"
            action={
              <div className="flex items-center gap-2 mt-2">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => handleImportCLI('claude')}
                  disabled={importing}
                >
                  <Icon name="fa-file-import" /> 导入 Claude
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => handleImportCLI('codex')}
                  disabled={importing}
                >
                  <Icon name="fa-file-import" /> 导入 Codex
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                  <Icon name="fa-plus" /> 创建新 Key
                </button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="mb-3" bodyClassName="py-3">
            <div className="flex items-center gap-4 flex-wrap text-[12.5px]">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <Icon name="fa-magnifying-glass" className="text-text-muted text-[12px]" />
                <input
                  className="input flex-1"
                  placeholder="搜索 alias 或 provider"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-text-muted">Provider</span>
                <FilterChip active={!providerFilter} onClick={() => setProviderFilter(null)}>
                  全部
                </FilterChip>
                {providerOptions.map((p) => (
                  <FilterChip
                    key={p}
                    active={providerFilter === p}
                    onClick={() => setProviderFilter(providerFilter === p ? null : p)}
                  >
                    <ProviderIcon providerId={p} title={providerLabel(p, providers)} size={14} />
                    <span>{p}</span>
                  </FilterChip>
                ))}
                {anyFilter && (
                  <button
                    className="btn btn-outline btn-xs"
                    onClick={() => {
                      setSearch('')
                      setProviderFilter(null)
                    }}
                  >
                    <Icon name="fa-xmark" /> 清空筛选
                  </button>
                )}
              </div>
            </div>
          </Card>
          {filtered.length === 0 ? (
            <Card>
              <div className="text-center text-text-muted py-8 text-[13px]">
                当前筛选下没有条目。
              </div>
            </Card>
          ) : (
            <SortableCardGrid
              items={filtered}
              getId={apiKeyId}
              getLabel={apiKeyLabel}
              onReorder={reorderVisible}
              className="grid grid-cols-2 gap-4 max-lg:grid-cols-1"
              ariaLabel="API Key 卡片顺序"
              renderItem={(k) => (
                <ApiKeyCard
                  keyRecord={k}
                  balance={latestByKey.get(k.id)}
                  providerDisplayName={providerLabel(k.providerId, providers)}
                  onEdit={setEditingKey}
                  onTest={handleTest}
                  onDelete={handleDelete}
                  onRefreshOne={handleRefreshOne}
                  onToggleUsage={handleToggleUsage}
                />
              )}
            />
          )}
          {keys.length > 0 && (
            <div className="pt-3 mt-2 text-[12px] text-text-muted flex items-center justify-between">
              <span>
                共 <AnimatedNumber value={keys.length} /> 条{' '}
                {anyFilter && (
                  <>
                    · 显示 <AnimatedNumber value={filtered.length} /> 条
                  </>
                )}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="fa-grip-lines" className="text-[10px]" />
                拖动卡片调整顺序
              </span>
            </div>
          )}
        </>
      )}

      {createOpen && (
        <CreateKeyModal
          catalog={catalog}
          onClose={() => setCreateOpen(false)}
          onSave={handleSave}
        />
      )}
      {editingKey && (
        <EditKeyModal
          keyRecord={editingKey}
          catalog={catalog}
          onClose={() => setEditingKey(null)}
          onSave={handleUpdate}
        />
      )}
      {deleteCandidate && (
        <DeleteKeyDialog
          keyRecord={deleteCandidate}
          deleting={deleting}
          error={deleteError}
          onClose={() => {
            if (!deleting) setDeleteCandidate(null)
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}
      {testDialog && <TestConnectionDialog state={testDialog} onClose={closeTestDialog} />}
    </div>
  )
}

function DeleteKeyDialog({
  keyRecord,
  deleting,
  error,
  onClose,
  onConfirm
}: {
  keyRecord: ApiKeyRecord
  deleting: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal title="删除 API Key" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
            <Icon name="fa-trash-can" />
          </span>
          <div>
            <h3 className="text-[14px] font-semibold text-text-primary">
              删除 “{keyRecord.alias}”？
            </h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
              删除后无法恢复，相关余额与历史关联会停止更新。
            </p>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-border-light bg-bg-base/45 px-3 py-2.5 text-[12px]">
          <div className="flex items-center justify-between gap-4">
            <span className="text-text-muted">Provider</span>
            <span className="font-mono text-text-secondary">{keyRecord.providerId}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-text-muted">Key 末位</span>
            <span className="font-mono text-text-secondary">…{keyRecord.keyTail}</span>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700"
          >
            删除失败：{error}
          </p>
        )}

        <div className="-mx-5 -mb-5 flex justify-end gap-2 border-t border-border-light bg-bg-base/30 px-5 py-4">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={deleting}>
            取消
          </button>
          <button
            type="button"
            className="btn border-red-600 bg-red-600 text-white hover:border-red-700 hover:bg-red-700"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? (
              <Icon name="fa-spinner" className="animate-spin" />
            ) : (
              <Icon name="fa-trash-can" />
            )}
            {deleting ? '删除中…' : '确认删除'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function TestConnectionDialog({
  state,
  onClose
}: {
  state: TestConnectionDialogState
  onClose: () => void
}) {
  const testing = state.status === 'testing'
  const success = state.status === 'success'
  const visual = testing
    ? {
        icon: 'fa-spinner',
        className: 'animate-spin bg-blue-50 text-blue-600',
        title: '正在测试连接'
      }
    : success
      ? { icon: 'fa-circle-check', className: 'bg-emerald-50 text-emerald-600', title: '连接正常' }
      : { icon: 'fa-triangle-exclamation', className: 'bg-red-50 text-red-600', title: '连接失败' }

  return (
    <Modal title="测试连接" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${visual.className}`}
          >
            <Icon name={visual.icon} />
          </span>
          <div>
            <h3 className="text-[14px] font-semibold text-text-primary">{visual.title}</h3>
            <p className="mt-1 text-[12.5px] text-text-secondary">API Key：{state.alias}</p>
          </div>
        </div>

        <div
          aria-live="polite"
          className="rounded-lg border border-border-light bg-bg-base/45 px-3 py-3 text-[12.5px] leading-relaxed text-text-secondary"
        >
          {testing ? '正在向服务商发起验证，请稍候…' : state.message}
        </div>

        {state.hint && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
            <Icon name="fa-lightbulb" className="mr-1" /> 建议：{state.hint}
          </p>
        )}

        <div className="-mx-5 -mb-5 flex justify-end border-t border-border-light bg-bg-base/30 px-5 py-4">
          <button type="button" className="btn btn-primary" onClick={onClose} disabled={testing}>
            {testing ? '测试中…' : '完成'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** 筛选胶囊按钮:高亮当前选中项 */
function FilterChip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[12px] border transition-colors ${
        active
          ? 'bg-accent text-text-primary border-accent'
          : 'bg-bg-base text-text-secondary border-border-light hover:border-text-muted'
      } inline-flex items-center gap-1.5`}
    >
      {children}
    </button>
  )
}
