/**
 * ComponentsPanel -- optional components on an awnix appliance (`awnix component`).
 *
 * Reads GET /api/appliance/components (the CLI's `list --json`) and mutates ONLY
 * through POST /api/appliance/actions/component-{install,remove,rollback} {id}; the
 * console runs a fixed argv, this panel never names a command. Every row shows the
 * CLI's own state -- baked, installed, available, unavailable (+ why), needs license --
 * the version and a short pin. Baked rows are what the appliance IS: read-only.
 *
 * Outcomes are explicit, never an empty success: 402 -> "needs a license", 409 -> the
 * CLI's reason and log tail, 501 -> "not an awnix appliance", 503 -> "unavailable".
 *
 * Vite-safe (no next/*), awkit-vars tokens only, holds at 360 px (the table keeps
 * three columns and the meta stacks under the name).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Badge, StateNotice, useApplianceCall } from './ApplianceConsole'
import type {
  ApiResult,
  AppliancePanelProps,
  ComponentResult,
  ComponentResultState,
  ComponentsResult,
} from './types'

type Op = 'install' | 'remove' | 'rollback'

const OP_VERB = {
  install: 'component-install',
  remove: 'component-remove',
  rollback: 'component-rollback',
} as const

const OP_LABEL: Record<Op, string> = { install: 'Install', remove: 'Remove', rollback: 'Roll back' }
const OP_DOING: Record<Op, string> = {
  install: 'Installing',
  remove: 'Removing',
  rollback: 'Rolling back',
}

export const STATE_LABEL: Record<ComponentResultState, string> = {
  baked: 'Built in',
  installed: 'Installed',
  available: 'Available',
  unavailable: 'Unavailable',
  'needs-license': 'Needs license',
  failed: 'Failed',
}

const STATE_TONE: Record<ComponentResultState, string> = {
  baked: 'muted',
  installed: 'ok',
  available: 'muted',
  unavailable: 'muted',
  'needs-license': 'warn',
  failed: 'danger',
}

/** The actions a row offers. Baked, unavailable and needs-license rows offer none. */
export function rowActions(r: ComponentResult): Op[] {
  switch (r.state) {
    case 'available':
      return ['install']
    case 'installed':
      return r.previous_pin ? ['remove', 'rollback'] : ['remove']
    case 'failed':
      return ['install']
    default:
      return []
  }
}

export function shortPin(pin?: string | null): string {
  if (!pin) return ''
  const hex = pin.replace(/^sha256:/, '')
  return hex.slice(0, 12)
}

/** Sort: installed first, then available, needs-license, baked, unavailable; by id. */
const ORDER: Record<ComponentResultState, number> = {
  installed: 0,
  failed: 1,
  available: 2,
  'needs-license': 3,
  baked: 4,
  unavailable: 5,
}

interface OpOutcome {
  id: string
  op: Op
  result: ApiResult<unknown>
  row?: ComponentResult
}

/** What to tell the admin about a finished action, in words. */
export function describeOutcome(o: OpOutcome): { tone: string; title: string; detail: string } {
  const { result, row, op, id } = o
  const reason = row?.reason || result.detail || ''
  if (result.state === 'ok') {
    const pin = row?.pin ? ` (${shortPin(row.pin)})` : ''
    const done = op === 'install' ? 'installed' : op === 'remove' ? 'removed' : 'rolled back'
    return { tone: 'ok', title: `${id} ${done}${pin}`, detail: reason }
  }
  if (result.state === 'not-entitled' || result.status === 402) {
    return {
      tone: 'warn',
      title: `${id} needs a license`,
      detail: reason || 'Your license does not include this component. Add it on the License tab.',
    }
  }
  if (result.status === 501 || result.state === 'not-an-appliance') {
    return {
      tone: 'muted',
      title: 'Not running on an awnix appliance',
      detail: 'Components are managed by awnix appliances; this host has no `awnix component`.',
    }
  }
  if (result.state === 'refused') {
    return { tone: 'danger', title: `${OP_LABEL[op]} ${id} failed -- nothing changed`, detail: reason }
  }
  if (result.state === 'unavailable') {
    return { tone: 'muted', title: 'The appliance could not judge right now', detail: reason }
  }
  return { tone: 'danger', title: `${OP_LABEL[op]} ${id}: ${result.state}`, detail: reason }
}

function firstRow(data: unknown, id: string): ComponentResult | undefined {
  const rows = (data as ComponentsResult | null)?.results
  if (!Array.isArray(rows)) return undefined
  return rows.find((r) => r.id === id) ?? rows[0]
}

const S: Record<string, CSSProperties> = {
  wrap: { overflowX: 'auto', maxWidth: '100%' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: {
    textAlign: 'left',
    fontWeight: 600,
    color: 'var(--text-muted)',
    padding: '8px 6px',
    borderBottom: '1px solid var(--border-subtle)',
  },
  td: { padding: '10px 6px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top' },
  name: { fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' },
  meta: { color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono, monospace)' },
  reason: { color: 'var(--text-muted)', fontSize: 12, marginTop: 4 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  confirm: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    padding: 8,
    borderRadius: 'var(--radius, 8px)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-default)',
  },
  log: {
    whiteSpace: 'pre-wrap',
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: 12,
    maxHeight: 220,
    overflow: 'auto',
    background: 'var(--bg-deep)',
    color: 'var(--text-secondary)',
    padding: 8,
    borderRadius: 'var(--radius, 8px)',
    margin: '8px 0 0',
  },
  toolbar: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', margin: '0 0 12px' },
}

export function ComponentsPanel({ client }: AppliancePanelProps) {
  const { result, loading, reload } = useApplianceCall(() => client.components())
  const [confirm, setConfirm] = useState<{ id: string; op: Op } | null>(null)
  const [busy, setBusy] = useState<{ id: string; op: Op } | null>(null)
  const [outcome, setOutcome] = useState<OpOutcome | null>(null)
  const [showAll, setShowAll] = useState(false)

  // Poll the list while an operation runs (an install can take minutes).
  useEffect(() => {
    if (!busy) return undefined
    const t = setInterval(() => void reload(), 4000)
    return () => clearInterval(t)
  }, [busy, reload])

  const run = useCallback(
    async (id: string, op: Op) => {
      setConfirm(null)
      setOutcome(null)
      setBusy({ id, op })
      const r = await client.action(OP_VERB[op], { id })
      setBusy(null)
      setOutcome({ id, op, result: r, row: firstRow(r.data, id) })
      await reload()
    },
    [client, reload],
  )

  const rows = useMemo(() => {
    const all = (result?.state === 'ok' && result.data?.results) || []
    return [...all].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.id.localeCompare(b.id))
  }, [result])

  if (!result) return <p className="awx-muted" aria-busy="true">Loading…</p>
  if (result.state !== 'ok' || !result.data) {
    if (result.status === 501 || result.state === 'not-an-appliance') {
      return (
        <StateNotice result={{ ...result, state: 'not-an-appliance' }}>
          <p className="awx-muted" data-testid="not-an-appliance">
            Not running on an awnix appliance: this host has no <code>awnix component</code>.
          </p>
        </StateNotice>
      )
    }
    return <StateNotice result={result} onRetry={() => void reload()} />
  }

  const hidden = rows.filter((r) => r.state === 'unavailable').length
  const shown = showAll ? rows : rows.filter((r) => r.state !== 'unavailable')
  const counts = rows.reduce<Record<string, number>>((m, r) => {
    m[r.state] = (m[r.state] ?? 0) + 1
    return m
  }, {})
  const said = outcome ? describeOutcome(outcome) : null
  const log = outcome ? outcome.row?.log_tail || outcome.result.stdoutTail || '' : ''

  return (
    <section className="awx-card" aria-busy={loading || busy ? true : undefined}>
      <div className="awx-card-head">
        <h2>Components</h2>
        <span className="awx-muted">
          {counts.installed ?? 0} installed · {counts.baked ?? 0} built in · {counts.available ?? 0}{' '}
          available
        </span>
      </div>
      <p className="awx-muted">
        Optional software pinned by this image. Installs are versioned and roll back with the
        system; built-in parts cannot be removed.
      </p>

      {busy ? (
        <div className="awx-notice awx-tone-muted" role="status" data-testid="busy">
          {OP_DOING[busy.op]} {busy.id}… this can take a few minutes.
        </div>
      ) : null}

      {said ? (
        <div className={`awx-notice awx-tone-${said.tone}`} role="status" data-testid="outcome">
          <strong>{said.title}</strong>
          {said.detail ? <p className="awx-notice-detail">{said.detail}</p> : null}
          {log ? <pre style={S.log}>{log}</pre> : null}
        </div>
      ) : null}

      <div style={S.toolbar}>
        <label className="awx-muted">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />{' '}
          Show unavailable ({hidden})
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="awx-muted">Nothing to show. Tick "Show unavailable" to see every row.</p>
      ) : (
        <div style={S.wrap}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th} scope="col">Component</th>
                <th style={S.th} scope="col">State</th>
                <th style={S.th} scope="col">
                  <span className="awx-muted">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const acts = rowActions(r)
                const asking = confirm?.id === r.id ? confirm : null
                return (
                  <tr key={r.id} data-testid={`row-${r.id}`} data-state={r.state}>
                    <td style={S.td}>
                      <div style={S.name}>{r.id}</div>
                      <div style={S.meta}>
                        {r.kind}
                        {r.version ? ` · ${r.version}` : ''}
                        {r.pin ? ` · ${shortPin(r.pin)}` : ''}
                      </div>
                      {r.reason && r.state !== 'available' ? (
                        <div style={S.reason} data-testid={`reason-${r.id}`}>
                          {r.reason}
                        </div>
                      ) : null}
                    </td>
                    <td style={S.td}>
                      <Badge tone={STATE_TONE[r.state] ?? 'muted'}>
                        {STATE_LABEL[r.state] ?? r.state}
                      </Badge>
                    </td>
                    <td style={S.td}>
                      {asking ? (
                        <div style={S.confirm} role="group" aria-label={`Confirm ${asking.op}`}>
                          <span>
                            {OP_LABEL[asking.op]} {r.id}?
                          </span>
                          <button
                            type="button"
                            className={`awx-btn ${asking.op === 'remove' ? 'awx-btn-danger' : 'awx-btn-primary'}`}
                            onClick={() => void run(r.id, asking.op)}
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            className="awx-btn awx-btn-quiet"
                            onClick={() => setConfirm(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : acts.length ? (
                        <div style={S.actions}>
                          {acts.map((op) => (
                            <button
                              key={op}
                              type="button"
                              className={`awx-btn ${op === 'install' ? 'awx-btn-primary' : 'awx-btn-quiet'}`}
                              disabled={busy !== null}
                              onClick={() => setConfirm({ id: r.id, op })}
                            >
                              {OP_LABEL[op]}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="awx-muted">
                          {r.state === 'baked'
                            ? 'Part of this appliance'
                            : r.state === 'needs-license'
                              ? 'Needs a license'
                              : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default ComponentsPanel
