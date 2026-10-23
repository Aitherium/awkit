'use client'

/**
 * Big uploads that are not documents yet, shown at the top of the documents list.
 *
 * A customer dropped a 6.6 GB zip (2026-10-22). It went up as 199 pieces of
 * 32 MB at ~6 s a piece, and the list -- finished documents only -- showed
 * nothing for 20+ minutes: it "seemed like it worked" and then was not there.
 * The backend's GET /api/documents/uploads now lists the caller's uploads in
 * flight (uploading / processing / failed); these rows say, in the same look as
 * the document rows, how far each one is, that closing the tab pauses it, and
 * how to resume one that stalled.
 */
import React from 'react'

export type InFlightState = 'uploading' | 'processing' | 'failed'

/** One row of GET /api/documents/uploads (backend services/upload_progress.py). */
export interface InFlightUpload {
  id: string
  upload_id: string | null
  job_id: string | null
  filename: string
  state: InFlightState
  detail: string
  size?: number
  received_bytes?: number
  received_chunks?: number
  total_chunks?: number
  created?: string | null
  idle_seconds?: number
  processed_files?: number
  total_files?: number
  /** Client-side: this tab is the one sending it (set by mergeLive). */
  live?: boolean
}

/** This tab's own upload: the pieces it has sent so far. */
export interface LiveUpload {
  uploadId: string | null
  filename: string
  sent: number
  total: number
}

/** No piece for this long and not sent from this tab: the upload has stopped. */
export const STALL_SECONDS = 90

const GB = 1024 * 1024 * 1024
const MB = 1024 * 1024

/** "1.7 of 6.6 GB": both numbers in the TOTAL's unit, so they compare at a glance. */
export function formatPair(done: number, total: number): string {
  if (total >= GB) return `${(done / GB).toFixed(1)} of ${(total / GB).toFixed(1)} GB`
  const digits = total < 10 * MB ? 1 : 0
  return `${(done / MB).toFixed(digits)} of ${(total / MB).toFixed(digits)} MB`
}

export interface UploadView {
  /** The row's first line: what is happening to which file. */
  title: string
  /** The second line: how far, and what the person should do. */
  line: string
  /** 0-100 for a bar, or null when there is no honest fraction to show. */
  pct: number | null
  tone: 'active' | 'paused' | 'error'
  action: 'resume' | 'dismiss' | null
}

/** Merge the server's row with this tab's live progress (it is fresher). */
export function mergeLive(rows: readonly InFlightUpload[], live: LiveUpload | null): InFlightUpload[] {
  if (!live) return [...rows]
  const at = rows.findIndex(r => r.state === 'uploading'
    && (live.uploadId ? r.upload_id === live.uploadId : r.filename === live.filename))
  const mine: InFlightUpload = {
    ...(at >= 0 ? rows[at] : {
      id: `live:${live.uploadId || live.filename}`, upload_id: live.uploadId, job_id: null,
      filename: live.filename, state: 'uploading' as const, detail: '',
    }),
    size: live.total, received_bytes: Math.max(live.sent, at >= 0 ? rows[at].received_bytes || 0 : 0),
    idle_seconds: 0, live: true,
  }
  if (at >= 0) return rows.map((r, i) => (i === at ? mine : r))
  return [mine, ...rows]
}

/** What one in-flight upload looks like, in words. ``live`` = this tab is sending it. */
export function describeUpload(u: InFlightUpload, live = false): UploadView {
  if (u.state === 'failed') {
    return { title: `Could not add ${u.filename}`, line: u.detail, pct: null, tone: 'error', action: 'dismiss' }
  }
  if (u.state === 'processing') {
    const total = u.total_files || 0
    const pct = total > 1 ? Math.floor((100 * (u.processed_files || 0)) / total) : null
    return {
      title: `Processing ${u.filename}`,
      line: `Processing — ${u.detail}. Its files appear below when it is done.`,
      pct, tone: 'active', action: null,
    }
  }
  const size = u.size || 0
  const done = Math.min(size, u.received_bytes || 0)
  const pct = size > 0 ? Math.floor((100 * done) / size) : 0
  const pair = size > 0 ? formatPair(done, size) : ''
  const stalled = !live && (u.idle_seconds || 0) >= STALL_SECONDS
  if (stalled) {
    return {
      title: `Paused: ${u.filename}`,
      line: `Stopped at ${pct}% (${pair}). Choose the same file again to resume where it stopped.`,
      pct, tone: 'paused', action: 'resume',
    }
  }
  return {
    title: `Uploading ${u.filename}`,
    line: live
      ? `${pct}% (${pair}) · keep this tab open — closing it pauses the upload`
      : `${pct}% (${pair}) · being sent from another window`,
    pct, tone: 'active', action: null,
  }
}

const TONE_COLOR: Record<UploadView['tone'], string> = {
  active: 'var(--accent-primary, #5EC9CC)',
  paused: 'var(--accent-amber, #f59e0b)',
  error: 'var(--accent-coral, #ef4444)',
}

export interface InFlightUploadRowProps {
  upload: InFlightUpload
  live?: boolean
  onResume?: (u: InFlightUpload) => void
  onDismiss?: (u: InFlightUpload) => void
  compact?: boolean
}

/** One upload, drawn like a document row (surface, hairline border, two lines). */
export function InFlightUploadRow({ upload, live, onResume, onDismiss, compact }: InFlightUploadRowProps) {
  const view = describeUpload(upload, live ?? !!upload.live)
  const color = TONE_COLOR[view.tone]
  return (
    <div data-testid={`inflight-upload-${upload.id}`} data-state={upload.state} data-tone={view.tone}
      role="status" aria-live="polite"
      style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: compact ? '0.5rem 0.6rem' : '0.6rem 0.75rem',
        background: 'var(--bg-surface, #1a1a2e)', borderRadius: 'var(--radius, 6px)',
        border: `1px solid ${view.tone === 'active' ? 'var(--glass-border, #333)' : color}`,
      }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: compact ? '0.75rem' : '0.85rem', fontWeight: 500, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{view.title}</div>
        <div data-testid="inflight-upload-line" style={{ fontSize: '0.65rem', marginTop: '0.1rem',
          fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
          color: view.tone === 'active' ? 'var(--text-muted, #888)' : color }}>{view.line}</div>
        {view.pct !== null && (
          <div style={{ height: 3, marginTop: '0.35rem', background: 'var(--bg-elevated, #222)',
            borderRadius: 2, overflow: 'hidden' }}>
            <div data-testid="inflight-upload-bar" style={{ height: '100%', width: `${view.pct}%`,
              background: color, transition: 'width 0.3s' }} />
          </div>
        )}
      </div>
      {view.action === 'resume' && onResume && (
        <button onClick={() => onResume(upload)} style={{
          padding: '0.2rem 0.55rem', background: 'var(--accent-primary, #5EC9CC)', color: '#050507',
          borderRadius: 4, fontSize: '0.65rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>Resume</button>
      )}
      {view.action === 'dismiss' && onDismiss && (
        <button onClick={() => onDismiss(upload)} style={{
          padding: '0.2rem 0.55rem', background: 'var(--bg-elevated, #222)',
          color: 'var(--text-secondary, #aaa)', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer',
          flexShrink: 0 }}>Dismiss</button>
      )}
    </div>
  )
}
