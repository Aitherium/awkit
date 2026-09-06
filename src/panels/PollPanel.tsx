'use client'

/**
 * PollPanel — admin manager for polls/surveys.
 *
 * Mirrors FormsPanel: list → create → detail. A poll is created as a draft,
 * published to open voting, then sent to an audience (an existing newsletter
 * distribution list OR a custom address list) and/or embedded in a blog post.
 * Results render as live bars (reusing PollWidget in results-only mode).
 *
 * Backend: the polls router at `apiBase` (default `/api/polls`), same-origin in
 * product apps; Veil passes a proxied base.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import PollWidget from './PollWidget'

interface Poll {
  id: string
  title: string
  status: string
  data: {
    description?: string
    poll_type?: 'single' | 'multiple'
    options?: string[]
    open_date?: string
    close_date?: string
    settings?: Record<string, any>
    email_config?: { sent_count?: number; sent_at?: string; list_cn?: string }
  }
  created_at?: string
}

type ViewMode = 'list' | 'detail'

export interface PollPanelProps {
  apiBase?: string
  /** Base origin where /polls/embed lives (for the copyable embed snippet). */
  embedBase?: string
}

export default function PollPanel({ apiBase = '/api/polls', embedBase = '' }: PollPanelProps) {
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ViewMode>('list')
  const [selected, setSelected] = useState<Poll | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pollType, setPollType] = useState<'single' | 'multiple'>('single')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [closeDate, setCloseDate] = useState('')
  const [showResultsBefore, setShowResultsBefore] = useState(true)

  // Send modal
  const [showSend, setShowSend] = useState(false)
  const [audienceType, setAudienceType] = useState<'newsletter_list' | 'custom'>('newsletter_list')
  const [listCn, setListCn] = useState('blog-newsletter')
  const [customRecipients, setCustomRecipients] = useState('')
  const [sendResult, setSendResult] = useState<string | null>(null)

  const fetchPolls = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiBase)
      if (res.ok) {
        const data = await res.json()
        setPolls(data?.polls || data?.data?.polls || [])
      }
    } catch (e) { console.error('Polls fetch error:', e) }
    setLoading(false)
  }, [apiBase])

  useEffect(() => { fetchPolls() }, [fetchPolls])

  const setOption = (i: number, v: string) => setOptions(o => o.map((x, idx) => idx === i ? v : x))
  const addOption = () => setOptions(o => [...o, ''])
  const removeOption = (i: number) => setOptions(o => o.filter((_, idx) => idx !== i))

  const createPoll = async () => {
    const opts = options.map(o => o.trim()).filter(Boolean)
    if (!title || opts.length < 2) return
    try {
      const res = await fetch(apiBase, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, description, poll_type: pollType, options: opts,
          close_date: closeDate || null,
          settings: { show_results_before_voting: showResultsBefore },
        }),
      })
      if (res.ok) {
        setShowCreate(false); setTitle(''); setDescription('')
        setOptions(['', '']); setCloseDate(''); setPollType('single')
        fetchPolls()
      }
    } catch (e) { console.error('Create poll error:', e) }
  }

  const action = async (poll: Poll, verb: 'publish' | 'close') => {
    try {
      const res = await fetch(`${apiBase}/${poll.id}/${verb}`, { method: 'PUT' })
      if (res.ok) { await fetchPolls(); if (selected?.id === poll.id) setSelected(await res.json()) }
    } catch (e) { console.error(`${verb} error:`, e) }
  }

  const deletePoll = async (poll: Poll) => {
    try {
      const res = await fetch(`${apiBase}/${poll.id}`, { method: 'DELETE' })
      if (res.ok) { if (selected?.id === poll.id) { setView('list'); setSelected(null) } ; fetchPolls() }
    } catch (e) { console.error('Delete error:', e) }
  }

  const send = async (dryRun: boolean) => {
    if (!selected) return
    setSendResult(null)
    try {
      const res = await fetch(`${apiBase}/${selected.id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audience_type: audienceType,
          list_cn: audienceType === 'newsletter_list' ? listCn : undefined,
          custom_recipients: audienceType === 'custom'
            ? customRecipients.split(/[,\n]/).map(s => s.trim()).filter(Boolean) : undefined,
          dry_run: dryRun,
        }),
      })
      const body = await res.json()
      if (!res.ok) { setSendResult(body.detail || 'Send failed'); return }
      setSendResult(
        dryRun ? `Would send to ${body.would_send_to} recipient(s).`
          : body.accepted != null ? `Queued send to ${body.accepted} recipient(s) — delivering in the background.`
          : `Sent to ${body.sent}, failed ${body.failed} (of ${body.recipients}).`)
      if (!dryRun) fetchPolls()
    } catch { setSendResult('Send failed — backend unreachable.') }
  }

  const statusChip = (s: string) => {
    const map: Record<string, [string, string]> = {
      draft: ['rgba(255,255,255,0.06)', 'var(--text-muted)'],
      published: ['rgba(0,200,83,0.15)', '#00c853'],
      closed: ['rgba(243,139,168,0.15)', '#f38ba8'],
    }
    const [bg, fg] = map[s] || map.draft
    return <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 600, background: bg, color: fg }}>{s}</span>
  }

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading polls…</div>

  const embedSnippet = selected
    ? `<iframe src="${embedBase}/polls/embed?pollId=${selected.id}" width="100%" height="420" style="border:0"></iframe>`
    : ''
  const publicLink = selected ? `${embedBase}/polls/${selected.id}` : ''
  const copy = (text: string) => { try { navigator.clipboard?.writeText(text) } catch { /* ignore */ } }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {view !== 'list' && (
            <button onClick={() => { setView('list'); setSelected(null) }}
              style={btn('ghost')}>Back</button>
          )}
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
            {view === 'list' ? 'Polls' : selected?.title || 'Poll'}
          </h2>
        </div>
        {view === 'list' && (
          <button onClick={() => setShowCreate(v => !v)} style={btn('accent')}>+ New Poll</button>
        )}
      </div>

      {showCreate && view === 'list' && (
        <div style={card()}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Poll question" style={input()} />
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} style={input()} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={lbl()}>
                <select value={pollType} onChange={e => setPollType(e.target.value as any)} style={input()}>
                  <option value="single">Single choice</option>
                  <option value="multiple">Multiple choice</option>
                </select>
              </label>
              <label style={lbl()}>
                Closes
                <input type="datetime-local" value={closeDate} onChange={e => setCloseDate(e.target.value)} style={input()} />
              </label>
            </div>
            <label style={{ ...lbl(), flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={showResultsBefore} onChange={e => setShowResultsBefore(e.target.checked)} />
              Show results before voting
            </label>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Options</div>
            {options.map((opt, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <input value={opt} onChange={e => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} style={{ ...input(), flex: 1 }} />
                {options.length > 2 && <button onClick={() => removeOption(i)} style={btn('ghost')}>×</button>}
              </div>
            ))}
            <button onClick={addOption} style={{ ...btn('ghost'), alignSelf: 'flex-start' }}>+ Add option</button>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button onClick={() => setShowCreate(false)} style={btn('ghost')}>Cancel</button>
            <button onClick={createPoll} disabled={!title || options.filter(o => o.trim()).length < 2} style={btn('accent')}>Create</button>
          </div>
        </div>
      )}

      {view === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {polls.length === 0 && !showCreate && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
              No polls yet. Create your first poll above.
            </div>
          )}
          {polls.map(poll => (
            <div key={poll.id} style={{ ...card(), cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }}
              onClick={() => { setSelected(poll); setView('detail'); setShowSend(false); setSendResult(null) }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>{poll.title}</span>
                  {statusChip(poll.status)}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {(poll.data?.options?.length || 0)} options · {poll.data?.poll_type || 'single'}
                  {poll.data?.email_config?.sent_count != null && ` · sent to ${poll.data.email_config.sent_count}`}
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); deletePoll(poll) }} style={btn('ghost')}>Delete</button>
            </div>
          ))}
        </div>
      )}

      {view === 'detail' && selected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {selected.status === 'draft' && <button onClick={() => action(selected, 'publish')} style={btn('accent')}>Publish</button>}
            {selected.status === 'published' && <button onClick={() => action(selected, 'close')} style={btn('ghost')}>Close</button>}
            {selected.status === 'published' && <button onClick={() => setShowSend(v => !v)} style={btn('accent')}>Send by email</button>}
            {statusChip(selected.status)}
          </div>

          {showSend && (
            <div style={card()}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>Send poll by email</div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                <label style={{ ...lbl(), flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <input type="radio" checked={audienceType === 'newsletter_list'} onChange={() => setAudienceType('newsletter_list')} />
                  Distribution list
                </label>
                <label style={{ ...lbl(), flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <input type="radio" checked={audienceType === 'custom'} onChange={() => setAudienceType('custom')} />
                  Custom addresses
                </label>
              </div>
              {audienceType === 'newsletter_list'
                ? <input value={listCn} onChange={e => setListCn(e.target.value)} placeholder="Distribution list (e.g. blog-newsletter)" style={input()} />
                : <textarea value={customRecipients} onChange={e => setCustomRecipients(e.target.value)} placeholder="Comma or newline separated emails" rows={3} style={input()} />}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={() => send(true)} style={btn('ghost')}>Dry run</button>
                <button onClick={() => send(false)} style={btn('accent')}>Send now</button>
              </div>
              {sendResult && <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-muted)' }}>{sendResult}</div>}
            </div>
          )}

          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Live results</div>
            <PollWidget pollId={selected.id} apiBase={apiBase} resultsOnly />
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Public link (share anywhere — social, email, website CTA)</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <code style={{ flex: 1, padding: 12, borderRadius: 6, background: 'var(--bg-deep, #11111b)', fontSize: '0.72rem', wordBreak: 'break-all' }}>
                {publicLink}
              </code>
              <button onClick={() => copy(publicLink)} style={btn('accent')}>Copy</button>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Anyone can open this and vote (one vote per visitor). Publish the poll first.
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Embed in a blog post</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <code style={{ flex: 1, padding: 12, borderRadius: 6, background: 'var(--bg-deep, #11111b)', fontSize: '0.72rem', wordBreak: 'break-all' }}>
                {embedSnippet}
              </code>
              <button onClick={() => copy(embedSnippet)} style={btn('ghost')}>Copy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── tiny style helpers (match FormsPanel's CSS-var theme) ───────────────────
function btn(kind: 'accent' | 'ghost'): CSSProperties {
  return kind === 'accent'
    ? { padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent, #7c3aed)', color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }
    : { padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border, #313244)', background: 'transparent', color: 'var(--text-muted, #a6adc8)', cursor: 'pointer', fontSize: '0.75rem' }
}
function card(): CSSProperties {
  return { padding: '1rem', borderRadius: 8, background: 'var(--bg-elevated, #1e1e2e)', border: '1px solid var(--border, #313244)', marginBottom: '1rem' }
}
function input(): CSSProperties {
  return { padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border, #313244)', background: 'var(--bg-deep, #11111b)', color: 'var(--text, #cdd6f4)', fontSize: '0.85rem' }
}
function lbl(): CSSProperties {
  return { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem', color: 'var(--text-muted, #a6adc8)' }
}
