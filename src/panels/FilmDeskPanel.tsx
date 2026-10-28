'use client'

/**
 * Film desk — the workspace's film projects in media-forge, edited with Iris.
 *
 * The host backend owns the scoping: `GET /api/film/projects` answers only the
 * caller's workspace (a tenant app's routers/film.py sends media-forge its own
 * tenant, never one the browser chose). This panel lists those projects, plays
 * the finished film, shows the shot list, and takes a plain-language change for
 * Iris — which comes back as a change PROPOSAL the owner approves. A project
 * with a `builder_url` also opens the DarkMatter engine scene where the site is
 * designed, city-builder style; the film is made from that scene. Nothing here
 * approves, publishes or renders on its own.
 *
 * Host contract: `GET /api/film/projects`, `GET /api/film/projects/{name}`,
 * `GET .../proposals`, `POST .../iris {instruction, shot?}`, `GET .../file/{path}`.
 * An unreachable or disabled desk is a NAMED message, never an empty panel.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'

export interface FilmDeskPanelProps {
  apiBase?: string
}

interface ProjectRow { name: string; title: string; units?: string[]; built?: boolean }
interface Shot { id: string; chapter?: string | null; start: number; dur: number }
interface Manifest {
  project: string
  title: string
  unit: string
  shots: Shot[]
  outputs: Record<string, string>
  /** The DarkMatter engine scene the site is built in (null = no builder yet). */
  builder_url?: string | null
}
interface Proposal { id: string; status: string; note?: string; created?: string }

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
const muted: CSSProperties = { color: 'var(--text-muted)', fontSize: 12 }

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: 'include', ...init })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
  return body as T
}

export default function FilmDeskPanel({ apiBase = '/api' }: FilmDeskPanelProps) {
  const base = `${apiBase}/film`
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [instruction, setInstruction] = useState('')
  const [shot, setShot] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState('')

  useEffect(() => {
    let cancelled = false
    getJson<{ projects: ProjectRow[] }>(`${base}/projects`)
      .then((d) => {
        if (cancelled) return
        setProjects(d.projects)
        if (d.projects.length === 1) setSelected(d.projects[0].name)
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [base])

  const loadProject = useCallback(async (name: string) => {
    setError('')
    try {
      const [m, p] = await Promise.all([
        getJson<Manifest>(`${base}/projects/${encodeURIComponent(name)}`),
        getJson<{ proposals?: Proposal[] }>(`${base}/projects/${encodeURIComponent(name)}/proposals`),
      ])
      setManifest(m)
      setProposals(p.proposals || [])
    } catch (e) {
      setError((e as Error).message)
    }
  }, [base])

  useEffect(() => { if (selected) void loadProject(selected) }, [selected, loadProject])

  const askIris = useCallback(async () => {
    if (!selected || !instruction.trim()) return
    setSending(true)
    setSent('')
    try {
      const out = await getJson<{ proposal?: Proposal; via?: string; step?: number }>(
        `${base}/projects/${encodeURIComponent(selected)}/iris`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction, shot: shot || undefined }),
        },
      )
      setSent(out.via === 'step_comment'
        ? `Noted on step ${out.step} — only that step is redone at the next render.`
        : `Iris has it — proposal ${out.proposal?.id ?? ''} is ${out.proposal?.status ?? 'queued'}.`)
      setInstruction('')
      void loadProject(selected)
    } catch (e) {
      setSent(`Not sent: ${(e as Error).message}`)
    } finally {
      setSending(false)
    }
  }, [base, selected, instruction, shot, loadProject])

  if (error && !projects) {
    return <div style={{ ...card, margin: 16 }}>Film desk unavailable: {error}</div>
  }
  if (!projects) return <div style={{ padding: 16, ...muted }}>Loading film projects…</div>
  if (projects.length === 0) {
    return <div style={{ ...card, margin: 16 }}>No film projects in this workspace yet.</div>
  }

  const film = manifest?.outputs?.film
  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, height: '100%', overflow: 'auto' }}>
      <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {projects.map((p) => (
          <button
            key={p.name}
            onClick={() => setSelected(p.name)}
            style={{ ...card, textAlign: 'left', cursor: 'pointer',
              outline: p.name === selected ? '2px solid var(--accent-primary)' : 'none' }}
          >
            <div>{p.title}</div>
            <div style={muted}>{p.name}</div>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        {error && <div style={card}>{error}</div>}
        {manifest && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h3 style={{ margin: 0, flex: 1 }}>{manifest.title}</h3>
              {manifest.builder_url && (
                <a
                  href={manifest.builder_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...button, textDecoration: 'none' }}
                >
                  Build the site
                </a>
              )}
            </div>
            {film ? (
              <video
                controls
                preload="metadata"
                style={{ width: '100%', maxHeight: 420, background: '#000' }}
                src={`${base}/projects/${encodeURIComponent(manifest.project)}/file/${film}`}
              />
            ) : (
              <div style={{ ...card, ...muted }}>No finished film yet.</div>
            )}

            <div style={card}>
              <div style={{ marginBottom: 8 }}>Ask Iris for a change</div>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                placeholder="e.g. hold the step 4 view two seconds longer"
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <select value={shot} onChange={(e) => setShot(e.target.value)}>
                  <option value="">whole film</option>
                  {manifest.shots.map((s) => (
                    <option key={s.id} value={s.id}>{s.chapter || s.id}</option>
                  ))}
                </select>
                <button style={button} disabled={sending || !instruction.trim()} onClick={askIris}>
                  {sending ? 'Sending…' : 'Send to Iris'}
                </button>
                {sent && <span style={muted}>{sent}</span>}
              </div>
            </div>

            <div style={card}>
              <div style={{ marginBottom: 8 }}>Shots ({manifest.shots.length})</div>
              {manifest.shots.map((s) => (
                <div key={s.id} style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                  <span style={{ width: 64, ...muted }}>{s.start.toFixed(1)}s</span>
                  <span style={{ flex: 1 }}>{s.chapter || s.id}</span>
                  <span style={muted}>{s.dur.toFixed(1)}s</span>
                </div>
              ))}
            </div>

            <div style={card}>
              <div style={{ marginBottom: 8 }}>Change proposals</div>
              {proposals.length === 0 && <div style={muted}>None yet.</div>}
              {proposals.slice().reverse().map((p) => (
                <div key={p.id} style={{ fontSize: 13 }}>
                  <b>{p.status}</b> — {p.note || p.id}
                </div>
              ))}
              <div style={{ ...muted, marginTop: 8 }}>
                Proposals are reviewed and approved by the studio owner before they land.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
