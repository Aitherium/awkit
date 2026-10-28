'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { getApiBase } from '../lib/apiBase'
import { uploadChunked } from '../lib/chunkedUpload'
import { expandZipUpload } from '../lib/zipExpand'
import { useConfig } from '../hooks/useConfig'
import { InFlightUploadRow, mergeLive, type InFlightUpload, type LiveUpload } from './InFlightUploads'

/**
 * Per-file and per-request ceiling. Uploads reach tenant backends through
 * Cloudflare, which refuses request bodies over 100 MB on Free/Pro, so anything
 * near that dies as an opaque network error. 90 MB leaves room for multipart
 * overhead; batches are split so no single POST exceeds it either.
 */
export const MAX_UPLOAD_BYTES = 90 * 1024 * 1024
const MB = 1024 * 1024

/**
 * Per-file limits for this backend. One that advertises `chunked_upload`
 * (/api/config/embed `features`) takes files past MAX_UPLOAD_BYTES as 32 MB
 * verified, resumable pieces up to its `max_upload_mb` (a customer's 6 GB
 * animations and zips); any other backend keeps the single-request cap.
 */
export function uploadLimits(config: {
  features?: readonly string[]; loaded?: boolean; max_upload_mb?: number; upload_single_max_mb?: number
}) {
  const chunked = !!config.loaded && !!config.features?.includes('chunked_upload')
  const single = Math.min(MAX_UPLOAD_BYTES, (config.upload_single_max_mb || 90) * MB)
  const perFile = chunked ? Math.max(single, (config.max_upload_mb || 2048) * MB) : single
  return { chunked, single, perFile }
}

export type UploadResultStatus = 'done' | 'warning' | 'error' | 'rejected' | 'skipped'

export interface UploadResult {
  filename: string
  status: UploadResultStatus
  detail: string
  /** A same-name document exists (409): the row offers Replace / Keep both. */
  duplicate?: boolean
}

/** How /upload resolves a same-name document (backend `on_duplicate`). */
export type DuplicateChoice = 'replace' | 'keep_both'

const fileExt = (name: string) => {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

/** Video/audio take minutes to transcribe and caption: they go through the
 *  batch job (returns at once, then polled with per-step progress) instead of
 *  holding one /upload request open past the tunnel's timeout. */
const MEDIA_EXTS = new Set([
  '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus',
])
export const isMediaUpload = (name: string) => MEDIA_EXTS.has(fileExt(name))

/** Over this, or any PDF (it may be a scan read page by page by the vision
 *  model), a single upload asks for `background` ingest: 202 + a job id. */
const BACKGROUND_INGEST_BYTES = 5 * 1024 * 1024

/**
 * Which document features this backend advertises in /api/config/embed
 * `features`. Projects and Replace / Keep both are host-app routes; another
 * tenant's backend would drop the project and answer Replace with the same 409.
 * `document_edit` = PATCH /api/documents/{id} + POST /api/documents/bulk (move
 * between projects, tags); without it the panel offers neither.
 */
export function documentFeatures(features: readonly string[] | undefined, loaded = true) {
  const has = (f: string) => loaded && !!features?.includes(f)
  return {
    projects: has('document_projects'), versions: has('document_versions'), edit: has('document_edit'),
    // The upload routes take archive=<zip name>: the panel may unpack a .zip
    // in the browser and send its members one by one (lib/zipExpand.ts).
    zipExpand: has('browser_zip_expand'),
  }
}

/** An unpacked zip member over this goes up in resumable 32 MB pieces (a
 *  dropped connection then re-sends one piece, not the whole member). */
const MEMBER_CHUNKED_BYTES = 32 * MB

/** How the panel sends one file: ``archive`` = the zip a browser-unpacked
 *  member came out of; ``onLanded`` = its bytes are on the server (it may still
 *  be indexing); ``quiet`` = do not take over the single batch-job card. */
interface SendOptions { archive?: string; onLanded?: () => void; quiet?: boolean }

/** Where the chosen upload project is remembered (per backend), so the next
 *  upload -- after a reload, or with the window closed and reopened -- goes to
 *  the same project instead of silently to none. */
export const uploadProjectKey = (base: string) => `awkit.documents.uploadProject:${base || 'same-origin'}`

function readStoredProject(): string {
  try {
    return (typeof window !== 'undefined' && window.localStorage?.getItem(uploadProjectKey(getApiBase()))) || ''
  } catch { return '' }
}

function storeProject(project: string) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    const key = uploadProjectKey(getApiBase())
    if (project) window.localStorage.setItem(key, project)
    else window.localStorage.removeItem(key)
  } catch { /* private mode: the choice lasts this session only */ }
}

/** A project or tag name as the backend stores it: whitespace collapsed, capped. */
export const cleanLabel = (v: string, max = 120) => v.split(/\s+/).filter(Boolean).join(' ').slice(0, max)

/** Longest folder path the backend stores (documents.MAX_PROJECT_LEN). */
const MAX_FOLDER_PATH = 240

/** A folder path as the backend stores it: each "/" segment whitespace-collapsed,
 *  empty segments dropped (" A / /B " -> "A/B"). A name without "/" is cleanLabel's. */
export const cleanFolderPath = (v: string) =>
  v.split('/').map(s => cleanLabel(s, MAX_FOLDER_PATH)).filter(Boolean).join('/').slice(0, MAX_FOLDER_PATH).replace(/[/ ]+$/, '')

/** One folder of GET /api/documents/folders (document_folders backends). */
export interface FolderInfo {
  path: string
  name: string
  parent: string | null
  depth: number
  /** Documents directly inside; total_count includes every subfolder. */
  doc_count: number
  total_count: number
}

/** The folder a path sits in ("" at the top). */
export const parentFolder = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** True when ``project`` is ``folder`` or inside it. */
export const inFolder = (project: string | null | undefined, folder: string) =>
  !!project && (project === folder || project.startsWith(`${folder}/`))

/** Ask a versions-capable backend to ingest in the background (202 + job). */
export const wantsBackgroundIngest = (file: File) =>
  isMediaUpload(file.name) || fileExt(file.name) === '.pdf' || file.size > BACKGROUND_INGEST_BYTES

const formatMb = (bytes: number) => (bytes >= 1024 * MB
  ? `${(bytes / (1024 * MB)).toFixed(bytes % (1024 * MB) === 0 ? 0 : 1)} GB`
  : `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`)

/** Normalise the backend's accepted_types (".PDF", "pdf") to lowercase ".pdf". */
export function normaliseAcceptedTypes(types: readonly string[] | undefined): string[] {
  return Array.from(new Set((types || [])
    .map(t => String(t).trim().toLowerCase())
    .filter(Boolean)
    .map(t => (t.startsWith('.') ? t : `.${t}`))))
}

/** What the panel offered before accepted_types was wired in; used whenever the
 *  backend's list cannot be trusted as file extensions. */
export const LEGACY_ACCEPTED_TYPES = ['.pdf', '.docx', '.doc', '.txt', '.xlsx', '.xls', '.md', '.csv', '.zip', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.srt']
const LEGACY_HINT = 'PDF, DOCX, TXT, XLSX, MD, CSV, images, or ZIP archives'

/** useConfig's DEFAULT_CONFIG.accepted_types: what the hook reports when
 *  /api/config/embed did not answer, so it says nothing about this backend. */
const HOOK_DEFAULT_TYPES = ['.pdf', '.docx', '.doc', '.xlsx', '.txt']

/**
 * Real file extensions. The shared awkit-backend builds accepted_types from pack
 * doc_types ids (".document", ".pricing", ".contract"), which are categories, not
 * extensions; one such entry means the list is not an upload allowlist.
 */
const KNOWN_FILE_EXTS = new Set([
  '.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt', '.md', '.markdown', '.html', '.htm',
  '.xls', '.xlsx', '.ods', '.csv', '.tsv', '.ppt', '.pptx', '.odp', '.json', '.xml',
  '.yaml', '.yml', '.log', '.eml', '.msg', '.epub', '.zip', '.srt',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.svg',
  // Video/audio: a backend with media ingest advertises them; without these an
  // allowlist containing ".mp4" was not enforced and the picker fell back to
  // the legacy list, which cannot select a video at all.
  ...MEDIA_EXTS,
])

/**
 * Decide whether the backend's accepted_types is an allowlist the panel may
 * enforce. Enforced only when the config actually loaded from the backend and
 * every entry is a real file extension; otherwise the legacy list drives the
 * picker and drag-and-drop is not filtered by type (the server still decides).
 */
export function resolveAcceptedTypes(types: readonly string[] | undefined, loaded = true): { types: string[]; enforced: boolean } {
  const norm = normaliseAcceptedTypes(types)
  const isHookDefault = norm.length === HOOK_DEFAULT_TYPES.length && norm.every((t, i) => t === HOOK_DEFAULT_TYPES[i])
  const enforced = loaded && norm.length > 0 && !isHookDefault && norm.every(t => KNOWN_FILE_EXTS.has(t))
  return enforced ? { types: norm, enforced } : { types: LEGACY_ACCEPTED_TYPES, enforced }
}

/**
 * Client-side gate. Drag-and-drop ignores the input's `accept`, so without this a
 * PSD or MP4 goes to the server and comes back as garbage or a tunnel error.
 */
export function partitionUploads(files: File[], accepted: string[], maxBytes = MAX_UPLOAD_BYTES) {
  const ok: File[] = []
  const rejected: UploadResult[] = []
  const listed = accepted.map(t => t.slice(1).toUpperCase()).join(', ')
  for (const f of files) {
    const ext = fileExt(f.name)
    if (accepted.length > 0 && !accepted.includes(ext)) {
      rejected.push({
        filename: f.name, status: 'rejected',
        detail: `${ext ? ext.slice(1).toUpperCase() : 'This file type'} is not supported. Accepted: ${listed}`,
      })
    } else if (f.size > maxBytes) {
      rejected.push({
        filename: f.name, status: 'rejected',
        detail: `File is ${formatMb(f.size)}; the upload limit is ${formatMb(maxBytes)}`,
      })
    } else {
      ok.push(f)
    }
  }
  return { ok, rejected }
}

/** Split files into groups whose combined size stays under the request cap. */
export function splitBatches(files: File[], maxBytes = MAX_UPLOAD_BYTES): File[][] {
  const groups: File[][] = []
  let cur: File[] = []
  let size = 0
  for (const f of files) {
    if (cur.length > 0 && size + f.size > maxBytes) {
      groups.push(cur)
      cur = []
      size = 0
    }
    cur.push(f)
    size += f.size
  }
  if (cur.length > 0) groups.push(cur)
  return groups
}

const errorDetail = async (resp: Response, fallback: string) => {
  const err = await resp.json().catch(() => ({} as Record<string, unknown>))
  const detail = (err as { detail?: unknown }).detail
  if (typeof detail === 'string' && detail) return detail
  if (detail) return JSON.stringify(detail)
  return `${fallback} (${resp.status})`
}

const ZERO_CHUNK_DETAIL = '0 chunks: no searchable text was extracted, so chat cannot use this file'

interface Doc {
  id: string
  filename: string
  doc_type: string
  uploaded_at: string | null
  chunk_count: number
  /** Production/project tag set at upload, on backends that advertise document_projects. */
  project?: string | null
  /** Free tags (document_edit backends). */
  tags?: string[]
}

/** Distinct project tags in the list, sorted, for the filter chips. */
export function projectsOf(docs: readonly { project?: string | null }[]): string[] {
  return Array.from(new Set(docs.map(d => d.project).filter((p): p is string => !!p))).sort()
}

/** Distinct tags in the list, case-insensitively unique and sorted, for the tag chips. */
export function tagsOf(docs: readonly { tags?: string[] | null }[]): string[] {
  const seen = new Map<string, string>()
  for (const d of docs) {
    for (const t of d.tags || []) if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

const NEW_PROJECT = '__new__'

interface DocChunk {
  text: string
  metadata?: Record<string, any>
}

interface DocContent {
  id: string
  filename: string
  doc_type: string
  text: string
  chunk_count: number
  /** 'image': the viewer shows the picture from preview_url. 'pdf': the PDF
   *  itself, in the app (served inline), instead of a hand-off to Adobe/Bluebeam. */
  kind?: string
  /** For an image: false when only its file name is indexed (no vision description yet). */
  described?: boolean
  preview_url?: string
}

interface FileProgress {
  filename: string
  status: string
  chunks: number
  error?: string
  /** Live step while the file is read, e.g. "reading scanned pages 12/40". */
  progress?: string | null
  /** Keep both: the name it was stored under. */
  saved_as?: string | null
  /** Replace: the version it retired. */
  replaced_doc_id?: string | null
}

interface BatchJob {
  job_id: string
  status: string
  total_files: number
  processed_files: number
  skipped_duplicates: number
  total_chunks: number
  files: FileProgress[]
}

type ViewMode = 'content' | 'chunks'

export default function DocumentPanel() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const [batchJob, setBatchJob] = useState<BatchJob | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [viewDoc, setViewDoc] = useState<Doc | null>(null)
  const [docContent, setDocContent] = useState<DocContent | null>(null)
  const [chunks, setChunks] = useState<DocChunk[]>([])
  const [loadingViewer, setLoadingViewer] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('content')
  const [dragOver, setDragOver] = useState(false)
  const [results, setResults] = useState<UploadResult[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [viewerError, setViewerError] = useState<string | null>(null)
  // The upload target. Remembered per backend: before this it lived only in
  // component state, so reopening the window or reloading sent every later
  // upload to no project while the list still showed the project's chip.
  const [project, setProjectState] = useState(readStoredProject)
  const [newProjectMode, setNewProjectMode] = useState(false)
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Big uploads not yet documents (GET /api/documents/uploads), and the one this
  // tab is sending right now. Before these the list showed nothing for the 20+
  // minutes a 6 GB zip takes (customer report 2026-10-22).
  const [inFlight, setInFlight] = useState<InFlightUpload[]>([])
  const inFlightRef = useRef<InFlightUpload[]>([])
  inFlightRef.current = inFlight
  // This tab's own chunked uploads in flight (more than one while a zip's
  // members are sent from the browser), keyed so each updates its own row.
  const [liveUploads, setLiveUploads] = useState<(LiveUpload & { key: number })[]>([])
  const liveKey = useRef(0)
  const [dismissedUploads, setDismissedUploads] = useState<Set<string>>(() => new Set())
  // Files whose upload hit a same-name 409, kept so Replace / Keep both can resend.
  const pendingDupes = useRef(new Map<string, File>())
  // ... and the zip such a file came out of, so Replace / Keep both keeps its provenance.
  const dupeArchives = useRef(new Map<string, string>())
  const projectRef = useRef('')
  projectRef.current = cleanFolderPath(project)
  const setProject = (value: string) => {
    setProjectState(value)
    storeProject(cleanFolderPath(value))
  }
  // Folder tree (document_folders backends): nested project paths + empty folders.
  const [folders, setFolders] = useState<FolderInfo[]>([])

  // The accept list and hint come from the backend's /api/config/embed when it is
  // a real extension allowlist (a pack that publishes it); other tenants keep the legacy list and
  // only the size cap is checked on the client.
  const config = useConfig()
  const { types: accepted, enforced } = resolveAcceptedTypes(config.accepted_types, config.loaded)
  const acceptedRef = useRef<string[]>([])
  acceptedRef.current = enforced ? accepted : []
  const acceptedLabel = enforced ? accepted.map(t => t.slice(1).toUpperCase()).join(', ') : LEGACY_HINT
  const supports = documentFeatures(config.features, config.loaded)
  const supportsRef = useRef(supports)
  supportsRef.current = supports
  // Kept out of documentFeatures (its shape is pinned by other tests): the folder
  // tree, nested paths, folder rename / tag / delete (/api/documents/folders).
  const foldersOn = config.loaded && !!config.features?.includes('document_folders')
  const limits = uploadLimits(config)
  const limitsRef = useRef(limits)
  limitsRef.current = limits

  const addResults = (more: UploadResult[]) => setResults(prev => [...prev, ...more])

  // Revoke the previous picture's object URL whenever it changes or the panel closes.
  useEffect(() => () => {
    if (previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  /** Fetch an image's preview through fetch (it carries the session's auth;
   *  a bare <img src> would not) and show it as an object URL. */
  const viewIdRef = useRef<string | null>(null)
  viewIdRef.current = viewDoc?.id ?? null
  const loadPreview = async (path: string, docId: string) => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return
    try {
      const r = await fetch(`${getApiBase()}${path}`)
      if (!r.ok) return
      const blob = await r.blob()
      // The user may have opened another document while this one loaded.
      if (viewIdRef.current === docId) setPreviewUrl(URL.createObjectURL(blob))
    } catch { /* the viewer still shows the status line */ }
  }

  const closeViewer = () => {
    setViewDoc(null)
    setDocContent(null)
    setChunks([])
    setPreviewUrl(null)
  }

  const openDoc = async (doc: Doc, reload = false) => {
    if (!reload && viewDoc?.id === doc.id) { closeViewer(); return }
    setViewDoc(doc)
    setDocContent(null)
    setChunks([])
    setPreviewUrl(null)
    setViewerError(null)
    setLoadingViewer(true)
    setViewMode('content')

    const base = getApiBase()
    const get = async (path: string) => {
      const r = await fetch(`${base}/api/documents/${doc.id}/${path}`)
      if (!r.ok) throw new Error(await errorDetail(r, `Could not load ${path}`))
      return r.json()
    }
    // Fetch content and chunks in parallel
    const [contentRes, chunksRes] = await Promise.allSettled([get('content'), get('chunks')])

    if (contentRes.status === 'fulfilled' && contentRes.value) {
      setDocContent(contentRes.value)
      const kind = contentRes.value.kind
      if ((kind === 'image' || kind === 'pdf') && contentRes.value.preview_url) {
        viewIdRef.current = doc.id
        loadPreview(contentRes.value.preview_url, doc.id)
      }
    }
    if (chunksRes.status === 'fulfilled' && chunksRes.value) {
      setChunks(chunksRes.value.chunks || chunksRes.value || [])
    }

    // If no content endpoint, fall back to reassembled chunks
    if (contentRes.status !== 'fulfilled' || !contentRes.value) {
      setViewMode('chunks')
    }
    if (contentRes.status === 'rejected' && chunksRes.status === 'rejected') {
      setViewerError(String((contentRes.reason as Error)?.message || contentRes.reason))
    }

    setLoadingViewer(false)
  }

  const fetchDocs = () => {
    fetch(`${getApiBase()}/api/documents`)
      .then(async r => {
        if (!r.ok) throw new Error(await errorDetail(r, 'Could not load documents'))
        return r.json()
      })
      .then(data => {
        setDocs(Array.isArray(data) ? data : (data?.documents || []))
        setListError(null)
      })
      .catch(e => setListError(`Could not load documents: ${e?.message || 'network error'}`))
  }

  useEffect(() => { fetchDocs() }, [])

  const fetchFolders = async () => {
    try {
      const r = await fetch(`${getApiBase()}/api/documents/folders`)
      if (!r.ok) return
      const data = await r.json()
      setFolders(Array.isArray(data?.folders) ? data.folders : [])
    } catch { /* the tree keeps its last state; the list still works */ }
  }

  // Every change to the list (upload, move, tag, rename) can change the tree.
  useEffect(() => { if (foldersOn) fetchFolders() }, [foldersOn, docs])

  /** POST/DELETE one folder route; the error line names the action on failure. */
  const folderCall = async (what: string, method: string, path: string, body?: unknown) => {
    setActionError(null)
    try {
      const resp = await fetch(`${getApiBase()}/api/documents/folders${path}`, {
        method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      })
      if (!resp.ok) {
        setActionError(`Could not ${what}: ${await errorDetail(resp, 'Request failed')}`)
        return null
      }
      const data = await resp.json()
      const failed: { filename?: string; detail?: string }[] = data?.failed || []
      if (failed.length > 0) setActionError(`Not updated: ${failed.map(f => `${f.filename}: ${f.detail}`).join('; ')}`)
      return data
    } catch (e) {
      setActionError(`Could not ${what}: ${(e as Error)?.message || 'network error'}`)
      return null
    }
  }

  /** New folder inside ``parent`` ("" = top level); opens it as the upload target. */
  const createFolder = async (parent: string, name: string) => {
    const path = cleanFolderPath(parent ? `${parent}/${name}` : name)
    if (!path) return
    const data = await folderCall('create the folder', 'POST', '', { path })
    if (!data) return
    await fetchFolders()
    chooseProjectFilter(data.path || path)
  }

  /** Rename a folder (its last segment); every subfolder and document follows. */
  const renameFolder = async (path: string, name: string) => {
    const parent = parentFolder(path)
    const newPath = cleanFolderPath(parent ? `${parent}/${name}` : name)
    if (!newPath || newPath === path) return
    const data = await folderCall('rename the folder', 'POST', '/rename', { path, new_path: newPath })
    if (!data) return
    const remap = (p: string) => (inFolder(p, path) ? newPath + p.slice(path.length) : p)
    if (projectFilter) setProjectFilter(remap(projectFilter))
    if (inFolder(projectRef.current, path)) setProject(remap(projectRef.current))
    applyLabels(data.updated || [])
    await fetchFolders()
  }

  /** Add a tag to every document in a folder and its subfolders. */
  const tagFolder = async (path: string, tag: string) => {
    const data = await folderCall('tag the folder', 'POST', '/tags', { path, add_tags: [tag], recursive: true })
    if (data) applyLabels(data.updated || [])
  }

  /** Delete an empty folder (the backend refuses one holding documents). */
  const deleteFolder = async (path: string) => {
    const data = await folderCall('delete the folder', 'DELETE', `?path=${encodeURIComponent(path)}`)
    if (!data) return
    if (projectFilter && inFolder(projectFilter, path)) setProjectFilter(null)
    await fetchFolders()
  }

  // A sign-in (or the desk handing this frame its bearer) after the first load
  // must clear "Authentication required" -- before this the error never went
  // away until the window was closed and reopened (2026-10-16, a customer appliance).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onAuth = () => fetchDocs()
    window.addEventListener('aitheros:auth-changed', onAuth)
    return () => window.removeEventListener('aitheros:auth-changed', onAuth)
  }, [])

  /** Upload one file through /upload; always resolves to a result for that file. */
  const uploadOne = async (file: File, onDuplicate?: DuplicateChoice, send: SendOptions = {}): Promise<UploadResult> => {
    const form = new FormData()
    form.append('file', file)
    form.append('auto_extract', 'true')
    const { projects, versions } = supportsRef.current
    if (projects && projectRef.current) form.append('project', projectRef.current)
    if (onDuplicate) form.append('on_duplicate', onDuplicate)
    if (versions && wantsBackgroundIngest(file)) form.append('background', 'true')
    if (send.archive) form.append('archive', send.archive)
    try {
      const resp = await fetch(`${getApiBase()}/api/documents/upload`, { method: 'POST', body: form })
      send.onLanded?.()
      if (resp.status === 409 && !onDuplicate) {
        if (versions) {
          pendingDupes.current.set(file.name, file)
          if (send.archive) dupeArchives.current.set(file.name, send.archive)
        }
        return { filename: file.name, status: 'error', duplicate: versions, detail: await errorDetail(resp, 'Already uploaded') }
      }
      if (!resp.ok) {
        return { filename: file.name, status: 'error', detail: await errorDetail(resp, 'Upload failed') }
      }
      const data = await resp.json()
      if (data.job_id) {
        const job = await waitForBatchJob(data.job_id, send.quiet)
        return jobResults(job, [file])[0]
      }
      const n = data.chunks_created ?? data.chunk_count
      const saved = data.filename && data.filename !== file.name ? ` as ${data.filename}` : ''
      const how = onDuplicate === 'replace' ? 'Replaced; ' : ''
      if (n === 0) return { filename: file.name, status: 'warning', detail: ZERO_CHUNK_DETAIL }
      return { filename: file.name, status: 'done', detail: `${how}${n ?? '?'} chunks ingested${saved}` }
    } catch (e) {
      return { filename: file.name, status: 'error', detail: `Upload error: ${(e as Error)?.message || 'network error'}` }
    }
  }

  /** A file past the single-request cap: verified 32 MB pieces, resumable.
   *  Its progress is a row at the top of the list (InFlightUploadRow), never a
   *  line that reads as done; a paused upload the server holds is resumed. */
  const uploadBig = async (file: File, send: SendOptions = {}): Promise<UploadResult> => {
    const held = inFlightRef.current.find(u => u.state === 'uploading' && u.upload_id
      && u.filename === file.name && u.size === file.size)
    const key = ++liveKey.current
    const patch = (p: Partial<LiveUpload>) =>
      setLiveUploads(all => all.map(l => (l.key === key ? { ...l, ...p } : l)))
    setLiveUploads(all => [...all,
      { key, uploadId: held?.upload_id || null, filename: file.name, sent: 0, total: file.size }])
    let result
    try {
      result = await uploadChunked(file, {
        apiBase: getApiBase(),
        project: supportsRef.current.projects ? projectRef.current : '',
        resumeId: held?.upload_id || undefined,
        archive: send.archive,
        onStart: id => patch({ uploadId: id }),
        onProgress: (sent, total) => patch({ sent, total }),
      })
    } finally {
      setLiveUploads(all => all.filter(l => l.key !== key))
      send.onLanded?.()
    }
    if (!result.ok) return { filename: file.name, status: 'error', detail: result.detail }
    if (!send.quiet) {
      setUploadProgress(`Uploaded ${file.name}. Checking and unpacking it -- its files appear below when done.`)
    }
    return jobResults(await waitForBatchJob(result.jobId, send.quiet), [file])[0]
      ?? { filename: file.name, status: 'done', detail: 'Uploaded' }
  }

  /**
   * A .zip opened in this browser: each member goes up on its own (3 at once)
   * and starts indexing as soon as it lands, instead of the whole archive
   * first (a 3.3 GB zip was ~80 minutes with nothing indexed). Members over
   * 32 MB use the resumable chunked upload. Returns false -- nothing sent --
   * when this zip cannot be read here; the caller then sends it whole.
   */
  const uploadZipMembers = async (zip: File): Promise<boolean> => {
    const { chunked, single, perFile } = limitsRef.current
    let total = 0
    const say = (names: readonly string[], finished: number) => setUploadProgress(
      `Unpacking ${zip.name} in this browser: ${finished} of ${total} file${total !== 1 ? 's' : ''} sent`
      + (names.length ? ` · sending ${names.join(', ')}` : ''))
    let lastRefresh = 0
    const out = await expandZipUpload<UploadResult>(zip, {
      accepted: acceptedRef.current,
      maxTotalBytes: perFile,
      upload: async (file, landed) => {
        const send = { archive: zip.name, onLanded: landed, quiet: true }
        if (chunked && (file.size > single || file.size > MEMBER_CHUNKED_BYTES)) return uploadBig(file, send)
        if (file.size > single) {
          landed()
          return {
            filename: file.name, status: 'error',
            detail: `Inside ${zip.name}: ${formatMb(file.size)} is over the ${formatMb(single)} upload limit`,
          }
        }
        return uploadOne(file, undefined, send)
      },
      row: (filename, status, detail) => ({ filename, status, detail }),
      onResult: r => {
        addResults([r])
        // Each member becomes a document as it is indexed: show it, at most every 3 s.
        const now = Date.now()
        if (r.status === 'done' && now - lastRefresh > 3000) { lastRefresh = now; fetchDocs() }
      },
      onPlan: members => { total = members; say([], 0) },
      onSending: say,
    })
    return out.kind === 'done'
  }

  const uploadSequential = async (fileList: File[]) => {
    for (let i = 0; i < fileList.length; i++) {
      setUploadProgress(`Uploading ${fileList[i].name} (${i + 1}/${fileList.length})...`)
      addResults([await uploadOne(fileList[i])])
    }
  }

  /** Poll a batch job until it finishes; resolves with the final job (null on loss).
   *  ``quiet`` (a zip member, several at once): no batch card, polled every 2 s. */
  const waitForBatchJob = (jobId: string, quiet = false) => new Promise<BatchJob | null>(resolve => {
    let misses = 0
    const poll = async () => {
      try {
        const resp = await fetch(`${getApiBase()}/api/documents/batch/${jobId}`)
        if (resp.ok) {
          const data: BatchJob = await resp.json()
          if (!quiet) {
            setBatchJob(data)
            setUploadProgress(null)
          }
          if (data.status === 'completed' || data.status === 'failed') { resolve(data); return }
        } else if (++misses >= 5) { resolve(null); return }
      } catch { if (++misses >= 5) { resolve(null); return } }
      setTimeout(poll, quiet ? 2000 : 1000)
    }
    poll()
  })

  const jobResults = (job: BatchJob | null, sent: File[]): UploadResult[] => {
    if (!job) {
      return sent.map(f => ({ filename: f.name, status: 'error' as const, detail: 'Lost track of the processing job; refresh to check' }))
    }
    const reported = new Set((job.files || []).map(f => f.filename))
    // The batch endpoint drops duplicates before it creates the job, so they never
    // appear in job.files; a ZIP is reported by its members, not its own name.
    const unreported: UploadResult[] = sent
      .filter(f => !reported.has(f.name) && fileExt(f.name) !== '.zip')
      .map(f => ({ filename: f.name, status: 'skipped' as const, detail: 'Already uploaded (skipped as a duplicate)' }))
    return [...unreported, ...(job.files || []).map(f => {
      if (f.status === 'done') {
        const how = f.replaced_doc_id ? 'Replaced; ' : ''
        const saved = f.saved_as ? ` as ${f.saved_as}` : ''
        return f.chunks === 0
          ? { filename: f.filename, status: 'warning' as const, detail: ZERO_CHUNK_DETAIL }
          : { filename: f.filename, status: 'done' as const, detail: `${how}${f.chunks} chunks ingested${saved}` }
      }
      if (f.status === 'duplicate') return duplicateResult(f.filename, f.error || 'Already uploaded', sent)
      if (f.status === 'skipped') return { filename: f.filename, status: 'skipped' as const, detail: f.error || 'Already uploaded' }
      return { filename: f.filename, status: 'error' as const, detail: f.error || `Ended as ${f.status}` }
    })]
  }

  /** A same-name row from a batch; Replace / Keep both when the backend has them. */
  const duplicateResult = (filename: string, detail: string, sent: File[]): UploadResult => {
    const file = sent.find(f => f.name === filename)
    const offer = supportsRef.current.versions && !!file
    if (offer && file) pendingDupes.current.set(filename, file)
    return { filename, status: offer ? 'error' : 'skipped', duplicate: offer, detail }
  }

  /** Resend a same-name upload as Replace or Keep both; swaps its result row. */
  const resolveDuplicate = async (filename: string, choice: DuplicateChoice) => {
    const file = pendingDupes.current.get(filename)
    if (!file) return
    pendingDupes.current.delete(filename)
    const archive = dupeArchives.current.get(filename)
    dupeArchives.current.delete(filename)
    setUploading(true)
    setUploadProgress(`${choice === 'replace' ? 'Replacing' : 'Uploading a new version of'} ${filename}...`)
    try {
      const result = await uploadOne(file, choice, { archive })
      setResults(prev => prev.map(r => (r.filename === filename && r.duplicate ? result : r)))
    } finally {
      setUploadProgress(null)
      setUploading(false)
      fetchDocs()
    }
  }

  const uploadGroup = async (group: File[]) => {
    setUploadProgress(`Uploading ${group.length} file${group.length !== 1 ? 's' : ''}...`)
    setBatchJob(null)
    const form = new FormData()
    group.forEach(f => form.append('files', f))
    form.append('doc_type', 'other')
    if (supportsRef.current.projects && projectRef.current) form.append('project', projectRef.current)
    try {
      const resp = await fetch(`${getApiBase()}/api/documents/batch`, { method: 'POST', body: form })
      if (resp.status === 404) { await uploadSequential(group); return }
      if (!resp.ok) {
        const detail = await errorDetail(resp, 'Batch upload failed')
        addResults(group.map(f => ({ filename: f.name, status: 'error' as const, detail })))
        return
      }
      const data = await resp.json()
      if (data.status === 'all_duplicates') {
        const dupes = new Set<string>(Array.isArray(data.duplicates) ? data.duplicates : [])
        addResults(group.map(f => dupes.has(f.name)
          ? duplicateResult(f.name, 'Already uploaded. Replace it with this version, or keep both.', group)
          : { filename: f.name, status: 'skipped' as const, detail: 'Already uploaded' }))
        return
      }
      if (data.job_id) addResults(jobResults(await waitForBatchJob(data.job_id), group))
    } catch (e) {
      const detail = `Batch upload error: ${(e as Error)?.message || 'network error'}`
      addResults(group.map(f => ({ filename: f.name, status: 'error' as const, detail })))
    }
  }

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList)
    if (arr.length === 0) return
    const { chunked, single, perFile } = limitsRef.current
    const { ok: accepted, rejected } = partitionUploads(arr, acceptedRef.current, perFile)
    pendingDupes.current.clear()
    dupeArchives.current.clear()
    setResults(rejected)
    setActionError(null)
    if (accepted.length === 0) return
    setUploading(true)
    try {
      // A .zip is opened here and sent member by member when the backend takes
      // archive= (browser_zip_expand) and publishes a real type allowlist to
      // filter by; one this browser cannot read goes up whole, as before.
      const rest: File[] = []
      for (const f of accepted) {
        const expand = fileExt(f.name) === '.zip' && supportsRef.current.zipExpand
          && acceptedRef.current.length > 0
        if (expand && await uploadZipMembers(f)) continue
        rest.push(f)
      }
      const big = chunked ? rest.filter(f => f.size > single) : []
      const ok = rest.filter(f => !big.includes(f))
      for (const f of big) addResults([await uploadBig(f)])
      if (ok.length === 1 && fileExt(ok[0].name) !== '.zip' && !isMediaUpload(ok[0].name)) {
        setUploadProgress(`Uploading ${ok[0].name}...`)
        addResults([await uploadOne(ok[0])])
      } else if (ok.length > 0) {
        for (const group of splitBatches(ok, single)) await uploadGroup(group)
      }
    } finally {
      setUploadProgress(null)
      setUploading(false)
      fetchDocs()
    }
  }, [])

  // Closing the tab mid-upload pauses it: say so before the browser does it.
  useEffect(() => {
    if (!uploading || typeof window === 'undefined') return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = 'An upload is still running. Leaving this page pauses it.'
      return e.returnValue
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [uploading])

  // The caller's uploads in flight, polled while the panel is open. A row that
  // leaves the list (its files were read) refreshes the documents.
  useEffect(() => {
    if (!limits.chunked) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const r = await fetch(`${getApiBase()}/api/documents/uploads`)
        if (r.status === 404 || r.status === 405) return // an older backend: no list
        if (r.ok) {
          const data = await r.json()
          const next: InFlightUpload[] = Array.isArray(data?.uploads) ? data.uploads : []
          if (stopped) return
          const gone = inFlightRef.current.some(u => u.state !== 'failed' && !next.some(n => n.id === u.id))
          setInFlight(next)
          if (gone) fetchDocs()
        }
      } catch { /* offline: try again next tick */ }
      if (!stopped) timer = setTimeout(poll, 5000)
    }
    poll()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [limits.chunked])

  const shownUploads = liveUploads
    .reduce<InFlightUpload[]>((rows, l) => mergeLive(rows, l), inFlight).filter(u =>
    !dismissedUploads.has(u.id) && !(batchJob && u.job_id && u.job_id === batchJob.job_id))

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const deleteDoc = async (id: string) => {
    setActionError(null)
    try {
      const resp = await fetch(`${getApiBase()}/api/documents/${id}`, { method: 'DELETE' })
      if (!resp.ok) {
        setActionError(`Delete failed: ${await errorDetail(resp, 'Delete failed')}`)
        return
      }
      fetchDocs()
      setConfirmDelete(null)
      setSelected(prev => { const next = new Set(prev); next.delete(id); return next })
      if (viewDoc?.id === id) closeViewer()
    } catch (e) {
      setActionError(`Delete failed: ${(e as Error)?.message || 'network error'}`)
    }
  }

  /** Merge returned labels into the list and the open viewer. */
  const applyLabels = (rows: { id: string; project?: string | null; tags?: string[] }[]) => {
    const byId = new Map(rows.map(r => [r.id, r]))
    const merge = (d: Doc): Doc => {
      const r = byId.get(d.id)
      return r ? { ...d, project: r.project ?? null, tags: r.tags || [] } : d
    }
    setDocs(prev => prev.map(merge))
    setViewDoc(prev => (prev ? merge(prev) : prev))
  }

  /** Move one document to a project ("" = none) and/or set its tags. */
  const patchDoc = async (id: string, body: { project?: string; tags?: string[] }) => {
    setActionError(null)
    try {
      const resp = await fetch(`${getApiBase()}/api/documents/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!resp.ok) {
        setActionError(`Could not update the document: ${await errorDetail(resp, 'Update failed')}`)
        return
      }
      applyLabels([await resp.json()])
    } catch (e) {
      setActionError(`Could not update the document: ${(e as Error)?.message || 'network error'}`)
    }
  }

  /** Move / tag every selected document in one request. */
  const bulkUpdate = async (body: { project?: string; add_tags?: string[] }) => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setActionError(null)
    try {
      const resp = await fetch(`${getApiBase()}/api/documents/bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, ...body }),
      })
      if (!resp.ok) {
        setActionError(`Could not update the selection: ${await errorDetail(resp, 'Update failed')}`)
        return
      }
      const data = await resp.json()
      applyLabels(data.updated || [])
      const failed: { filename?: string; detail?: string }[] = data.failed || []
      if (failed.length > 0) {
        setActionError(`Not updated: ${failed.map(f => `${f.filename}: ${f.detail}`).join('; ')}`)
      } else {
        setSelected(new Set())
      }
    } catch (e) {
      setActionError(`Could not update the selection: ${(e as Error)?.message || 'network error'}`)
    }
  }

  /** Re-read an image (or any document) from its stored original. Admin only. */
  const describeAgain = async (doc: Doc) => {
    setActionError(null)
    try {
      const resp = await fetch(`${getApiBase()}/api/documents/${doc.id}/reindex`, { method: 'POST' })
      if (!resp.ok) {
        setActionError(`Could not re-read ${doc.filename}: ${await errorDetail(resp, 'Re-read failed')}`)
        return
      }
      const data = await resp.json()
      fetchDocs()
      await openDoc({ ...doc, chunk_count: data.chunks ?? doc.chunk_count }, true)
    } catch (e) {
      setActionError(`Could not re-read ${doc.filename}: ${(e as Error)?.message || 'network error'}`)
    }
  }

  /** While anything is selected the list is in SELECT mode: a row click adds or removes
   *  that row instead of opening it, so building a selection never opens a file by mistake. */
  const onRowClick = (doc: Doc) => {
    if (supports.edit && !viewDoc && selected.size > 0) toggleSelected(doc.id)
    else openDoc(doc)
  }

  const toggleSelected = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const statusColor = (status: string) => {
    switch (status) {
      case 'done': return 'var(--accent-green, #22c55e)'
      case 'warning': return 'var(--accent-amber, #f59e0b)'
      case 'error': case 'rejected': return 'var(--accent-coral, #ef4444)'
      case 'skipped': return 'var(--text-muted, #888)'
      case 'pending': return 'var(--text-muted, #888)'
      default: return 'var(--accent-cyan, #06b6d4)'
    }
  }

  const docTypeIcon = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'contract': case 'msa': return '📄'
      case 'proposal': return '📋'
      case 'resume': return '👤'
      case 'qbr': case 'report': return '📊'
      case 'sop': case 'playbook': return '📘'
      case 'pricing': return '💰'
      case 'conversation': return '💬'
      case 'web': return '🌐'
      default: return '📎'
    }
  }

  // With folders, every folder (empty ones too) is a move / upload target.
  const projects = foldersOn
    ? Array.from(new Set([...folders.map(f => f.path), ...projectsOf(docs)])).sort()
    : projectsOf(docs)
  const tags = tagsOf(docs)
  const shownDocs = docs.filter(d =>
    (!projectFilter || d.project === projectFilter)
    && (!tagFilter || (d.tags || []).some(t => t.toLowerCase() === tagFilter.toLowerCase())))
  /** A project chip is a folder: opening it also makes it the upload target,
   *  so files dropped while looking at a project land in it. */
  const chooseProjectFilter = (p: string | null) => {
    setProjectFilter(p)
    if (p) { setProject(p); setNewProjectMode(false) }
  }
  const allShownSelected = shownDocs.length > 0 && shownDocs.every(d => selected.has(d.id))

  // Reassemble full text from chunks if content endpoint didn't return
  const displayText = docContent?.text
    || (chunks.length > 0 ? chunks.map(c => c.text).join('\n') : '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: '1rem 1.5rem 0.75rem', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Documents</h2>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="btn btn-primary" style={{ fontSize: '0.8rem' }}>
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>

        {/* Drop zone */}
        <div
          data-testid="document-dropzone"
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => !uploading && fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--accent-primary, #3b82f6)' : 'var(--glass-border, #333)'}`,
            borderRadius: 'var(--radius, 8px)',
            padding: '1rem',
            textAlign: 'center',
            cursor: uploading ? 'default' : 'pointer',
            background: dragOver ? 'var(--bg-surface, #1a1a2e)' : 'transparent',
            transition: 'all 0.2s',
          }}
        >
          <p style={{ color: dragOver ? 'var(--accent-primary, #3b82f6)' : 'var(--text-secondary, #aaa)', fontSize: '0.8rem', fontWeight: 500, margin: 0 }}>
            Drop files here or click to browse
          </p>
          <p style={{ color: 'var(--text-muted, #666)', fontSize: '0.65rem', marginTop: '0.2rem', margin: '0.2rem 0 0' }}>
            {acceptedLabel}, up to {formatMb(limits.perFile)} per file
          </p>
        </div>

        <input ref={fileRef} type="file" hidden multiple data-testid="document-file-input"
          accept={accepted.join(',')}
          onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }} />

        {supports.projects && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem', fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--text-secondary, #aaa)', flexShrink: 0 }}>Upload to</span>
            <ProjectPicker value={project} projects={projects} live
              creating={newProjectMode || projects.length === 0}
              onCreating={setNewProjectMode}
              onCommit={setProject} noneLabel="No project"
              selectTestId="document-project-select" inputTestId="document-project-input"
              placeholder="New project name (optional)" />
          </div>
        )}
        {supports.projects && (
          <div data-testid="document-upload-target" style={{ fontSize: '0.65rem', color: 'var(--text-muted, #666)', marginTop: '0.2rem' }}>
            {projectRef.current ? `New uploads go to ${projectRef.current}` : 'New uploads go to no project'}
          </div>
        )}

        {uploadProgress && (
          <div style={{ padding: '0.5rem 0.75rem', marginTop: '0.5rem', background: 'var(--bg-surface, #1a1a2e)',
            borderRadius: 'var(--radius, 8px)', border: '1px solid var(--glass-border, #333)', fontSize: '0.8rem' }}>
            {uploadProgress}
          </div>
        )}

        {(listError || actionError) && (
          <div role="alert" style={{ padding: '0.5rem 0.75rem', marginTop: '0.5rem', fontSize: '0.75rem',
            borderRadius: 'var(--radius, 8px)', border: '1px solid var(--accent-coral, #ef4444)',
            color: 'var(--accent-coral, #ef4444)' }}>
            {actionError || listError}
          </div>
        )}

        {/* Per-file upload results: every file gets a line with its own reason */}
        {results.length > 0 && (
          <div data-testid="upload-results" style={{ background: 'var(--bg-surface, #1a1a2e)', borderRadius: 'var(--radius, 8px)',
            padding: '0.5rem 0.75rem', marginTop: '0.5rem', border: '1px solid var(--glass-border, #333)' }}>
            {results.map((r, i) => (
              <div key={`${r.filename}-${i}`} data-status={r.status} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                padding: '0.25rem 0', fontSize: '0.75rem',
                borderTop: i > 0 ? '1px solid var(--glass-border, #333)' : undefined }}>
                <span style={{ width: 6, height: 6, marginTop: '0.35rem', borderRadius: '50%', background: statusColor(r.status), flexShrink: 0 }} />
                <span style={{ fontWeight: 500, flexShrink: 0, maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.filename}</span>
                <span style={{ flex: 1, fontSize: '0.7rem',
                  color: r.status === 'warning' ? 'var(--accent-amber, #f59e0b)'
                    : r.status === 'error' || r.status === 'rejected' ? 'var(--accent-coral, #ef4444)'
                    : 'var(--text-muted, #888)' }}>
                  {r.detail}
                  {r.duplicate && !uploading && (
                    <span style={{ display: 'inline-flex', gap: '0.3rem', marginLeft: '0.4rem' }}>
                      <button onClick={() => resolveDuplicate(r.filename, 'replace')} style={{
                        padding: '0.1rem 0.45rem', background: 'var(--accent-primary, #3b82f6)', color: '#fff',
                        borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer' }}>Replace</button>
                      <button onClick={() => resolveDuplicate(r.filename, 'keep_both')} style={{
                        padding: '0.1rem 0.45rem', background: 'var(--bg-elevated, #222)',
                        color: 'var(--text-secondary, #aaa)', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer' }}>Keep both</button>
                    </span>
                  )}
                </span>
              </div>
            ))}
            {!uploading && (
              <button onClick={() => setResults([])} style={{
                marginTop: '0.4rem', padding: '0.2rem 0.6rem', background: 'var(--bg-elevated, #222)',
                color: 'var(--text-secondary, #aaa)', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer',
              }}>Dismiss</button>
            )}
          </div>
        )}

        {/* Batch progress */}
        {batchJob && (
          <div style={{ background: 'var(--bg-surface, #1a1a2e)', borderRadius: 'var(--radius, 8px)',
            padding: '0.75rem', marginTop: '0.5rem', border: '1px solid var(--glass-border, #333)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                {batchJob.status === 'completed' ? 'Batch Complete' : 'Processing...'}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #666)' }}>
                {batchJob.processed_files}/{batchJob.total_files} files
                {batchJob.total_chunks > 0 && ` — ${batchJob.total_chunks} chunks`}
              </span>
            </div>
            <div style={{ height: 3, background: 'var(--bg-elevated, #222)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${batchJob.total_files > 0 ? (batchJob.processed_files / batchJob.total_files) * 100 : 0}%`,
                background: batchJob.status === 'completed' ? 'var(--accent-green, #22c55e)' : 'var(--accent-primary, #3b82f6)',
                transition: 'width 0.3s',
              }} />
            </div>
            {batchJob.files.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.25rem 0', fontSize: '0.75rem',
                borderTop: i > 0 ? '1px solid var(--glass-border, #333)' : undefined }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor(f.status), flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.filename}</span>
                <span style={{ color: 'var(--text-muted, #666)', fontSize: '0.65rem' }}>
                  {f.status === 'done' ? `${f.chunks} chunks` : f.error || f.progress || f.status}
                </span>
              </div>
            ))}
            {batchJob.status === 'completed' && (
              <button onClick={() => setBatchJob(null)} style={{
                marginTop: '0.4rem', padding: '0.2rem 0.6rem', background: 'var(--bg-elevated, #222)',
                color: 'var(--text-secondary, #aaa)', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer',
              }}>Dismiss</button>
            )}
          </div>
        )}
      </div>

      {/* Main area: split between doc list and viewer */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: viewDoc ? 'row' : 'column', gap: 0 }}>
        {/* Doc list */}
        <div style={{
          width: viewDoc ? '280px' : '100%',
          flexShrink: 0,
          overflowY: 'auto',
          padding: '0 1.5rem 1rem',
          borderRight: viewDoc ? '1px solid var(--glass-border, #333)' : undefined,
        }}>
          {shownUploads.length > 0 && (
            <div data-testid="inflight-uploads" style={{ display: 'grid', gap: '0.35rem', marginBottom: '0.35rem' }}>
              {shownUploads.map(u => (
                <InFlightUploadRow key={u.id} upload={u} compact={!!viewDoc}
                  onResume={() => !uploading && fileRef.current?.click()}
                  onDismiss={x => setDismissedUploads(prev => new Set(prev).add(x.id))} />
              ))}
            </div>
          )}
          {/* Shown even before the first upload, so folders can be laid out first. */}
          {foldersOn && (
            <div style={{ marginBottom: '0.35rem' }}>
              <FolderTree folders={folders} selected={projectFilter} total={docs.length}
                canEdit={supports.edit} onSelect={chooseProjectFilter}
                onCreate={createFolder} onRename={renameFolder} onTag={tagFolder} onDelete={deleteFolder} />
            </div>
          )}
          {docs.length === 0 && !batchJob && shownUploads.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem 0', textAlign: 'center' }}>
              <h3 style={{ fontSize: '0.9rem', margin: '0 0 0.3rem' }}>No documents yet</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Upload documents to create a knowledge base.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.35rem' }}>
              {!foldersOn && projects.length > 0 && (
                <div data-testid="document-project-filter" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                  {[null, ...projects].map(p => (
                    <button key={p ?? '__all'} aria-pressed={projectFilter === p} onClick={() => chooseProjectFilter(p)} style={{
                      padding: '0.15rem 0.55rem', borderRadius: 999, fontSize: '0.65rem', cursor: 'pointer',
                      background: projectFilter === p ? 'var(--accent-primary, #3b82f6)' : 'var(--bg-elevated, #222)',
                      color: projectFilter === p ? '#fff' : 'var(--text-secondary, #aaa)',
                    }}>{p ?? 'All projects'}</button>
                  ))}
                </div>
              )}
              {tags.length > 0 && (
                <div data-testid="document-tag-filter" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                  {[null, ...tags].map(t => (
                    <button key={t ?? '__all'} aria-pressed={tagFilter === t} onClick={() => setTagFilter(t)} style={{
                      padding: '0.1rem 0.5rem', borderRadius: 4, fontSize: '0.62rem', cursor: 'pointer',
                      background: tagFilter === t ? 'var(--accent-cyan, #06b6d4)' : 'transparent',
                      border: '1px solid var(--glass-border, #333)',
                      color: tagFilter === t ? '#fff' : 'var(--text-secondary, #aaa)',
                    }}>{t === null ? 'All tags' : `#${t}`}</button>
                  ))}
                </div>
              )}
              {supports.edit && !viewDoc && shownDocs.length > 0 && (
                <BulkBar count={selected.size} allSelected={allShownSelected} projects={projects}
                  onToggleAll={() => setSelected(allShownSelected ? new Set() : new Set(shownDocs.map(d => d.id)))}
                  onMove={p => bulkUpdate({ project: p })}
                  onTag={t => bulkUpdate({ add_tags: [t] })}
                  onClear={() => setSelected(new Set())} />
              )}
              {shownDocs.map(doc => (
                <div key={doc.id} data-testid={`document-row-${doc.id}`} onClick={() => onRowClick(doc)} style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: viewDoc ? '0.5rem 0.6rem' : '0.6rem 0.75rem',
                  background: viewDoc?.id === doc.id ? 'var(--bg-elevated, #2a2a3e)' : 'var(--bg-surface, #1a1a2e)',
                  borderRadius: 'var(--radius, 6px)',
                  border: viewDoc?.id === doc.id ? '1px solid var(--accent-primary, #3b82f6)' : '1px solid var(--glass-border, #333)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}>
                  {supports.edit && !viewDoc && (
                    /* The hit zone is the whole label, not the 13px box: a near-miss on the
                       bare checkbox landed on the row and OPENED the file (customer report, 10-20). */
                    <label data-testid={`document-select-zone-${doc.id}`} onClick={e => e.stopPropagation()}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        alignSelf: 'stretch', margin: '-0.6rem 0 -0.6rem -0.75rem', padding: '0 0.6rem 0 0.75rem', cursor: 'pointer' }}>
                      <input type="checkbox" data-testid={`document-select-${doc.id}`} aria-label={`Select ${doc.filename}`}
                        checked={selected.has(doc.id)}
                        onChange={() => toggleSelected(doc.id)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                    </label>
                  )}
                  {!viewDoc && <span style={{ fontSize: '1rem', flexShrink: 0 }}>{docTypeIcon(doc.doc_type)}</span>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: viewDoc ? '0.75rem' : '0.85rem', fontWeight: 500, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.filename}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted, #666)', marginTop: '0.1rem' }}>
                      {doc.doc_type}{doc.project ? ` · ${doc.project}` : ''} · {doc.chunk_count} chunk{doc.chunk_count !== 1 ? 's' : ''}
                      {!viewDoc && doc.uploaded_at && ` · ${new Date(doc.uploaded_at).toLocaleDateString()}`}
                    </div>
                    {(doc.tags || []).length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem', marginTop: '0.2rem' }}>
                        {(doc.tags || []).map(t => (
                          <span key={t} style={{ fontSize: '0.6rem', padding: '0 0.35rem', borderRadius: 3,
                            border: '1px solid var(--glass-border, #333)', color: 'var(--accent-cyan, #06b6d4)' }}>#{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {!viewDoc && (
                    confirmDelete === doc.id ? (
                      <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                        <button onClick={(e) => { e.stopPropagation(); deleteDoc(doc.id) }} style={{
                          padding: '0.2rem 0.4rem', background: 'var(--accent-coral, #ef4444)', color: '#fff',
                          borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer' }}>Delete</button>
                        <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(null) }} style={{
                          padding: '0.2rem 0.4rem', background: 'var(--bg-elevated, #222)',
                          color: 'var(--text-secondary, #aaa)', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer' }}>No</button>
                      </div>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(doc.id) }} style={{
                        padding: '0.2rem 0.4rem', background: 'transparent', color: 'var(--text-muted, #666)',
                        fontSize: '0.65rem', cursor: 'pointer', flexShrink: 0 }}>Delete</button>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Document viewer */}
        {viewDoc && (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* Viewer header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '0.6rem 1rem', borderBottom: '1px solid var(--glass-border, #333)',
              flexShrink: 0,
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {docTypeIcon(viewDoc.doc_type)} {viewDoc.filename}
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted, #666)', marginTop: '0.1rem' }}>
                  {viewDoc.doc_type}{viewDoc.project ? ` · ${viewDoc.project}` : ''} · {viewDoc.chunk_count} chunk{viewDoc.chunk_count !== 1 ? 's' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexShrink: 0 }}>
                {/* View mode toggle */}
                <div style={{ display: 'flex', background: 'var(--bg-elevated, #222)', borderRadius: 4, overflow: 'hidden' }}>
                  <button onClick={() => setViewMode('content')} style={{
                    padding: '0.2rem 0.5rem', fontSize: '0.65rem', cursor: 'pointer',
                    background: viewMode === 'content' ? 'var(--accent-primary, #3b82f6)' : 'transparent',
                    color: viewMode === 'content' ? '#fff' : 'var(--text-muted, #888)',
                  }}>Document</button>
                  <button onClick={() => setViewMode('chunks')} style={{
                    padding: '0.2rem 0.5rem', fontSize: '0.65rem', cursor: 'pointer',
                    background: viewMode === 'chunks' ? 'var(--accent-primary, #3b82f6)' : 'transparent',
                    color: viewMode === 'chunks' ? '#fff' : 'var(--text-muted, #888)',
                  }}>Chunks</button>
                </div>
                {/* Delete in viewer */}
                {confirmDelete === viewDoc.id ? (
                  <div style={{ display: 'flex', gap: '0.2rem' }}>
                    <button onClick={() => deleteDoc(viewDoc.id)} style={{
                      padding: '0.2rem 0.4rem', background: 'var(--accent-coral, #ef4444)', color: '#fff',
                      borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer' }}>Confirm</button>
                    <button onClick={() => setConfirmDelete(null)} style={{
                      padding: '0.2rem 0.4rem', background: 'var(--bg-elevated, #222)',
                      color: 'var(--text-secondary, #aaa)', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer' }}>No</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDelete(viewDoc.id)} style={{
                    padding: '0.2rem 0.4rem', background: 'transparent', color: 'var(--text-muted, #666)',
                    fontSize: '0.65rem', cursor: 'pointer' }}>Delete</button>
                )}
                <button onClick={closeViewer} style={{
                  padding: '0.2rem 0.5rem', background: 'var(--bg-elevated, #222)',
                  color: 'var(--text-secondary, #aaa)', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer' }}>
                  ✕
                </button>
              </div>
            </div>

            {/* Project + tags: move the document, tag it */}
            {supports.edit && (
              <div data-testid="document-labels-editor" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center',
                gap: '0.4rem 0.75rem', padding: '0.45rem 1rem', borderBottom: '1px solid var(--glass-border, #333)',
                fontSize: '0.72rem', flexShrink: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span style={{ color: 'var(--text-secondary, #aaa)' }}>Project</span>
                  <ProjectPicker key={viewDoc.id} value={viewDoc.project || ''} projects={projects}
                    onCommit={p => patchDoc(viewDoc.id, { project: p })} noneLabel="No project"
                    selectTestId="document-move-select" inputTestId="document-move-input"
                    placeholder="New project name" />
                </span>
                <TagEditor key={`tags-${viewDoc.id}`} tags={viewDoc.tags || []}
                  onChange={next => patchDoc(viewDoc.id, { tags: next })} />
              </div>
            )}

            {/* Viewer body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
              {loadingViewer ? (
                <div style={{ color: 'var(--text-muted, #888)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>
                  Loading document...
                </div>
              ) : viewerError ? (
                <div role="alert" style={{ color: 'var(--accent-coral, #ef4444)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>
                  {viewerError}
                </div>
              ) : viewMode === 'content' && docContent?.kind === 'image' ? (
                <div data-testid="document-image-view">
                  {previewUrl ? (
                    <img data-testid="document-image-preview" src={previewUrl} alt={viewDoc.filename}
                      style={{ display: 'block', maxWidth: '100%', maxHeight: '60vh', margin: '0 auto 0.75rem',
                        borderRadius: 'var(--radius, 6px)', objectFit: 'contain' }} />
                  ) : (
                    <div style={{ color: 'var(--text-muted, #888)', fontSize: '0.8rem', textAlign: 'center', padding: '1rem' }}>
                      Loading picture...
                    </div>
                  )}
                  {docContent.described ? (
                    <div style={{ fontSize: '0.82rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text-primary, #ddd)' }}>
                      {displayText}
                    </div>
                  ) : (
                    <div data-testid="document-image-undescribed" style={{ fontSize: '0.78rem', color: 'var(--accent-amber, #f59e0b)', textAlign: 'center' }}>
                      Not yet described. Only the file name is searchable until the vision model reads this picture.
                      <div style={{ marginTop: '0.4rem' }}>
                        <button data-testid="document-describe-again" onClick={() => describeAgain(viewDoc)} style={{
                          padding: '0.2rem 0.6rem', background: 'var(--bg-elevated, #222)', color: 'var(--text-secondary, #aaa)',
                          borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer' }}>Describe again</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : viewMode === 'content' && docContent?.kind === 'pdf' ? (
                <div data-testid="document-pdf-view">
                  {previewUrl ? (
                    <>
                      <iframe data-testid="document-pdf-frame" src={previewUrl} title={viewDoc.filename}
                        style={{ display: 'block', width: '100%', height: '70vh', border: 'none',
                          borderRadius: 'var(--radius, 6px)', background: '#fff', marginBottom: '0.5rem' }} />
                      <a data-testid="document-pdf-open" href={previewUrl} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: '0.72rem', color: 'var(--accent-primary, #5EC9CC)' }}>
                        Open in a new tab
                      </a>
                    </>
                  ) : (
                    <div style={{ color: 'var(--text-muted, #888)', fontSize: '0.8rem', textAlign: 'center', padding: '1rem' }}>
                      Loading PDF...
                    </div>
                  )}
                  {displayText ? (
                    <details style={{ marginTop: '0.75rem' }}>
                      <summary style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #aaa)', cursor: 'pointer' }}>
                        Text read from this PDF
                      </summary>
                      <div style={{ fontSize: '0.82rem', lineHeight: 1.65, whiteSpace: 'pre-wrap',
                        fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary, #ddd)', marginTop: '0.5rem' }}>
                        {displayText}
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : viewMode === 'content' ? (
                displayText ? (
                  <div style={{
                    fontSize: '0.82rem', lineHeight: 1.65, whiteSpace: 'pre-wrap',
                    fontFamily: 'var(--font-mono, monospace)',
                    color: 'var(--text-primary, #ddd)',
                  }}>
                    {displayText}
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-muted, #888)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>
                    No text content available. Try the Chunks view.
                  </div>
                )
              ) : (
                chunks.length === 0 ? (
                  <div style={{ color: 'var(--text-muted, #888)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>
                    No chunks indexed for this document.
                  </div>
                ) : (
                  chunks.map((chunk, i) => (
                    <div key={i} style={{ marginBottom: '0.75rem', paddingBottom: '0.75rem',
                      borderBottom: i < chunks.length - 1 ? '1px solid var(--glass-border, #333)' : 'none' }}>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        marginBottom: '0.3rem',
                      }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--accent-primary, #3b82f6)', fontWeight: 600 }}>
                          Chunk {i + 1}/{chunks.length}
                        </span>
                        {chunk.metadata?.chunk_index !== undefined && (
                          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted, #666)' }}>
                            idx {chunk.metadata.chunk_index}
                            {chunk.metadata.total_chunks && ` of ${chunk.metadata.total_chunks}`}
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontSize: '0.8rem', lineHeight: 1.55, whiteSpace: 'pre-wrap',
                        padding: '0.5rem 0.6rem',
                        background: 'var(--bg-elevated, #222)',
                        borderRadius: 'var(--radius, 6px)',
                        border: '1px solid var(--glass-border, #333)',
                      }}>
                        {chunk.text}
                      </div>
                    </div>
                  ))
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const pickerStyle: React.CSSProperties = {
  padding: '0.25rem 0.45rem', fontSize: '0.72rem', minWidth: 0,
  background: 'var(--bg-surface, #1a1a2e)', color: 'var(--text-primary, #ddd)',
  border: '1px solid var(--glass-border, #333)', borderRadius: 'var(--radius, 6px)',
}
const smallButton: React.CSSProperties = {
  padding: '0.2rem 0.5rem', background: 'var(--bg-elevated, #222)', color: 'var(--text-secondary, #aaa)',
  borderRadius: 4, fontSize: '0.68rem', cursor: 'pointer', flexShrink: 0,
}

interface ProjectPickerProps {
  value: string
  projects: readonly string[]
  /** Called with the chosen project ("" = none). */
  onCommit: (project: string) => void
  noneLabel: string
  selectTestId: string
  inputTestId: string
  placeholder: string
  /** Upload target: every keystroke of a new name is the choice (no Create step). */
  live?: boolean
  /** Controlled "typing a new name" state; uncontrolled when omitted. */
  creating?: boolean
  onCreating?: (creating: boolean) => void
}

/** Choose an existing project, no project, or type a new one. */
export function ProjectPicker({
  value, projects, onCommit, noneLabel, selectTestId, inputTestId, placeholder,
  live = false, creating: creatingProp, onCreating,
}: ProjectPickerProps) {
  const [creatingState, setCreatingState] = useState(false)
  const creating = creatingProp ?? creatingState
  const setCreating = (v: boolean) => { setCreatingState(v); onCreating?.(v) }
  const [draft, setDraft] = useState('')
  const options = Array.from(new Set([...projects, ...(value ? [value] : [])])).sort()
  const commitDraft = () => {
    const name = cleanFolderPath(draft)  // "Yard/Scripts" = a nested folder
    if (!name) return
    onCommit(name)
    setDraft('')
    setCreating(false)
  }

  if (creating) {
    return (
      <span style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flex: 1, minWidth: 0 }}>
        <input data-testid={inputTestId} value={live ? value : draft}
          maxLength={MAX_FOLDER_PATH} placeholder={placeholder}
          onChange={e => (live ? onCommit(e.target.value) : setDraft(e.target.value))}
          onKeyDown={e => {
            if (e.key === 'Enter' && !live) commitDraft()
            if (e.key === 'Escape' && options.length > 0) setCreating(false)
          }}
          style={{ ...pickerStyle, flex: 1 }} />
        {!live && <button data-testid={`${inputTestId}-create`} onClick={commitDraft} style={smallButton}>Create</button>}
        {options.length > 0 && (
          <button onClick={() => setCreating(false)} style={smallButton}>{live ? 'Pick existing' : 'Cancel'}</button>
        )}
      </span>
    )
  }
  return (
    <select data-testid={selectTestId} value={value} aria-label="Project"
      onChange={e => {
        if (e.target.value === NEW_PROJECT) {
          setDraft('')
          if (live) onCommit('')
          setCreating(true)
        } else {
          onCommit(e.target.value)
        }
      }}
      style={{ ...pickerStyle, flex: 1 }}>
      <option value="">{noneLabel}</option>
      {options.map(p => <option key={p} value={p}>{p}</option>)}
      <option value={NEW_PROJECT}>+ New project...</option>
    </select>
  )
}

/** A document's tags: remove with x, add by typing and Enter / Add. */
export function TagEditor({ tags, onChange }: { tags: readonly string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const t = cleanLabel(draft, 40)
    if (!t) return
    setDraft('')
    if (tags.some(x => x.toLowerCase() === t.toLowerCase())) return
    onChange([...tags, t])
  }
  return (
    <span data-testid="document-tag-editor" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.25rem' }}>
      <span style={{ color: 'var(--text-secondary, #aaa)' }}>Tags</span>
      {tags.map(t => (
        <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem', padding: '0 0.3rem',
          borderRadius: 3, border: '1px solid var(--glass-border, #333)', color: 'var(--accent-cyan, #06b6d4)', fontSize: '0.65rem' }}>
          #{t}
          <button aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter(x => x !== t))} style={{
            background: 'transparent', color: 'var(--text-muted, #888)', cursor: 'pointer', fontSize: '0.65rem', padding: 0 }}>x</button>
        </span>
      ))}
      <input data-testid="document-tag-input" value={draft} maxLength={40} placeholder="Add tag"
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        style={{ ...pickerStyle, width: '6.5rem' }} />
      <button data-testid="document-tag-add" onClick={add} style={smallButton}>Add</button>
    </span>
  )
}

interface BulkBarProps {
  count: number
  allSelected: boolean
  projects: readonly string[]
  onToggleAll: () => void
  onMove: (project: string) => void
  onTag: (tag: string) => void
  onClear: () => void
}

/** Select documents, then move them to a project or tag them in one go. */
function BulkBar({ count, allSelected, projects, onToggleAll, onMove, onTag, onClear }: BulkBarProps) {
  const [tag, setTag] = useState('')
  const addTag = () => {
    const t = cleanLabel(tag, 40)
    if (!t) return
    onTag(t)
    setTag('')
  }
  return (
    <div data-testid="document-bulk-bar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem',
      fontSize: '0.7rem', color: 'var(--text-secondary, #aaa)' }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
        <input type="checkbox" data-testid="document-select-all" checked={allSelected} onChange={onToggleAll} />
        {count > 0 ? `${count} selected` : 'Select all'}
      </label>
      {count > 0 && (<>
        <span>Move to</span>
        {/* value "" + a fresh key per selection size: the picker is an action, not a state */}
        <ProjectPicker key={count} value="" projects={projects} noneLabel="(choose a project)"
          onCommit={onMove}
          selectTestId="document-bulk-move" inputTestId="document-bulk-move-input" placeholder="New project name" />
        <button data-testid="document-bulk-unproject" onClick={() => onMove('')} style={smallButton}>No project</button>
        <input data-testid="document-bulk-tag" value={tag} maxLength={40} placeholder="Add tag"
          onChange={e => setTag(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addTag() }}
          style={{ ...pickerStyle, width: '6.5rem' }} />
        <button data-testid="document-bulk-tag-add" onClick={addTag} style={smallButton}>Tag</button>
        <button onClick={onClear} style={smallButton}>Clear</button>
      </>)}
    </div>
  )
}

interface FolderTreeProps {
  folders: readonly FolderInfo[]
  /** The open folder (exact path) or null = all documents. */
  selected: string | null
  /** Every document's count, for the "All documents" row. */
  total: number
  canEdit: boolean
  onSelect: (path: string | null) => void
  /** New folder ``name`` inside ``parent`` ("" = top level). */
  onCreate: (parent: string, name: string) => void
  onRename: (path: string, name: string) => void
  onTag: (path: string, tag: string) => void
  onDelete: (path: string) => void
}

type FolderAction = 'new' | 'rename' | 'tag'

/** File-explorer folder tree (customer ask 2026-10-28): nested folders, click to
 *  open, New folder inside the open one, Rename, Tag every document inside. */
export function FolderTree({
  folders, selected, total, canEdit, onSelect, onCreate, onRename, onTag, onDelete,
}: FolderTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [action, setAction] = useState<FolderAction | null>(null)
  const [draft, setDraft] = useState('')
  const current = selected ? folders.find(f => f.path === selected) : undefined
  const hasChildren = new Set(folders.map(f => f.parent).filter((p): p is string => !!p))
  // A folder is hidden while any folder above it is collapsed.
  const visible = folders.filter(f => !Array.from(collapsed).some(c => f.path.startsWith(`${c}/`)))

  const start = (a: FolderAction) => {
    setAction(prev => (prev === a ? null : a))
    setDraft(a === 'rename' && current ? current.name : '')
  }
  const submit = () => {
    const value = action === 'tag' ? cleanLabel(draft, 40) : cleanFolderPath(draft)
    if (!value || !action) return
    if (action === 'new') onCreate(selected || '', value)
    else if (action === 'rename' && selected) onRename(selected, value)
    else if (action === 'tag' && selected) onTag(selected, value)
    setAction(null)
    setDraft('')
  }
  const toggle = (path: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })
  const placeholder = action === 'new'
    ? (current ? `New folder inside ${current.name}` : 'New folder name')
    : action === 'rename' ? 'New name' : 'Tag for everything inside'
  const rowStyle = (on: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '0.3rem', width: '100%', textAlign: 'left',
    padding: '0.15rem 0.4rem', borderRadius: 4, fontSize: '0.72rem', cursor: 'pointer', border: 'none',
    background: on ? 'var(--accent-primary, #3b82f6)' : 'transparent',
    color: on ? '#fff' : 'var(--text-secondary, #aaa)',
  })

  return (
    <div data-testid="document-folder-tree" style={{ border: '1px solid var(--glass-border, #333)',
      borderRadius: 'var(--radius, 6px)', background: 'var(--bg-surface, #1a1a2e)', padding: '0.4rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.3rem', marginBottom: '0.3rem' }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary, #aaa)', marginRight: 'auto' }}>Folders</span>
        {canEdit && (<>
          <button data-testid="folder-new" onClick={() => start('new')} style={smallButton}>New folder</button>
          {current && <button data-testid="folder-rename" onClick={() => start('rename')} style={smallButton}>Rename</button>}
          {current && current.total_count > 0 && (
            <button data-testid="folder-tag" onClick={() => start('tag')} style={smallButton}>Tag folder</button>
          )}
          {current && current.total_count === 0 && (
            <button data-testid="folder-delete" onClick={() => onDelete(current.path)} style={smallButton}>Delete</button>
          )}
        </>)}
      </div>
      {action && (
        <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.3rem' }}>
          <input data-testid="folder-input" value={draft} autoFocus placeholder={placeholder}
            maxLength={action === 'tag' ? 40 : MAX_FOLDER_PATH}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') setAction(null)
            }}
            style={{ ...pickerStyle, flex: 1 }} />
          <button data-testid="folder-input-ok" onClick={submit} style={smallButton}>
            {action === 'new' ? 'Create' : action === 'rename' ? 'Rename' : 'Apply'}
          </button>
          <button onClick={() => setAction(null)} style={smallButton}>Cancel</button>
        </div>
      )}
      <div role="tree" style={{ display: 'grid', gap: '0.05rem', maxHeight: '14rem', overflowY: 'auto' }}>
        <button role="treeitem" data-testid="folder-row-all" aria-selected={selected === null}
          onClick={() => onSelect(null)} style={rowStyle(selected === null)}>
          <span style={{ flex: 1 }}>All documents</span>
          <span style={{ fontSize: '0.62rem', opacity: 0.8 }}>{total}</span>
        </button>
        {visible.map(f => (
          <div key={f.path} style={{ display: 'flex', alignItems: 'center', paddingLeft: `${f.depth * 0.9}rem` }}>
            <button aria-label={`${collapsed.has(f.path) ? 'Expand' : 'Collapse'} ${f.name}`}
              onClick={() => toggle(f.path)} disabled={!hasChildren.has(f.path)}
              style={{ width: '1rem', flexShrink: 0, padding: 0, border: 'none', background: 'transparent',
                color: 'var(--text-muted, #888)', fontSize: '0.6rem', cursor: hasChildren.has(f.path) ? 'pointer' : 'default',
                visibility: hasChildren.has(f.path) ? 'visible' : 'hidden' }}>
              {collapsed.has(f.path) ? '▸' : '▾'}
            </button>
            <button role="treeitem" data-testid={`folder-row-${f.path}`} aria-selected={selected === f.path}
              title={f.path} onClick={() => onSelect(f.path)} style={rowStyle(selected === f.path)}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📁 {f.name}</span>
              <span style={{ fontSize: '0.62rem', opacity: 0.8 }}>{f.total_count}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
