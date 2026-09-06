'use client'

/**
 * Room notes — the documents this room is writing together.
 *
 * Backed by AitherOne (the platform's CRDT collaboration engine) through
 * `/api/platform/one/*`. A document carries a `channel_id`, and the Company Room
 * IS a Relay channel, so a conversation can grow a durable document without
 * anyone leaving the room.
 *
 * Honesty rule inherited from ContextSurface: AitherOne fails CLOSED, and a
 * refusal returns an empty list just like a genuinely empty workspace would.
 * The backend distinguishes them (`identity_complete`, `error`), so this surface
 * says which one it is instead of rendering a convincing empty state.
 */

import { useCallback, useEffect, useState } from 'react'

export interface RoomNote {
  doc_id?: string
  title?: string
  owner_id?: string
  channel_id?: string
  updated_at?: string
  created_at?: string
}

interface NotesResponse {
  notes?: RoomNote[]
  channel?: string
  identity_complete?: boolean
  error?: string
}

export interface NotesSurfaceProps {
  apiBase?: string
  onClose: () => void
  /** Drop a note reference into the conversation. */
  onCite: (text: string) => void
}

export default function NotesSurface({
  apiBase = '/api/platform', onClose, onCite,
}: NotesSurfaceProps) {
  const [notes, setNotes] = useState<RoomNote[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'unauthorized' | 'failed'>('loading')
  const [detail, setDetail] = useState('')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/one/notes`, { credentials: 'same-origin' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data: NotesResponse = await r.json()

      if (data.error) {
        // A refusal is not an empty workspace. Name which one it is.
        const unauth = /auth/i.test(data.error)
        setState(unauth ? 'unauthorized' : 'failed')
        setDetail(data.error)
        setNotes([])
        return
      }
      setNotes(data.notes || [])
      setState('ready')
    } catch (err) {
      setState('failed')
      setDetail(err instanceof Error ? err.message : 'unknown error')
    }
  }, [apiBase])

  useEffect(() => { load() }, [load])

  const create = async () => {
    const name = title.trim()
    if (!name) return
    setCreating(true)
    try {
      const r = await fetch(`${apiBase}/one/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ title: name }),
      })
      const data = await r.json().catch(() => ({}))
      if (data?.error) {
        setState('failed')
        setDetail(String(data.error))
      } else {
        setTitle('')
        onCite(`Started a note: ${name}`)
        await load()
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="room-context">
      <div className="room-context-head">
        <span className="room-context-title">Room notes</span>
        <button type="button" className="room-context-close" onClick={onClose}>Close</button>
      </div>

      <div className="room-context-body">
        {state === 'loading' && <p className="room-note">Looking…</p>}

        {state === 'unauthorized' && (
          <p className="room-note">
            This app cannot prove who it is to the collaboration engine yet, so its notes stay
            closed. It needs its platform credential — an operator can add it, then reopen this.
          </p>
        )}

        {state === 'failed' && (
          <p className="room-note">
            Could not reach the room notes{detail ? ` — ${detail}` : ''}. The room is still live.
          </p>
        )}

        {state === 'ready' && notes.length === 0 && (
          <p className="room-note">
            No notes yet. Start one and the room writes it together.
          </p>
        )}

        {state === 'ready' && notes.map((n, i) => (
          <button
            key={n.doc_id || `${n.title}-${i}`}
            type="button"
            className="room-result"
            onClick={() => onCite(`Note: ${n.title || 'Untitled'}`)}
          >
            <span className="room-result-name">{n.title || 'Untitled'}</span>
            <span className="room-result-meta">
              {[n.owner_id, n.updated_at || n.created_at].filter(Boolean).join(' · ')}
            </span>
          </button>
        ))}

        {(state === 'ready') && (
          <div className="room-context-head" style={{ marginTop: '0.9rem', borderBottom: 0 }}>
            <input
              className="room-input"
              style={{ fontSize: '0.85rem' }}
              value={title}
              placeholder="Start a note…"
              aria-label="Title for a new note"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') create() }}
            />
            <button
              type="button"
              className="room-send"
              onClick={create}
              disabled={!title.trim() || creating}
            >
              {creating ? 'Starting' : 'Start'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
