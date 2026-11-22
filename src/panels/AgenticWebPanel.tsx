'use client'

/**
 * Make my site agent-ready -- the customer-facing agentic-web flow.
 *
 * domain -> scan (remote isitagentready.com + local probes) -> plan for a target
 * (the workspace's connected Cloudflare, by the workspace secret NAME
 * CLOUDFLARE_API_TOKEN, or a PR to their GitHub repo) -> a preview diff per artifact
 * -> owner approval (a customer_domain_publish decision card) -> apply ONLY once that
 * card is answered `approve` -> verify -> a one-page report to download.
 *
 * Every call goes to /api/agentic-web/<action> (Veil), which proxies the awdk
 * `agentic_web` MCP tools as the signed-in caller and re-checks the card server-side
 * before apply. The Apply button being disabled is UX; the route's 409 is the lock.
 *
 * Gated kinds other than the publish gate -- DNSSEC, registrar DS, live payments
 * (wallet, facilitator, AP2 role required, x402/MPP on a revenue route) -- are shown
 * as "needs owner decision" and never as something this panel can apply.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

export type ScanStatus = 'pass' | 'fail' | 'neutral' | string

export interface PlanChange {
  target: string
  path_or_record: string
  before?: string | null
  after?: string | null
  diff?: string
  gate?: string | null
}

export interface PlanGate {
  kind: string
  summary?: string
}

export interface Plan {
  plan_id: string
  changes: PlanChange[]
  gates: PlanGate[]
}

export interface DecisionState {
  decision_id: string
  status?: string
  answer?: string
}

export interface AgenticWebPanelProps {
  /** Prefix for the Veil route (default ''). */
  apiBase?: string
  fetchImpl?: typeof fetch
  /** Card poll interval in ms; 0 disables polling (the Refresh button still works). */
  pollMs?: number
  initialDomain?: string
}

/** The publish gate the decision card answers. Everything else in OWNER_GATES is
 *  never applicable from here. */
export const PUBLISH_GATE = 'customer_domain_publish'
export const OWNER_GATES = new Set(['dnssec_enable', 'registrar_ds', 'live_payment'])

const TARGETS: { key: string; label: string; help: string }[] = [
  { key: 'cf_worker', label: 'Cloudflare (connected)', help: 'Workers routes + well-known files, using this workspace\'s CLOUDFLARE_API_TOKEN secret.' },
  { key: 'cf_dns', label: 'Cloudflare DNS (DNS-AID)', help: 'SVCB/HTTPS records under _agents, same workspace secret.' },
  { key: 'pages_repo_pr', label: 'GitHub repo (pull request)', help: 'Opens a PR with the files; you merge it.' },
]

/** The scanner's flat {"group.check": status} map(s) -> one row per check. */
export function scanRows(scan: unknown): { check: string; remote?: ScanStatus; local?: ScanStatus }[] {
  const rows = new Map<string, { check: string; remote?: ScanStatus; local?: ScanStatus }>()
  const take = (src: unknown, side: 'remote' | 'local') => {
    if (!src || typeof src !== 'object') return
    const obj = src as Record<string, unknown>
    const checks = obj.checks && typeof obj.checks === 'object' && !Array.isArray(obj.checks)
      ? (obj.checks as Record<string, unknown>) : obj
    for (const [k, v] of Object.entries(checks)) {
      if (!k.includes('.') || typeof v !== 'string') continue
      const row = rows.get(k) || { check: k }
      row[side] = v
      rows.set(k, row)
    }
  }
  const s = (scan || {}) as Record<string, unknown>
  if (s.remote || s.local) {
    take(s.remote, 'remote')
    take(s.local, 'local')
  } else {
    take(s, 'remote')
  }
  return [...rows.values()].sort((a, b) => a.check.localeCompare(b.check))
}

/** True only for a card answered `approve`. */
export function cardApproved(d: DecisionState | null): boolean {
  if (!d) return false
  return (d.status === 'answered' && d.answer === 'approve') || d.status === 'approve'
}

function gateOf(c: PlanChange): string | null {
  return c.gate && c.gate !== PUBLISH_GATE ? c.gate : null
}

function statusClass(s?: ScanStatus): string {
  if (s === 'pass') return 'text-emerald-400'
  if (s === 'fail') return 'text-rose-400'
  return 'text-zinc-400'
}

export default function AgenticWebPanel({
  apiBase = '', fetchImpl, pollMs = 5000, initialDomain = '',
}: AgenticWebPanelProps) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined)
  const [domain, setDomain] = useState(initialDomain)
  const [target, setTarget] = useState('cf_worker')
  const [repo, setRepo] = useState('')
  const [scan, setScan] = useState<unknown>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [decision, setDecision] = useState<DecisionState | null>(null)
  const [applied, setApplied] = useState<Record<string, unknown> | null>(null)
  const [verify, setVerify] = useState<unknown>(null)
  const [report, setReport] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const post = useCallback(async (action: string, body: Record<string, unknown>) => {
    if (!doFetch) throw new Error('fetch unavailable')
    const r = await doFetch(`${apiBase}/api/agentic-web/${action}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(String((data as { error?: string }).error || `${action} failed (${r.status})`))
    return data as Record<string, unknown>
  }, [apiBase, doFetch])

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }, [])

  const onScan = () => run('scan', async () => {
    setPlan(null); setDecision(null); setApplied(null); setVerify(null); setReport('')
    setScan(await post('scan', { domain, mode: 'both' }))
  })

  const onPlan = () => run('plan', async () => {
    const host = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '')
    const body: Record<string, unknown> = {
      target, profile: { domain: host, name: host, origins: { apex: `https://${host}` } },
    }
    if (target === 'pages_repo_pr') body.repo = repo
    const p = await post('plan', body)
    setPlan({
      plan_id: String(p.plan_id || ''),
      changes: Array.isArray(p.changes) ? (p.changes as PlanChange[]) : [],
      gates: Array.isArray(p.gates) ? (p.gates as PlanGate[]) : [],
    })
    setDecision(null)
  })

  const publishable = useMemo(() => (plan?.changes || []).filter((c) => !gateOf(c)), [plan])
  const ownerItems = useMemo(() => {
    const out: { key: string; kind: string; summary: string }[] = []
    for (const g of plan?.gates || []) {
      if (g.kind !== PUBLISH_GATE) out.push({ key: `g:${g.kind}:${g.summary || ''}`, kind: g.kind, summary: g.summary || '' })
    }
    for (const c of plan?.changes || []) {
      const k = gateOf(c)
      if (k) out.push({ key: `c:${c.target}:${c.path_or_record}`, kind: k, summary: c.path_or_record })
    }
    return out
  }, [plan])

  const onRequestApproval = () => run('approve', async () => {
    if (!plan) return
    const card = await post('approve', {
      plan_id: plan.plan_id, domain,
      changes: publishable.map((c) => `${c.target} ${c.path_or_record}`),
    })
    const c = (card.card && typeof card.card === 'object' ? card.card : card) as Record<string, unknown>
    setDecision({ decision_id: String(c.id || c.decision_id || ''), status: String(c.status || 'open'), answer: c.answer ? String(c.answer) : undefined })
  })

  const refreshDecision = useCallback(async () => {
    if (!decision?.decision_id) return
    const d = await post('decision', { decision_id: decision.decision_id })
    const c = (d.card && typeof d.card === 'object' ? d.card : d) as Record<string, unknown>
    setDecision({ decision_id: decision.decision_id, status: c.status ? String(c.status) : undefined, answer: c.answer ? String(c.answer) : undefined })
  }, [decision?.decision_id, post])

  useEffect(() => {
    if (!pollMs || !decision?.decision_id || decision.status === 'answered') return
    const t = setInterval(() => { refreshDecision().catch(() => undefined) }, pollMs)
    return () => clearInterval(t)
  }, [pollMs, decision?.decision_id, decision?.status, refreshDecision])

  const approved = cardApproved(decision)

  const onApply = () => run('apply', async () => {
    if (!plan || !decision || !cardApproved(decision)) return
    setApplied(await post('apply', { plan_id: plan.plan_id, decision_id: decision.decision_id }))
    const expect = publishable.map((c) => c.path_or_record)
    const after = await post('verify', { domain, expect })
    setVerify(after)
    const rep = await post('report', { domain, before: scan, plan, after })
    setReport(String(rep.markdown || rep.content || rep.report || rep.text || ''))
  })

  const downloadHref = useMemo(
    () => (report ? `data:text/markdown;charset=utf-8,${encodeURIComponent(report)}` : ''), [report])

  const rows = scanRows(scan)

  return (
    <div className="space-y-6 p-4 text-sm text-zinc-200" data-testid="agentic-web-panel">
      <header>
        <h2 className="text-lg font-semibold text-zinc-100">Make my site agent-ready</h2>
        <p className="text-zinc-400">
          Scan a domain for the agentic-web checks (A2A card, MCP card, OAuth discovery, Web Bot Auth,
          DNS-AID, commerce), preview every file and record, and publish only after you approve.
        </p>
      </header>

      <section className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-400">Domain</span>
          <input data-testid="aw-domain" value={domain} onChange={(e) => setDomain(e.target.value)}
            placeholder="example.com" className="rounded border border-white/10 bg-zinc-900 px-2 py-1" />
        </label>
        <button data-testid="aw-scan" disabled={!domain.trim() || !!busy} onClick={onScan}
          className="rounded bg-teal-600 px-3 py-1 disabled:opacity-40">
          {busy === 'scan' ? 'Scanning...' : 'Scan'}
        </button>
      </section>

      {error && <p role="alert" data-testid="aw-error" className="text-rose-400">{error}</p>}

      {rows.length > 0 && (
        <section data-testid="aw-scan-grid">
          <h3 className="mb-2 font-medium">Scan results</h3>
          <table className="w-full text-left text-xs">
            <thead><tr><th>Check</th><th>isitagentready.com</th><th>Local probe</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.check} data-testid={`aw-check-${r.check}`}>
                  <td className="font-mono">{r.check}</td>
                  <td className={statusClass(r.remote)}>{r.remote || '-'}</td>
                  <td className={statusClass(r.local)}>{r.local || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {scan != null && (
        <section className="space-y-2">
          <h3 className="font-medium">Where to publish</h3>
          {TARGETS.map((t) => (
            <label key={t.key} className="flex items-start gap-2">
              <input type="radio" name="aw-target" value={t.key} checked={target === t.key}
                onChange={() => setTarget(t.key)} data-testid={`aw-target-${t.key}`} />
              <span><span className="text-zinc-100">{t.label}</span> <span className="text-zinc-500">{t.help}</span></span>
            </label>
          ))}
          {target === 'pages_repo_pr' && (
            <input data-testid="aw-repo" value={repo} onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repo" className="rounded border border-white/10 bg-zinc-900 px-2 py-1" />
          )}
          <button data-testid="aw-plan" disabled={!!busy} onClick={onPlan}
            className="rounded bg-zinc-700 px-3 py-1 disabled:opacity-40">
            {busy === 'plan' ? 'Planning...' : 'Preview changes'}
          </button>
        </section>
      )}

      {plan && (
        <section data-testid="aw-plan-preview" className="space-y-3">
          <h3 className="font-medium">Preview ({publishable.length} change{publishable.length === 1 ? '' : 's'})</h3>
          {publishable.map((c) => (
            <details key={`${c.target}:${c.path_or_record}`} open data-testid="aw-diff"
              className="rounded border border-white/10 p-2">
              <summary className="font-mono text-xs">{c.target} {c.path_or_record}</summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre text-xs">{c.diff || `${c.before ?? ''}\n---\n${c.after ?? ''}`}</pre>
            </details>
          ))}

          {ownerItems.length > 0 && (
            <div data-testid="aw-owner-items" className="rounded border border-amber-500/30 p-2">
              <h4 className="mb-1 text-amber-300">Needs owner decision (not applied by this flow)</h4>
              <ul>
                {ownerItems.map((g) => (
                  <li key={g.key} data-testid={`aw-owner-${g.kind}`}>
                    <span className="font-mono">{g.kind}</span> -- needs owner decision{g.summary ? `: ${g.summary}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!decision && (
              <button data-testid="aw-request-approval" disabled={!!busy || publishable.length === 0}
                onClick={onRequestApproval} className="rounded bg-zinc-700 px-3 py-1 disabled:opacity-40">
                Request owner approval
              </button>
            )}
            {decision && (
              <span data-testid="aw-card">
                Decision card <span className="font-mono">{decision.decision_id}</span>:{' '}
                <span data-testid="aw-card-status">{decision.answer ? `${decision.status} (${decision.answer})` : decision.status}</span>{' '}
                <button onClick={() => run('decision', refreshDecision)} className="underline">Refresh</button>
              </span>
            )}
            <button data-testid="aw-apply" disabled={!approved || !!busy} onClick={onApply}
              className="rounded bg-teal-600 px-3 py-1 disabled:opacity-40">
              {busy === 'apply' ? 'Publishing...' : 'Apply'}
            </button>
          </div>
        </section>
      )}

      {applied && (
        <section data-testid="aw-verify" className="space-y-2">
          <h3 className="font-medium">Verify</h3>
          {scanRows(verify).map((r) => (
            <div key={r.check} className={statusClass(r.remote || r.local)}>{r.check}: {r.remote || r.local}</div>
          ))}
          {report && (
            <>
              <pre data-testid="aw-report" className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-white/10 p-2 text-xs">{report}</pre>
              <a data-testid="aw-report-download" href={downloadHref} download={`agent-ready-${domain.trim() || 'report'}.md`}
                className="underline">Download report</a>
            </>
          )}
        </section>
      )}
    </div>
  )
}
