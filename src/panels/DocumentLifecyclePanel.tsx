'use client'

import { useCallback, useEffect, useState } from 'react'

// ---------- Types ----------

interface DocVersion {
  id: string
  doc_id: string
  version_num: number
  content_hash: string
  byte_size: number
  changed_by: string
  changed_by_type: string
  change_summary: string | null
  source: string
  created_at: string
  chunk_count: number
  embedding_status: string
}

interface DocEvent {
  id: string
  doc_id: string
  event_type: string
  actor_id: string
  actor_type: string
  version_id: string | null
  target_id: string | null
  target_type: string | null
  diff_summary: string | null
  metadata: Record<string, any>
  created_at: string
}

interface DocLink {
  id: string
  doc_id: string
  target_id: string
  target_type: string
  link_type: string
  created_by: string
  created_at: string
  metadata: Record<string, any>
}

interface DiffResult {
  doc_id: string
  from_version: number
  to_version: number
  unified_diff: string
  additions: number
  deletions: number
  changed_by: string
  change_summary: string
}

interface TimelineEntry {
  timestamp: string
  event_type: string
  actor_id: string
  actor_type: string
  summary: string
  version_num: number | null
  target_id: string | null
  target_type: string | null
}

interface Props {
  apiBase?: string
  docId?: string
}

// ---------- Helpers ----------

const EVENT_ICONS: Record<string, string> = {
  created: 'plus-circle',
  edited: 'pencil',
  viewed: 'eye',
  shared: 'share-2',
  exported: 'download',
  imported: 'upload',
  re_ingested: 'refresh-cw',
  linked: 'link',
  unlinked: 'unlink',
  deleted: 'trash-2',
  commented: 'message-circle',
  tagged: 'tag',
  synced: 'cloud',
  archived: 'archive',
  restored: 'undo',
  permission_changed: 'shield',
  embedded: 'cpu',
  chunked: 'layers',
}

const LINK_COLORS: Record<string, string> = {
  person: 'text-blue-400',
  task: 'text-amber-400',
  conversation: 'text-green-400',
  email: 'text-purple-400',
  document: 'text-cyan-400',
  decision: 'text-red-400',
  agent: 'text-pink-400',
  workspace: 'text-gray-400',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// ---------- Components ----------

function DiffViewer({ diff }: { diff: DiffResult }) {
  const lines = diff.unified_diff.split('\n')
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-neutral-400">
        <span>v{diff.from_version} → v{diff.to_version}</span>
        <span className="text-green-400">+{diff.additions}</span>
        <span className="text-red-400">-{diff.deletions}</span>
        <span>by {diff.changed_by}</span>
      </div>
      {diff.change_summary && (
        <p className="text-sm text-neutral-300 italic">{diff.change_summary}</p>
      )}
      <pre className="max-h-96 overflow-auto rounded border border-neutral-700 bg-neutral-900 p-3 text-xs font-mono">
        {lines.map((line, i) => {
          let cls = 'text-neutral-400'
          if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-green-400'
          else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-red-400'
          else if (line.startsWith('@@')) cls = 'text-cyan-400'
          return (
            <div key={i} className={cls}>
              {line || ' '}
            </div>
          )
        })}
      </pre>
    </div>
  )
}

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <div className="space-y-1">
      {entries.map((e, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded px-3 py-2 hover:bg-neutral-800/50"
        >
          <div className="mt-1 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-neutral-200 capitalize">
                {e.event_type.replace('_', ' ')}
              </span>
              {e.version_num && (
                <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-neutral-400">
                  v{e.version_num}
                </span>
              )}
              <span className="text-neutral-500">{timeAgo(e.timestamp)}</span>
            </div>
            <p className="text-xs text-neutral-400 truncate">{e.summary}</p>
            <div className="flex gap-2 text-xs text-neutral-500 mt-0.5">
              <span>{e.actor_type === 'agent' ? '🤖' : '👤'} {e.actor_id}</span>
              {e.target_type && (
                <span className={LINK_COLORS[e.target_type] || 'text-neutral-400'}>
                  → {e.target_type}:{e.target_id}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function VersionList({
  versions,
  onSelectDiff,
}: {
  versions: DocVersion[]
  onSelectDiff: (from: number, to: number) => void
}) {
  return (
    <div className="space-y-1">
      {versions.map((v, i) => (
        <div
          key={v.id}
          className="flex items-center gap-3 rounded px-3 py-2 hover:bg-neutral-800/50"
        >
          <span className="font-mono text-xs text-neutral-500 w-8">v{v.version_num}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-neutral-200 truncate">
              {v.change_summary || `Version ${v.version_num}`}
            </p>
            <div className="flex gap-2 text-xs text-neutral-500">
              <span>{v.changed_by_type === 'agent' ? '🤖' : '👤'} {v.changed_by}</span>
              <span>{timeAgo(v.created_at)}</span>
              <span>{(v.byte_size / 1024).toFixed(1)}KB</span>
              <span className={
                v.embedding_status === 'indexed' ? 'text-green-500' :
                v.embedding_status === 'failed' ? 'text-red-500' : 'text-yellow-500'
              }>
                {v.embedding_status}
              </span>
            </div>
          </div>
          {i < versions.length - 1 && (
            <button
              onClick={() => onSelectDiff(versions[i + 1].version_num, v.version_num)}
              className="text-xs rounded bg-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-600"
            >
              Diff
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function LinksList({ links }: { links: DocLink[] }) {
  return (
    <div className="space-y-1">
      {links.length === 0 && (
        <p className="text-sm text-neutral-500 p-3">No relationships yet</p>
      )}
      {links.map((lnk) => (
        <div
          key={lnk.id}
          className="flex items-center gap-3 rounded px-3 py-2 hover:bg-neutral-800/50"
        >
          <span className={`text-sm ${LINK_COLORS[lnk.target_type] || ''}`}>
            {lnk.target_type}
          </span>
          <span className="text-sm text-neutral-200 truncate flex-1">
            {lnk.target_id}
          </span>
          <span className="text-xs rounded bg-neutral-700 px-2 py-0.5 text-neutral-400">
            {lnk.link_type}
          </span>
          <span className="text-xs text-neutral-500">{timeAgo(lnk.created_at)}</span>
        </div>
      ))}
    </div>
  )
}

// ---------- Main Panel ----------

type Tab = 'timeline' | 'versions' | 'diff' | 'links'

export default function DocumentLifecyclePanel({ apiBase = '', docId: initialDocId }: Props) {
  const [tab, setTab] = useState<Tab>('timeline')
  const [docId, setDocId] = useState(initialDocId || '')
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [versions, setVersions] = useState<DocVersion[]>([])
  const [links, setLinks] = useState<DocLink[]>([])
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(false)

  const base = `${apiBase}/api/documents/lifecycle`

  const loadData = useCallback(async () => {
    if (!docId) return
    setLoading(true)
    try {
      const [tRes, vRes, lRes] = await Promise.all([
        fetch(`${base}/${docId}/timeline`),
        fetch(`${base}/${docId}/versions`),
        fetch(`${base}/${docId}/links`),
      ])
      if (tRes.ok) setTimeline(await tRes.json())
      if (vRes.ok) setVersions(await vRes.json())
      if (lRes.ok) setLinks(await lRes.json())
    } catch { /* ignore */ }
    setLoading(false)
  }, [docId, base])

  useEffect(() => { loadData() }, [loadData])

  const handleDiff = async (from: number, to: number) => {
    try {
      const res = await fetch(`${base}/${docId}/diff?from=${from}&to=${to}`)
      if (res.ok) {
        setDiff(await res.json())
        setTab('diff')
      }
    } catch { /* ignore */ }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'timeline', label: 'Timeline' },
    { id: 'versions', label: `Versions (${versions.length})` },
    { id: 'diff', label: 'Diff' },
    { id: 'links', label: `Links (${links.length})` },
  ]

  return (
    <div className="flex h-full flex-col bg-neutral-900 text-neutral-100">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
        <h2 className="font-semibold text-sm">Document Lifecycle</h2>
        <input
          type="text"
          value={docId}
          onChange={(e) => setDocId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && loadData()}
          placeholder="Document ID..."
          className="flex-1 rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 border border-neutral-700 focus:border-blue-500 outline-none"
        />
        <button
          onClick={loadData}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium hover:bg-blue-500"
        >
          Load
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              tab === t.id
                ? 'border-b-2 border-blue-500 text-blue-400'
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && <p className="text-sm text-neutral-500">Loading...</p>}

        {!loading && !docId && (
          <p className="text-sm text-neutral-500">Enter a document ID to view its lifecycle.</p>
        )}

        {!loading && docId && tab === 'timeline' && (
          <Timeline entries={timeline} />
        )}

        {!loading && docId && tab === 'versions' && (
          <VersionList versions={versions} onSelectDiff={handleDiff} />
        )}

        {!loading && docId && tab === 'diff' && (
          diff ? <DiffViewer diff={diff} /> : (
            <p className="text-sm text-neutral-500">
              Select two versions to compare, or click "Diff" next to a version.
            </p>
          )
        )}

        {!loading && docId && tab === 'links' && (
          <LinksList links={links} />
        )}
      </div>
    </div>
  )
}
