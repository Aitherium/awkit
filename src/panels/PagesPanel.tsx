'use client'

/**
 * PagesPanel -- AitherOne collaborative document editor.
 *
 * 3-column layout:
 *  - Left: page tree with search (280px)
 *  - Center: rich editor with formatting toolbar + slash menu (flex)
 *  - Right: metadata panel, toggleable (280px)
 */

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Data models ──────────────────────────────────────────────────────

interface Notebook {
  id: string
  title: string
  created_at: string
  updated_at: string
  doc_count: number
}

interface PageDoc {
  id: string
  title: string
  content: string
  notebook_id: string | null
  created_at: string
  updated_at: string
  word_count?: number
}

export interface PagesPanelProps {
  apiBase?: string
}

// ── Save status indicator ────────────────────────────────────────────

type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error'

function SaveIndicator({ status }: { status: SaveStatus }) {
  const labels: Record<SaveStatus, string> = {
    saved: 'Saved',
    saving: 'Saving...',
    unsaved: 'Unsaved changes',
    error: 'Save failed',
  }
  const colors: Record<SaveStatus, string> = {
    saved: 'var(--text-muted)',
    saving: 'var(--accent-primary)',
    unsaved: 'var(--accent-warning, #e5a00d)',
    error: 'var(--accent-danger, #e5484d)',
  }
  return (
    <span style={{ fontSize: '0.7rem', color: colors[status], marginLeft: 8 }}>
      {labels[status]}
    </span>
  )
}

// ── Formatting toolbar ───────────────────────────────────────────────

interface ToolbarProps {
  onCommand: (cmd: string, value?: string) => void
}

function FormattingToolbar({ onCommand }: ToolbarProps) {
  const btn = (label: string, cmd: string, value?: string) => (
    <button
      key={cmd + (value || '')}
      onClick={() => onCommand(cmd, value)}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        padding: '4px 8px',
        background: 'none',
        border: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
        borderRadius: 4,
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        fontSize: '0.75rem',
        fontWeight: 500,
        lineHeight: 1,
      }}
      title={label}
    >
      {label}
    </button>
  )

  return (
    <div style={{
      display: 'flex', gap: 4, padding: '6px 12px',
      borderBottom: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
      background: 'var(--bg-elevated)',
      flexWrap: 'wrap',
    }}>
      {btn('B', 'bold')}
      {btn('I', 'italic')}
      {btn('U', 'underline')}
      {btn('H1', 'formatBlock', 'h1')}
      {btn('H2', 'formatBlock', 'h2')}
      {btn('H3', 'formatBlock', 'h3')}
      {btn('UL', 'insertUnorderedList')}
      {btn('OL', 'insertOrderedList')}
      {btn('Quote', 'formatBlock', 'blockquote')}
      {btn('Code', 'formatBlock', 'pre')}
    </div>
  )
}

// ── Slash menu ───────────────────────────────────────────────────────

interface SlashItem {
  label: string
  description: string
  action: string
}

const SLASH_ITEMS: SlashItem[] = [
  { label: 'Heading 1', description: 'Large heading', action: 'h1' },
  { label: 'Heading 2', description: 'Medium heading', action: 'h2' },
  { label: 'Heading 3', description: 'Small heading', action: 'h3' },
  { label: 'Bullet List', description: 'Unordered list', action: 'ul' },
  { label: 'Numbered List', description: 'Ordered list', action: 'ol' },
  { label: 'Quote', description: 'Block quote', action: 'quote' },
  { label: 'Code Block', description: 'Monospace code', action: 'code' },
  { label: 'Divider', description: 'Horizontal rule', action: 'hr' },
]

function SlashMenu({
  query,
  onSelect,
  onClose,
}: {
  query: string
  onSelect: (item: SlashItem) => void
  onClose: () => void
}) {
  const filtered = SLASH_ITEMS.filter(
    (i) => i.label.toLowerCase().includes(query.toLowerCase())
  )
  const [selected, setSelected] = useState(0)

  useEffect(() => { setSelected(0) }, [query])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
      else if (e.key === 'Enter' && filtered[selected]) { e.preventDefault(); onSelect(filtered[selected]) }
      else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [filtered, selected, onSelect, onClose])

  if (!filtered.length) return null

  return (
    <div style={{
      position: 'absolute', bottom: '100%', left: 12, marginBottom: 4,
      background: 'var(--bg-elevated)', border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
      borderRadius: 8, padding: 4, minWidth: 220, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      zIndex: 100,
    }}>
      {filtered.map((item, i) => (
        <div
          key={item.action}
          onClick={() => onSelect(item)}
          style={{
            padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
            background: i === selected ? 'var(--accent-primary-muted, rgba(99,102,241,0.15))' : 'transparent',
          }}
        >
          <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)' }}>{item.label}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.description}</div>
        </div>
      ))}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────

export default function PagesPanel({ apiBase = '/api/docs' }: PagesPanelProps) {
  const [pages, setPages] = useState<PageDoc[]>([])
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [activePage, setActivePage] = useState<PageDoc | null>(null)
  const [search, setSearch] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [showMeta, setShowMeta] = useState(false)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const editorRef = useRef<HTMLDivElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedContent = useRef<string>('')

  // ── Fetch pages ────────────────────────────────────────────────
  const fetchPages = useCallback(async () => {
    try {
      const [pagesRes, nbRes] = await Promise.all([
        fetch(`${apiBase}/list`),
        fetch(`${apiBase}/notebooks`),
      ])
      if (pagesRes.ok) {
        const data = await pagesRes.json()
        setPages(Array.isArray(data) ? data : data.documents || data.pages || [])
      }
      if (nbRes.ok) {
        const data = await nbRes.json()
        setNotebooks(Array.isArray(data) ? data : data.notebooks || [])
      }
    } catch {
      // service unavailable — show empty state
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => { fetchPages() }, [fetchPages])

  // ── Load page content ──────────────────────────────────────────
  const loadPage = useCallback(async (page: PageDoc) => {
    try {
      const res = await fetch(`${apiBase}/${page.id}`)
      if (res.ok) {
        const full = await res.json()
        const doc = full.document || full
        setActivePage(doc)
        lastSavedContent.current = doc.content || ''
        setSaveStatus('saved')
        if (editorRef.current) {
          editorRef.current.innerHTML = doc.content || ''
        }
      }
    } catch {
      setActivePage(page)
      if (editorRef.current) editorRef.current.innerHTML = page.content || ''
    }
  }, [apiBase])

  // ── Save with debounce ─────────────────────────────────────────
  const saveContent = useCallback(async (content: string) => {
    if (!activePage) return
    if (content === lastSavedContent.current) { setSaveStatus('saved'); return }
    setSaveStatus('saving')
    try {
      const res = await fetch(`${apiBase}/${activePage.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: activePage.title, content }),
      })
      if (res.ok) {
        lastSavedContent.current = content
        setSaveStatus('saved')
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    }
  }, [activePage, apiBase])

  const debounceSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveStatus('unsaved')
    saveTimerRef.current = setTimeout(() => {
      if (editorRef.current) saveContent(editorRef.current.innerHTML)
    }, 1500)
  }, [saveContent])

  // Save on blur
  const handleBlur = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (editorRef.current && activePage) saveContent(editorRef.current.innerHTML)
  }, [saveContent, activePage])

  // ── Create new page ────────────────────────────────────────────
  const createPage = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled', content: '' }),
      })
      if (res.ok) {
        const created = await res.json()
        const doc = created.document || created
        setPages((prev) => [doc, ...prev])
        setActivePage(doc)
        lastSavedContent.current = ''
        setSaveStatus('saved')
        if (editorRef.current) {
          editorRef.current.innerHTML = ''
          editorRef.current.focus()
        }
      }
    } catch { /* ignore */ }
  }, [apiBase])

  // ── Delete page ────────────────────────────────────────────────
  const deletePage = useCallback(async (id: string) => {
    try {
      await fetch(`${apiBase}/${id}`, { method: 'DELETE' })
      setPages((prev) => prev.filter((p) => p.id !== id))
      if (activePage?.id === id) {
        setActivePage(null)
        if (editorRef.current) editorRef.current.innerHTML = ''
      }
    } catch { /* ignore */ }
  }, [apiBase, activePage])

  // ── Exec formatting ────────────────────────────────────────────
  const execCommand = useCallback((cmd: string, value?: string) => {
    if (cmd === 'formatBlock' && value) {
      document.execCommand('formatBlock', false, `<${value}>`)
    } else {
      document.execCommand(cmd, false, value)
    }
    debounceSave()
  }, [debounceSave])

  // ── Slash command handler ──────────────────────────────────────
  const handleSlashSelect = useCallback((item: SlashItem) => {
    // Remove the /query text from editor
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      const node = range.startContainer
      if (node.nodeType === Node.TEXT_NODE && node.textContent) {
        const slashIdx = node.textContent.lastIndexOf('/')
        if (slashIdx >= 0) {
          const newRange = document.createRange()
          newRange.setStart(node, slashIdx)
          newRange.setEnd(node, node.textContent.length)
          newRange.deleteContents()
        }
      }
    }

    const actionMap: Record<string, [string, string?]> = {
      h1: ['formatBlock', 'h1'],
      h2: ['formatBlock', 'h2'],
      h3: ['formatBlock', 'h3'],
      ul: ['insertUnorderedList'],
      ol: ['insertOrderedList'],
      quote: ['formatBlock', 'blockquote'],
      code: ['formatBlock', 'pre'],
      hr: ['insertHorizontalRule'],
    }
    const [cmd, val] = actionMap[item.action] || []
    if (cmd) execCommand(cmd, val)
    setSlashQuery(null)
  }, [execCommand])

  // ── Editor input handler (detect slash) ────────────────────────
  const handleEditorInput = useCallback(() => {
    debounceSave()
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      const node = range.startContainer
      if (node.nodeType === Node.TEXT_NODE && node.textContent) {
        const text = node.textContent.slice(0, range.startOffset)
        const slashMatch = text.match(/\/([a-zA-Z0-9]*)$/)
        if (slashMatch) {
          setSlashQuery(slashMatch[1])
          return
        }
      }
    }
    setSlashQuery(null)
  }, [debounceSave])

  // ── Rename page (inline) ───────────────────────────────────────
  const renamePage = useCallback(async (page: PageDoc, newTitle: string) => {
    const title = newTitle.trim() || 'Untitled'
    try {
      await fetch(`${apiBase}/${page.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: page.content }),
      })
      setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, title } : p)))
      if (activePage?.id === page.id) setActivePage((prev) => prev ? { ...prev, title } : prev)
    } catch { /* ignore */ }
  }, [apiBase, activePage])

  // ── Filtered pages ─────────────────────────────────────────────
  const filteredPages = search
    ? pages.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()))
    : pages

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, color: 'var(--text-primary)' }}>
      {/* ─── Left: Page Tree ─────────────────────────────────── */}
      <aside style={{
        width: 280, minWidth: 280,
        borderRight: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
        background: 'var(--bg-elevated)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
        }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>Pages</span>
          <button
            onClick={createPage}
            style={{
              padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600,
              background: 'var(--accent-primary)', color: '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer',
            }}
          >
            + New
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '8px 14px' }}>
          <input
            type="text"
            placeholder="Search pages..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '6px 10px', fontSize: '0.8rem',
              background: 'var(--bg-deep)', color: 'var(--text-primary)',
              border: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
              borderRadius: 6, outline: 'none',
            }}
          />
        </div>

        {/* Page list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
          {loading ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              Loading...
            </div>
          ) : filteredPages.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              {search ? 'No matching pages' : 'No pages yet. Click + New to start.'}
            </div>
          ) : (
            filteredPages.map((page) => (
              <div
                key={page.id}
                onClick={() => loadPage(page)}
                style={{
                  padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                  marginBottom: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: activePage?.id === page.id
                    ? 'var(--accent-primary-muted, rgba(99,102,241,0.15))'
                    : 'transparent',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: '0.8rem', fontWeight: activePage?.id === page.id ? 600 : 400,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {page.title || 'Untitled'}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {page.updated_at ? new Date(page.updated_at).toLocaleDateString() : ''}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deletePage(page.id) }}
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: '0.7rem', padding: '2px 4px',
                    opacity: 0.5,
                  }}
                  title="Delete"
                >
                  x
                </button>
              </div>
            ))
          )}
        </div>

        {/* Notebooks section */}
        {notebooks.length > 0 && (
          <div style={{
            borderTop: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
            padding: '8px 14px',
          }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
              NOTEBOOKS
            </div>
            {notebooks.map((nb) => (
              <div key={nb.id} style={{ fontSize: '0.75rem', padding: '3px 0', color: 'var(--text-secondary)' }}>
                {nb.title} ({nb.doc_count})
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* ─── Center: Editor ──────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
        {activePage ? (
          <>
            {/* Title bar */}
            <div style={{
              padding: '10px 16px', display: 'flex', alignItems: 'center',
              borderBottom: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
              background: 'var(--bg-surface)',
            }}>
              <input
                type="text"
                value={activePage.title}
                onChange={(e) => setActivePage((prev) => prev ? { ...prev, title: e.target.value } : prev)}
                onBlur={(e) => renamePage(activePage, e.target.value)}
                style={{
                  flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)',
                }}
              />
              <SaveIndicator status={saveStatus} />
              <button
                onClick={() => setShowMeta((v) => !v)}
                style={{
                  marginLeft: 8, padding: '4px 8px', fontSize: '0.7rem',
                  background: showMeta ? 'var(--accent-primary-muted, rgba(99,102,241,0.15))' : 'none',
                  border: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
                  borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                Info
              </button>
            </div>

            {/* Toolbar */}
            <FormattingToolbar onCommand={execCommand} />

            {/* Editor area */}
            <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
              {slashQuery !== null && (
                <SlashMenu
                  query={slashQuery}
                  onSelect={handleSlashSelect}
                  onClose={() => setSlashQuery(null)}
                />
              )}
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={handleEditorInput}
                onBlur={handleBlur}
                style={{
                  padding: '20px 32px', minHeight: '100%', outline: 'none',
                  fontSize: '0.9rem', lineHeight: 1.7,
                  color: 'var(--text-primary)',
                  maxWidth: 800, margin: '0 auto',
                }}
              />
            </div>
          </>
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ fontSize: '1.5rem', opacity: 0.3 }}>Pages</div>
            <div style={{ fontSize: '0.85rem' }}>Select a page or create a new one</div>
            <button
              onClick={createPage}
              style={{
                marginTop: 8, padding: '8px 20px', fontSize: '0.85rem',
                background: 'var(--accent-primary)', color: '#fff',
                border: 'none', borderRadius: 8, cursor: 'pointer',
              }}
            >
              Create Page
            </button>
          </div>
        )}
      </div>

      {/* ─── Right: Metadata (toggleable) ────────────────────── */}
      {showMeta && activePage && (
        <aside style={{
          width: 280, minWidth: 280,
          borderLeft: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
          background: 'var(--bg-elevated)',
          padding: 16, overflow: 'auto',
        }}>
          <h3 style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 16 }}>Page Info</h3>
          <div style={{ display: 'grid', gap: 12, fontSize: '0.75rem' }}>
            <div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>ID</div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all' }}>
                {activePage.id}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Created</div>
              <div>{activePage.created_at ? new Date(activePage.created_at).toLocaleString() : '--'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Updated</div>
              <div>{activePage.updated_at ? new Date(activePage.updated_at).toLocaleString() : '--'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Words</div>
              <div>{activePage.word_count ?? '--'}</div>
            </div>
            {activePage.notebook_id && (
              <div>
                <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Notebook</div>
                <div>{notebooks.find((n) => n.id === activePage.notebook_id)?.title || activePage.notebook_id}</div>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
