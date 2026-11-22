'use client'

/**
 * Documents as a file explorer (tenant ask, 2026-11-16: "make this a real file
 * explorer / drives ... edit in real time and move folders & files ... doesn't have to be
 * anything more than a Windows or SharePoint file system").
 *
 * One box over the routes the host already serves (no second store): drives and folders on
 * the left, the open folder in the middle, the open file on the right. Drag a file or a
 * folder onto a folder to move it; F2 renames; Delete sends to the Recycle Bin; Enter opens;
 * Backspace goes up; Ctrl+A selects all; Ctrl+S saves an edit; F5 refreshes. Every rename,
 * move and edit keeps the file's id, so its history and everything the system remembers from
 * it (search passages, staff / CertTrack rows, chat references) keep resolving.
 *
 * Rendered by DocumentPanel when the host advertises `document_drives`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, KeyboardEvent } from 'react'
import { getApiBase } from '../lib/apiBase'
import { uploadChunked } from '../lib/chunkedUpload'
import { useConfig } from '../hooks/useConfig'

// ── Pure helpers (exported for tests) ──────────────────────────────────────────

export interface ExDoc {
  id: string
  filename: string
  doc_type: string
  uploaded_at: string | null
  chunk_count: number
  project?: string | null
  tags?: string[]
}
export interface ExFolder {
  path: string
  name: string
  parent: string | null
  depth: number
  doc_count: number
  total_count: number
}
export interface ExDrive {
  id: string
  name: string
  description: string
  read_roles: string[]
  write_roles: string[]
  user_ids: string[]
  documents: number
  can_write: boolean
  chat_scoped: boolean
}
export interface TrashItem {
  id: string
  filename: string
  trashed_at: string | null
  trashed_by: string
  original_folder: string | null
}

export const DOC_MIME = 'application/x-awkit-docs'
export const FOLDER_MIME = 'application/x-awkit-folder'

/** "A/B/C" -> [{label:"A",path:"A"},{label:"B",path:"A/B"},...]; "" -> []. */
export function breadcrumbs(path: string): { label: string; path: string }[] {
  if (!path) return []
  const parts = path.split('/')
  return parts.map((label, i) => ({ label, path: parts.slice(0, i + 1).join('/') }))
}

export const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** What the open folder holds: its subfolders first, then its documents, both A-Z. */
export function entriesIn(
  path: string, docs: readonly ExDoc[], folders: readonly ExFolder[],
): { folders: ExFolder[]; docs: ExDoc[] } {
  const by = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
  return {
    folders: folders.filter(f => (f.parent || '') === path).sort((a, b) => by(a.name, b.name)),
    docs: docs.filter(d => (d.project || '') === path).sort((a, b) => by(a.filename, b.filename)),
  }
}

/** Where a dragged folder lands when dropped on `target` ("" = top level). null = refuse. */
export function movedFolderPath(source: string, target: string): string | null {
  const name = source.split('/').pop() || ''
  if (!name) return null
  if (target === source || target.startsWith(`${source}/`)) return null // into itself
  const next = target ? `${target}/${name}` : name
  return next === source ? null : next
}

export const EDITABLE = /\.(txt|md|csv|json|log|ya?ml)$/i
const fileKind = (name: string) => {
  const ext = (name.split('.').pop() || '').toLowerCase()
  return ext && ext !== name.toLowerCase() ? ext.toUpperCase() : 'File'
}
const when = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
/** Open to everyone in the workspace (no named people, every role reads)? */
export const driveIsOpen = (d: ExDrive) =>
  d.user_ids.length === 0 && ['admin', 'member', 'viewer'].every(r => d.read_roles.includes(r))

// ── Styles ────────────────────────────────────────────────────────────────────

const border = '1px solid var(--glass-border, #333)'
const muted: CSSProperties = { color: 'var(--text-muted, #888)' }
const btn: CSSProperties = {
  padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderRadius: 4, border,
  background: 'var(--bg-surface, #1a1a2e)', color: 'var(--text-primary, #eee)', cursor: 'pointer',
}
const primaryBtn: CSSProperties = { ...btn, background: 'var(--accent-primary, #3b82f6)', borderColor: 'transparent', color: '#fff' }
const input: CSSProperties = {
  padding: '0.2rem 0.4rem', fontSize: '0.78rem', borderRadius: 4, border,
  background: 'var(--bg-primary, #111)', color: 'var(--text-primary, #eee)',
}

type Selection = { kind: 'doc' | 'folder'; key: string }
type View = { mode: 'folder'; path: string } | { mode: 'trash' } | { mode: 'onboarding' }
type Tab = 'preview' | 'history' | 'memory' | 'pipeline'

interface HistoryEvent {
  id: string; event: string; at: string | null; old_filename: string | null; new_filename: string | null
  old_folder: string | null; new_folder: string | null; version: number | null; by: string | null
}
interface History {
  events: HistoryEvent[]
  versions: { version: number; at: string | null; by: string; summary: string | null }[]
  former_names: string[]
  former_folders: string[]
}
interface Memory {
  search: { chunks?: number; chunk_filenames?: string[]; chunk_folders?: string[]; in_sync?: boolean; error?: string }
  records: { staff_rows: number; project_rows: number; certtrack_entries: number; chat_turns_that_read_it: number }
}
interface PipeStage {
  id: string; label: string; status: string; detail: string
  entries?: { id: string; cert_name: string; number: string; issued: string; expires: string; status: string; state: string }[]
  checks?: { row: string; issue: string; detail: string }[]
  summary?: { counts: Record<string, number>; alerts: { cert: string; expires: string; state: string }[]; reminders: string } | null
}
interface Pipeline {
  stages: PipeStage[]; next: string | null
  log: { audit: number; decision: string; note: string; by: string; at: string | null }[]
}
interface Opened {
  id: string; filename: string; text: string; kind?: string; preview_url?: string
}

const api = (path: string) => `${getApiBase()}${path}`

async function call(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const r = await fetch(api(path), init)
  let data: any = null
  try { data = await r.json() } catch { /* an empty body */ }
  return { ok: r.ok, status: r.status, data }
}

const detailOf = (r: { data: any; status: number }, fallback: string) => {
  const d = r.data?.detail
  if (typeof d === 'string') return d
  if (d && typeof d.detail === 'string') return d.detail
  return `${fallback} (${r.status})`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DocumentExplorer() {
  const config = useConfig()
  const [docs, setDocs] = useState<ExDoc[]>([])
  const [folders, setFolders] = useState<ExFolder[]>([])
  const [drives, setDrives] = useState<ExDrive[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [trash, setTrash] = useState<TrashItem[]>([])
  const [view, setView] = useState<View>({ mode: 'folder', path: '' })
  const [sel, setSel] = useState<Selection[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<Selection | null>(null)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Opened | null>(null)
  const [tab, setTab] = useState<Tab>('preview')
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null) // the draft text
  const [baseVersion, setBaseVersion] = useState(1)
  const [history, setHistory] = useState<History | null>(null)
  const [memory, setMemory] = useState<Memory | null>(null)
  const [pipeline, setPipeline] = useState<Pipeline | null>(null)
  const [newFolder, setNewFolder] = useState<string | null>(null)
  const [showAccess, setShowAccess] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const path = view.mode === 'folder' ? view.path : ''
  const say = (text: string, bad = false) => setStatus({ text, bad })

  const refresh = useCallback(async () => {
    try {
      const [d, f, dr, tr] = await Promise.all([
        call('GET', '/api/documents'), call('GET', '/api/documents/folders'),
        call('GET', '/api/documents/drives'), call('GET', '/api/documents/trash'),
      ])
      if (d.ok && Array.isArray(d.data)) setDocs(d.data)
      else say(detailOf(d, 'Could not load documents'), true)
      if (f.ok) setFolders(f.data?.folders || [])
      if (dr.ok) { setDrives(dr.data?.drives || []); setIsAdmin(!!dr.data?.is_admin) }
      if (tr.ok) setTrash(tr.data?.items || [])
    } catch {
      say('Could not reach the server. Check your connection and press F5.', true)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const here = useMemo(() => entriesIn(path, docs, folders), [path, docs, folders])
  const driveOf = (p: string) => drives.find(d => d.name.toLowerCase() === (p.split('/')[0] || '').toLowerCase())
  const currentDrive = driveOf(path)
  const rows: Selection[] = useMemo(() => [
    ...here.folders.map(f => ({ kind: 'folder' as const, key: f.path })),
    ...here.docs.map(d => ({ kind: 'doc' as const, key: d.id })),
  ], [here])
  const isSel = (s: Selection) => sel.some(x => x.kind === s.kind && x.key === s.key)
  const selDocs = sel.filter(s => s.kind === 'doc').map(s => s.key)
  const docById = (id: string) => docs.find(d => d.id === id)

  // ── Actions ────────────────────────────────────────────────────────────────

  const go = (p: string) => { setView({ mode: 'folder', path: p }); setSel([]); setRenaming(null) }

  const moveDocs = async (ids: string[], target: string) => {
    const movable = ids.filter(id => (docById(id)?.project || '') !== target)
    if (!movable.length) return
    setBusy(true)
    const r = await call('POST', '/api/documents/bulk', { ids: movable, project: target })
    setBusy(false)
    if (!r.ok) return say(detailOf(r, 'Could not move'), true)
    const failed = r.data?.failed?.length || 0
    say(failed ? `Moved ${r.data.updated.length}; ${failed} could not move: ${r.data.failed[0].detail}`
      : `Moved ${r.data.updated.length} to ${target || 'the top level'}`, !!failed)
    await refresh()
  }

  const moveFolder = async (source: string, target: string) => {
    const next = movedFolderPath(source, target)
    if (next === null) return say('A folder cannot be moved into itself.', true)
    setBusy(true)
    const r = await call('POST', '/api/documents/folders/rename', { path: source, new_path: next })
    setBusy(false)
    if (!r.ok) return say(detailOf(r, 'Could not move the folder'), true)
    say(`Moved folder to ${next}`)
    if (path === source || path.startsWith(`${source}/`)) go(next + path.slice(source.length))
    await refresh()
  }

  const onDropOn = async (e: DragEvent, target: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropOn(null)
    const raw = e.dataTransfer.getData(DOC_MIME)
    const folder = e.dataTransfer.getData(FOLDER_MIME)
    if (raw) {
      try { await moveDocs(JSON.parse(raw) as string[], target) } catch { /* a foreign drag */ }
    } else if (folder) {
      await moveFolder(folder, target)
    } else if (e.dataTransfer.files?.length) {
      await upload(Array.from(e.dataTransfer.files), target)
    }
  }

  const onDragStart = (e: DragEvent, s: Selection) => {
    if (s.kind === 'doc') {
      const ids = isSel(s) && selDocs.length ? selDocs : [s.key]
      e.dataTransfer.setData(DOC_MIME, JSON.stringify(ids))
    } else {
      e.dataTransfer.setData(FOLDER_MIME, s.key)
    }
    e.dataTransfer.effectAllowed = 'move'
  }

  const dragOver = (e: DragEvent, target: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropOn(target || '/')
  }

  const upload = async (files: File[], target: string) => {
    if (!files.length) return
    setBusy(true)
    let done = 0
    const problems: string[] = []
    const singleMax = (config.upload_single_max_mb || 90) * 1024 * 1024
    for (const file of files) {
      say(`Uploading ${file.name} (${done + 1} of ${files.length})...`)
      try {
        if (file.size > singleMax && config.features?.includes('chunked_upload')) {
          const out = await uploadChunked(file, { apiBase: getApiBase(), project: target, onDuplicate: 'keep_both' })
          if (!out.ok) { problems.push(`${file.name}: ${out.detail}`); continue }
        } else {
          const form = new FormData()
          form.append('file', file)
          form.append('project', target)
          form.append('on_duplicate', 'keep_both') // never overwrites: a clash becomes "Name (v2)"
          const r = await fetch(api('/api/documents/upload'), { method: 'POST', body: form })
          if (!r.ok) {
            let d = ''
            try { const j = await r.json(); d = typeof j.detail === 'string' ? j.detail : '' } catch { /* none */ }
            problems.push(`${file.name}: ${d || r.status}`)
            continue
          }
        }
        done += 1
      } catch {
        problems.push(`${file.name}: network error`)
      }
    }
    setBusy(false)
    say(problems.length ? `Uploaded ${done} of ${files.length}. ${problems[0]}` : `Uploaded ${done} file${done === 1 ? '' : 's'}`, problems.length > 0)
    await refresh()
  }

  const createFolder = async (name: string) => {
    const clean = name.trim().replace(/[\\/]+/g, ' ').trim()
    if (!clean) return setNewFolder(null)
    const r = await call('POST', '/api/documents/folders', { path: path ? `${path}/${clean}` : clean })
    setNewFolder(null)
    if (!r.ok) return say(detailOf(r, 'Could not create the folder'), true)
    say(`Created ${clean}`)
    await refresh()
  }

  const startRename = (s: Selection | undefined) => {
    if (!s) return
    const current = s.kind === 'doc' ? docById(s.key)?.filename : s.key.split('/').pop()
    setRenaming(s)
    setDraft(current || '')
  }

  const commitRename = async () => {
    const target = renaming
    setRenaming(null)
    if (!target || !draft.trim()) return
    if (target.kind === 'doc') {
      const r = await call('POST', `/api/documents/${target.key}/rename`, { filename: draft.trim() })
      if (!r.ok) return say(detailOf(r, 'Could not rename'), true)
      say(r.data.changed ? `Renamed to ${r.data.filename}. The old name is kept in its history.` : 'Name unchanged')
      if (open?.id === target.key) setOpen({ ...open, filename: r.data.filename })
      if (open?.id === target.key && tab === 'history') void loadHistory(target.key)
    } else {
      const parent = parentOf(target.key)
      const r = await call('POST', '/api/documents/folders/rename', {
        path: target.key, new_path: parent ? `${parent}/${draft.trim()}` : draft.trim(),
      })
      if (!r.ok) return say(detailOf(r, 'Could not rename the folder'), true)
      say('Renamed the folder')
    }
    await refresh()
  }

  const trashSelected = async () => {
    const ids = selDocs
    if (!ids.length) return
    setBusy(true)
    let ok = 0
    let bad = ''
    for (const id of ids) {
      const r = await call('POST', `/api/documents/${id}/trash`)
      if (r.ok) ok += 1
      else bad = detailOf(r, 'Could not delete')
    }
    setBusy(false)
    if (open && ids.includes(open.id)) closeFile()
    say(bad ? `Moved ${ok} to the Recycle Bin. ${bad}` : `Moved ${ok} to the Recycle Bin (restore any time)`, !!bad)
    setSel([])
    await refresh()
  }

  const restore = async (id: string) => {
    const r = await call('POST', `/api/documents/${id}/restore`)
    if (!r.ok) return say(detailOf(r, 'Could not restore'), true)
    say(r.data.renamed_on_restore ? `Restored as ${r.data.filename} (the name was taken)` : `Restored ${r.data.filename}`)
    await refresh()
  }

  const deleteForever = async (item: TrashItem) => {
    if (!window.confirm(`Delete "${item.filename}" for good? This cannot be undone.`)) return
    const r = await call('DELETE', `/api/documents/${item.id}`)
    if (!r.ok) return say(detailOf(r, 'Only an administrator can delete for good'), true)
    say(`Deleted ${item.filename} for good`)
    await refresh()
  }

  // ── Open file ──────────────────────────────────────────────────────────────

  const closeFile = () => { setOpen(null); setBlobUrl(null); setEditing(null); setHistory(null); setMemory(null); setPipeline(null) }

  const loadHistory = async (id: string) => {
    const r = await call('GET', `/api/documents/${id}/history`)
    if (r.ok) {
      setHistory(r.data)
      const versions: number[] = (r.data.versions || []).map((v: { version: number }) => v.version)
      setBaseVersion(versions.length ? Math.max(...versions) : 1)
    }
  }
  const loadPipeline = async (id: string) => {
    const r = await call('GET', `/api/pipeline/docs/${id}`)
    if (r.ok) setPipeline(r.data)
  }
  const pipelineOn = !!config.features?.includes('document_pipeline')
  const readAsCert = async () => {
    if (!open) return
    setBusy(true)
    const r = await call('POST', `/api/pipeline/docs/${open.id}/read`)
    setBusy(false)
    if (!r.ok) return say(detailOf(r, 'Could not read this file as a certificate'), true)
    setPipeline(r.data)
    say(`Read ${r.data.read?.records ?? 0} certificate record(s). They wait for Audit 1.`)
  }
  const decide = async (n: number, decision: 'approved' | 'rejected') => {
    if (!open) return
    let note = ''
    if (decision === 'rejected') {
      note = window.prompt('Why is this wrong? (required)') || ''
      if (!note.trim()) return
    }
    setBusy(true)
    const r = await call('POST', `/api/pipeline/docs/${open.id}/audit/${n}`, { decision, note })
    setBusy(false)
    if (!r.ok) return say(detailOf(r, 'Could not record the decision'), true)
    setPipeline(r.data)
    say(`Audit ${n} ${decision}`)
  }
  const loadMemory = async (id: string) => {
    const r = await call('GET', `/api/documents/${id}/memory`)
    if (r.ok) setMemory(r.data)
  }

  const openFile = async (id: string) => {
    setTab('preview'); setEditing(null); setBlobUrl(null); setHistory(null); setMemory(null); setPipeline(null)
    const r = await call('GET', `/api/documents/${id}/content`)
    if (!r.ok) return say(detailOf(r, 'Could not open the file'), true)
    setOpen({ id, filename: r.data.filename, text: r.data.text || '', kind: r.data.kind, preview_url: r.data.preview_url })
    void loadHistory(id)
    if (r.data.preview_url) {
      try {
        const b = await fetch(api(r.data.preview_url))
        if (b.ok && typeof URL !== 'undefined' && URL.createObjectURL) setBlobUrl(URL.createObjectURL(await b.blob()))
      } catch { /* the text view still works */ }
    }
  }

  const save = async () => {
    if (!open || editing === null) return
    setBusy(true)
    const r = await call('PUT', `/api/documents/${open.id}/content`, { text: editing, base_version: baseVersion })
    setBusy(false)
    if (r.status === 409) return say(detailOf(r, 'Someone saved this file after you opened it. Reload to see their version.'), true)
    if (!r.ok) return say(detailOf(r, 'Could not save'), true)
    say(r.data.changed ? `Saved as version ${r.data.version}` : 'No changes to save')
    setOpen({ ...open, text: editing })
    setEditing(null)
    await loadHistory(open.id)
    await refresh()
  }

  const restoreVersion = async (version: number) => {
    if (!open) return
    const v = await call('GET', `/api/documents/${open.id}/versions/${version}`)
    if (!v.ok) return say(detailOf(v, 'Could not read that version'), true)
    setTab('preview')
    setEditing(v.data.text) // loaded into the editor; Save makes it the newest version
    say(`Version ${version} is in the editor. Save to make it the newest version.`)
  }

  useEffect(() => {
    if (!open) return
    if (tab === 'history') void loadHistory(open.id)
    if (tab === 'memory') void loadMemory(open.id)
    if (tab === 'pipeline') void loadPipeline(open.id)
  }, [tab, open?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard ───────────────────────────────────────────────────────────────

  const onKeys = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
    const idx = sel.length ? rows.findIndex(r => r.kind === sel[sel.length - 1].kind && r.key === sel[sel.length - 1].key) : -1
    if (e.key === 'F2') { e.preventDefault(); startRename(sel[sel.length - 1]) }
    else if (e.key === 'Delete') { e.preventDefault(); void trashSelected() }
    else if (e.key === 'F5') { e.preventDefault(); void refresh() }
    else if (e.key === 'Backspace') { e.preventDefault(); if (path) go(parentOf(path)) }
    else if (e.key === 'Escape') { setSel([]); setRenaming(null) }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(rows) }
    else if (e.key === 'Enter') {
      const s = sel[sel.length - 1]
      if (s?.kind === 'folder') go(s.key)
      else if (s) void openFile(s.key)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = rows[Math.max(0, Math.min(rows.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) { setSel([next]); setAnchor(next.key) }
    }
  }

  const clickRow = (e: React.MouseEvent, s: Selection) => {
    if (e.shiftKey && anchor) {
      const a = rows.findIndex(r => r.key === anchor)
      const b = rows.findIndex(r => r.kind === s.kind && r.key === s.key)
      if (a >= 0 && b >= 0) return setSel(rows.slice(Math.min(a, b), Math.max(a, b) + 1))
    }
    if (e.ctrlKey || e.metaKey) {
      setSel(isSel(s) ? sel.filter(x => !(x.kind === s.kind && x.key === s.key)) : [...sel, s])
    } else {
      setSel([s])
    }
    setAnchor(s.key)
    listRef.current?.focus()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const topFolders = folders.filter(f => !f.parent)
  const treeRow = (f: ExFolder) => {
    const drive = f.depth === 0 ? driveOf(f.path) : undefined
    const on = view.mode === 'folder' && view.path === f.path
    return (
      <button key={f.path} role="treeitem" aria-selected={on} data-testid={`ex-tree-${f.path}`}
        onClick={() => go(f.path)} onDragOver={e => dragOver(e, f.path)} onDragLeave={() => setDropOn(null)}
        onDrop={e => void onDropOn(e, f.path)} title={f.path}
        style={{
          display: 'flex', gap: '0.3rem', alignItems: 'center', width: '100%', textAlign: 'left', border: 'none',
          padding: '0.15rem 0.4rem', paddingLeft: `${0.4 + f.depth * 0.8}rem`, borderRadius: 4, cursor: 'pointer',
          fontSize: '0.76rem', color: on ? '#fff' : 'var(--text-secondary, #aaa)',
          background: on ? 'var(--accent-primary, #3b82f6)' : dropOn === f.path ? 'rgba(59,130,246,0.25)' : 'transparent',
        }}>
        <span aria-hidden>{drive ? (driveIsOpen(drive) ? '🗄' : '🔒') : '📁'}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
        <span style={{ fontSize: '0.62rem', opacity: 0.8 }}>{f.total_count}</span>
      </button>
    )
  }
  const orderedTree = [...folders].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }))

  return (
    <div data-testid="document-explorer" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'var(--text-primary, #eee)' }}
      onKeyDown={onKeys}>
      {/* Address bar + commands */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', padding: '0.5rem 0.75rem', borderBottom: border }}>
        <nav aria-label="Folder path" data-testid="ex-breadcrumbs" style={{ display: 'flex', alignItems: 'center', gap: '0.15rem', flex: 1, minWidth: 0, fontSize: '0.8rem', flexWrap: 'wrap' }}>
          <button onClick={() => go('')} onDragOver={e => dragOver(e, '')} onDragLeave={() => setDropOn(null)}
            onDrop={e => void onDropOn(e, '')} data-testid="ex-crumb-root"
            style={{ ...btn, background: dropOn === '/' ? 'rgba(59,130,246,0.25)' : btn.background }}>
            This workspace
          </button>
          {view.mode === 'trash' && <span style={muted}> / Recycle Bin</span>}
          {view.mode === 'onboarding' && <span style={muted}> / Onboarding</span>}
          {view.mode === 'folder' && breadcrumbs(path).map(c => (
            <span key={c.path} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
              <span style={muted}>/</span>
              <button onClick={() => go(c.path)} onDragOver={e => dragOver(e, c.path)} onDragLeave={() => setDropOn(null)}
                onDrop={e => void onDropOn(e, c.path)} data-testid={`ex-crumb-${c.path}`}
                style={{ ...btn, background: dropOn === c.path ? 'rgba(59,130,246,0.25)' : btn.background }}>{c.label}</button>
            </span>
          ))}
        </nav>
        {view.mode === 'folder' && (<>
          <button style={primaryBtn} data-testid="ex-upload" onClick={() => fileRef.current?.click()} disabled={busy}>Upload</button>
          <input ref={fileRef} type="file" multiple hidden data-testid="ex-file-input"
            onChange={e => { void upload(Array.from(e.target.files || []), path); e.target.value = '' }} />
          <button style={btn} data-testid="ex-new-folder" onClick={() => setNewFolder('')}>New folder</button>
          <button style={btn} data-testid="ex-rename" disabled={sel.length !== 1} onClick={() => startRename(sel[0])}>Rename (F2)</button>
          <button style={btn} data-testid="ex-delete" disabled={!selDocs.length} onClick={() => void trashSelected()}>Delete</button>
          {isAdmin && path && (
            <button style={btn} data-testid="ex-access" onClick={() => setShowAccess(v => !v)}>
              {currentDrive ? 'Drive access' : 'Make a drive'}
            </button>
          )}
        </>)}
        {config.features?.includes('shoebox') && (
          <button style={btn} data-testid="ex-onboarding" onClick={() => { setView({ mode: 'onboarding' }); setSel([]) }}>Onboarding</button>
        )}
        <button style={btn} onClick={() => void refresh()} title="Refresh (F5)">Refresh</button>
      </div>

      {status && (
        <div role={status.bad ? 'alert' : 'status'} data-testid="ex-status"
          style={{ padding: '0.3rem 0.75rem', fontSize: '0.76rem', color: status.bad ? 'var(--accent-coral, #ef4444)' : 'var(--text-secondary, #aaa)' }}>
          {status.text}
        </div>
      )}
      {showAccess && path && isAdmin && (
        <AccessEditor folder={path.split('/')[0]} drive={currentDrive}
          onDone={async msg => { setShowAccess(false); if (msg) say(msg); await refresh() }} />
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Left: drives and folders */}
        <div role="tree" aria-label="Drives and folders" data-testid="ex-tree"
          style={{ width: 220, flexShrink: 0, overflowY: 'auto', padding: '0.5rem', borderRight: border, display: 'grid', gap: '0.05rem', alignContent: 'start' }}>
          <button role="treeitem" aria-selected={view.mode === 'folder' && !path} onClick={() => go('')}
            onDragOver={e => dragOver(e, '')} onDragLeave={() => setDropOn(null)} onDrop={e => void onDropOn(e, '')}
            style={{ display: 'flex', gap: '0.3rem', width: '100%', textAlign: 'left', border: 'none', padding: '0.15rem 0.4rem', borderRadius: 4,
              cursor: 'pointer', fontSize: '0.76rem', color: view.mode === 'folder' && !path ? '#fff' : 'var(--text-secondary, #aaa)',
              background: view.mode === 'folder' && !path ? 'var(--accent-primary, #3b82f6)' : 'transparent' }}>
            <span aria-hidden>🖥</span><span style={{ flex: 1 }}>This workspace</span><span style={{ fontSize: '0.62rem', opacity: 0.8 }}>{docs.length}</span>
          </button>
          {orderedTree.map(treeRow)}
          {topFolders.length === 0 && <div style={{ ...muted, fontSize: '0.72rem', padding: '0.3rem 0.4rem' }}>No folders yet. Use New folder.</div>}
          <button role="treeitem" aria-selected={view.mode === 'trash'} data-testid="ex-trash"
            onClick={() => { setView({ mode: 'trash' }); setSel([]) }}
            style={{ display: 'flex', gap: '0.3rem', width: '100%', textAlign: 'left', border: 'none', marginTop: '0.5rem',
              padding: '0.15rem 0.4rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.76rem',
              color: view.mode === 'trash' ? '#fff' : 'var(--text-secondary, #aaa)',
              background: view.mode === 'trash' ? 'var(--accent-primary, #3b82f6)' : 'transparent' }}>
            <span aria-hidden>🗑</span><span style={{ flex: 1 }}>Recycle Bin</span><span style={{ fontSize: '0.62rem', opacity: 0.8 }}>{trash.length}</span>
          </button>
        </div>

        {/* Middle: the open folder */}
        <div ref={listRef} tabIndex={0} data-testid="ex-list" aria-label="Files" onKeyDown={undefined}
          onDragOver={e => { if (view.mode === 'folder') dragOver(e, path) }} onDragLeave={() => setDropOn(null)}
          onDrop={e => { if (view.mode === 'folder') void onDropOn(e, path) }}
          style={{ flex: 1, minWidth: 0, overflow: 'auto', outline: 'none', padding: '0.4rem 0.6rem',
            background: dropOn === (path || '/') && view.mode === 'folder' ? 'rgba(59,130,246,0.08)' : undefined }}>
          {view.mode === 'onboarding' ? (
            <OnboardingView isAdmin={isAdmin} onOpenDoc={id => {
              const d = docById(id)
              if (!d) { say('That file is no longer available.', true); return }
              setView({ mode: 'folder', path: d.project || '' })
              setTab('pipeline')
              void openFile(id).then(() => setTab('pipeline')).catch(() => say('Could not open that file.', true))
            }} onMessage={m => say(m)} />
          ) : view.mode === 'trash' ? (
            <TrashList items={trash} onRestore={id => void restore(id)} onDelete={i => void deleteForever(i)} />
          ) : (
            <>
              {currentDrive && !currentDrive.chat_scoped && !driveIsOpen(currentDrive) && (
                <div data-testid="ex-chat-scope-note" style={{ ...muted, fontSize: '0.7rem', padding: '0 0 0.4rem' }}>
                  Restricted drive: only the people allowed can open these files here. Assistant chat can still read the whole workspace for now.
                </div>
              )}
              {newFolder !== null && (
                <div style={{ display: 'flex', gap: '0.3rem', padding: '0.2rem 0' }}>
                  <input autoFocus value={newFolder} placeholder="New folder name" data-testid="ex-new-folder-input" style={{ ...input, flex: 1 }}
                    onChange={e => setNewFolder(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void createFolder(newFolder); if (e.key === 'Escape') setNewFolder(null) }} />
                  <button style={btn} onClick={() => void createFolder(newFolder)}>Create</button>
                </div>
              )}
              <div role="row" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 5rem 11rem', gap: '0.5rem', fontSize: '0.68rem', ...muted, padding: '0.15rem 0.4rem', borderBottom: border }}>
                <span>Name</span><span>Type</span><span>Modified</span>
              </div>
              {rows.length === 0 && (
                <div style={{ ...muted, padding: '2rem 0', textAlign: 'center', fontSize: '0.82rem' }} data-testid="ex-empty">
                  This folder is empty. Drop files here, or press Upload.
                </div>
              )}
              {here.folders.map(f => {
                const s: Selection = { kind: 'folder', key: f.path }
                return (
                  <div key={f.path} role="row" draggable data-testid={`ex-row-folder-${f.path}`} aria-selected={isSel(s)}
                    onClick={e => clickRow(e, s)} onDoubleClick={() => go(f.path)}
                    onDragStart={e => onDragStart(e, s)} onDragOver={e => dragOver(e, f.path)} onDragLeave={() => setDropOn(null)}
                    onDrop={e => void onDropOn(e, f.path)} style={rowStyle(isSel(s), dropOn === f.path)}>
                    <span style={nameCell}>
                      <span aria-hidden>{driveOf(f.path) ? (driveIsOpen(driveOf(f.path)!) ? '🗄' : '🔒') : '📁'}</span>
                      {renaming?.kind === 'folder' && renaming.key === f.path
                        ? <RenameBox value={draft} onChange={setDraft} onCommit={() => void commitRename()} onCancel={() => setRenaming(null)} />
                        : <span>{f.name}</span>}
                      <span style={{ ...muted, fontSize: '0.66rem' }}>{f.total_count} item{f.total_count === 1 ? '' : 's'}</span>
                    </span>
                    <span style={muted}>Folder</span><span />
                  </div>
                )
              })}
              {here.docs.map(d => {
                const s: Selection = { kind: 'doc', key: d.id }
                return (
                  <div key={d.id} role="row" draggable data-testid={`ex-row-doc-${d.id}`} aria-selected={isSel(s)}
                    onClick={e => clickRow(e, s)} onDoubleClick={() => void openFile(d.id)}
                    onDragStart={e => onDragStart(e, s)} style={rowStyle(isSel(s), false)}>
                    <span style={nameCell}>
                      <span aria-hidden>📄</span>
                      {renaming?.kind === 'doc' && renaming.key === d.id
                        ? <RenameBox value={draft} onChange={setDraft} onCommit={() => void commitRename()} onCancel={() => setRenaming(null)} />
                        : <span>{d.filename}</span>}
                      {d.chunk_count === 0 && <span title="No searchable text was read from this file" style={{ ...muted, fontSize: '0.66rem' }}>not searchable</span>}
                    </span>
                    <span style={muted}>{fileKind(d.filename)}</span><span style={muted}>{when(d.uploaded_at)}</span>
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Right: the open file */}
        {open && (
          <div data-testid="ex-detail" style={{ width: '42%', minWidth: 300, borderLeft: border, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.6rem', borderBottom: border }}>
              <strong style={{ flex: 1, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{open.filename}</strong>
              {EDITABLE.test(open.filename) && editing === null && (
                <button style={btn} data-testid="ex-edit" onClick={() => setEditing(open.text)}>Edit</button>
              )}
              {editing !== null && (<>
                <button style={primaryBtn} data-testid="ex-save" disabled={busy} onClick={() => void save()}>Save (Ctrl+S)</button>
                <button style={btn} onClick={() => setEditing(null)}>Cancel</button>
              </>)}
              <a style={{ ...btn, textDecoration: 'none' }} href={api(`/api/documents/${open.id}/download`)} download>Download</a>
              <button style={btn} aria-label="Close" onClick={closeFile}>Close</button>
            </div>
            <div role="tablist" style={{ display: 'flex', gap: '0.2rem', padding: '0.3rem 0.6rem' }}>
              {((pipelineOn ? ['preview', 'history', 'memory', 'pipeline'] : ['preview', 'history', 'memory']) as Tab[]).map(t => (
                <button key={t} role="tab" aria-selected={tab === t} data-testid={`ex-tab-${t}`} onClick={() => setTab(t)}
                  style={{ ...btn, background: tab === t ? 'var(--accent-primary, #3b82f6)' : btn.background, color: tab === t ? '#fff' : btn.color }}>
                  {t === 'preview' ? 'Open' : t === 'history' ? 'History' : t === 'memory' ? 'What it remembers' : 'Stages'}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}>
              {tab === 'preview' && (editing !== null ? (
                <textarea data-testid="ex-editor" value={editing} onChange={e => setEditing(e.target.value)}
                  onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save() } }}
                  style={{ ...input, width: '100%', height: '100%', minHeight: 240, fontFamily: 'monospace', resize: 'none' }} />
              ) : open.kind === 'pdf' && blobUrl ? (
                <iframe title={open.filename} src={blobUrl} style={{ width: '100%', height: '100%', minHeight: 360, border: 'none' }} />
              ) : open.kind === 'image' && blobUrl ? (
                <img alt={open.filename} src={blobUrl} style={{ maxWidth: '100%' }} />
              ) : (
                <pre data-testid="ex-text" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>{open.text || 'No readable text in this file.'}</pre>
              ))}
              {tab === 'history' && <HistoryView history={history} onRestoreVersion={v => void restoreVersion(v)} canEdit={EDITABLE.test(open.filename)} />}
              {tab === 'memory' && <MemoryView memory={memory} />}
              {tab === 'pipeline' && <PipelineView pipeline={pipeline} isAdmin={isAdmin} busy={busy}
                onRead={() => void readAsCert()} onDecide={(n, d) => void decide(n, d)} />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

const nameCell: CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }
const rowStyle = (selected: boolean, over: boolean): CSSProperties => ({
  display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 5rem 11rem', gap: '0.5rem', alignItems: 'center',
  padding: '0.2rem 0.4rem', fontSize: '0.8rem', cursor: 'default', userSelect: 'none', borderRadius: 4,
  background: over ? 'rgba(59,130,246,0.25)' : selected ? 'rgba(59,130,246,0.18)' : 'transparent',
  outline: selected ? '1px solid var(--accent-primary, #3b82f6)' : 'none',
})

function RenameBox({ value, onChange, onCommit, onCancel }: {
  value: string; onChange: (v: string) => void; onCommit: () => void; onCancel: () => void
}) {
  return (
    <input autoFocus data-testid="ex-rename-input" value={value} style={{ ...input, flex: 1 }}
      onFocus={e => e.currentTarget.select()} onClick={e => e.stopPropagation()}
      onChange={e => onChange(e.target.value)} onBlur={onCommit}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') onCommit(); if (e.key === 'Escape') onCancel() }} />
  )
}

interface Onboarding {
  stage: string
  dumped: { documents: number; last_dropped_at: string | null; types: Record<string, number> }
  organized: { in_folders: number; not_in_a_folder: number; top_level_folders: string[]; drives: string[]; searchable: number; not_searchable: number }
  awaiting_review: { count: number; items: { doc_id: string; filename: string; next_label: string }[] }
  applications: Record<string, any>[]
  recipes: { id: string; name: string; application: string; runs: number; last_run_at: string | null; auto_approve_clean: boolean }[]
  next_steps: string[]
  not_yet_read_by_a_recipe: number
}
interface Proposal {
  name: string; instruction: string; application: string
  mapping: { from: string; to: string }[]; cleaning: string[]; audits: string[]
}

const STAGE_TEXT: Record<string, string> = {
  empty: 'Waiting for files', organizing: 'Getting organized', reviewing: 'Waiting for your review', live: 'Live in an application',
}

function OnboardingView({ isAdmin, onOpenDoc, onMessage }: {
  isAdmin: boolean; onOpenDoc: (id: string) => void; onMessage: (m: string) => void
}) {
  const [st, setSt] = useState<Onboarding | null>(null)
  const [words, setWords] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [auto, setAuto] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    const r = await call('GET', '/api/shoebox/status')
    if (r.ok) setSt(r.data)
    else setErr(detailOf(r, 'Could not load the onboarding status'))
  }, [])
  useEffect(() => { void load() }, [load])

  const propose = async () => {
    setErr(null)
    const r = await call('POST', '/api/shoebox/recipes/propose', { instruction: words })
    if (!r.ok) return setErr(detailOf(r, 'Could not propose a recipe'))
    setProposal(r.data)
  }
  const approve = async () => {
    const r = await call('POST', '/api/shoebox/recipes', { proposal, auto_approve_clean: auto })
    if (!r.ok) return setErr(detailOf(r, 'Could not save the recipe'))
    setProposal(null); setWords(''); setAuto(false)
    onMessage(`Saved the recipe "${r.data.name}". Run it on your files.`)
    await load()
  }
  const run = async (id: string) => {
    const r = await call('POST', `/api/shoebox/recipes/${id}/run`, {})
    if (!r.ok) return setErr(detailOf(r, 'Could not run the recipe'))
    onMessage(`Read ${r.data.read} file(s); ${r.data.waiting_for_a_person} wait for a person to review.`)
    await load()
  }
  if (!st) return <div style={muted}>{err || 'Loading onboarding status...'}</div>
  const tile = (title: string, big: string, small: string, testid: string) => (
    <div data-testid={testid} style={{ border, borderRadius: 6, padding: '0.5rem 0.7rem', minWidth: 150 }}>
      <div style={{ ...muted, fontSize: '0.68rem' }}>{title}</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 600 }}>{big}</div>
      <div style={{ ...muted, fontSize: '0.7rem' }}>{small}</div>
    </div>
  )
  const cert = st.applications.find(a => a.app === 'CertTrack')
  return (
    <div data-testid="ex-onboarding-view" style={{ fontSize: '0.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginBottom: '0.5rem' }}>
        <strong style={{ fontSize: '0.95rem' }}>Onboarding</strong>
        <span data-testid="ex-stage" style={{ color: STATUS_COLOR[st.stage === 'live' ? 'live' : st.stage === 'reviewing' ? 'needs_review' : 'waiting'] }}>{STAGE_TEXT[st.stage] || st.stage}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.7rem' }}>
        {tile('Dumped', String(st.dumped.documents), Object.entries(st.dumped.types).slice(0, 4).map(([k, v]) => `${v} ${k}`).join(', ') || 'no files yet', 'ex-tile-dumped')}
        {tile('Organized', `${st.organized.in_folders}/${st.dumped.documents}`, `${st.organized.top_level_folders.length} top folder(s), ${st.organized.drives.length} drive(s); ${st.organized.searchable} searchable`, 'ex-tile-organized')}
        {tile('Waiting for review', String(st.awaiting_review.count), 'files at an audit', 'ex-tile-review')}
        {tile('Live in CertTrack', String(cert?.live_files ?? 0), `${cert?.records_confirmed ?? 0} confirmed, ${cert?.records_unconfirmed ?? 0} unconfirmed record(s)`, 'ex-tile-live')}
      </div>
      {st.next_steps.length > 0 && (
        <div data-testid="ex-next-steps" style={{ marginBottom: '0.7rem' }}>
          <strong>What happens next</strong>
          <ul style={{ margin: '0.2rem 0', paddingLeft: '1.1rem' }}>{st.next_steps.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
      {st.awaiting_review.items.length > 0 && (
        <div data-testid="ex-review-list" style={{ marginBottom: '0.7rem' }}>
          <strong>Waiting for you</strong>
          {st.awaiting_review.items.map(i => (
            <div key={i.doc_id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.15rem 0' }}>
              <span style={{ flex: 1 }}>{i.filename}<span style={{ ...muted, fontSize: '0.7rem' }}> - {i.next_label}</span></span>
              <button style={btn} onClick={() => onOpenDoc(i.doc_id)}>Review</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginBottom: '0.7rem' }}>
        <strong>Recipes</strong> <span style={{ ...muted, fontSize: '0.7rem' }}>(what you want done with your data, saved for next time)</span>
        {st.recipes.length === 0 && <div style={muted}>None yet.</div>}
        {st.recipes.map(r => (
          <div key={r.id} data-testid={`ex-recipe-${r.id}`} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.15rem 0' }}>
            <span style={{ flex: 1 }}>{r.name}<span style={{ ...muted, fontSize: '0.7rem' }}> into {r.application}; run {r.runs}x{r.auto_approve_clean ? '; passes a clean gate itself' : ''}</span></span>
            {isAdmin && <button style={btn} data-testid={`ex-run-${r.id}`} onClick={() => void run(r.id)}>Run on new files</button>}
          </div>
        ))}
      </div>
      {isAdmin && (
        <div data-testid="ex-propose" style={{ border, borderRadius: 6, padding: '0.5rem' }}>
          <strong>Tell the agent what to do with your data</strong>
          <div style={{ display: 'flex', gap: '0.4rem', margin: '0.3rem 0' }}>
            <input value={words} onChange={e => setWords(e.target.value)} placeholder="e.g. put the certificates into CertTrack and audit them"
              data-testid="ex-propose-input" style={{ ...input, flex: 1 }} onKeyDown={e => { if (e.key === 'Enter') void propose() }} />
            <button style={primaryBtn} data-testid="ex-propose-go" disabled={!words.trim()} onClick={() => void propose()}>Propose</button>
          </div>
          {err && <div role="alert" style={{ color: 'var(--accent-coral, #ef4444)' }}>{err}</div>}
          {proposal && (
            <div data-testid="ex-proposal">
              <div><strong>{proposal.name}</strong> into {proposal.application}</div>
              <div style={{ ...muted, marginTop: '0.2rem' }}>Fields</div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{proposal.mapping.map((m, i) => <li key={i}>{m.from} becomes {m.to}</li>)}</ul>
              <div style={{ ...muted, marginTop: '0.2rem' }}>Cleaning</div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{proposal.cleaning.map((m, i) => <li key={i}>{m}</li>)}</ul>
              <div style={{ ...muted, marginTop: '0.2rem' }}>Audits</div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{proposal.audits.map((m, i) => <li key={i}>{m}</li>)}</ul>
              <label style={{ display: 'block', margin: '0.3rem 0' }}>
                <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Let the recipe pass an audit that has nothing to flag (it is logged as the recipe's decision)
              </label>
              <button style={primaryBtn} data-testid="ex-proposal-approve" onClick={() => void approve()}>Approve and save</button>
              <button style={{ ...btn, marginLeft: '0.4rem' }} onClick={() => setProposal(null)}>Not this</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TrashList({ items, onRestore, onDelete }: {
  items: TrashItem[]; onRestore: (id: string) => void; onDelete: (i: TrashItem) => void
}) {
  if (!items.length) {
    return <div data-testid="ex-trash-empty" style={{ ...muted, padding: '2rem 0', textAlign: 'center', fontSize: '0.82rem' }}>The Recycle Bin is empty.</div>
  }
  return (
    <div data-testid="ex-trash-list">
      <div style={{ ...muted, fontSize: '0.72rem', padding: '0 0 0.4rem' }}>
        Deleted files wait here. Restore puts a file back in its folder with its history and memory intact.
      </div>
      {items.map(i => (
        <div key={i.id} role="row" data-testid={`ex-trash-${i.id}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0.4rem', fontSize: '0.8rem' }}>
          <span aria-hidden>📄</span>
          <span style={{ flex: 1, minWidth: 0 }}>{i.filename}<span style={{ ...muted, fontSize: '0.68rem' }}> from {i.original_folder || 'the top level'}, {when(i.trashed_at)}</span></span>
          <button style={btn} onClick={() => onRestore(i.id)}>Restore</button>
          <button style={btn} onClick={() => onDelete(i)}>Delete forever</button>
        </div>
      ))}
    </div>
  )
}

function describeEvent(e: HistoryEvent): string {
  switch (e.event) {
    case 'renamed': return `Renamed from "${e.old_filename}" to "${e.new_filename}"`
    case 'moved': return `Moved from ${e.old_folder || 'the top level'} to ${e.new_folder || 'the top level'}`
    case 'edited': return `Edited (saved as version ${e.version})`
    case 'trashed': return 'Moved to the Recycle Bin'
    case 'restored': return 'Restored from the Recycle Bin'
    default: return e.event
  }
}

function HistoryView({ history, onRestoreVersion, canEdit }: {
  history: History | null; onRestoreVersion: (v: number) => void; canEdit: boolean
}) {
  if (!history) return <div style={muted}>Loading history...</div>
  return (
    <div data-testid="ex-history">
      <p style={{ ...muted, marginTop: 0, fontSize: '0.74rem' }}>
        This file keeps one identity. Renaming or moving it changes its labels, never the file, so everything below stays attached.
      </p>
      {(history.former_names.length > 0 || history.former_folders.length > 0) && (
        <p data-testid="ex-former" style={{ fontSize: '0.76rem' }}>
          {history.former_names.length > 0 && <>Used to be called: <strong>{history.former_names.join(', ')}</strong>. </>}
          {history.former_folders.length > 0 && <>Used to live in: <strong>{history.former_folders.join(', ')}</strong>.</>}
        </p>
      )}
      {history.events.length === 0 && <div style={muted}>No renames, moves or edits yet.</div>}
      {history.events.map(e => (
        <div key={e.id} data-testid="ex-event" style={{ padding: '0.2rem 0', borderBottom: border }}>
          <div>{describeEvent(e)}</div>
          <div style={{ ...muted, fontSize: '0.68rem' }}>{when(e.at)}{e.by ? ` by ${e.by}` : ''}</div>
        </div>
      ))}
      {history.versions.length > 0 && (
        <>
          <h4 style={{ fontSize: '0.78rem', margin: '0.8rem 0 0.2rem' }}>Saved versions</h4>
          {history.versions.map(v => (
            <div key={v.version} data-testid={`ex-version-${v.version}`} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.15rem 0' }}>
              <span style={{ flex: 1 }}>Version {v.version}<span style={{ ...muted, fontSize: '0.68rem' }}> {when(v.at)} {v.by ? `by ${v.by}` : ''} {v.summary ? `- ${v.summary}` : ''}</span></span>
              {canEdit && <button style={btn} onClick={() => onRestoreVersion(v.version)}>Load into editor</button>}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

const STATUS_TEXT: Record<string, string> = {
  done: 'Done', live: 'Live', approved: 'Approved', rejected: 'Rejected', needs_review: 'Needs your review',
  waiting: 'Not started', locked: 'Not yet',
}
const STATUS_COLOR: Record<string, string> = {
  done: '#22c55e', live: '#22c55e', approved: '#22c55e', rejected: '#ef4444', needs_review: '#f59e0b',
  waiting: '#f59e0b', locked: '#6b7280',
}

function PipelineView({ pipeline, isAdmin, busy, onRead, onDecide }: {
  pipeline: Pipeline | null; isAdmin: boolean; busy: boolean
  onRead: () => void; onDecide: (n: number, d: 'approved' | 'rejected') => void
}) {
  if (!pipeline) return <div style={muted}>Loading the stages...</div>
  return (
    <div data-testid="ex-pipeline">
      <p style={{ ...muted, marginTop: 0, fontSize: '0.74rem' }}>
        Feed, then three audits a person signs, then the data and the application. Nothing moves on until the audit before it is approved.
      </p>
      {pipeline.stages.map((st, i) => {
        const n = st.id === 'audit1' ? 1 : st.id === 'audit2' ? 2 : st.id === 'audit3' ? 3 : 0
        return (
          <div key={st.id} data-testid={`ex-stage-${st.id}`} data-status={st.status}
            style={{ borderLeft: `3px solid ${STATUS_COLOR[st.status] || '#6b7280'}`, padding: '0.2rem 0.6rem', margin: '0 0 0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
              <strong style={{ fontSize: '0.8rem' }}>{i + 1}. {st.label}</strong>
              <span style={{ fontSize: '0.68rem', color: STATUS_COLOR[st.status] }}>{STATUS_TEXT[st.status] || st.status}</span>
            </div>
            <div style={{ ...muted, fontSize: '0.72rem' }}>{st.detail}</div>
            {st.id === 'audit1' && st.status === 'waiting' && (
              <button style={{ ...btn, marginTop: '0.3rem' }} data-testid="ex-read-cert" disabled={busy} onClick={onRead}>Read as a certificate</button>
            )}
            {st.id === 'audit1' && st.entries && st.entries.length > 0 && (
              <table style={{ fontSize: '0.72rem', marginTop: '0.3rem', borderCollapse: 'collapse' }}>
                <tbody>
                  {st.entries.map(e => (
                    <tr key={e.id}><td style={{ paddingRight: '0.6rem' }}>{e.cert_name}</td><td style={{ paddingRight: '0.6rem' }}>{e.number || 'no number'}</td>
                      <td style={{ paddingRight: '0.6rem' }}>{e.expires ? `expires ${e.expires}` : 'no expiry'}</td><td style={muted}>{e.status}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {st.id === 'audit2' && st.checks && st.checks.length > 0 && (
              <ul style={{ fontSize: '0.72rem', margin: '0.3rem 0 0', paddingLeft: '1.1rem' }}>
                {st.checks.map((c, k) => <li key={k}>{c.detail}</li>)}
              </ul>
            )}
            {st.id === 'useful' && st.summary && st.summary.alerts.length > 0 && (
              <ul style={{ fontSize: '0.72rem', margin: '0.3rem 0 0', paddingLeft: '1.1rem' }}>
                {st.summary.alerts.map((a, k) => <li key={k}>{a.cert}: {a.state === 'expired' ? 'expired' : 'expires'} {a.expires}</li>)}
                <li style={muted}>{st.summary.reminders}</li>
              </ul>
            )}
            {n > 0 && st.status === 'needs_review' && (
              isAdmin ? (
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.3rem' }}>
                  <button style={primaryBtn} data-testid={`ex-approve-${n}`} disabled={busy} onClick={() => onDecide(n, 'approved')}>Approve</button>
                  <button style={btn} data-testid={`ex-reject-${n}`} disabled={busy} onClick={() => onDecide(n, 'rejected')}>Reject</button>
                </div>
              ) : <div style={{ ...muted, fontSize: '0.7rem', marginTop: '0.3rem' }}>An administrator approves this step.</div>
            )}
          </div>
        )
      })}
      {pipeline.log.length > 0 && (
        <div data-testid="ex-pipeline-log" style={{ fontSize: '0.7rem', ...muted }}>
          <strong>Audit log</strong>
          {pipeline.log.map((l, i) => (
            <div key={i}>Audit {l.audit} {l.decision} by {l.by} {when(l.at)}{l.note ? `: ${l.note}` : ''}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function MemoryView({ memory }: { memory: Memory | null }) {
  if (!memory) return <div style={muted}>Checking what the system holds for this file...</div>
  const s = memory.search
  const r = memory.records
  return (
    <div data-testid="ex-memory">
      <p style={{ ...muted, marginTop: 0, fontSize: '0.74rem' }}>
        Read live from the search index and the records that cite this file by its id, not from its name or folder.
      </p>
      {s.error ? <div role="alert">{s.error}</div> : (
        <div data-testid="ex-memory-search">
          Search passages: <strong>{s.chunks}</strong> {s.in_sync ? '- labelled with the current name and folder' : '- labels are out of date (re-index fixes it)'}
        </div>
      )}
      <ul style={{ paddingLeft: '1.1rem' }}>
        <li>Staff rows from this file: {r.staff_rows}</li>
        <li>Project rows from this file: {r.project_rows}</li>
        <li>CertTrack entries from this file: {r.certtrack_entries}</li>
        <li>Chat answers that read this file whole: {r.chat_turns_that_read_it}</li>
      </ul>
    </div>
  )
}

function AccessEditor({ folder, drive, onDone }: {
  folder: string; drive: ExDrive | undefined; onDone: (message?: string) => void | Promise<void>
}) {
  const preset = !drive ? 'everyone' : driveIsOpen(drive) ? 'everyone' : drive.read_roles.length === 0 && drive.user_ids.length === 0 ? 'admins' : 'custom'
  const [who, setWho] = useState<'everyone' | 'admins' | 'people'>(preset === 'admins' ? 'admins' : preset === 'custom' ? 'people' : 'everyone')
  const [people, setPeople] = useState((drive?.user_ids || []).join(', '))
  const [err, setErr] = useState<string | null>(null)
  const apply = async () => {
    const body = {
      read_roles: who === 'everyone' ? ['admin', 'member', 'viewer'] : [],
      write_roles: who === 'everyone' ? ['admin', 'member'] : [],
      user_ids: who === 'people' ? people.split(',').map(s => s.trim()).filter(Boolean) : [],
    }
    const r = drive
      ? await call('PATCH', `/api/documents/drives/${drive.id}`, body)
      : await call('POST', '/api/documents/drives', { name: folder, ...body })
    if (!r.ok) return setErr(detailOf(r, 'Could not save access'))
    await onDone(`${folder} drive: ${who === 'everyone' ? 'open to the workspace' : who === 'admins' ? 'administrators only' : 'named people only'}`)
  }
  const remove = async () => {
    if (!drive) return
    const r = await call('DELETE', `/api/documents/drives/${drive.id}`)
    if (!r.ok) return setErr(detailOf(r, 'Could not remove the drive'))
    await onDone(`${folder} is a plain folder again (its files stay)`)
  }
  return (
    <div data-testid="ex-access-editor" style={{ margin: '0 0.75rem 0.4rem', padding: '0.5rem', border, borderRadius: 6, fontSize: '0.78rem' }}>
      <strong>{drive ? `Who can open the ${folder} drive` : `Make "${folder}" a drive`}</strong>
      <div style={{ display: 'flex', gap: '0.8rem', margin: '0.4rem 0', flexWrap: 'wrap' }}>
        {([['everyone', 'Everyone in the workspace'], ['admins', 'Administrators only'], ['people', 'Named people only']] as const).map(([v, label]) => (
          <label key={v}><input type="radio" name="ex-who" checked={who === v} onChange={() => setWho(v)} /> {label}</label>
        ))}
      </div>
      {who === 'people' && (
        <input value={people} onChange={e => setPeople(e.target.value)} placeholder="User ids, separated by commas" style={{ ...input, width: '100%', marginBottom: '0.4rem' }} />
      )}
      {err && <div role="alert" style={{ color: 'var(--accent-coral, #ef4444)' }}>{err}</div>}
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <button style={primaryBtn} data-testid="ex-access-save" onClick={() => void apply()}>Save</button>
        {drive && <button style={btn} onClick={() => void remove()}>Make it a plain folder</button>}
        <button style={btn} onClick={() => void onDone()}>Cancel</button>
      </div>
    </div>
  )
}
