/**
 * MeshPanel -- this box in the tenant's AitherMesh: state, overlay address, peers,
 * registered capabilities, and join / retry / leave.
 *
 * Reads GET /api/appliance/mesh (`awnix mesh status --json`); acts through the console's
 * fixed action allowlist: mesh-join {token} (sent once, stdin to the CLI), mesh-retry,
 * mesh-leave. Every HTTP outcome is rendered, never an empty success:
 *   501 -> "mesh is not installed on this image" (no /usr/libexec/awnix/awnix-mesh)
 *   503 with data -> the CLI's own pending/offline status (exit 2 is not an error)
 * The enroll token lives only in the password input; it is cleared on submit and is
 * never rendered back (the status document never contains one).
 *
 * Vite-safe (no next/*), awkit-vars tokens only, light and dark, holds at 360 px.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import {
  MESH_STATUS_PATH,
  MESH_TOKEN_RE,
  type MeshActionVerb,
  type MeshApiResult,
  type MeshClient,
  type MeshState,
  type MeshStatus,
} from './mesh-types'

export interface MeshPanelProps {
  client: MeshClient
}

const TONE: Record<MeshState, string> = {
  joined: 'var(--accent-success, var(--accent-green))',
  pending: 'var(--accent-warn, var(--accent-warm))',
  offline: 'var(--accent-warn, var(--accent-warm))',
  refused: 'var(--accent-danger, var(--accent-red))',
  error: 'var(--accent-danger, var(--accent-red))',
  unjoined: 'var(--text-muted)',
  left: 'var(--text-muted)',
}

const LABEL: Record<MeshState, string> = {
  joined: 'Joined',
  pending: 'Pending: waiting for the network',
  offline: 'Joined, portal unreachable',
  refused: 'Refused',
  error: 'Error',
  unjoined: 'Not joined',
  left: 'Left the mesh',
}

const S: Record<string, CSSProperties> = {
  section: { display: 'grid', gap: 16, maxWidth: '100%', color: 'var(--text-primary)' },
  card: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg, 12px)',
    padding: 16,
    minWidth: 0,
  },
  h2: { margin: '0 0 8px', fontSize: 17, fontFamily: 'var(--font-display, inherit)' },
  muted: { color: 'var(--text-muted)', margin: 0 },
  dl: { display: 'grid', gridTemplateColumns: 'minmax(96px, max-content) 1fr', gap: '4px 12px', margin: 0 },
  dt: { color: 'var(--text-muted)' },
  dd: { margin: 0, overflowWrap: 'anywhere', fontFamily: 'var(--font-mono, monospace)', fontSize: 14 },
  scroll: { overflowX: 'auto', maxWidth: '100%' },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 14 },
  th: { textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500, padding: '4px 8px 4px 0', borderBottom: '1px solid var(--border-subtle)' },
  td: { padding: '4px 8px 4px 0', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' },
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  input: {
    flex: '1 1 200px',
    minWidth: 0,
    padding: '8px 10px',
    background: 'var(--bg-base)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default, var(--border-subtle))',
    borderRadius: 'var(--radius, 8px)',
    fontFamily: 'var(--font-mono, monospace)',
  },
  button: {
    padding: '8px 14px',
    background: 'var(--accent-primary, var(--accent))',
    color: 'var(--bg-base)',
    border: 'none',
    borderRadius: 'var(--radius, 8px)',
    cursor: 'pointer',
  },
  ghost: {
    padding: '8px 14px',
    background: 'transparent',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default, var(--border-subtle))',
    borderRadius: 'var(--radius, 8px)',
    cursor: 'pointer',
  },
  error: { color: 'var(--text-danger, var(--accent-danger))', margin: 0 },
}

function Badge({ state }: { state: MeshState }) {
  return (
    <span
      data-testid="mesh-state"
      data-state={state}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 10px',
        borderRadius: 999,
        border: `1px solid ${TONE[state]}`,
        color: TONE[state],
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: TONE[state] }} />
      {LABEL[state]}
    </span>
  )
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt style={S.dt}>{k}</dt>
      <dd style={S.dd}>{v}</dd>
    </>
  )
}

/** The console wraps CLI output as {verb, exit, state, result}; a plain getJson does not unwrap it. */
function unwrap(r: MeshApiResult<unknown>): MeshApiResult<MeshStatus> {
  const d = r.data as Record<string, unknown> | null
  if (d && typeof d === 'object' && 'verb' in d && 'result' in d) {
    return { ...r, data: (d.result ?? null) as MeshStatus | null, exit: (d.exit as number | null) ?? r.exit }
  }
  return r as MeshApiResult<MeshStatus>
}

function isStatus(d: unknown): d is MeshStatus {
  return !!d && typeof d === 'object' && typeof (d as MeshStatus).state === 'string' && (d as MeshStatus).state in LABEL
}

function ago(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
}

export default function MeshPanel({ client }: MeshPanelProps) {
  const [result, setResult] = useState<MeshApiResult<MeshStatus> | null>(null)
  const [busy, setBusy] = useState<MeshActionVerb | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const alive = useRef(true)

  const load = useCallback(async () => {
    const r = client.getMesh ? await client.getMesh() : unwrap(await client.getJson<unknown>(MESH_STATUS_PATH))
    if (alive.current) setResult(r)
  }, [client])

  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
    }
  }, [load])

  const act = useCallback(
    async (verb: MeshActionVerb, body?: { token: string }) => {
      setBusy(verb)
      setActionError(null)
      const r = await client.action(verb, body)
      if (!alive.current) return
      // exit 2 (pending/offline) is a normal outcome of join/retry, not a failure.
      if (r.state !== 'ok' && !(r.state === 'unavailable' && r.exit === 2)) {
        setActionError(r.detail || r.stdoutTail || `${verb} failed (${r.state}, HTTP ${r.status})`)
      }
      setBusy(null)
      await load()
    },
    [client, load],
  )

  const onJoin = (e: FormEvent) => {
    e.preventDefault()
    const t = token.trim()
    if (!MESH_TOKEN_RE.test(t)) {
      setActionError('That does not look like an enroll token. Copy it again from Connect a device.')
      return
    }
    setToken('') // the token leaves the page state before the request resolves
    void act('mesh-join', { token: t })
  }

  if (!result) return <p style={S.muted} aria-busy="true">Loading…</p>

  const notInstalled = result.status === 501 || result.state === 'not-an-appliance'
  if (notInstalled) {
    return (
      <section style={S.section}>
        <article style={S.card} data-testid="mesh-not-installed">
          <h2 style={S.h2}>Mesh</h2>
          <p style={S.muted}>Mesh is not installed on this image. It needs awnix-mesh in /usr/libexec/awnix.</p>
        </article>
      </section>
    )
  }

  const st = isStatus(result.data) ? result.data : null
  if (!st) {
    return (
      <section style={S.section}>
        <article style={S.card} role="alert">
          <h2 style={S.h2}>Mesh</h2>
          <p style={S.error}>
            {result.state === 'locked'
              ? 'The console is locked for a moment. Try again shortly.'
              : `The mesh status could not be read (${result.state}${result.status ? `, HTTP ${result.status}` : ''}).`}
          </p>
          {result.detail ? <p style={S.muted}>{result.detail}</p> : null}
          <p style={{ marginTop: 12 }}>
            <button type="button" style={S.ghost} onClick={() => void load()}>
              Try again
            </button>
          </p>
        </article>
      </section>
    )
  }

  const canJoin = st.state === 'unjoined' || st.state === 'left' || st.state === 'refused' || st.state === 'error'
  const inMesh = st.state === 'joined' || st.state === 'offline'
  const caps = st.capabilities

  return (
    <section style={S.section} aria-busy={busy ? true : undefined}>
      <article style={S.card}>
        <div style={{ ...S.row, justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ ...S.h2, margin: 0 }}>Mesh</h2>
          <Badge state={st.state} />
        </div>
        {st.detail ? (
          <p style={st.state === 'refused' || st.state === 'error' ? S.error : S.muted} data-testid="mesh-detail">
            {st.detail}
          </p>
        ) : null}
        {actionError ? (
          <p style={{ ...S.error, marginTop: 8 }} role="alert">
            {actionError}
          </p>
        ) : null}
        {inMesh || st.overlay_ip ? (
          <dl style={{ ...S.dl, marginTop: 12 }}>
            <Row k="Overlay IP" v={st.overlay_ip ?? '—'} />
            <Row k="Subnet" v={st.overlay_cidr ?? '—'} />
            <Row k="Interface" v={`${st.iface ?? 'aithernet0'}${st.iface_up === false ? ' (down)' : ''}`} />
            <Row k="Registered" v={st.registered ? 'yes' : 'not yet'} />
            <Row k="Heartbeat" v={ago(st.heartbeat_at)} />
            <Row k="Portal" v={st.portal ?? '—'} />
          </dl>
        ) : null}
        <p style={{ ...S.muted, marginTop: 12, fontSize: 13 }}>
          Client-only: this box opens no port. It connects out to the mesh, and the overlay sits
          in a firewall zone that accepts nothing inbound.
        </p>
      </article>

      {canJoin ? (
        <article style={S.card}>
          <h2 style={S.h2}>Join a mesh</h2>
          <p style={{ ...S.muted, marginBottom: 12 }}>
            Paste the enroll token from Connect a device in your portal. It works once. With no
            network the join waits and finishes by itself.
          </p>
          <form onSubmit={onJoin} style={S.row}>
            <label htmlFor="awx-mesh-token" style={{ position: 'absolute', left: -9999 }}>
              Enroll token
            </label>
            <input
              id="awx-mesh-token"
              data-testid="mesh-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Enroll token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              style={S.input}
            />
            <button type="submit" style={S.button} disabled={!!busy || !token.trim()}>
              {busy === 'mesh-join' ? 'Joining…' : 'Join'}
            </button>
          </form>
        </article>
      ) : null}

      {st.state === 'pending' || st.state === 'offline' ? (
        <div style={S.row}>
          <button type="button" style={S.ghost} disabled={!!busy} onClick={() => void act('mesh-retry')}>
            {busy === 'mesh-retry' ? 'Retrying…' : 'Retry now'}
          </button>
        </div>
      ) : null}

      {inMesh && st.peers.length ? (
        <article style={S.card}>
          <h2 style={S.h2}>Peers</h2>
          <div style={S.scroll}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Node</th>
                  <th style={S.th}>Endpoint</th>
                  <th style={S.th}>Routes</th>
                </tr>
              </thead>
              <tbody>
                {st.peers.map((p) => (
                  <tr key={`${p.node_id}-${p.endpoint}`}>
                    <td style={S.td}>
                      {p.hostname ?? p.node_id ?? '—'}
                      {p.hub ? <span style={{ ...S.muted, marginLeft: 6 }}>hub</span> : null}
                    </td>
                    <td style={S.td}>{p.endpoint}</td>
                    <td style={S.td}>{p.allowed_ips.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {caps ? (
        <article style={S.card}>
          <h2 style={S.h2}>Capabilities</h2>
          <dl style={S.dl}>
            <Row k="Type" v={caps.node_type === 'gpu_node' ? 'GPU node' : 'Agent node'} />
            <Row k="Arch" v={caps.arch} />
            <Row k="CPU" v={`${caps.cpu_model} · ${caps.cpu_count} cores`} />
            <Row k="Memory" v={`${caps.mem_gb} GB`} />
          </dl>
          {caps.gpus.length ? (
            <div style={{ ...S.scroll, marginTop: 12 }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>GPU</th>
                    <th style={S.th}>Vendor</th>
                    <th style={S.th}>VRAM</th>
                  </tr>
                </thead>
                <tbody>
                  {caps.gpus.map((g, i) => (
                    <tr key={`${g.model}-${i}`}>
                      <td style={S.td}>{g.model}</td>
                      <td style={S.td}>{g.vendor}</td>
                      <td style={S.td}>{g.vram_gb == null ? 'shared' : `${g.vram_gb} GB`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ ...S.muted, marginTop: 8 }}>No GPU found. Registered as a CPU node.</p>
          )}
        </article>
      ) : null}

      {inMesh || st.state === 'pending' ? (
        <div style={S.row}>
          <button
            type="button"
            style={S.ghost}
            disabled={!!busy}
            onClick={() => {
              if (typeof window === 'undefined' || window.confirm('Leave the mesh? The overlay, credential and key are removed.')) {
                void act('mesh-leave')
              }
            }}
          >
            {busy === 'mesh-leave' ? 'Leaving…' : 'Leave mesh'}
          </button>
        </div>
      ) : null}
    </section>
  )
}

export { MeshPanel }
