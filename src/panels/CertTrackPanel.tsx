'use client'

/**
 * CertTrack — the workspace's engineer certifications, read from its own documents.
 *
 * Host contract (assistant `routers/certtrack.py`, admin only):
 *   GET  `${apiBase}/certtrack/records` -> `{state, employees, certTypes, summary}`;
 *        `202 {state: "building"}` while the first build runs (about a minute) —
 *        this panel polls; `state: "refreshing"` serves the previous build meanwhile.
 *   POST `${apiBase}/certtrack/refresh` -> starts a rebuild.
 * The host owns the scoping (tenant from the session) and the status of each
 * certificate (`active` / `expiring` / `expired` / `no_expiry` / `superseded`).
 * Superseded renewals are shown as history and never counted as expired.
 *
 * Mounted BARE by the Veil PanelApp (no props): `apiBase` defaults to `/api`, which
 * the tenant fetch interceptor sends to the workspace's own backend.
 * Ported from Jason's CertTrack prototype (dashboard / employees / library / alerts).
 *
 * CertTrack v2 (curated store): `Review` confirms / corrects / disputes what extraction
 * found (GET `/queue`, POST `/entries/{id}/confirm|dispute`, `/entries/confirm-bulk`);
 * `Audit` is one drop box and one button (POST `/drop`, GET `/audit-sheet.xlsx`); the
 * evidence and cross-checks (GET `/audit`) sit behind its "More" link;
 * `My certifications` is the employee page (GET `/me`, POST/DELETE `/uploads`). A
 * non-admin who opens the panel gets `/records` 403 and sees ONLY their own page.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { friendlyHttpError, friendlyThrown } from '../lib/friendlyError'

export interface CertTrackPanelProps {
  apiBase?: string
  /** Poll interval while a build runs (ms). */
  pollMs?: number
}

type Status = 'active' | 'expiring' | 'expired' | 'no_expiry' | 'superseded'

export interface CertTrackCert {
  id: number
  name: string
  category: string
  number: string
  issued: string
  expires: string | null
  status: Status
  superseded: boolean
  confidence: number
  filename_only?: boolean
  document?: string | null
  notes?: string
}
export interface CertTrackEmployee { id: number; name: string; certs: CertTrackCert[] }
interface CertType { id: string; name: string; category: string; primary: boolean }
interface Summary {
  records: number
  current_records: number
  employees: number
  active: number
  expiring: number
  expired: number
  no_expiry: number
  superseded: number
  filename_only: number
  expiring_days: number
}
interface Payload {
  state?: 'ready' | 'refreshing' | 'building' | 'error'
  error?: string
  generated_at?: string
  employees?: CertTrackEmployee[]
  certTypes?: CertType[]
  summary?: Summary
}

type View = 'dashboard' | 'employees' | 'certs' | 'alerts' | 'review' | 'audit' | 'mine'

const card: CSSProperties = {
  padding: 12,
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius)',
  background: 'var(--glass-bg, transparent)',
}
const button: CSSProperties = {
  padding: '6px 12px',
  background: 'var(--accent-primary)',
  color: 'var(--bg-deep)',
  borderRadius: 'var(--radius)',
  border: 'none',
  cursor: 'pointer',
}
const tabStyle = (on: boolean): CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--glass-border)',
  background: on ? 'var(--accent-primary)' : 'transparent',
  color: on ? 'var(--bg-deep)' : 'var(--text-primary)',
  cursor: 'pointer',
})
const muted: CSSProperties = { color: 'var(--text-muted)', fontSize: 12 }
const cell: CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--glass-border)' }

const STATUS_LABEL: Record<Status, string> = {
  active: 'Active',
  expiring: 'Expiring',
  expired: 'Expired',
  no_expiry: 'No expiry on file',
  superseded: 'Superseded',
}
const STATUS_COLOR: Record<Status, string> = {
  active: 'var(--success, #16a34a)',
  expiring: 'var(--warning, #d97706)',
  expired: 'var(--danger, #dc2626)',
  no_expiry: 'var(--text-muted)',
  superseded: 'var(--text-muted)',
}

function Badge({ status }: { status: Status }) {
  return (
    <span
      data-status={status}
      style={{
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 999,
        border: `1px solid ${STATUS_COLOR[status]}`,
        color: STATUS_COLOR[status],
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

/** Whole days from today to an ISO date (negative = past). */
export function daysUntil(iso: string | null, today: Date = new Date()): number | null {
  if (!iso) return null
  const t = Date.parse(`${iso}T00:00:00`)
  if (Number.isNaN(t)) return null
  const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  return Math.round((t - d0) / 86_400_000)
}

async function readJson(r: Response): Promise<Payload & { detail?: string }> {
  return (await r.json().catch(() => ({}))) as Payload & { detail?: string }
}

export default function CertTrackPanel({ apiBase = '/api', pollMs = 5000 }: CertTrackPanelProps) {
  const base = `${apiBase}/certtrack`
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>('dashboard')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<CertTrackEmployee | null>(null)
  const [employeeOnly, setEmployeeOnly] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)

  const load = useCallback(async (init?: RequestInit) => {
    if (timer.current) clearTimeout(timer.current)
    try {
      const url = init?.method === 'POST' ? `${base}/refresh` : `${base}/records`
      const r = await fetch(url, { credentials: 'include', ...init })
      const body = await readJson(r)
      if (!alive.current) return
      if (r.status === 403 && init?.method !== 'POST') {
        setEmployeeOnly(body.detail || 'This view needs a workspace administrator.')
        setView('mine')
        return
      }
      if (!r.ok && r.status !== 202) {
        setError(friendlyHttpError(r.status, { detail: body.detail, subject: 'CertTrack' }))
        return
      }
      setError('')
      if (body.employees || !data?.employees) setData(body)
      else setData((prev) => ({ ...prev, state: body.state }))
      if (body.state === 'building' || body.state === 'refreshing') {
        timer.current = setTimeout(() => { void load() }, pollMs)
      }
    } catch (e) {
      if (alive.current) setError(friendlyThrown(e, { action: 'load your certifications' }))
    }
  }, [base, pollMs, data?.employees])

  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base])

  const employees = useMemo(() => data?.employees ?? [], [data])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? employees.filter((e) => e.name.toLowerCase().includes(q)) : employees
  }, [employees, query])

  const live = useMemo(() => employees.flatMap((e) =>
    e.certs.filter((c) => !c.superseded).map((c) => ({ emp: e, cert: c, days: daysUntil(c.expires) }))),
  [employees])
  const upcoming = useMemo(() => live
    .filter((x) => x.cert.status === 'expiring' || x.cert.status === 'expired')
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0)), [live])
  const alerts = useMemo(() => upcoming.filter((x) => (x.days ?? 0) <= 30), [upcoming])
  const holders = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of live) m.set(x.cert.name, (m.get(x.cert.name) ?? 0) + 1)
    return m
  }, [live])

  const s = data?.summary
  const building = data?.state === 'building'

  if (employeeOnly) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, height: '100%',
        overflow: 'auto', color: 'var(--text-primary)' }}
      >
        <strong style={{ fontSize: 16 }}>My certifications</strong>
        <div style={muted} data-testid="certtrack-employee-note">
          Upload your certificates here; an administrator confirms them. ({employeeOnly})
        </div>
        <MyCerts base={base} pollMs={pollMs} />
      </div>
    )
  }

  // Nothing has loaded and the host refused: one sentence and one button. Seven tabs over
  // an empty error is a dead end for someone who cannot fix the host (owner screenshot
  // 2026-11-16: CertTrack showed a red "HTTP 404" under a full tab bar).
  if (error && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, height: '100%',
        overflow: 'auto', color: 'var(--text-primary)' }}
      >
        <strong style={{ fontSize: 16 }}>CertTrack</strong>
        <div role="alert" data-testid="certtrack-unavailable" style={{ ...card, color: 'var(--danger, #dc2626)' }}>{error}</div>
        <div>
          <button type="button" style={button} onClick={() => { void load() }}>Try again</button>
        </div>
      </div>
    )
  }

  const TABS: Array<[View, string]> = [
    ['dashboard', 'Dashboard'], ['employees', 'Employees'], ['certs', 'Cert library'],
    ['alerts', `Alerts${alerts.length ? ` (${alerts.length})` : ''}`], ['review', 'Review'],
    ['audit', 'Audit'], ['mine', 'My certifications'],
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, height: '100%',
      overflow: 'auto', color: 'var(--text-primary)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 16 }}>CertTrack</strong>
        <span style={muted}>Engineer certifications from your documents</span>
        <span style={{ flex: 1 }} />
        {TABS.map(([v, label]) => (
          <button key={v} type="button" style={tabStyle(view === v)}
            onClick={() => { setView(v); setSelected(null) }}
          >
            {label}
          </button>
        ))}
        <button type="button" style={button} disabled={data?.state === 'refreshing' || building}
          onClick={() => { void load({ method: 'POST' }) }}
        >
          {data?.state === 'refreshing' ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div role="alert" style={{ ...card, color: 'var(--danger, #dc2626)' }}>{error}</div>}
      {!error && !data && <div style={muted}>Loading certifications…</div>}
      {!error && building && (
        <div style={card}>
          Reading certificates from your documents. The first build takes about a minute;
          this page updates by itself.
        </div>
      )}
      {data?.generated_at && (
        <div style={muted}>
          Built {new Date(data.generated_at).toLocaleString()} from assistant documents
          {s ? ` · ${s.filename_only} records read from a file name only (check those)` : ''}
        </div>
      )}

      {s && view === 'dashboard' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            {([
              ['Employees', s.employees, 'var(--text-primary)'],
              ['Active', s.active, STATUS_COLOR.active],
              [`Expiring (${s.expiring_days} days)`, s.expiring, STATUS_COLOR.expiring],
              ['Expired', s.expired, STATUS_COLOR.expired],
              ['No expiry on file', s.no_expiry, 'var(--text-muted)'],
            ] as Array<[string, number, string]>).map(([label, n, color]) => (
              <div key={label} style={card} data-stat={label}>
                <div style={muted}>{label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color }}>{n}</div>
              </div>
            ))}
          </div>
          <div style={muted}>
            {s.superseded} older renewals are kept as history and not counted as expired.
          </div>
          <div style={card}>
            <strong>Upcoming and overdue renewals</strong>
            {upcoming.length === 0 ? <div style={muted}>Nothing expiring soon.</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 13 }}>
                <tbody>
                  {upcoming.slice(0, 25).map(({ emp, cert, days }) => (
                    <tr key={cert.id}>
                      <td style={cell}>{emp.name}</td>
                      <td style={cell}>{cert.name}</td>
                      <td style={cell}>{cert.expires}</td>
                      <td style={cell}>{days !== null && days < 0 ? `${-days} days ago` : `${days} days`}</td>
                      <td style={cell}><Badge status={cert.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {data && view === 'employees' && !selected && (
        <div style={card}>
          <input aria-label="Search employees" placeholder="Search employees" value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', padding: 6, marginBottom: 8, background: 'transparent',
              color: 'var(--text-primary)', border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius)' }}
          />
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr><th style={cell} align="left">Name</th><th style={cell} align="left">Certifications</th>
                <th style={cell} align="left">Status</th><th style={cell} /></tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const cur = e.certs.filter((c) => !c.superseded)
                const worst: Status = cur.some((c) => c.status === 'expired') ? 'expired'
                  : cur.some((c) => c.status === 'expiring') ? 'expiring' : 'active'
                return (
                  <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(e)}>
                    <td style={cell}>{e.name}</td>
                    <td style={cell}>{cur.length}</td>
                    <td style={cell}><Badge status={worst} /></td>
                    <td style={{ ...cell, color: 'var(--accent-primary)' }}>View</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && view === 'employees' && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" style={tabStyle(false)} onClick={() => setSelected(null)}>Back</button>
            <strong>{selected.name}</strong>
          </div>
          {selected.certs.map((c) => (
            <div key={c.id} style={{ ...cell, opacity: c.superseded ? 0.6 : 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{c.name}</strong><span style={muted}>{c.category}</span><Badge status={c.status} />
              </div>
              <div style={muted}>
                {c.number ? `No. ${c.number} · ` : ''}
                {c.issued ? `Issued ${c.issued} · ` : ''}
                {c.expires ? `Expires ${c.expires}` : 'No expiry on file'}
              </div>
              {c.document && <div style={muted}>Source: {c.document}</div>}
              {c.notes && <div style={muted}>{c.notes}</div>}
            </div>
          ))}
        </div>
      )}

      {data && view === 'certs' && (
        <div style={card}>
          <div style={muted}>Primary licenses are PE and E.I.T.</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
            <thead>
              <tr><th style={cell} align="left">Certification</th><th style={cell} align="left">Category</th>
                <th style={cell} align="left">Holders</th></tr>
            </thead>
            <tbody>
              {(data.certTypes ?? []).map((t) => (
                <tr key={t.id}>
                  <td style={cell}>{t.name}{t.primary ? ' (primary)' : ''}</td>
                  <td style={cell}>{t.category}</td>
                  <td style={cell}>{holders.get(t.name) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'review' && <Review base={base} />}
      {view === 'audit' && <Audit base={base} />}
      {view === 'mine' && <MyCerts base={base} pollMs={pollMs} />}

      {data && view === 'alerts' && (
        <div style={card}>
          <strong>Expired or expiring within 30 days</strong>
          {alerts.length === 0 ? <div style={muted}>No alerts.</div> : alerts.map(({ emp, cert, days }) => (
            <div key={cert.id} style={cell}>
              <Badge status={cert.status} /> {emp.name}: {cert.name}{' '}
              {days !== null && days < 0 ? `expired ${-days} days ago` : `expires in ${days} days`}
              {' '}({cert.expires})
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── CertTrack v2: curated store views ─────────────────────────────────────────

interface StoreEntry {
  id: string
  person?: string
  status: 'extracted' | 'curated' | 'disputed'
  state: Status
  origin: string
  cert_name: string
  category: string
  number: string
  issued: string
  expires: string
  source_filename: string
  confidence: number
  filename_only: boolean
  confirmed_by: string
  confirmed_at: string
  dispute_reason: string
}
interface UploadRow {
  id: string; filename: string; uploader: string; status: string; records: number
  error: string; created_at: string
}
interface Evidence { field: string; value: string; where: string; excerpt?: string }
interface AuditRecord extends StoreEntry { evidence: Evidence[]; checks: Record<string, unknown> }
interface MePayload {
  linked: boolean
  certs: Record<string, StoreEntry[]> | null
  uploads: UploadRow[]
  limits?: { max_bytes: number }
}

const input: CSSProperties = {
  padding: 4, background: 'transparent', color: 'var(--text-primary)',
  border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)',
}
const small: CSSProperties = { ...tabStyle(false), padding: '2px 8px', fontSize: 12 }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any
async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Body }> {
  const r = await fetch(url, { credentials: 'include', ...init })
  const body = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, body }
}
const jsonPost = (body: unknown): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

function StatusTag({ status }: { status: StoreEntry['status'] }) {
  const color = status === 'curated' ? 'var(--success, #16a34a)'
    : status === 'disputed' ? 'var(--danger, #dc2626)' : 'var(--warning, #d97706)'
  const label = status === 'curated' ? 'Confirmed' : status === 'disputed' ? 'Disputed' : 'Not yet confirmed'
  return <span data-curation={status} style={{ fontSize: 11, color, whiteSpace: 'nowrap' }}>{label}</span>
}

interface Queue { counts: Record<string, number>; uploads: UploadRow[]; items: StoreEntry[] }

/** Review: what extraction (and employee uploads) found, for a person to confirm. */
export function Review({ base }: { base: string }) {
  const [q, setQ] = useState<Queue | null>(null)
  const [err, setErr] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    const r = await call(`${base}/queue`)
    if (!r.ok) { setErr(friendlyHttpError(r.status, { detail: r.body.detail, subject: 'CertTrack' })); return }
    setErr(''); setQ(r.body as Queue); setPicked(new Set())
  }, [base])
  useEffect(() => { void load() }, [load])

  const act = async (url: string, init: RequestInit) => {
    const r = await call(url, init)
    if (!r.ok) { setErr(friendlyHttpError(r.status, { detail: r.body.detail, subject: 'CertTrack' })); return }
    setEditing(null)
    await load()
  }
  const items = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (q?.items ?? []).filter((i) => !f || `${i.person} ${i.cert_name}`.toLowerCase().includes(f))
  }, [q, filter])

  if (err) return <div role="alert" style={{ ...card, color: 'var(--danger, #dc2626)' }}>{err}</div>
  if (!q) return <div style={muted}>Loading the review queue…</div>
  const field = (i: StoreEntry, k: 'cert_name' | 'number' | 'expires') => (editing === i.id
    ? <input aria-label={k} style={input} placeholder={k === 'expires' ? 'YYYY-MM-DD' : ''}
        value={draft[k] ?? i[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
    : (i[k] || '—'))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={card}>
        <strong>Waiting for you</strong>
        <div style={muted}>
          {q.counts.uploads} uploads from employees · {q.counts.disputed} disputed ·{' '}
          {q.counts.extracted} read from documents and not yet confirmed. Nothing counts as
          confirmed until a person confirms it.
        </div>
        {q.uploads.map((u) => (
          <div key={u.id} style={cell}>
            {u.uploader}: {u.filename} — {u.status}{u.records ? ` (${u.records} found)` : ''}
            {u.error && <span style={muted}> · {u.error}</span>}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input aria-label="Filter review" placeholder="Filter by name or certification" value={filter}
          onChange={(e) => setFilter(e.target.value)} style={{ ...input, flex: 1 }}
        />
        <button type="button" style={button} disabled={picked.size === 0}
          onClick={() => { void act(`${base}/entries/confirm-bulk`, jsonPost({ ids: [...picked] })) }}
        >
          Confirm {picked.size || ''} selected as shown
        </button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={cell} /><th style={cell} align="left">Person</th>
            <th style={cell} align="left">Certification</th><th style={cell} align="left">Number</th>
            <th style={cell} align="left">Expires</th><th style={cell} align="left">Source</th>
            <th style={cell} align="left">Status</th><th style={cell} />
          </tr>
        </thead>
        <tbody>
          {items.slice(0, 200).map((i) => (
            <tr key={i.id} data-entry={i.id}>
              <td style={cell}>
                <input type="checkbox" aria-label={`select ${i.person} ${i.cert_name}`} checked={picked.has(i.id)}
                  onChange={(e) => {
                    const n = new Set(picked)
                    if (e.target.checked) n.add(i.id)
                    else n.delete(i.id)
                    setPicked(n)
                  }}
                />
              </td>
              <td style={cell}>{i.person}</td>
              <td style={cell}>{field(i, 'cert_name')}</td>
              <td style={cell}>{field(i, 'number')}</td>
              <td style={cell}>{field(i, 'expires')}</td>
              <td style={{ ...cell, ...muted }}>
                {i.source_filename}{i.filename_only ? ' (file name only)' : ''}
                {i.origin === 'upload' ? ' · uploaded by the employee' : ''}
              </td>
              <td style={cell}>
                <StatusTag status={i.status} />
                {i.dispute_reason && <div style={muted}>{i.dispute_reason}</div>}
              </td>
              <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                {editing === i.id ? (
                  <>
                    <button type="button" style={small}
                      onClick={() => { void act(`${base}/entries/${i.id}/confirm`, jsonPost({ changes: draft })) }}
                    >Save + confirm</button>{' '}
                    <button type="button" style={small} onClick={() => setEditing(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button type="button" style={small}
                      onClick={() => { void act(`${base}/entries/${i.id}/confirm`, jsonPost({ changes: {} })) }}
                    >Confirm</button>{' '}
                    <button type="button" style={small}
                      onClick={() => { setEditing(i.id); setDraft({}) }}
                    >Correct</button>{' '}
                    <button type="button" style={small}
                      onClick={() => {
                        const reason = window.prompt('What is wrong with this record?')
                        if (reason) void act(`${base}/entries/${i.id}/dispute`, jsonPost({ reason }))
                      }}
                    >Dispute</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > 200 && <div style={muted}>Showing 200 of {items.length}; filter to find more.</div>}
    </div>
  )
}

const CHECK_LABEL: Record<string, string> = {
  number_bad_format: 'Number does not match the issuer format',
  number_missing: 'No certificate number',
  number_ok: 'Number matches the issuer format',
  number_unchecked: 'Number format not known for this issuer',
  expiry_before_issue: 'Expiry is not after the issue date',
  stale_expiry: 'Expired more than 5 years ago and not replaced',
  duplicate_number: 'Same number on two people',
  not_in_staff_list: 'Person not in the staff list',
  in_staff_list: 'Person in the staff list',
  curated_diff: 'Confirmed value differs from the document',
  filename_only: 'Read from the file name only',
  not_in_latest_extraction: 'No longer found in the documents',
  spreadsheet_agree: 'Agrees with your spreadsheet',
  spreadsheet_disagree: 'Disagrees with your spreadsheet',
  spreadsheet_not_in_spreadsheet: 'Not in your spreadsheet',
  spreadsheet_only_in_spreadsheet: 'In your spreadsheet, not found in the documents',
  evidence_text: 'Values found in the document text',
  evidence_filename: 'Values found only in a file name',
  evidence_not_found: 'Values not found in the document',
}

/** Whether one audit record carries the check ``code`` (a key of CHECK_LABEL). */
export function flagged(r: AuditRecord, code: string): boolean {
  const c = r.checks
  if (code.startsWith('number_')) return `number_${c.number}` === code
  if (code.startsWith('spreadsheet_')) return `spreadsheet_${c.spreadsheet}` === code
  if (code === 'not_in_staff_list') return c.in_staff_list === false
  if (code === 'in_staff_list') return c.in_staff_list === true
  if (code.startsWith('evidence_')) return r.evidence.some((e) => `evidence_${e.where}` === code)
  return Boolean(c[code])
}

interface AuditPayload {
  counts: Record<string, number>
  records: AuditRecord[]
  spreadsheet_only: Array<Record<string, string>>
}

interface DropAsk {
  type: 'kind' | 'confirm' | 'column'
  question: string
  digest?: string
  field?: string
  headers?: Array<{ index: number; header: string }>
}
interface DropResult { file: string; kind: string; text: string; ask?: DropAsk }
interface DropStatus { have: Array<{ kind: string; text: string }>; documents: number }
const DROP_KINDS: Array<[string, string]> = [
  ['roster', 'Employee list'], ['certifications', 'Certifications'], ['licenses', 'Licenses'],
  ['export', 'Audit sheet'], ['other', 'Leave it out'],
]
const link: CSSProperties = { color: 'var(--text-muted)', fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }

/**
 * Audit, the simple way: ONE drop box and ONE button.
 *
 * Any number of files go in the box (employee list, certifications, licenses, or the
 * audit sheet coming back corrected); the host works out what each one is from its
 * content (`POST /drop`) and answers one sentence per file. A question appears only
 * when the host needs one. "Download audit" is the one output (`GET /audit-sheet.xlsx`).
 */
export function Audit({ base }: { base: string }) {
  const files = useRef(new Map<string, File>())
  const answers = useRef<Record<'kinds' | 'mapping' | 'confirm', Record<string, unknown>>>(
    { kinds: {}, mapping: {}, confirm: {} })
  const [results, setResults] = useState<DropResult[]>([])
  const [have, setHave] = useState<DropStatus | null>(null)
  const [fixing, setFixing] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [more, setMore] = useState(false)

  useEffect(() => {
    void call(`${base}/drop`).then((r) => { if (r.ok) setHave(r.body as DropStatus) })
  }, [base])

  const send = async (names: string[]) => {
    const fd = new FormData()
    for (const n of names) {
      const f = files.current.get(n)
      if (f) fd.append('files', f, n)
    }
    for (const key of ['kinds', 'mapping', 'confirm'] as const) {
      const part = Object.fromEntries(Object.entries(answers.current[key]).filter(([n]) => names.includes(n)))
      if (Object.keys(part).length) fd.append(key, JSON.stringify(part))
    }
    setBusy(true); setNote('')
    const r = await call(`${base}/drop`, { method: 'POST', body: fd })
    setBusy(false)
    if (!r.ok) { setNote(friendlyHttpError(r.status, { detail: r.body.detail, subject: 'CertTrack' })); return }
    const got = r.body.files as DropResult[]
    setResults((prev) => [...prev.filter((x) => !got.some((g) => g.file === x.file)), ...got])
    setHave({ have: r.body.have, documents: r.body.documents })
    setFixing('')
  }
  const take = (list: FileList | null) => {
    const names = []
    for (const f of Array.from(list ?? [])) {
      files.current.set(f.name, f)
      for (const key of ['kinds', 'mapping', 'confirm'] as const) delete answers.current[key][f.name]
      names.push(f.name)
    }
    if (names.length) void send(names)
  }
  const answer = (name: string, key: 'kinds' | 'mapping' | 'confirm', value: unknown) => {
    answers.current[key][name] = value
    void send([name])
  }
  const download = async (ext: 'xlsx' | 'csv') => {
    setNote('')
    const r = await fetch(`${base}/audit-sheet.${ext}`, { credentials: 'include' })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      setNote(friendlyHttpError(r.status, { detail: body.detail, subject: 'CertTrack' }))
      return
    }
    const url = URL.createObjectURL(await r.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = `certtrack-audit-${new Date().toISOString().slice(0, 10)}.${ext}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }
  const dropped = new Set(results.map((r) => r.kind))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="certtrack-audit">
      <label
        style={{ ...card, display: 'block', textAlign: 'center', padding: 24, borderStyle: 'dashed', cursor: 'pointer' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); take(e.dataTransfer.files) }}
      >
        <strong>Drop your files here (employee list, certifications, licenses). Any names, CSV or Excel.</strong>
        <div style={{ marginTop: 8 }}>
          <input type="file" multiple accept=".csv,.xlsx" aria-label="Drop your files here" disabled={busy}
            onChange={(e) => { take(e.target.files); e.target.value = '' }}
          />
        </div>
      </label>
      {busy && <div style={muted}>Reading…</div>}
      {note && <div role="alert" style={{ color: 'var(--danger, #dc2626)', fontSize: 13 }}>{note}</div>}
      {(have?.have ?? []).filter((h) => !dropped.has(h.kind)).map((h) => (
        <div key={h.kind} style={muted} data-have={h.kind}>{h.text}</div>
      ))}
      {results.map((r) => (
        <div key={r.file} style={cell} data-dropped={r.file}>
          {r.text}{' '}
          {!r.ask && <a href="#" style={link} onClick={(e) => { e.preventDefault(); setFixing(fixing === r.file ? '' : r.file) }}>not right?</a>}
          {(fixing === r.file || r.ask?.type === 'kind') && (
            <div style={muted}>
              {r.ask?.question ?? 'What is this file?'}{' '}
              <select aria-label={`What is ${r.file}`} style={input} value="" disabled={busy}
                onChange={(e) => { if (e.target.value) answer(r.file, 'kinds', e.target.value) }}
              >
                <option value="">Choose…</option>
                {DROP_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
          )}
          {r.ask?.type === 'column' && (
            <div style={muted}>
              {r.ask.question}{' '}
              <select aria-label={r.ask.question} style={input} value="" disabled={busy}
                onChange={(e) => {
                  if (!e.target.value) return
                  const prev = (answers.current.mapping[r.file] as unknown[] | undefined) ?? []
                  answer(r.file, 'mapping', [...prev, { index: Number(e.target.value), field: r.ask?.field }])
                }}
              >
                <option value="">Choose…</option>
                {(r.ask.headers ?? []).map((h) => <option key={h.index} value={h.index}>{h.header}</option>)}
              </select>
            </div>
          )}
          {r.ask?.type === 'confirm' && (
            <div style={{ marginTop: 4 }}>
              {r.ask.question}{' '}
              <button type="button" style={button} disabled={busy}
                onClick={() => answer(r.file, 'confirm', r.ask?.digest)}
              >Yes</button>{' '}
              <a href="#" style={link}
                onClick={(e) => { e.preventDefault(); setResults(results.filter((x) => x.file !== r.file)) }}
              >No</a>
            </div>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" style={{ ...button, padding: '10px 18px', fontSize: 15 }}
          onClick={() => { void download('xlsx') }}
        >Download audit</button>
        <a href="#" style={link} onClick={(e) => { e.preventDefault(); void download('csv') }}>CSV</a>
        <span style={{ flex: 1 }} />
        <a href="#" style={link} onClick={(e) => { e.preventDefault(); setMore(!more) }}>More</a>
      </div>
      {more && <AuditDetails base={base} />}
    </div>
  )
}

/** Behind "More": the evidence and cross-checks for every record. */
function AuditDetails({ base }: { base: string }) {
  const [a, setA] = useState<AuditPayload | null>(null)
  const [err, setErr] = useState('')
  const [code, setCode] = useState('number_bad_format')

  const load = useCallback(async () => {
    const r = await call(`${base}/audit`)
    if (!r.ok) { setErr(friendlyHttpError(r.status, { detail: r.body.detail, subject: 'CertTrack' })); return }
    setErr(''); setA(r.body as AuditPayload)
  }, [base])
  useEffect(() => { void load() }, [load])

  if (err) return <div role="alert" style={{ ...card, color: 'var(--danger, #dc2626)' }}>{err}</div>
  if (!a) return <div style={muted}>Building the audit…</div>
  const c = a.counts
  const rows = a.records.filter((r) => flagged(r, code))
  const stats: Array<[string, number]> = [['Records', c.entries], ['Confirmed by a person', c.curated],
    ['Not yet confirmed', c.extracted], ['Disputed', c.disputed], ['Spreadsheet rows', c.spreadsheet_rows]]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        {stats.map(([l, n]) => (
          <div key={l} style={card} data-audit-stat={l}>
            <div style={muted}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{n ?? 0}</div>
          </div>
        ))}
      </div>
      <div style={card}>
        <strong>Cross-checks</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {Object.keys(CHECK_LABEL).filter((k) => (c[k] ?? 0) > 0).map((k) => (
            <button key={k} type="button" style={tabStyle(code === k)} onClick={() => setCode(k)}>
              {CHECK_LABEL[k]}: {c[k]}
            </button>
          ))}
        </div>
      </div>
      <div style={card}>
        <strong>
          {CHECK_LABEL[code] || code} (
          {code === 'spreadsheet_only_in_spreadsheet' ? a.spreadsheet_only.length : rows.length})
        </strong>
        {code === 'spreadsheet_only_in_spreadsheet' ? a.spreadsheet_only.slice(0, 200).map((r, i) => (
          <div key={i} style={cell}>
            {r.employee}: {r.cert_name} {r.expires && `· expires ${r.expires}`} (row {r.row_number})
          </div>
        )) : rows.slice(0, 200).map((r) => (
          <div key={r.id} style={cell} data-audit-record={r.id}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <strong>{r.person}</strong> {r.cert_name} <StatusTag status={r.status} />
              <span style={muted}>{r.source_filename}</span>
            </div>
            {r.evidence.map((e) => (
              <div key={e.field} style={muted}>
                {e.field} “{e.value}”: {e.where === 'text' ? <>in the document: …{e.excerpt}…</>
                  : e.where === 'filename' ? 'only in the file name' : 'not found in the document'}
              </div>
            ))}
            {r.checks.curated_diff
              ? <div style={muted}>Differs: {JSON.stringify(r.checks.curated_diff)}</div> : null}
            {r.checks.spreadsheet_diff
              ? <div style={muted}>Spreadsheet: {JSON.stringify(r.checks.spreadsheet_diff)}</div> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/** My certifications: an employee's own records and certificate uploads. */
export function MyCerts({ base, pollMs = 5000 }: { base: string; pollMs?: number }) {
  const [me, setMe] = useState<MePayload | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    const r = await call(`${base}/me`)
    if (!r.ok) { setErr(friendlyHttpError(r.status, { detail: r.body.detail, subject: 'CertTrack' })); return }
    const body = r.body as MePayload
    setErr(''); setMe(body)
    if ((body.uploads ?? []).some((u) => u.status === 'queued')) {
      timer.current = setTimeout(() => { void load() }, pollMs)
    }
  }, [base, pollMs])
  useEffect(() => {
    void load()
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [load])

  const upload = async (f: File) => {
    if (f.size > (me?.limits?.max_bytes ?? 20 * 1024 * 1024)) { setErr('That file is larger than 20 MB.'); return }
    setBusy(true)
    const fd = new FormData()
    fd.append('file', f)
    const r = await call(`${base}/uploads`, { method: 'POST', body: fd })
    setBusy(false)
    if (!r.ok) { setErr(friendlyHttpError(r.status, { detail: r.body.detail, subject: 'CertTrack' })); return }
    await load()
  }
  const withdraw = async (id: string) => {
    const r = await call(`${base}/uploads/${id}`, { method: 'DELETE' })
    if (!r.ok) setErr(friendlyHttpError(r.status, { detail: r.body.detail, subject: 'CertTrack' }))
    await load()
  }

  const groups: Array<[string, string]> = [['expired', 'Expired'], ['expiring', 'Expiring soon'],
    ['current', 'Current'], ['no_expiry', 'No expiry on file']]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {err && <div role="alert" style={{ ...card, color: 'var(--danger, #dc2626)' }}>{err}</div>}
      <div style={card}>
        <strong>Upload a certificate</strong>
        <div style={muted}>
          A PDF or a photo of the card or certificate, up to 20 MB. An administrator checks it
          before it counts.
        </div>
        <input type="file" aria-label="Upload a certificate" disabled={busy}
          accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }}
        />
        {busy && <div style={muted}>Uploading…</div>}
      </div>
      {me && (
        <div style={card}>
          <strong>Your uploads</strong>
          {me.uploads.length === 0 && <div style={muted}>Nothing uploaded yet.</div>}
          {me.uploads.map((u) => (
            <div key={u.id} style={cell} data-upload={u.status}>
              {u.filename} — {u.status === 'queued' ? 'reading…' : u.status === 'needs_review'
                ? 'waiting for an administrator' : u.status}
              {u.records ? ` · ${u.records} found` : ''}{u.error && <span style={muted}> · {u.error}</span>}
              {u.status !== 'confirmed' && u.status !== 'queued' && (
                <> <button type="button" style={small} onClick={() => { void withdraw(u.id) }}>Withdraw</button></>
              )}
            </div>
          ))}
        </div>
      )}
      {me && !me.linked && (
        <div style={muted}>
          No certifications are linked to your login yet; upload one and an administrator links it.
        </div>
      )}
      {me?.certs && groups.map(([k, label]) => ((me.certs?.[k] ?? []).length > 0 ? (
        <div key={k} style={card}>
          <strong>{label}</strong>
          {(me.certs?.[k] ?? []).map((c) => (
            <div key={c.id} style={cell}>
              {c.cert_name} {c.expires ? `· expires ${c.expires}` : ''} <StatusTag status={c.status} />
            </div>
          ))}
        </div>
      ) : null))}
    </div>
  )
}
