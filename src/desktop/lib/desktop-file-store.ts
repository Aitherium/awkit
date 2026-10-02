/**
 * Desktop File Store
 * ==================
 *
 * Local-first file storage for the AitherOS desktop.
 * Files are persisted in localStorage immediately and optionally
 * synced to AitherStrata when the service is available.
 *
 * Key design:
 *  - Every file has a unique `id` (used as window id when opened)
 *  - Files live under `aither://desktop/` namespace
 *  - Content is stored as plain text (supports code, notes, config)
 *  - Sync flag tracks whether a file has been pushed to Strata
 */

import { isLocalNetworkHost } from './is-local-network-host'

// ─── Types ────────────────────────────────────────────────────────────────

export interface DesktopFile {
  id: string
  name: string
  path: string            // aither://desktop/<name>
  content: string
  createdAt: number       // epoch ms
  updatedAt: number
  synced: boolean         // true if pushed to Strata
  mimeType: string
  size: number            // content.length in bytes
}

const STORAGE_KEY = 'aitherzero:desktop-files'
const STRATA_BASE = 'http://localhost:8136'

/**
 * Strata (:8136) and Recover (:8115) are LOCAL daemons, reachable only when the desktop is
 * served from this machine or the LAN. From a public origin the dial is a guaranteed
 * Private Network Access refusal and a console error on every visit -- measured 2026-10-01
 * on aitherium.com/desktop (localhost:8136/strata/stats, localhost:8115/health). Not dialled
 * there: the file store is local-first and every caller already treats a refusal as offline.
 */
export function localDaemonsReachable(hostname?: string): boolean {
  const h = hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  return isLocalNetworkHost(h)
}

/** fetch() for the local daemons; rejects WITHOUT a request on a public origin. */
export function localDaemonFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!localDaemonsReachable()) return Promise.reject(new Error('local daemons are not reachable from this origin'))
  return fetch(url, init)
}

// ─── Read / Write localStorage ────────────────────────────────────────────

function loadFiles(): DesktopFile[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (_e) {
    return []
  }
}

function saveFiles(files: DesktopFile[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(files))
}

// ─── MIME type heuristic ──────────────────────────────────────────────────

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const mimeMap: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    py: 'text/x-python',
    ts: 'text/typescript',
    tsx: 'text/typescript',
    js: 'text/javascript',
    jsx: 'text/javascript',
    css: 'text/css',
    html: 'text/html',
    sh: 'text/x-shellscript',
    ps1: 'text/x-powershell',
    toml: 'text/toml',
    csv: 'text/csv',
    log: 'text/plain',
  }
  return mimeMap[ext] || 'text/plain'
}

// ─── Public API ───────────────────────────────────────────────────────────

/** List all desktop files */
export function listFiles(): DesktopFile[] {
  return loadFiles()
}

/** Get a single file by id */
export function getFile(id: string): DesktopFile | undefined {
  return loadFiles().find(f => f.id === id)
}

/** Get a single file by path */
export function getFileByPath(path: string): DesktopFile | undefined {
  return loadFiles().find(f => f.path === path)
}

/** Create a new file and return it */
export function createFile(name: string, content = ''): DesktopFile {
  const files = loadFiles()
  const now = Date.now()
  const file: DesktopFile = {
    id: `file-${now}`,
    name,
    path: `aither://desktop/${name}`,
    content,
    createdAt: now,
    updatedAt: now,
    synced: false,
    mimeType: guessMime(name),
    size: new Blob([content]).size,
  }
  files.push(file)
  saveFiles(files)
  return file
}

/** Update file content (returns updated file) */
export function updateFileContent(id: string, content: string): DesktopFile | undefined {
  const files = loadFiles()
  const idx = files.findIndex(f => f.id === id)
  if (idx === -1) return undefined
  files[idx] = {
    ...files[idx],
    content,
    updatedAt: Date.now(),
    synced: false,
    size: new Blob([content]).size,
  }
  saveFiles(files)
  return files[idx]
}

/** Rename a file */
export function renameFile(id: string, newName: string): DesktopFile | undefined {
  const files = loadFiles()
  const idx = files.findIndex(f => f.id === id)
  if (idx === -1) return undefined
  files[idx] = {
    ...files[idx],
    name: newName,
    path: `aither://desktop/${newName}`,
    mimeType: guessMime(newName),
    updatedAt: Date.now(),
    synced: false,
  }
  saveFiles(files)
  return files[idx]
}

/** Delete a file */
export function deleteFile(id: string): boolean {
  const files = loadFiles()
  const filtered = files.filter(f => f.id !== id)
  if (filtered.length === files.length) return false
  saveFiles(filtered)
  return true
}

// ─── Strata Sync ──────────────────────────────────────────────────────────

/** Try to push a single file to Strata. Returns true on success. */
export async function syncFileToStrata(id: string): Promise<boolean> {
  const file = getFile(id)
  if (!file) return false

  try {
    const res = await localDaemonFetch(`${STRATA_BASE}/strata/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        path: file.path,
        content: file.content,
        tier: 'warm',
        metadata: {
          source: 'desktop',
          mimeType: file.mimeType,
          createdAt: file.createdAt,
        },
      }),
    })

    if (res.ok) {
      // Mark as synced
      const files = loadFiles()
      const idx = files.findIndex(f => f.id === id)
      if (idx !== -1) {
        files[idx].synced = true
        saveFiles(files)
      }
      return true
    }
    return false
  } catch (_e) {
    return false
  }
}

/** Attempt to sync all unsynced files. Returns count of successfully synced. */
export async function syncAllToStrata(): Promise<number> {
  const files = loadFiles().filter(f => !f.synced)
  let synced = 0
  for (const file of files) {
    const ok = await syncFileToStrata(file.id)
    if (ok) synced++
  }
  return synced
}

/** Check if Strata is reachable */
export async function isStrataOnline(): Promise<boolean> {
  try {
    const res = await localDaemonFetch(`${STRATA_BASE}/strata/stats`, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch (_e) {
    return false
  }
}

// ─── Recover Backup Integration ───────────────────────────────────────────

const RECOVER_BASE = 'http://localhost:8115'

/** Create a full backup of all desktop files via Recover */
export async function createRecoverBackup(): Promise<boolean> {
  const files = loadFiles()
  try {
    const res = await localDaemonFetch(`${RECOVER_BASE}/backup/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        source: 'desktop-filesystem',
        files: files.map(f => ({
          path: f.path,
          content: f.content,
          size: f.size,
          mimeType: f.mimeType,
          updatedAt: f.updatedAt,
        })),
        metadata: {
          file_count: files.length,
          total_size: files.reduce((sum, f) => sum + f.size, 0),
          created_at: new Date().toISOString(),
        },
      }),
    })
    return res.ok
  } catch (_e) {
    return false
  }
}

/** List available Recover backup snapshots */
export async function listRecoverSnapshots(): Promise<any[]> {
  try {
    const res = await localDaemonFetch(`${RECOVER_BASE}/backup/list?source=desktop-filesystem`, {
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = await res.json()
      return data.snapshots || data.backups || []
    }
    return []
  } catch (_e) {
    return []
  }
}

/** Restore files from a Recover snapshot */
export async function restoreFromSnapshot(snapshotId: string): Promise<number> {
  try {
    const res = await localDaemonFetch(`${RECOVER_BASE}/backup/restore/${snapshotId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return 0

    const data = await res.json()
    const restoredFiles = data.files || []
    const existing = loadFiles()

    let count = 0
    for (const rf of restoredFiles) {
      const existingIdx = existing.findIndex(f => f.path === rf.path)
      if (existingIdx >= 0) {
        // Update existing
        existing[existingIdx] = {
          ...existing[existingIdx],
          content: rf.content,
          updatedAt: Date.now(),
          size: new Blob([rf.content]).size,
          synced: false,
        }
      } else {
        // Create new
        existing.push({
          id: `file-${Date.now()}-${count}`,
          name: rf.path.split('/').pop() || 'restored',
          path: rf.path,
          content: rf.content,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          synced: false,
          mimeType: rf.mimeType || guessMime(rf.path.split('/').pop() || ''),
          size: new Blob([rf.content]).size,
        })
      }
      count++
    }
    saveFiles(existing)
    return count
  } catch (_e) {
    return 0
  }
}

/** Check if Recover is reachable */
export async function isRecoverOnline(): Promise<boolean> {
  try {
    const res = await localDaemonFetch(`${RECOVER_BASE}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch (_e) {
    return false
  }
}

/** Get total storage usage stats */
export function getStorageStats(): { used: number; total: number; fileCount: number } {
  const files = loadFiles()
  const used = files.reduce((sum, f) => sum + f.size, 0)
  return {
    used,
    total: 5 * 1024 * 1024, // ~5MB localStorage limit
    fileCount: files.length,
  }
}
