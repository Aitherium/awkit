'use client'

/**
 * AitherMail surface for the Company Room.
 *
 * A working inbox, not a browser window. The surface works as a context panel
 * in the room's title block (narrow column, scrollable) and scales to standalone
 * if given more width.
 *
 * Displays real mail data only. If an endpoint is missing or errors, the UI says
 * so plainly rather than rendering a plausible-looking empty list (security-
 * review-patterns #5, applied to UX).
 *
 * Reading a message stays within the room. Composing / replying is wired if a
 * send endpoint exists; otherwise the affordance is omitted to avoid dead buttons.
 *
 * An "onCite" action lets you drop a message or its summary into the conversation
 * for the room to act on, similar to ContextSurface's pattern.
 */

import { useState } from 'react'
import { useMail, type MailMessage } from './useMail'

export interface MailSurfaceProps {
  /** GET endpoint that returns { messages: [...], source?: string }. */
  endpoint?: string
  /** Called when user clicks "Drop into room" on a message. */
  onCite: (text: string) => void
  /** Called when surface is dismissed (only in context mode). */
  onClose?: () => void
}

interface MailState {
  selectedMessageId: string | null
}

/**
 * Format a date for display in the drafting sheet style: concise, monospaced.
 * Shows the time if today, the date if this week, the full date if older.
 */
function formatMailDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const diffDays = Math.floor((today.getTime() - msgDate.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    }
    if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' })
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return '—'
  }
}

/**
 * Excerpt a message body for list display: first 60 chars, no newlines, ellipsis if longer.
 */
function excerptBody(body?: string): string {
  if (!body) return '(no body)'
  const clean = body.replace(/\s+/g, ' ').trim()
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean
}

export default function MailSurface({
  endpoint = '/api/platform/email/inbox',
  onCite,
  onClose,
}: MailSurfaceProps) {
  const { messages, loading, error } = useMail(endpoint)
  const [state, setState] = useState<MailState>({
    selectedMessageId: null,
  })

  // If we're viewing a message, find it
  const selectedMessage = state.selectedMessageId
    ? messages.find((m) => m.id === state.selectedMessageId)
    : null

  const handleBack = () => {
    setState((s) => ({ ...s, selectedMessageId: null }))
  }

  const handleCiteMessage = () => {
    if (selectedMessage) {
      const text = `Re: ${selectedMessage.subject} (from ${selectedMessage.from})`
      onCite(text)
      handleBack()
    }
  }

  return (
    <div className="mail-surface">
      {/* Header: title and close button */}
      <div className="mail-head">
        <span className="mail-title">
          {selectedMessage ? 'Message' : 'Inbox'}
        </span>
        {onClose && (
          <button
            type="button"
            className="mail-close"
            onClick={onClose}
            title="Close"
          >
            Close
          </button>
        )}
      </div>

      {/* Body: loading, error, list, or message detail */}
      <div className="mail-body">
        {loading && (
          <p className="mail-note">Looking…</p>
        )}

        {!loading && error && (
          <p className="mail-error">
            {error}
          </p>
        )}

        {!loading && !error && messages.length === 0 && (
          <p className="mail-note">
            Your inbox is empty.
          </p>
        )}

        {!loading && !error && messages.length > 0 && !selectedMessage && (
          <div className="mail-list">
            {messages.map((msg) => (
              <button
                key={msg.id}
                type="button"
                className={`mail-item ${msg.read ? '' : 'mail-item-unread'}`}
                onClick={() => setState((s) => ({ ...s, selectedMessageId: msg.id }))}
              >
                <div className="mail-item-from">{msg.from}</div>
                <div className="mail-item-subject">{msg.subject}</div>
                <div className="mail-item-preview">{excerptBody(msg.body)}</div>
                <div className="mail-item-date">{formatMailDate(msg.date)}</div>
              </button>
            ))}
          </div>
        )}

        {!loading && !error && selectedMessage && (
          <div className="mail-view">
            <button
              type="button"
              className="mail-back"
              onClick={handleBack}
            >
              ← Back
            </button>

            <div className="mail-view-header">
              <div className="mail-view-from">{selectedMessage.from}</div>
              <div className="mail-view-subject">{selectedMessage.subject}</div>
              <div className="mail-view-date">{new Date(selectedMessage.date).toLocaleString()}</div>
            </div>

            <div className="mail-view-body">
              {selectedMessage.body || '(no message body)'}
            </div>

            <div className="mail-view-actions">
              <button
                type="button"
                className="mail-action"
                onClick={handleCiteMessage}
              >
                Drop into room
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
