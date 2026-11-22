/**
 * MemoryStackCard -- "Memory & search (self-hosted)": the ONE-click switch for the
 * appliance's own memory stack (lock row `memory-stack`, kind `bundle`: Postgres, Qdrant,
 * the embedder, Secrets, Strata, Nexus, the knowledge graph, Retrieval).
 *
 * It drives the SAME component plane as the table below it, never a command:
 *   Install -> POST /api/appliance/actions/component-install-start {id: "memory-stack"}
 *   Remove  -> POST /api/appliance/actions/component-remove-start  {id: "memory-stack"}
 * Both run in the background (minutes: image pulls + health probes), so the answer is
 * "scheduled", and the card polls the components read and renders the row's `progress`
 * ("Step 3 of 9: Starting vector memory"). A failure is shown in the CLI's own plain
 * words; nothing is ever an empty success.
 *
 * Rendered by ComponentsPanel only when the lock offers a `memory-stack` row; it reuses
 * the panel's components read (no second fetch) and its reload for polling.
 */
import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Badge } from './ApplianceConsole'
import type { ApiResult, AppliancePanelProps, ComponentProgress, ComponentResult } from './types'

export const MEMORY_STACK_ID = 'memory-stack'

/** What the app is told to use once the stack is up (a mirror of the installer's file). */
const ENDPOINT_LABEL: Record<string, string> = {
  RETRIEVAL_URL: 'Search',
  NEXUS_URL: 'Vector memory',
  KG_URL: 'Knowledge graph',
  EMBED_URL: 'Embedder',
  STRATA_URL: 'Data plane',
}

export interface MemoryStackCardProps extends AppliancePanelProps {
  /** The bundle row from the components read. */
  row: ComponentResult
  /** Member rows (memory-*) for the compact status line. */
  members?: ComponentResult[]
  /** Re-read the components list (the panel's reload). */
  reload: () => Promise<unknown>
  /** Poll interval while an op runs; tests pass 0 to disable the timer. */
  pollMs?: number
}

/** Is a background op still running on this row? */
export function isRunning(p?: ComponentProgress | null): boolean {
  return !!p && p.done === false
}

/** "Step 3 of 9: Starting vector memory" -- or just the message when steps are unknown. */
export function progressLine(p: ComponentProgress): string {
  const msg = p.message || (p.current ? `Working on ${p.current}` : 'Working')
  return p.steps > 0 ? `Step ${Math.min(p.step, p.steps)} of ${p.steps}: ${msg}` : msg
}

/** An action answer that is NOT "scheduled", in plain words. Null when it was accepted. */
export function describeStartFailure(r: ApiResult<unknown>): string | null {
  if (r.state === 'ok') return null
  const detail = (r.detail || '').trim()
  if (r.state === 'not-entitled' || r.status === 402) {
    return 'Your license does not include the self-hosted memory stack.'
  }
  if (r.state === 'refused') {
    return detail ? `The appliance refused: ${detail}` : 'The appliance refused the request.'
  }
  if (r.state === 'unavailable' || r.state === 'not-an-appliance' || r.status === 501 || r.status === 503) {
    return `This box cannot run it right now${detail ? `: ${detail}` : '.'}`
  }
  return `Something went wrong${detail ? `: ${detail}` : ` (${r.state})`}.`
}

const S: Record<string, CSSProperties> = {
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '8px 0' },
  members: { color: 'var(--text-muted)', fontSize: 12, marginTop: 4 },
  endpoints: { color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0', paddingLeft: 18 },
  spinner: {
    display: 'inline-block',
    width: 12,
    height: 12,
    borderRadius: '50%',
    border: '2px solid var(--border-default)',
    borderTopColor: 'var(--text-primary)',
    animation: 'awx-spin 0.9s linear infinite',
    marginRight: 6,
    verticalAlign: 'middle',
  },
}

export function MemoryStackCard({ client, row, members = [], reload, pollMs = 3000 }: MemoryStackCardProps) {
  const [sending, setSending] = useState<'install' | 'remove' | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  // Set when we scheduled an op and have not yet seen its progress on the row.
  const [awaiting, setAwaiting] = useState(false)

  const progress = row.progress ?? null
  const running = isRunning(progress) || awaiting
  useEffect(() => {
    if (awaiting && progress) setAwaiting(false)
  }, [awaiting, progress])

  useEffect(() => {
    if (!running || !pollMs) return undefined
    const t = setInterval(() => void reload(), pollMs)
    return () => clearInterval(t)
  }, [running, pollMs, reload])

  const start = useCallback(
    async (op: 'install' | 'remove') => {
      setConfirmRemove(false)
      setStartError(null)
      setSending(op)
      const r = await client.action(
        op === 'install' ? 'component-install-start' : 'component-remove-start',
        { id: row.id },
      )
      setSending(null)
      const why = describeStartFailure(r)
      if (why) {
        setStartError(why)
      } else {
        setAwaiting(true)
      }
      await reload()
    },
    [client, row.id, reload],
  )

  const busy = running || sending !== null
  const failed = !!progress && progress.done && progress.ok === false
  const endpoints = row.state === 'installed' ? row.endpoints ?? null : null
  const memberLine = members.length
    ? `${members.filter((m) => m.state === 'installed').length} of ${members.length} services running`
    : ''

  return (
    <section
      className="awx-card"
      data-testid="memory-stack-card"
      data-state={row.state}
      aria-busy={busy ? true : undefined}
    >
      <div className="awx-card-head">
        <h2>Memory &amp; search (self-hosted)</h2>
        <Badge tone={row.state === 'installed' ? 'ok' : row.state === 'needs-license' ? 'warn' : 'muted'}>
          {row.state === 'installed'
            ? 'On'
            : row.state === 'needs-license'
              ? 'Needs license'
              : row.state === 'unavailable'
                ? 'Unavailable'
                : 'Off'}
        </Badge>
      </div>
      <p className="awx-muted">
        Runs your own memory, search and knowledge graph on this machine; nothing leaves the box.
      </p>

      {running ? (
        <div className="awx-notice awx-tone-muted" role="status" data-testid="memory-progress">
          <span style={S.spinner} aria-hidden="true" />
          {progress && !progress.done
            ? progressLine(progress)
            : sending === 'remove' || progress?.op === 'remove'
              ? 'Removing…'
              : 'Starting… this takes a few minutes.'}
        </div>
      ) : null}

      {!running && failed ? (
        <div className="awx-notice awx-tone-danger" role="status" data-testid="memory-error">
          <strong>{progress?.op === 'remove' ? 'Remove did not finish' : 'Install did not finish'}</strong>
          <p className="awx-notice-detail">
            {progress?.error || progress?.message || 'The appliance gave no reason.'}
          </p>
        </div>
      ) : null}

      {startError ? (
        <div className="awx-notice awx-tone-danger" role="status" data-testid="memory-start-error">
          {startError}
        </div>
      ) : null}

      {row.state === 'needs-license' || row.state === 'unavailable' ? (
        <p className="awx-muted" data-testid="memory-reason">
          {row.reason ||
            (row.state === 'needs-license'
              ? 'Your license does not include the self-hosted memory stack.'
              : 'This appliance image does not offer it.')}
        </p>
      ) : null}

      {endpoints ? (
        <div data-testid="memory-endpoints">
          <p>This assistant now uses this machine for memory and search.</p>
          <ul style={S.endpoints}>
            {Object.entries(endpoints).map(([k, v]) => (
              <li key={k}>
                {ENDPOINT_LABEL[k] ?? k}: <code>{v}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {memberLine ? <div style={S.members} data-testid="memory-members">{memberLine}</div> : null}

      <div style={S.row}>
        {(row.state === 'available' || row.state === 'failed') ? (
          <button
            type="button"
            className="awx-btn awx-btn-primary"
            disabled={busy}
            onClick={() => void start('install')}
          >
            {failed && progress?.op === 'install' ? 'Try again' : 'Install'}
          </button>
        ) : null}
        {row.state === 'installed' && !confirmRemove ? (
          <button
            type="button"
            className="awx-btn awx-btn-quiet"
            disabled={busy}
            onClick={() => setConfirmRemove(true)}
          >
            Remove
          </button>
        ) : null}
        {row.state === 'installed' && confirmRemove ? (
          <div role="group" aria-label="Confirm remove" style={S.row}>
            <span>
              Remove it? This assistant goes back to the platform for memory and search. Your stored data
              stays on disk.
            </span>
            <button
              type="button"
              className="awx-btn awx-btn-danger"
              disabled={busy}
              onClick={() => void start('remove')}
            >
              Confirm
            </button>
            <button type="button" className="awx-btn awx-btn-quiet" onClick={() => setConfirmRemove(false)}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

export default MemoryStackCard
