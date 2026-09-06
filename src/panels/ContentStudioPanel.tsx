'use client'

/**
 * ContentStudioPanel — AI content generation for captions, blogs, calendars, emails.
 *
 * Each sub-tab calls a configurable API endpoint. Products can override
 * the API base and customize which sub-tabs are shown.
 */

import { useState } from 'react'

export interface ContentStudioPanelProps {
  /** API base for content endpoints, default "/api/content" */
  apiBase?: string
  /** Which sub-tabs to show */
  tabs?: ('captions' | 'calendar' | 'blog' | 'email')[]
  /** Platform options for caption generation */
  platforms?: string[]
  /** Email preset buttons */
  emailPresets?: string[]
}

const DEFAULT_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'pinterest', 'linkedin', 'twitter']
const DEFAULT_EMAIL_PRESETS = [
  'Booking confirmation', 'Follow-up', 'Welcome email',
  'Thank you', 'Reminder', 'Announcement',
]

export default function ContentStudioPanel({
  apiBase = '/api/content',
  tabs = ['captions', 'calendar', 'blog', 'email'],
  platforms = DEFAULT_PLATFORMS,
  emailPresets = DEFAULT_EMAIL_PRESETS,
}: ContentStudioPanelProps) {
  const [tab, setTab] = useState(tabs[0])

  const tabLabels: Record<string, string> = {
    captions: 'Captions', calendar: 'Calendar', blog: 'Blog Post', email: 'Email',
  }

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: 24 }}>Content Studio</h1>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--bg-base)', padding: 4, borderRadius: 'var(--radius)' }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '10px 16px', borderRadius: 'var(--radius)',
            background: tab === t ? 'var(--bg-elevated)' : 'transparent',
            color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
            fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer',
          }}>{tabLabels[t]}</button>
        ))}
      </div>

      {tab === 'captions' && <CaptionGenerator apiBase={apiBase} platforms={platforms} />}
      {tab === 'calendar' && <CalendarGenerator apiBase={apiBase} />}
      {tab === 'blog' && <BlogGenerator apiBase={apiBase} />}
      {tab === 'email' && <EmailGenerator apiBase={apiBase} presets={emailPresets} />}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────

function CaptionGenerator({ apiBase, platforms }: { apiBase: string; platforms: string[] }) {
  const [desc, setDesc] = useState('')
  const [platform, setPlatform] = useState(platforms[0])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ captions: string[]; hashtags: string[] } | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  const generate = async () => {
    if (!desc.trim()) return
    setLoading(true)
    const resp = await fetch(`${apiBase}/caption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc, platform, num_variants: 3 }),
    })
    setResult(await resp.json())
    setLoading(false)
  }

  const copy = (text: string, i: number) => {
    navigator.clipboard.writeText(text)
    setCopied(i)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
          What's this post about?
        </label>
        <textarea value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="Describe the content you want to promote..."
          rows={3} style={{
            width: '100%', padding: 12, background: 'var(--bg-surface)',
            color: 'var(--text-primary)', border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius)', fontSize: '0.85rem', resize: 'vertical',
          }} />
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <select value={platform} onChange={e => setPlatform(e.target.value)} style={{
          padding: '8px 12px', background: 'var(--bg-surface)', color: 'var(--text-primary)',
          border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)', fontSize: '0.85rem',
        }}>
          {platforms.map(p => (
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
        <button onClick={generate} disabled={loading || !desc.trim()} style={{
          padding: '10px 20px', background: 'var(--accent-primary)', color: 'white',
          borderRadius: 'var(--radius)', fontSize: '0.85rem', fontWeight: 500,
          opacity: loading ? 0.6 : 1, cursor: 'pointer',
        }}>{loading ? 'Generating...' : 'Generate'}</button>
      </div>
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {result.captions.map((caption, i) => (
            <div key={i} style={{
              background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius)', padding: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Option {i + 1}</span>
                <button onClick={() => copy(caption, i)} style={{
                  background: 'none', color: copied === i ? 'var(--accent-green, #7ab08a)' : 'var(--text-muted)',
                  fontSize: '0.7rem', cursor: 'pointer',
                }}>{copied === i ? 'Copied!' : 'Copy'}</button>
              </div>
              <p style={{ fontSize: '0.85rem', lineHeight: 1.6 }}>{caption}</p>
            </div>
          ))}
          {result.hashtags.length > 0 && (
            <div style={{
              background: 'var(--bg-surface)', borderRadius: 'var(--radius)',
              padding: '12px 16px', fontSize: '0.8rem', color: 'var(--accent-primary)',
            }}>{result.hashtags.join(' ')}</div>
          )}
        </div>
      )}
    </div>
  )
}

function CalendarGenerator({ apiBase }: { apiBase: string }) {
  const [weeks, setWeeks] = useState(4)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')

  const generate = async () => {
    setLoading(true)
    const resp = await fetch(`${apiBase}/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weeks, posts_per_week: 5 }),
    })
    const data = await resp.json()
    setResult(data.calendar)
    setLoading(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} style={{
          padding: '8px 12px', background: 'var(--bg-surface)', color: 'var(--text-primary)',
          border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)', fontSize: '0.85rem',
        }}>
          <option value={2}>2 weeks</option>
          <option value={4}>4 weeks</option>
          <option value={8}>8 weeks</option>
        </select>
        <button onClick={generate} disabled={loading} style={{
          padding: '10px 20px', background: 'var(--accent-primary)', color: 'white',
          borderRadius: 'var(--radius)', fontSize: '0.85rem', fontWeight: 500,
          opacity: loading ? 0.6 : 1, cursor: 'pointer',
        }}>{loading ? 'Generating...' : 'Generate Calendar'}</button>
      </div>
      {result && (
        <div style={{
          background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius)', padding: 20,
          fontSize: '0.85rem', lineHeight: 1.7, whiteSpace: 'pre-wrap',
        }}>{result}</div>
      )}
    </div>
  )
}

function BlogGenerator({ apiBase }: { apiBase: string }) {
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')

  const generate = async () => {
    if (!topic.trim()) return
    setLoading(true)
    const resp = await fetch(`${apiBase}/blog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, length: 'medium' }),
    })
    const data = await resp.json()
    setResult(data.content)
    setLoading(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <input value={topic} onChange={e => setTopic(e.target.value)}
          placeholder="Enter blog post topic..."
          style={{
            flex: 1, padding: '10px 14px', background: 'var(--bg-surface)',
            color: 'var(--text-primary)', border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius)', fontSize: '0.85rem',
          }} />
        <button onClick={generate} disabled={loading || !topic.trim()} style={{
          padding: '10px 20px', background: 'var(--accent-primary)', color: 'white',
          borderRadius: 'var(--radius)', fontSize: '0.85rem', fontWeight: 500,
          opacity: loading ? 0.6 : 1, cursor: 'pointer',
        }}>{loading ? 'Writing...' : 'Generate'}</button>
      </div>
      {result && (
        <div style={{
          background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius)', padding: 24,
          fontSize: '0.9rem', lineHeight: 1.8, whiteSpace: 'pre-wrap',
        }}>{result}</div>
      )}
    </div>
  )
}

function EmailGenerator({ apiBase, presets }: { apiBase: string; presets: string[] }) {
  const [purpose, setPurpose] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')

  const generate = async (p?: string) => {
    const val = p || purpose
    if (!val.trim()) return
    setPurpose(val)
    setLoading(true)
    const resp = await fetch(`${apiBase}/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose: val }),
    })
    const data = await resp.json()
    setResult(data.email)
    setLoading(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {presets.map(p => (
          <button key={p} onClick={() => generate(p)} style={{
            padding: '6px 12px', background: 'var(--bg-surface)',
            border: '1px solid var(--glass-border)', borderRadius: 16,
            color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer',
          }}>{p}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <input value={purpose} onChange={e => setPurpose(e.target.value)}
          placeholder="Or describe the email purpose..."
          style={{
            flex: 1, padding: '10px 14px', background: 'var(--bg-surface)',
            color: 'var(--text-primary)', border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius)', fontSize: '0.85rem',
          }} />
        <button onClick={() => generate()} disabled={loading || !purpose.trim()} style={{
          padding: '10px 20px', background: 'var(--accent-primary)', color: 'white',
          borderRadius: 'var(--radius)', fontSize: '0.85rem', fontWeight: 500,
          opacity: loading ? 0.6 : 1, cursor: 'pointer',
        }}>{loading ? 'Writing...' : 'Generate'}</button>
      </div>
      {result && (
        <div style={{
          background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius)', padding: 24,
          fontSize: '0.85rem', lineHeight: 1.7, whiteSpace: 'pre-wrap',
        }}>{result}</div>
      )}
    </div>
  )
}
