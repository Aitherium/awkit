'use client'

/**
 * SecretguardPanel — git secret detection & history purge (product: secretguard)
 *
 * Four tabs over the Genesis SecretGuard router (Layer 2):
 *   Scan      — run gitleaks over the working tree or git history
 *   Allowlist — list and add `.gitleaks.toml` allowlist paths / regexes
 *   Purge     — remove files from git history (dry run first, always)
 *   Hooks     — install a gitleaks pre-commit / pre-push hook
 *
 * ENDPOINT CONTRACT (relative to `apiBase`, default
 * `/api/bridge/genesis/api/v1/secretguard`), mirroring the Layer 2 router
 * `apps/AitherGenesis/routers/secretguard.py`. Paths, JSON body field names and
 * query parameter names are asserted against that router's pydantic models by
 * `dev/tests/test_secretguard_productization.py` — change both sides together:
 *   POST /scan       {mode, depth, repo_path, config_path}  -> {status, data: {leaks, count, ...}}
 *   GET  /allowlist?repo_path=                              -> {status, data: {paths, regexes, commits, config_path}}
 *   POST /allowlist  {entry_type, value, repo_path}         -> {status, data: {status, ...}}
 *   POST /purge      {paths, repo_path, dry_run}            -> {status, data: {status, commits_rewritten, ...}}
 *   POST /hooks      {hook, repo_path, force}               -> {status, data: {status, ...}}
 *
 * PLATFORM-OPERATOR SURFACE: every endpoint acts on a repo on the
 * Genesis host, so the router answers 401 to an anonymous caller and 403 to
 * anyone who is not a platform operator — a tenant admin included. The panel
 * routes 401 to a sign-in view and 403 to a "platform operators only" view, and
 * never renders either as an empty result. It sends no tenant/user ids.
 *
 * Leak matches are MASKED in the UI (first 6 characters) — the router already
 * truncates them, and a panel is not the place to re-display a credential.
 * Purge defaults to dry run; a real rewrite needs the operator to type PURGE.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { AlertCircle, GitCommit, Lock, RefreshCw, Search, ShieldAlert, Trash2 } from 'lucide-react'

type TabMode = 'scan' | 'allowlist' | 'purge' | 'hooks'
type HookKind = 'pre-commit' | 'pre-push' | 'both'
type Access = 'unknown' | 'ok' | 'signin' | 'forbidden'

interface Leak {
  rule?: string
  file?: string
  line?: number
  commit?: string
  author?: string
  date?: string
  match?: string
}

interface ScanResult {
  leaks?: Leak[]
  count?: number
  scan_mode?: string
  commits_scanned?: number
  config_used?: string | null
  error?: string
}

interface AllowlistResult {
  paths?: string[]
  regexes?: string[]
  commits?: string[]
  config_path?: string | null
  error?: string
}

interface PurgeResult {
  status?: string
  paths_purged?: string[]
  commits_rewritten?: number
  dry_run?: boolean
  error?: string
  [key: string]: unknown
}

interface HookResult {
  status?: string
  error?: string
  [key: string]: unknown
}

interface SecretguardPanelProps {
  apiBase?: string
}

/** 401 from the router: route to the sign-in view. */
export class SecretguardSignInError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretguardSignInError'
  }
}

/** 403 from the router: this caller is not a platform operator. */
export class SecretguardForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretguardForbiddenError'
  }
}

const ACCENT = '#dc2626'
const PURGE_CONFIRM_WORD = 'PURGE'

/** Mask a leaked value to its first 6 characters. Never render the full match. */
export function maskMatch(match: string | undefined): string {
  if (!match) return ''
  return match.length <= 6 ? '•'.repeat(match.length) : `${match.slice(0, 6)}…`
}

function detailMessage(body: any): string {
  const detail = body?.detail ?? body
  if (Array.isArray(detail)) {
    return detail.map((d: any) => (typeof d?.msg === 'string' ? d.msg : JSON.stringify(d))).join('; ')
  }
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') return String(detail.message || detail.error || JSON.stringify(detail))
  return 'request failed'
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export default function SecretguardPanel({
  apiBase = '/api/bridge/genesis/api/v1/secretguard',
}: SecretguardPanelProps) {
  const [tab, setTab] = useState<TabMode>('scan')
  const [access, setAccess] = useState<Access>('unknown')
  const [repoPath, setRepoPath] = useState('')

  // scan
  const [mode, setMode] = useState<'tree' | 'history'>('tree')
  const [depth, setDepth] = useState(0)
  const [configPath, setConfigPath] = useState('')
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  // allowlist
  const [allowlist, setAllowlist] = useState<AllowlistResult | null>(null)
  const [allowLoading, setAllowLoading] = useState(false)
  const [allowError, setAllowError] = useState<string | null>(null)
  const [entryType, setEntryType] = useState<'path' | 'regex'>('path')
  const [entryValue, setEntryValue] = useState('')
  const [allowNote, setAllowNote] = useState<string | null>(null)

  // purge
  const [purgePaths, setPurgePaths] = useState('')
  const [confirmWord, setConfirmWord] = useState('')
  const [purge, setPurge] = useState<PurgeResult | null>(null)
  const [purging, setPurging] = useState(false)
  const [purgeError, setPurgeError] = useState<string | null>(null)

  // hooks
  const [hookKind, setHookKind] = useState<HookKind>('pre-commit')
  const [hookForce, setHookForce] = useState(false)
  const [hookResult, setHookResult] = useState<HookResult | null>(null)
  const [installing, setInstalling] = useState(false)
  const [hookError, setHookError] = useState<string | null>(null)

  const call = useCallback(
    async (method: 'GET' | 'POST', path: string, body?: Record<string, unknown>) => {
      const res = await fetch(`${apiBase}${path}`, {
        method,
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      let data: any = null
      try {
        data = await res.json()
      } catch {
        data = null
      }
      if (res.status === 401) throw new SecretguardSignInError(detailMessage(data))
      if (res.status === 403) throw new SecretguardForbiddenError(detailMessage(data))
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${detailMessage(data)}`)
      setAccess('ok')
      return data?.data ?? data
    },
    [apiBase],
  )

  /** Route auth errors to the access views; return the message for anything else. */
  const handleError = useCallback((e: unknown): string | null => {
    if (e instanceof SecretguardSignInError) {
      setAccess('signin')
      return null
    }
    if (e instanceof SecretguardForbiddenError) {
      setAccess('forbidden')
      return null
    }
    return errMsg(e)
  }, [])

  const loadAllowlist = useCallback(async () => {
    setAllowLoading(true)
    setAllowError(null)
    try {
      const qs = repoPath ? `?repo_path=${encodeURIComponent(repoPath)}` : ''
      const data: AllowlistResult = await call('GET', `/allowlist${qs}`)
      if (data?.error) setAllowError(data.error)
      setAllowlist(data)
    } catch (e) {
      setAllowError(handleError(e))
    } finally {
      setAllowLoading(false)
    }
  }, [call, handleError, repoPath])

  // The first real read decides access; there is no separate probe to drift.
  useEffect(() => {
    loadAllowlist()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runScan = async () => {
    setScanning(true)
    setScanError(null)
    setScan(null)
    try {
      const data: ScanResult = await call('POST', '/scan', {
        mode,
        depth,
        repo_path: repoPath,
        config_path: configPath,
      })
      if (data?.error) setScanError(data.error)
      setScan(data)
    } catch (e) {
      setScanError(handleError(e))
    } finally {
      setScanning(false)
    }
  }

  const addEntry = async () => {
    if (!entryValue.trim()) return
    setAllowNote(null)
    setAllowError(null)
    try {
      const data = await call('POST', '/allowlist', {
        entry_type: entryType,
        value: entryValue.trim(),
        repo_path: repoPath,
      })
      if (data?.error) {
        setAllowError(data.error)
        return
      }
      setAllowNote(data?.status === 'exists' ? 'Already allowlisted.' : 'Added.')
      setEntryValue('')
      await loadAllowlist()
    } catch (e) {
      setAllowError(handleError(e))
    }
  }

  const runPurge = async (dryRun: boolean) => {
    const paths = purgePaths.split('\n').map((p) => p.trim()).filter(Boolean)
    if (!paths.length) return
    if (!dryRun && confirmWord !== PURGE_CONFIRM_WORD) return
    setPurging(true)
    setPurgeError(null)
    setPurge(null)
    try {
      const data: PurgeResult = await call('POST', '/purge', {
        paths,
        repo_path: repoPath,
        dry_run: dryRun,
      })
      if (data?.error) setPurgeError(String(data.error))
      setPurge(data)
      if (!dryRun) setConfirmWord('')
    } catch (e) {
      setPurgeError(handleError(e))
    } finally {
      setPurging(false)
    }
  }

  const installHook = async () => {
    setInstalling(true)
    setHookError(null)
    setHookResult(null)
    try {
      const data: HookResult = await call('POST', '/hooks', {
        hook: hookKind,
        repo_path: repoPath,
        force: hookForce,
      })
      if (data?.error) setHookError(String(data.error))
      setHookResult(data)
    } catch (e) {
      setHookError(handleError(e))
    } finally {
      setInstalling(false)
    }
  }

  if (access === 'signin' || access === 'forbidden') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
        <Lock className="w-8 h-8" style={{ color: ACCENT }} />
        <div className="text-sm font-medium">
          {access === 'signin' ? 'Sign in to use SecretGuard' : 'SecretGuard is for platform operators only'}
        </div>
        <div className="text-xs opacity-70 max-w-md">
          {access === 'signin'
            ? 'The SecretGuard API needs an authenticated session.'
            : 'Scanning and rewriting repositories on the platform host is a platform-operator action; workspace admins cannot run it.'}
        </div>
      </div>
    )
  }

  const tabBtn = (id: TabMode, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`px-3 py-1.5 text-xs rounded ${tab === id ? 'font-semibold' : 'opacity-60'}`}
      style={tab === id ? { borderBottom: `2px solid ${ACCENT}` } : undefined}
    >
      {label}
    </button>
  )

  const errorBox = (msg: string | null) =>
    msg ? (
      <div className="flex items-start gap-2 text-xs p-2 rounded border border-red-500/40 text-red-400">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>{msg}</span>
      </div>
    ) : null

  return (
    <div className="flex flex-col h-full gap-3 p-4 text-sm">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5" style={{ color: ACCENT }} />
        <span className="font-semibold">SecretGuard</span>
        <span className="text-xs opacity-60">git secret detection &amp; history purge</span>
      </div>
      <input
        className="w-full px-2 py-1 text-xs rounded border bg-transparent"
        placeholder="Repository path on the platform host (empty = default repo)"
        value={repoPath}
        onChange={(e) => setRepoPath(e.target.value)}
      />
      <div className="flex gap-1 border-b">
        {tabBtn('scan', 'Scan')}
        {tabBtn('allowlist', 'Allowlist')}
        {tabBtn('purge', 'Purge')}
        {tabBtn('hooks', 'Hooks')}
      </div>

      {tab === 'scan' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2 items-center">
            <select
              className="px-2 py-1 text-xs rounded border bg-transparent"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'tree' | 'history')}
            >
              <option value="tree">Working tree</option>
              <option value="history">Git history</option>
            </select>
            {mode === 'history' && (
              <input
                type="number"
                min={0}
                className="w-28 px-2 py-1 text-xs rounded border bg-transparent"
                title="Recent commits to scan (0 = all)"
                value={depth}
                onChange={(e) => setDepth(Math.max(0, Number(e.target.value) || 0))}
              />
            )}
            <input
              className="flex-1 min-w-[10rem] px-2 py-1 text-xs rounded border bg-transparent"
              placeholder=".gitleaks.toml path (optional)"
              value={configPath}
              onChange={(e) => setConfigPath(e.target.value)}
            />
            <button
              onClick={runScan}
              disabled={scanning}
              className="flex items-center gap-1 px-3 py-1 text-xs rounded text-white disabled:opacity-50"
              style={{ background: ACCENT }}
            >
              {scanning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              Scan
            </button>
          </div>
          {errorBox(scanError)}
          {scanning && <div className="text-xs opacity-60">Scanning… a full history scan can take minutes.</div>}
          {scan && !scan.error && (
            <div className="flex flex-col gap-1">
              <div className="text-xs">
                {scan.count ?? 0} leak(s) — mode {scan.scan_mode}
                {scan.commits_scanned ? `, ${scan.commits_scanned} commit(s)` : ''}
              </div>
              {(scan.count ?? 0) === 0 ? (
                <div className="text-xs opacity-70">No leaks found.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left opacity-60">
                      <th>Rule</th>
                      <th>File</th>
                      <th>Line</th>
                      <th>Commit</th>
                      <th>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(scan.leaks || []).map((l, i) => (
                      <tr key={`${l.file}-${l.line}-${i}`}>
                        <td>{l.rule}</td>
                        <td className="font-mono">{l.file}</td>
                        <td>{l.line}</td>
                        <td className="font-mono">{(l.commit || '').slice(0, 10)}</td>
                        <td className="font-mono">{maskMatch(l.match)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'allowlist' && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 items-center">
            <select
              className="px-2 py-1 text-xs rounded border bg-transparent"
              value={entryType}
              onChange={(e) => setEntryType(e.target.value as 'path' | 'regex')}
            >
              <option value="path">Path</option>
              <option value="regex">Regex</option>
            </select>
            <input
              className="flex-1 px-2 py-1 text-xs rounded border bg-transparent"
              placeholder={entryType === 'path' ? 'e.g. tests/fixtures/.*' : 'e.g. EXAMPLE_KEY_[0-9]+'}
              value={entryValue}
              onChange={(e) => setEntryValue(e.target.value)}
            />
            <button
              onClick={addEntry}
              className="px-3 py-1 text-xs rounded text-white"
              style={{ background: ACCENT }}
            >
              Add
            </button>
            <button onClick={loadAllowlist} title="Reload" className="p-1 opacity-70">
              <RefreshCw className={`w-3 h-3 ${allowLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {allowNote && <div className="text-xs opacity-70">{allowNote}</div>}
          {errorBox(allowError)}
          {allowLoading && !allowlist && <div className="text-xs opacity-60">Loading allowlist…</div>}
          {allowlist && !allowlist.error && (
            <div className="flex flex-col gap-1 text-xs">
              <div className="opacity-60">{allowlist.config_path || 'No .gitleaks.toml found — adding an entry creates one.'}</div>
              {(['paths', 'regexes', 'commits'] as const).map((key) => (
                <div key={key}>
                  <div className="font-semibold">{key}</div>
                  {(allowlist[key] || []).length === 0 ? (
                    <div className="opacity-60">none</div>
                  ) : (
                    <ul className="font-mono">
                      {(allowlist[key] || []).map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'purge' && (
        <div className="flex flex-col gap-2">
          <textarea
            className="w-full h-24 px-2 py-1 text-xs font-mono rounded border bg-transparent"
            placeholder="One file path per line to remove from the ENTIRE git history"
            value={purgePaths}
            onChange={(e) => setPurgePaths(e.target.value)}
          />
          <div className="flex flex-wrap gap-2 items-center">
            <button
              onClick={() => runPurge(true)}
              disabled={purging}
              className="px-3 py-1 text-xs rounded border disabled:opacity-50"
            >
              Dry run
            </button>
            <input
              className="w-40 px-2 py-1 text-xs rounded border bg-transparent"
              placeholder={`Type ${PURGE_CONFIRM_WORD} to rewrite`}
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
            />
            <button
              onClick={() => runPurge(false)}
              disabled={purging || confirmWord !== PURGE_CONFIRM_WORD}
              className="flex items-center gap-1 px-3 py-1 text-xs rounded text-white disabled:opacity-40"
              style={{ background: ACCENT }}
            >
              <Trash2 className="w-3 h-3" />
              Rewrite history
            </button>
          </div>
          <div className="text-xs opacity-60">
            A rewrite needs a force-push afterwards, and every exposed credential must be rotated — removing it from
            history does not un-leak it.
          </div>
          {errorBox(purgeError)}
          {purging && <div className="text-xs opacity-60">Working…</div>}
          {purge && !purge.error && (
            <pre className="text-xs p-2 rounded border overflow-auto">{JSON.stringify(purge, null, 2)}</pre>
          )}
        </div>
      )}

      {tab === 'hooks' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2 items-center">
            <select
              className="px-2 py-1 text-xs rounded border bg-transparent"
              value={hookKind}
              onChange={(e) => setHookKind(e.target.value as HookKind)}
            >
              <option value="pre-commit">pre-commit</option>
              <option value="pre-push">pre-push</option>
              <option value="both">both</option>
            </select>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={hookForce} onChange={(e) => setHookForce(e.target.checked)} />
              Replace an existing non-SecretGuard hook
            </label>
            <button
              onClick={installHook}
              disabled={installing}
              className="flex items-center gap-1 px-3 py-1 text-xs rounded text-white disabled:opacity-50"
              style={{ background: ACCENT }}
            >
              {installing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <GitCommit className="w-3 h-3" />}
              Install hook
            </button>
          </div>
          {errorBox(hookError)}
          {hookResult && !hookResult.error && (
            <pre className="text-xs p-2 rounded border overflow-auto">{JSON.stringify(hookResult, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  )
}
