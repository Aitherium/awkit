/**
 * Outbound endpoints — every vendor/fleet URL this appliance will dial.
 *
 * A read-only mirror of the box's endpoint env files (contract `endpoints-env`):
 *   awnix   /usr/lib/awnix/endpoints.env  <  /etc/awnix/endpoints.env  <  process env
 *   tenant  the product's vendor env file <  its /etc admin file       <  process env
 * The UI is NOT a second store. An admin changes an endpoint by editing the /etc file,
 * like any Linux service; the footer names the file (each row carries it as `file`) and
 * the command that applies it (`awnix endpoints apply`: restarting the product's
 * first-boot unit alone skips a backend that is already running).
 *
 * Backed by GET /api/appliance/endpoints (`awnix endpoints show --json`) and the
 * `endpoints-probe` action (`awnix endpoints probe --json`). 501 and 503 render as
 * explicit states, never as an empty table: "no endpoints" and "could not ask" must
 * not look alike.
 *
 * Vite-safe: no next/* imports; awkit-vars.css tokens only, so light/dark come free.
 */
import { useCallback, useEffect, useState } from 'react'

export type EndpointSource = 'default' | 'vendor-env' | 'admin-env' | 'process-env'
export type Reachability = 'ok' | 'unreachable' | 'off'

export interface EndpointRow {
  var: string
  value: string | null
  source: EndpointSource
  internal: boolean
  /** 'awnix' or the tenant product's chain name. */
  chain?: string
  /** The /etc file an admin edits for this row's chain. */
  file?: string
  reachable?: Reachability
}

/** What the appliance client returns for the endpoints route. Structural on purpose:
 * `createApplianceClient` (appliance/client.ts) satisfies it. */
export type EndpointsResult =
  | { state: 'ok'; data: { endpoints: EndpointRow[] } }
  | { state: 'unavailable'; detail?: string } // 501: this box has no appliance plane
  | { state: 'unreachable'; detail?: string } // 503: the console did not answer
  | { state: 'error'; status?: number; detail?: string }

export interface EndpointsClient {
  getEndpoints(): Promise<EndpointsResult>
  /** Runs the `endpoints-probe` action; optional (read-only consoles omit it). */
  probeEndpoints?(): Promise<EndpointsResult>
}

const SOURCE_LABEL: Record<EndpointSource, string> = {
  default: 'built-in default',
  'vendor-env': 'vendor default',
  'admin-env': 'admin override',
  'process-env': 'environment',
}

const S = {
  wrap: {
    color: 'var(--text-primary)',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-lg)',
    padding: 16,
    maxWidth: '100%',
    boxSizing: 'border-box' as const,
  },
  head: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, alignItems: 'center',
          justifyContent: 'space-between', marginBottom: 12 },
  title: { margin: 0, fontSize: 18, fontFamily: 'var(--font-display)' },
  button: {
    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
    border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)',
    padding: '6px 12px', cursor: 'pointer', minHeight: 36,
  },
  scroller: { overflowX: 'auto' as const, width: '100%' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, color: 'var(--text-secondary)', fontWeight: 600,
        padding: '6px 8px', borderBottom: '1px solid var(--border-default)' },
  td: { padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)',
        verticalAlign: 'top' as const },
  mono: { fontFamily: 'var(--font-mono)', wordBreak: 'break-all' as const },
  badge: { display: 'inline-block', padding: '1px 6px', borderRadius: 'var(--radius)',
           border: '1px solid var(--border-default)', color: 'var(--text-secondary)',
           fontSize: 12, whiteSpace: 'nowrap' as const },
  internal: { display: 'inline-block', marginTop: 4, padding: '1px 6px',
              borderRadius: 'var(--radius)', background: 'var(--accent-danger)',
              color: 'var(--bg-deep)', fontSize: 12, fontWeight: 700 },
  notice: { padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-default)',
            background: 'var(--bg-elevated)' },
  error: { padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--accent-danger)',
           color: 'var(--text-danger)', background: 'var(--bg-elevated)' },
  footer: { marginTop: 12, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 },
  code: { fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' },
}

const REACH_COLOR: Record<Reachability, string> = {
  ok: 'var(--accent-success)',
  unreachable: 'var(--accent-danger)',
  off: 'var(--text-muted)',
}

type View =
  | { kind: 'loading' }
  | { kind: 'ok'; rows: EndpointRow[] }
  | { kind: 'unavailable'; detail?: string }
  | { kind: 'unreachable'; detail?: string }
  | { kind: 'error'; detail: string }

function toView(r: EndpointsResult): View {
  switch (r.state) {
    case 'ok':
      return Array.isArray(r.data?.endpoints)
        ? { kind: 'ok', rows: r.data.endpoints }
        : { kind: 'error', detail: 'the console answered without an endpoints list' }
    case 'unavailable':
      return { kind: 'unavailable', detail: r.detail }
    case 'unreachable':
      return { kind: 'unreachable', detail: r.detail }
    default:
      return { kind: 'error', detail: r.detail || `request failed${r.status ? ` (${r.status})` : ''}` }
  }
}

function Footer({ rows }: { rows: EndpointRow[] }) {
  const chains = new Set(rows.map((r) => r.chain).filter(Boolean))
  const awnix = chains.has('awnix') || chains.size === 0
  // Every non-awnix chain is a tenant product's; its admin file comes from the rows.
  const tenantFiles = Array.from(new Set(
    rows.filter((r) => r.chain && r.chain !== 'awnix').map((r) => r.file ?? ''),
  ))
  return (
    <div style={S.footer} data-testid="endpoints-footer">
      <p style={{ margin: 0 }}>
        This page only mirrors the box's env files. To change an endpoint, edit the file
        (plain <code style={S.code}>KEY=VALUE</code>; an empty value turns the feature off):
      </p>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {awnix && (
          <li>
            <code style={S.code}>/etc/awnix/endpoints.env</code> — read by every{' '}
            <code style={S.code}>awnix</code> command on its next run.
          </li>
        )}
        {tenantFiles.map((file) => (
          <li key={file || 'tenant'}>
            {file ? <code style={S.code}>{file}</code> : "the product's appliance env file"} — then
            apply it with <code style={S.code}>sudo awnix endpoints apply</code>. Restarting the
            product's first-boot unit alone is not enough: it skips the backend that is already
            running, so the old values stay live.
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function EndpointsPanel({ client }: { client: EndpointsClient }) {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [probing, setProbing] = useState(false)

  const load = useCallback(async () => {
    try {
      setView(toView(await client.getEndpoints()))
    } catch (e) {
      setView({ kind: 'error', detail: e instanceof Error ? e.message : String(e) })
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  const probe = useCallback(async () => {
    if (!client.probeEndpoints) return
    setProbing(true)
    try {
      setView(toView(await client.probeEndpoints()))
    } catch (e) {
      setView({ kind: 'error', detail: e instanceof Error ? e.message : String(e) })
    } finally {
      setProbing(false)
    }
  }, [client])

  const internalSet = view.kind === 'ok' ? view.rows.filter((r) => r.internal && r.value) : []

  return (
    <section style={S.wrap} aria-labelledby="awkit-endpoints-title" data-testid="endpoints-panel">
      <div style={S.head}>
        <h2 id="awkit-endpoints-title" style={S.title}>Outbound endpoints</h2>
        {client.probeEndpoints && view.kind === 'ok' && (
          <button type="button" style={S.button} onClick={probe} disabled={probing}>
            {probing ? 'Checking…' : 'Check reachability'}
          </button>
        )}
      </div>

      {view.kind === 'loading' && <p role="status">Loading endpoints…</p>}

      {view.kind === 'unavailable' && (
        <div style={S.notice} role="status" data-testid="endpoints-unavailable">
          This machine has no appliance endpoint plane (not an awnix or product appliance), so
          there is nothing to show.{view.detail ? ` ${view.detail}` : ''}
        </div>
      )}

      {view.kind === 'unreachable' && (
        <div style={S.error} role="alert" data-testid="endpoints-unreachable">
          The appliance console did not answer, so the endpoint list is unknown — not empty.
          On the box, run <code style={S.code}>sudo awnix endpoints show</code>.
          {view.detail ? ` (${view.detail})` : ''}
          <div style={{ marginTop: 8 }}>
            <button type="button" style={S.button} onClick={() => void load()}>Retry</button>
          </div>
        </div>
      )}

      {view.kind === 'error' && (
        <div style={S.error} role="alert" data-testid="endpoints-error">
          Could not read the endpoint list: {view.detail}
          <div style={{ marginTop: 8 }}>
            <button type="button" style={S.button} onClick={() => void load()}>Retry</button>
          </div>
        </div>
      )}

      {view.kind === 'ok' && (
        <>
          {internalSet.length > 0 && (
            <div style={{ ...S.error, marginBottom: 12 }} role="alert" data-testid="endpoints-internal-warning">
              {internalSet.length} endpoint{internalSet.length === 1 ? '' : 's'} still point at a
              fleet-internal host that does not exist on this box. Set {internalSet.length === 1 ? 'it' : 'them'} empty
              or to a reachable URL in the file named below.
            </div>
          )}
          {view.rows.length === 0 ? (
            <p style={S.notice}>This box dials no configured vendor endpoints.</p>
          ) : (
            <div style={S.scroller}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Variable</th>
                    <th style={S.th}>Value</th>
                    <th style={S.th}>Source</th>
                    <th style={S.th}>Reachable</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r) => (
                    <tr key={`${r.chain ?? ''}:${r.var}`} data-testid={`endpoint-row-${r.var}`}>
                      <td style={{ ...S.td, ...S.mono }}>{r.var}</td>
                      <td style={{ ...S.td, ...S.mono }}>
                        {r.value ? r.value : <span style={{ color: 'var(--text-muted)' }}>(off)</span>}
                        {r.internal && r.value && (
                          <div><span style={S.internal}>fleet-internal default</span></div>
                        )}
                      </td>
                      <td style={S.td}><span style={S.badge}>{SOURCE_LABEL[r.source] ?? r.source}</span></td>
                      <td style={{ ...S.td, color: r.reachable ? REACH_COLOR[r.reachable] : 'var(--text-muted)' }}>
                        {r.reachable ?? (r.value ? 'not checked' : 'off')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Footer rows={view.rows} />
        </>
      )}
    </section>
  )
}
