'use client'

/**
 * The Film Desk's LOOK strips: References and Assets for one film project.
 *
 * Everything here is a PROPOSAL until a person decides. A found reference may be wrong (a
 * nearby building, an old photo, the wrong side), so each card shows its source and licence
 * and waits for approve / reject / replace. A Google Earth / Maps screenshot the user uploads
 * is kept for PLANNING only. Generated textures and models arrive as proposals too, and
 * nothing unapproved enters the film.
 *
 * Host contract (a tenant app's routers/film.py): GET/POST `{base}/projects/{name}/references`
 * (+ `/find`, `/upload`, `/{id}`, `/{id}/image`) and `/assets` (+ `/{id}`, `/{id}/file/{i}`).
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'

export interface FilmLookStripsProps {
  /** `${apiBase}/film` */
  base: string
  project: string
  /** step numbers to filter references by (from the film's shots) */
  steps: number[]
}

interface Reference {
  id: string
  element: string
  step?: number | null
  source: string
  licence?: string
  url?: string
  note?: string
  status: string
  planning_only?: boolean
  layout?: unknown
}
interface Asset {
  id: string
  kind: string
  role?: string
  model_kind?: string
  status: string
  files?: string[]
  prompt?: string | null
}
interface Generating { kind: string; label?: string; status?: string; done?: number; total?: number }

const card: CSSProperties = {
  padding: 12,
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius)',
}
const small: CSSProperties = { fontSize: 12, color: 'var(--text-muted)' }
const pill = (status: string): CSSProperties => ({
  fontSize: 11,
  padding: '1px 6px',
  borderRadius: 8,
  border: '1px solid var(--glass-border)',
  background: status === 'approved' ? 'var(--accent-green, #2e7d32)' : 'transparent',
  color: status === 'approved' ? 'var(--bg-deep, #000)' : 'inherit',
  textTransform: 'uppercase',
})
const btn: CSSProperties = { padding: '2px 8px', cursor: 'pointer' }

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: 'include', ...init })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
  return body as T
}

export default function FilmLookStrips({ base, project, steps }: FilmLookStripsProps) {
  const p = `${base}/projects/${encodeURIComponent(project)}`
  const [refs, setRefs] = useState<Reference[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [generating, setGenerating] = useState<Generating[]>([])
  const [step, setStep] = useState(0)
  const [element, setElement] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [upload, setUpload] = useState<File | null>(null)
  const [fromGoogle, setFromGoogle] = useState(false)

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams()
      if (step) q.set('step', String(step))
      const [r, a] = await Promise.all([
        json<{ references: Reference[] }>(`${p}/references?${q}`),
        json<{ assets?: Asset[]; generating?: Generating[] }>(`${p}/assets`),
      ])
      setRefs(r.references || [])
      setAssets(a.assets || [])
      setGenerating(a.generating || [])
    } catch (e) {
      setMessage((e as Error).message)
    }
  }, [p, step])

  useEffect(() => { void load() }, [load])

  const find = async () => {
    if (!element.trim()) return
    setBusy(true)
    try {
      const out = await json<{ message?: string }>(`${p}/references/find`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ element, step: step || undefined }),
      })
      setMessage(out.message || '')
      await load()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    if (!upload || !element.trim()) return
    const fd = new FormData()
    fd.append('file', upload)
    fd.append('element', element)
    if (step) fd.append('step', String(step))
    fd.append('from_google', fromGoogle ? 'true' : 'false')
    setBusy(true)
    try {
      await json(`${p}/references/upload`, { method: 'POST', body: fd })
      setUpload(null)
      setMessage(fromGoogle ? 'Uploaded. Google imagery is kept for planning only.' : 'Uploaded.')
      await load()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const decide = async (path: string, action: string, replacement?: string) => {
    try {
      await json(`${p}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, replacement }),
      })
      await load()
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>References</b>
          <select value={step} onChange={(e) => setStep(Number(e.target.value))}>
            <option value={0}>all steps</option>
            {steps.map((s) => <option key={s} value={s}>step {s}</option>)}
          </select>
          <input
            value={element}
            onChange={(e) => setElement(e.target.value)}
            placeholder="element, e.g. canopy"
          />
          <button style={btn} disabled={busy || !element.trim()} onClick={() => void find()}>
            Find references
          </button>
          <input type="file" accept=".jpg,.jpeg,.png,.webp"
            onChange={(e) => setUpload(e.target.files?.[0] || null)} />
          <label style={small}>
            <input type="checkbox" checked={fromGoogle}
              onChange={(e) => setFromGoogle(e.target.checked)} /> Google Earth screenshot
          </label>
          <button style={btn} disabled={busy || !upload || !element.trim()} onClick={() => void send()}>
            Upload my photo
          </button>
        </div>
        {message && <div style={{ ...small, marginTop: 6 }}>{message}</div>}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginTop: 8 }}>
          {refs.length === 0 && <div style={small}>No references yet.</div>}
          {refs.map((r) => (
            <div key={r.id} style={{ ...card, width: 200, flexShrink: 0 }}>
              {r.layout ? (
                <div style={small}>layout data (OpenStreetMap), not an image</div>
              ) : (
                <img src={`${p}/references/${r.id}/image`} alt={r.element}
                  style={{ width: '100%', height: 110, objectFit: 'cover' }} />
              )}
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 }}>
                <span style={pill(r.status)}>{r.status}</span>
                {r.planning_only && <span style={pill('planning')}>planning only</span>}
              </div>
              <div style={{ fontSize: 12 }}>{r.element}{r.step ? ` · step ${r.step}` : ''}</div>
              <div style={small}>{r.source} · {r.licence || 'licence unknown'}</div>
              {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" style={small}>source</a>}
              {r.status === 'proposed' && (
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <button style={btn} onClick={() => void decide(`references/${r.id}`, 'approve')}>Approve</button>
                  <button style={btn} onClick={() => void decide(`references/${r.id}`, 'reject')}>Reject</button>
                  <select defaultValue="" onChange={(e) => {
                    if (e.target.value) void decide(`references/${r.id}`, 'replace', e.target.value)
                  }}>
                    <option value="">Replace with…</option>
                    {refs.filter((o) => o.id !== r.id && o.element === r.element).map((o) => (
                      <option key={o.id} value={o.id}>{o.source} {o.id.slice(-6)}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <b>Assets</b>
        <span style={{ ...small, marginLeft: 8 }}>
          Generated textures and models. Nothing enters the film until you approve it.
        </span>
        {generating.map((g, i) => (
          <div key={i} style={small}>
            generating: {g.label || g.kind}{g.total ? ` (${g.done || 0}/${g.total})` : ''}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginTop: 8 }}>
          {assets.length === 0 && generating.length === 0 && <div style={small}>No assets yet.</div>}
          {assets.map((a) => (
            <div key={a.id} style={{ ...card, width: 200, flexShrink: 0 }}>
              {a.kind === 'texture' ? (
                <div title="tiled swatch" style={{
                  height: 110,
                  backgroundImage: `url(${p}/assets/${a.id}/file/0)`,
                  backgroundSize: '64px 64px',
                  backgroundRepeat: 'repeat',
                }} />
              ) : (
                <a href={`${p}/assets/${a.id}/file/0`} style={{ display: 'block', height: 110 }}>
                  3D model (GLB): download to view
                </a>
              )}
              <span style={pill(a.status)}>{a.status}</span>
              <div style={{ fontSize: 12 }}>{a.role || a.model_kind || a.kind}</div>
              {a.status === 'proposed' && (
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <button style={btn} onClick={() => void decide(`assets/${a.id}`, 'approve')}>Approve</button>
                  <button style={btn} onClick={() => void decide(`assets/${a.id}`, 'reject')}>Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
