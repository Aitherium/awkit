'use client'

/**
 * What the workspace's assistant has learned — a section of workspace Settings.
 *
 * Host contract (`/api/lessons`, admin only, scoped to the caller's workspace):
 *   GET    `/api/lessons?limit=5`      -> `{next_action, items, total, more, waiting, settings}`
 *   PUT    `/api/lessons/settings`     -> `{settings}` (`mode`, `consolidate`)
 *   POST   `/api/lessons/{id}/approve | on | off`
 *   DELETE `/api/lessons/{id}`         forget (final)
 *
 * The first line is the next action. Five lessons, then "+N more" with the real
 * total. Each lesson: what, learned from what, when, how often it was used, an
 * on/off switch and forget. Two settings: how it learns and how often it re-checks.
 *
 * It lives here, in Settings, on purpose: the screens people work in (the cert
 * tracker's one drop box and one button) gain no control from learning. A member,
 * or a backend without lessons, sees nothing at all.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { getApiBase } from '../lib/apiBase'

export interface LessonRow {
  id: string
  what: string
  status: 'proposed' | 'active' | 'off' | 'retired'
  from?: { evidence?: string; source_turn?: string }
  when?: number
  used?: number
  retired_reason?: string
}
interface LessonsPage {
  next_action: string
  items: LessonRow[]
  total: number
  more: number
  waiting: number
  settings: { mode: string; consolidate: string }
}

export interface LessonsCardProps {
  /** The assistant's name in the heading ("What Acme has learned"). */
  agentName?: string
}

const LEARNED_FROM: Record<string, string> = {
  confirmed_mapping: 'your answer about a dropped file',
  user_correction: 'a correction in chat',
  verified_answer: 'an answer you verified',
  retry_success: 'a task that worked on the second try',
  thumbs_up: 'a thumbs-up',
  thumbs_down: 'a thumbs-down',
  capability_gap: 'something it could not do',
  imported: 'a skill you imported',
}
const MODES: Array<[string, string]> = [
  ['auto', 'Learn automatically'], ['ask', 'Ask me first'], ['off', 'Off'],
]
const RECHECK: Array<[string, string]> = [
  ['task', 'After each task'], ['nightly', 'Nightly'], ['weekly', 'Weekly'],
]

const muted: CSSProperties = { color: 'var(--text-muted)', fontSize: '0.75rem' }
const box: CSSProperties = {
  background: 'var(--bg-surface)', padding: '1rem', borderRadius: 'var(--radius)',
  border: '1px solid var(--glass-border)', fontSize: '0.85rem',
}
const link: CSSProperties = {
  color: 'var(--text-muted)', fontSize: '0.75rem', textDecoration: 'underline', cursor: 'pointer',
  background: 'none', border: 'none', padding: 0,
}
const select: CSSProperties = {
  background: 'var(--bg-deep, transparent)', color: 'var(--text-primary)',
  border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)', padding: '2px 6px',
}

function when(seconds?: number): string {
  if (!seconds) return ''
  return new Date(seconds * 1000).toLocaleDateString()
}

export default function LessonsCard({ agentName = 'your assistant' }: LessonsCardProps) {
  const [page, setPage] = useState<LessonsPage | null>(null)
  const [all, setAll] = useState(false)
  const [forgetting, setForgetting] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const base = `${getApiBase()}/api/lessons`

  const load = useCallback(async (everything: boolean) => {
    try {
      const r = await fetch(`${base}?limit=${everything ? 100 : 5}`, { credentials: 'include' })
      if (!r.ok) { setPage(null); return } // a member (403) or no lessons module: show nothing
      const body = await r.json() as Partial<LessonsPage> | null
      // Only a real lessons page is drawn; any other 200 (a proxy's own answer) is nothing.
      const real = !!body && typeof body.next_action === 'string' && Array.isArray(body.items)
        && !!body.settings && typeof body.settings === 'object'
      setPage(real ? body as LessonsPage : null)
    } catch {
      setPage(null)
    }
  }, [base])

  useEffect(() => { void load(all) }, [load, all])

  const act = async (path: string, init: RequestInit) => {
    setBusy(true); setError('')
    try {
      const r = await fetch(`${base}${path}`, { credentials: 'include', ...init })
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { detail?: string }
        setError(typeof body.detail === 'string' ? body.detail : `HTTP ${r.status}`)
      }
    } catch (e) {
      setError((e as Error).message || 'Could not reach the workspace')
    }
    setBusy(false); setForgetting('')
    await load(all)
  }
  const setting = (key: 'mode' | 'consolidate', value: string) => act('/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: value }),
  })

  if (!page) return null

  return (
    <section style={{ marginBottom: '2rem' }} data-testid="lessons-card">
      <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
        What {agentName} has learned
      </h3>
      <div style={box}>
        <div style={{ fontWeight: 600 }} data-testid="lessons-next-action">{page.next_action}</div>
        {error && <div role="alert" style={{ color: 'var(--accent-coral)', marginTop: 6 }}>{error}</div>}

        {page.items.map((l) => (
          <div key={l.id} data-lesson={l.id} data-status={l.status}
            style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 0',
              borderTop: '1px solid var(--glass-border)', marginTop: 8 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>{l.what}</div>
              <div style={muted}>
                Learned from {LEARNED_FROM[l.from?.evidence ?? ''] ?? 'an outcome'}
                {when(l.when) ? ` on ${when(l.when)}` : ''}
                {' · '}used {l.used ?? 0} {l.used === 1 ? 'time' : 'times'}
                {l.status === 'proposed' ? ' · waiting for your OK' : ''}
                {l.status === 'retired' ? ` · stopped helping${l.retired_reason ? ` (${l.retired_reason})` : ''}` : ''}
              </div>
            </div>
            {l.status === 'proposed' && (
              <button type="button" disabled={busy} style={{ ...select, cursor: 'pointer' }}
                onClick={() => { void act(`/${l.id}/approve`, { method: 'POST' }) }}
              >OK</button>
            )}
            {(l.status === 'active' || l.status === 'off') && (
              <label style={{ ...muted, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={l.status === 'active'} disabled={busy}
                  aria-label={`Use this lesson: ${l.what}`}
                  onChange={() => { void act(`/${l.id}/${l.status === 'active' ? 'off' : 'on'}`, { method: 'POST' }) }}
                />
                {l.status === 'active' ? 'On' : 'Off'}
              </label>
            )}
            {forgetting === l.id ? (
              <span style={muted}>
                Forget for good?{' '}
                <button type="button" style={link} disabled={busy}
                  onClick={() => { void act(`/${l.id}`, { method: 'DELETE' }) }}
                >Yes, forget</button>{' '}
                <button type="button" style={link} onClick={() => setForgetting('')}>Keep</button>
              </span>
            ) : (
              <button type="button" style={link} aria-label={`Forget: ${l.what}`}
                onClick={() => setForgetting(l.id)}
              >Forget</button>
            )}
          </div>
        ))}

        {page.more > 0 && (
          <div style={{ marginTop: 8 }}>
            <button type="button" style={link} onClick={() => setAll(true)}>
              +{page.more} more
            </button>{' '}
            <span style={muted}>({page.total} in all)</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, paddingTop: 10,
          borderTop: '1px solid var(--glass-border)' }}
        >
          <label style={muted}>
            Learning{' '}
            <select aria-label="How it learns" style={select} disabled={busy}
              value={page.settings.mode} onChange={(e) => { void setting('mode', e.target.value) }}
            >
              {MODES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
          <label style={muted}>
            Re-check what it learned{' '}
            <select aria-label="How often it re-checks" style={select} disabled={busy}
              value={page.settings.consolidate}
              onChange={(e) => { void setting('consolidate', e.target.value) }}
            >
              {RECHECK.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>
    </section>
  )
}
