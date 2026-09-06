'use client'

/**
 * PlanBLedgerPanel — the portal face of Plan B Ledger ("one ledger, two faces").
 *
 * Offline-first checkbook-discipline ledger: digital entries here, a printable
 * structured continuity sheet (checkpoint PB-NNNN) for when tech is down, and
 * reconcile-on-return handled by the planb_* toolpack (awdk).
 *
 * Server-backed: reads and writes the tenant-scoped ledger at /api/planb/*
 * (portal-kit-backend `routers/planb_ledger.py`), which derives scope from the
 * AUTHENTICATED caller — the panel never sends a tenant id.
 *
 * Offline is a FIRST-CLASS state, not an error. When the API is unreachable the
 * panel shows the last state it saw (cached in localStorage) and DISABLES
 * writes, because silently accepting an entry that will never persist is the
 * one thing a ledger must not do. That is the same discipline as the paper
 * face: you always know which record you are looking at.
 */

import { useCallback, useEffect, useState } from 'react'
import { usePlanBWebGPUBrain } from '../webml/usePlanBWebGPUBrain'

/** Server shapes — mirror `_summary()` in routers/planb_ledger.py. */
export interface PlanBBill {
  id: string; name: string; amount_c: number; due_day: number
  paid: boolean; paid_on: string | null; paid_source: string | null
}
export interface PlanBEntry {
  id: string; date: string; desc: string; amount_c: number
  type: 'in' | 'out'; category: string; source: 'digital' | 'paper'
  bill_id?: string | null
}
export interface PlanBSummary {
  balance_c: number; balance: string; bills: PlanBBill[]
  entries: PlanBEntry[]; entry_count: number; sheets: string[]
}

export interface PlanBLedgerPanelProps {
  /**
   * API root. Defaults to the RELATIVE router mount, deliberately.
   *
   * Do not hardcode an absolute origin here. Tenant apps are moving to static
   * GitHub Pages frontends with the backend on a separate host (a tenant portal
   * -> its API host), and portal-kit already solves that centrally:
   * `installIdentityHeaders` wraps window.fetch and rewrites relative `/api/*`
   * onto the absolute base from `window.__AITHER_API_BASE__`, switching
   * credentials mode with it. A relative path is therefore correct in BOTH
   * topologies; an absolute one would break one of them.
   */
  apiBase?: string
  /** Where the last-seen state is cached so an offline load still shows data. */
  storageKey?: string
  /**
   * Optional WebGPU worker factory for on-device parsing. If provided, the panel
   * will attempt to use Bonsai for intelligent categorization; the deterministic
   * fallback always works offline. The host app provides this because Worker URL
   * resolution is bundler-specific. Use:
   * `() => new Worker(new URL('./webgpu-worker.ts', import.meta.url), { type: 'module' })`
   */
  workerFactory?: () => Worker
}

const CATEGORIES = ['Bills', 'Food', 'Auto', 'Home', 'Fun', 'Income', 'Other']

function fmt(c: number): string {
  const s = c < 0 ? '-' : ''
  const a = Math.abs(c)
  return `${s}$${Math.floor(a / 100).toLocaleString()}.${String(a % 100).padStart(2, '0')}`
}

/**
 * Turn one sentence into a structured entry, client-side.
 *
 * Mirrors the deterministic fallback in the adk pack's `brain.py`. The server
 * takes EXACT entries; natural language is parsed by whichever face the user is
 * on (bonsai via llama.cpp for the bot/CLI, this for the browser), which is why
 * these two parsers have to agree.
 */
export function parseCapture(
  text: string, bills: PlanBBill[],
): { desc: string; amount: string; type: 'in' | 'out'; category: string } | null {
  const low = text.toLowerCase().trim()
  const amt = low.match(/\$?(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)/)
  const amount = amt ? amt[1].replace(/,/g, '') : null

  if (/\b(paid|pay|payed)\b/.test(low)) {
    const bill = bills.find(b => low.includes(b.name.toLowerCase()))
    if (bill) {
      return {
        desc: `${bill.name} (bill)`,
        amount: amount ?? (bill.amount_c / 100).toFixed(2),
        type: 'out',
        category: 'Bills',
      }
    }
  }
  if (amount == null) return null

  const income = /(paycheck|got paid|deposit|received|refund|income)/.test(low)
  let category = income ? 'Income' : 'Other'
  if (!income) {
    if (/(grocer|food|lunch|dinner|coffee|restaurant)/.test(low)) category = 'Food'
    else if (/(gas|fuel|uber|parking|car |oil change)/.test(low)) category = 'Auto'
  }
  const desc = low.replace(/(spent|paid|got|received|bought|for|on)\b/g, ' ')
    .replace(/\$?[\d,.]+/g, ' ').replace(/\s+/g, ' ').trim()
  return {
    desc: desc ? desc[0].toUpperCase() + desc.slice(1) : text.slice(0, 60),
    amount,
    type: income ? 'in' : 'out',
    category: CATEGORIES.includes(category) ? category : 'Other',
  }
}

/**
 * Placeholder factory for hosts that pass no workerFactory. Never invoked —
 * the hook only calls it on an explicit load(), which the panel only triggers
 * when a real factory was supplied. It exists so the hook can be called
 * unconditionally (see the Rules-of-Hooks note at the call site).
 */
function _noWorker(): Worker {
  throw new Error('planb: no WebGPU workerFactory configured')
}

export default function PlanBLedgerPanel({
  apiBase = '/api/planb',
  storageKey = 'planb-ledger-cache',
  workerFactory,
}: PlanBLedgerPanelProps) {
  const [summary, setSummary] = useState<PlanBSummary | null>(null)
  const [online, setOnline] = useState(true)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [flash, setFlash] = useState<string | null>(null)
  const [usedBrain, setUsedBrain] = useState<'deterministic' | 'bonsai-4b' | null>(
    null,
  )

  // Optional WebGPU brain for on-device parsing; the deterministic parser is
  // always the fallback and always works with no GPU, model or network.
  //
  // Called UNCONDITIONALLY — `workerFactory ? useX() : null` is a Rules-of-Hooks
  // violation: a host that passes the prop conditionally, or passes it only
  // after data loads, changes the hook count between renders and React throws
  // "change in the order of Hooks called". Gate the BEHAVIOUR, never the call.
  // A no-op worker factory is safe: the hook constructs nothing and downloads
  // nothing until parse() explicitly loads a model.
  const brain = usePlanBWebGPUBrain({
    workerFactory: workerFactory ?? _noWorker,
    bills: summary?.bills,
  })
  const gpuBrain = workerFactory ? brain : null

  const cache = useCallback((s: PlanBSummary) => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(s)) } catch { /* quota */ }
  }, [storageKey])

  const load = useCallback(async () => {
    try {
      // credentials matter: scope is derived from the caller's session.
      const r = await fetch(`${apiBase}/state`, { credentials: 'include' })
      if (!r.ok) throw new Error(`state ${r.status}`)
      const body = await r.json()
      setSummary(body.state)
      setOnline(true)
      cache(body.state)
    } catch {
      setOnline(false)
      try {
        const raw = window.localStorage.getItem(storageKey)
        if (raw) setSummary(JSON.parse(raw))
      } catch { /* no cache on this device */ }
    }
  }, [apiBase, storageKey, cache])

  useEffect(() => { void load() }, [load])

  /** Every write goes through here, so offline can never fake a success. */
  const post = useCallback(async (path: string, body?: unknown) => {
    setBusy(true)
    try {
      const r = await fetch(`${apiBase}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        setFlash(r.status === 401
          ? 'Sign in to use your ledger.'
          : `Could not save (${r.status})`)
        return null
      }
      if (data?.state) { setSummary(data.state); cache(data.state) }
      setOnline(true)
      return data
    } catch {
      // Do NOT apply the change locally: an entry that silently never persists
      // is worse than a refused one. Offline is shown, never simulated.
      setOnline(false)
      setFlash('Offline — not recorded. Use the printed sheet, reconcile later.')
      return null
    } finally {
      setBusy(false)
    }
  }, [apiBase, cache])

  const capture = async () => {
    if (!summary) return

    // Try the WebGPU brain first if available; always fall back to deterministic.
    let parsed = null
    let brain = 'deterministic'

    if (gpuBrain && gpuBrain.ready && !gpuBrain.busy) {
      const modelParsed = await gpuBrain.parse(input)
      if (modelParsed) {
        // Convert model output to panel shape
        if (modelParsed.kind === 'bill' && modelParsed.bill_name) {
          const bill = summary.bills.find(b => b.name === modelParsed.bill_name)
          if (bill) {
            parsed = {
              desc: `${bill.name} (bill)`,
              amount: modelParsed.amount ?? (bill.amount_c / 100).toFixed(2),
              type: 'out' as const,
              category: 'Bills',
            }
            brain = 'bonsai-4b'
          }
        } else if (modelParsed.amount !== null) {
          parsed = {
            desc: modelParsed.desc || input.slice(0, 60),
            amount: modelParsed.amount,
            type: modelParsed.kind === 'income' ? ('in' as const) : ('out' as const),
            category: CATEGORIES.includes(modelParsed.category)
              ? modelParsed.category
              : modelParsed.kind === 'income'
                ? 'Income'
                : 'Other',
          }
          brain = 'bonsai-4b'
        }
      }
    }

    // Fallback to deterministic parser
    if (!parsed) {
      parsed = parseCapture(input, summary.bills)
      brain = 'deterministic'
    }

    if (!parsed) {
      setFlash('Try "spent 12.50 on lunch" or "paid the electric bill"')
      return
    }

    setUsedBrain(brain as 'deterministic' | 'bonsai-4b')
    const out = await post('/entry', parsed)
    if (out) {
      setInput('')
      setFlash(
        `Recorded ${parsed.type === 'in' ? '+' : '−'}$${parsed.amount} ${parsed.desc} (${brain})`,
      )
    }
  }

  const printSheet = async () => {
    // The checkpoint must be recorded SERVER-side before it is printed: a sheet
    // the server never issued cannot be reconciled, and a PB-id minted offline
    // would collide with the real sequence.
    const out = await post('/sheet')
    if (!out?.html) return
    const w = window.open('', '_blank')
    if (w) { w.document.write(out.html); w.document.close() }
    setFlash(`Sheet ${out.result?.sheet_id} printed — balance ${out.result?.balance_at_print}`)
  }

  const row: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', padding: '4px 0',
    fontSize: 13, borderBottom: '1px solid var(--pk-border, #2223)',
  }
  const writesOff = !online || busy

  if (!summary) {
    return (
      <div style={{ padding: 16, fontSize: 13, opacity: 0.7 }}>
        {online ? 'Loading your ledger…' : 'Offline, and no cached ledger on this device yet.'}
      </div>
    )
  }

  return (
    <div style={{ padding: 16, maxWidth: 560 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>Plan B Ledger</h3>
        <span style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700 }}>
          {summary.balance}
        </span>
      </div>
      <p style={{ fontSize: 12, opacity: 0.7, margin: '4px 0 12px' }}>
        One ledger, two faces — digital here, paper when tech is down.
      </p>

      {!online && (
        <p role="status" style={{
          fontSize: 12, padding: '6px 10px', borderRadius: 6, marginBottom: 10,
          background: 'var(--pk-warn-bg, #6a4a0022)',
          border: '1px solid var(--pk-warn, #b8860b)',
        }}>
          ⚠️ Offline — showing the last state this device saw. Entries are disabled
          so nothing is lost; work on your printed sheet and reconcile when the
          connection is back.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          disabled={writesOff}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void capture() }}
          placeholder='e.g. "spent 23.75 on lunch" · "paid the electric bill"'
          style={{
            flex: 1, padding: '8px 10px', borderRadius: 6,
            border: '1px solid var(--pk-border, #8884)',
            background: 'transparent', color: 'inherit',
            opacity: writesOff ? 0.5 : 1,
          }}
        />
        <button
          onClick={() => void capture()}
          disabled={writesOff}
          style={{ padding: '8px 14px', borderRadius: 6, cursor: writesOff ? 'not-allowed' : 'pointer' }}
        >
          Record
        </button>
        <button
          onClick={() => void printSheet()}
          disabled={writesOff}
          title="Print a continuity checkpoint sheet"
          style={{ padding: '8px 14px', borderRadius: 6, cursor: writesOff ? 'not-allowed' : 'pointer' }}
        >
          🖨️ Sheet
        </button>
      </div>
      {flash && <p style={{ fontSize: 12, margin: '8px 0 0' }}>{flash}</p>}

      {/* The opt-in that makes the on-device brain reachable at all. `parse()`
          loads the model, but every caller naturally guards on `ready` — so
          without an explicit trigger the feature deadlocks and silently never
          runs. Deliberately opt-in: the model is a multi-hundred-MB download. */}
      {gpuBrain && gpuBrain.status !== 'unsupported' && !gpuBrain.ready && (
        <p style={{ fontSize: 12, margin: '8px 0 0' }}>
          {gpuBrain.loadStatus ? (
            <span>⏳ {gpuBrain.loadStatus} — using the built-in parser meanwhile.</span>
          ) : (
            <button
              onClick={() => gpuBrain.enable()}
              style={{
                fontSize: 12, padding: '3px 8px', borderRadius: 5,
                cursor: 'pointer', background: 'transparent', color: 'inherit',
                border: '1px solid var(--pk-border, #8884)',
              }}
            >
              ⚡ Enable on-device AI (downloads a model, then runs offline)
            </button>
          )}
        </p>
      )}
      {gpuBrain?.ready && (
        <p style={{ fontSize: 11, margin: '6px 0 0', opacity: 0.65 }}>
          ⚡ On-device AI active{usedBrain ? ` · last entry read by ${usedBrain}` : ''}
        </p>
      )}

      <h4 style={{ margin: '16px 0 6px', fontSize: 13 }}>Bills</h4>
      {summary.bills.length === 0 && (
        <p style={{ fontSize: 12, opacity: 0.6 }}>No bills yet.</p>
      )}
      {summary.bills.map(b => (
        <div key={b.id} style={row}>
          <span>{b.paid ? '☑' : '☐'} {b.name}</span>
          <span style={{ fontFamily: 'monospace' }}>
            {fmt(b.amount_c)} · {b.paid ? `paid ${b.paid_on}` : `due ${b.due_day}`}
          </span>
        </div>
      ))}

      <h4 style={{ margin: '16px 0 6px', fontSize: 13 }}>
        Recent{' '}
        {summary.entry_count > summary.entries.length && (
          <span style={{ opacity: 0.6, fontWeight: 400 }}>(of {summary.entry_count})</span>
        )}
      </h4>
      {summary.entries.slice(-6).reverse().map(e => (
        <div key={e.id} style={row}>
          <span>{e.source === 'paper' ? '✍️' : '⌨️'} {e.desc}</span>
          <span style={{
            fontFamily: 'monospace',
            color: e.type === 'in' ? 'var(--pk-success, #2a7)' : 'inherit',
          }}>
            {e.type === 'in' ? '+' : '−'}{fmt(e.amount_c)}
          </span>
        </div>
      ))}
    </div>
  )
}
