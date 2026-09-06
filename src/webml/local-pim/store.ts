// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/**
 * Local PIM — the local-first personal data layer for the Living OS.
 *
 * Calendar events and notes live in IndexedDB in the user's browser: instant reads,
 * offline-safe, zero login, zero fleet round-trip. This is the spine both the OS apps
 * (calendar-app, notes-app) and the agent tools (notes_*, calendar_*) read and write —
 * one module owns the data, so the agent's "add a note" shows up in the app instantly.
 *
 * Sync (Chronos for calendar, AitherOne for notes) is a SEPARATE later layer that reads
 * this same store; it is deliberately not here. Local-first means the local copy is the
 * truth until sync lands.
 *
 * Two object stores:
 *   - `events` indexed by `start` (ISO) for range queries.
 *   - `notes`  indexed by `updatedAt` (ISO) for recency.
 *
 * A tiny emitter notifies subscribers after any mutation, so the apps re-render without
 * polling. This is the reactive bit the OS apps need; it costs nothing when unused.
 */

export interface LocalEvent {
  id: string
  title: string
  /** ISO 8601. The primary sort key. */
  start: string
  end: string
  allDay?: boolean
  /** A free-form calendar/source label ("Personal", "Work"). Defaults to "Personal". */
  calendar?: string
  location?: string
  notes?: string
  /** Set by the fleet sync seam once this event is mirrored to Chronos. Absent = unsynced. */
  remoteId?: string
  createdAt: string
  updatedAt: string
}

export interface LocalNote {
  id: string
  title: string
  body: string
  tags?: string[]
  pinned?: boolean
  /** Set by the fleet sync seam once this note is mirrored to an AitherOne document. */
  remoteId?: string
  createdAt: string
  updatedAt: string
}

export interface LocalTask {
  id: string
  title: string
  notes?: string
  /** ISO 8601 due instant (optional). Open tasks sort by this, nearest first. */
  due?: string
  done: boolean
  createdAt: string
  updatedAt: string
}

/** A saved snippet/page — the local-first knowledge base. */
export interface LocalKbItem {
  id: string
  title: string
  content: string
  /** The page this was saved from, if any. */
  sourceUrl?: string
  tags?: string[]
  createdAt: string
  updatedAt: string
}

const DB_NAME = 'aither-local-pim'
const DB_VERSION = 2
const EVENTS = 'events'
const NOTES = 'notes'
const TASKS = 'tasks'
const KB = 'kb_items'

type Listener = () => void

let dbPromise: Promise<IDBDatabase> | null = null
const listeners = new Set<Listener>()

/** Subscribe to store mutations. Returns an unsubscribe function. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * TEST ONLY: drop the cached connection + subscribers so a fresh IndexedDB shim takes
 * effect. The connection promise is cached at module level by design (a real IndexedDB
 * connection should be opened once), which means tests must clear it or they keep talking
 * to the previous test's database instance.
 */
export function __resetForTests(): void {
  dbPromise = null
  listeners.clear()
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* a listener must not break the store */
    }
  }
}

function openDb(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('IndexedDB not available'))
  }
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(EVENTS)) {
        const s = db.createObjectStore(EVENTS, { keyPath: 'id' })
        s.createIndex('by-start', 'start')
      }
      if (!db.objectStoreNames.contains(NOTES)) {
        const s = db.createObjectStore(NOTES, { keyPath: 'id' })
        s.createIndex('by-updated', 'updatedAt')
      }
      if (!db.objectStoreNames.contains(TASKS)) {
        const s = db.createObjectStore(TASKS, { keyPath: 'id' })
        s.createIndex('by-due', 'due')
        s.createIndex('by-updated', 'updatedAt')
      }
      if (!db.objectStoreNames.contains(KB)) {
        const s = db.createObjectStore(KB, { keyPath: 'id' })
        s.createIndex('by-updated', 'updatedAt')
      }
    }
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
    req.onsuccess = () => resolve(req.result)
  })
  return dbPromise
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function nowIso(): string {
  return new Date().toISOString()
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** All mutations funnel through here so the emitter fires exactly once per op. */
async function mutate<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDb()
  const result = await fn(db)
  notify()
  return result
}

/* ─────────────────────────────── Events ─────────────────────────────── */

export async function listEvents(
  fromIso?: string,
  toIso?: string,
): Promise<LocalEvent[]> {
  if (typeof window === 'undefined') return []
  try {
    const db = await openDb()
    const tx = db.transaction(EVENTS, 'readonly')
    const index = tx.objectStore(EVENTS).index('by-start')
    let req: IDBRequest<LocalEvent[]>
    if (fromIso && toIso) {
      req = index.getAll(IDBKeyRange.bound(fromIso, toIso))
    } else if (fromIso) {
      req = index.getAll(IDBKeyRange.lowerBound(fromIso))
    } else {
      req = index.getAll()
    }
    const all = await reqToPromise(req)
    return all
  } catch {
    return []
  }
}

export async function getEvent(id: string): Promise<LocalEvent | null> {
  if (typeof window === 'undefined') return null
  try {
    const db = await openDb()
    const req = db.transaction(EVENTS, 'readonly').objectStore(EVENTS).get(id)
    return (await reqToPromise(req)) || null
  } catch {
    return null
  }
}

export async function createEvent(
  input: Omit<LocalEvent, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<LocalEvent> {
  const ev: LocalEvent = {
    ...input,
    id: uid(),
    calendar: input.calendar || 'Personal',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  await mutate(async (db) => {
    await reqToPromise(db.transaction(EVENTS, 'readwrite').objectStore(EVENTS).put(ev))
  })
  return ev
}

export async function updateEvent(
  id: string,
  patch: Partial<Omit<LocalEvent, 'id' | 'createdAt'>>,
): Promise<LocalEvent | null> {
  return mutate(async (db) => {
    const store = db.transaction(EVENTS, 'readwrite').objectStore(EVENTS)
    const existing = (await reqToPromise(store.get(id))) as LocalEvent | undefined
    if (!existing) return null
    const updated: LocalEvent = { ...existing, ...patch, id, updatedAt: nowIso() }
    await reqToPromise(store.put(updated))
    return updated
  })
}

export async function deleteEvent(id: string): Promise<void> {
  await mutate(async (db) => {
    await reqToPromise(db.transaction(EVENTS, 'readwrite').objectStore(EVENTS).delete(id))
  })
}

/* ─────────────────────────────── Notes ─────────────────────────────── */

export async function listNotes(): Promise<LocalNote[]> {
  if (typeof window === 'undefined') return []
  try {
    const db = await openDb()
    const index = db.transaction(NOTES, 'readonly').objectStore(NOTES).index('by-updated')
    const all = await reqToPromise(index.getAll())
    // Newest first.
    return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  } catch {
    return []
  }
}

export async function getNote(id: string): Promise<LocalNote | null> {
  if (typeof window === 'undefined') return null
  try {
    const db = await openDb()
    const req = db.transaction(NOTES, 'readonly').objectStore(NOTES).get(id)
    return (await reqToPromise(req)) || null
  } catch {
    return null
  }
}

export async function createNote(
  input: Omit<LocalNote, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<LocalNote> {
  const note: LocalNote = {
    ...input,
    id: uid(),
    title: input.title.trim() || 'Untitled',
    tags: input.tags ?? [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  await mutate(async (db) => {
    await reqToPromise(db.transaction(NOTES, 'readwrite').objectStore(NOTES).put(note))
  })
  return note
}

export async function updateNote(
  id: string,
  patch: Partial<Omit<LocalNote, 'id' | 'createdAt'>>,
): Promise<LocalNote | null> {
  return mutate(async (db) => {
    const store = db.transaction(NOTES, 'readwrite').objectStore(NOTES)
    const existing = (await reqToPromise(store.get(id))) as LocalNote | undefined
    if (!existing) return null
    const updated: LocalNote = { ...existing, ...patch, id, updatedAt: nowIso() }
    await reqToPromise(store.put(updated))
    return updated
  })
}

export async function deleteNote(id: string): Promise<void> {
  await mutate(async (db) => {
    await reqToPromise(db.transaction(NOTES, 'readwrite').objectStore(NOTES).delete(id))
  })
}

/** Case-insensitive search over title + body + tags. */
export async function searchNotes(q: string): Promise<LocalNote[]> {
  const all = await listNotes()
  const needle = q.trim().toLowerCase()
  if (!needle) return all
  return all.filter(
    (n) =>
      n.title.toLowerCase().includes(needle) ||
      n.body.toLowerCase().includes(needle) ||
      (n.tags ?? []).some((t) => t.toLowerCase().includes(needle)),
  )
}

/**
 * Convenience for the 'Today' home: events whose day window overlaps `day`.
 *
 * The window is the LOCAL day: boundaries are built from the date's y/m/d components
 * (not `setHours` on the input instant), so the same `day` yields the same window in any
 * timezone. Events are stored as absolute UTC ISO instants, so string comparison against
 * the local-day ISO bounds is correct.
 */
export async function eventsForDay(day: Date): Promise<LocalEvent[]> {
  const y = day.getFullYear()
  const m = day.getMonth()
  const d = day.getDate()
  const start = new Date(y, m, d, 0, 0, 0, 0)
  const end = new Date(y, m, d, 23, 59, 59, 999)
  return listEvents(start.toISOString(), end.toISOString())
}

/* ─────────────────────────────── Tasks ─────────────────────────────── */

/**
 * Open tasks first (nearest due first, undated last), then done tasks by recency.
 * One deliberate sort here rather than in each consumer, so the app and the agent
 * tools show the same order.
 */
export async function listTasks(): Promise<LocalTask[]> {
  if (typeof window === 'undefined') return []
  try {
    const db = await openDb()
    const req = db.transaction(TASKS, 'readonly').objectStore(TASKS).getAll()
    const all = (await reqToPromise(req)) as LocalTask[]
    const open = all.filter((t) => !t.done).sort((a, b) => {
      if (a.due && b.due) return a.due < b.due ? -1 : 1
      if (a.due) return -1
      if (b.due) return 1
      return a.updatedAt < b.updatedAt ? 1 : -1
    })
    const done = all.filter((t) => t.done).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    return [...open, ...done]
  } catch {
    return []
  }
}

export async function getTask(id: string): Promise<LocalTask | null> {
  if (typeof window === 'undefined') return null
  try {
    const db = await openDb()
    const req = db.transaction(TASKS, 'readonly').objectStore(TASKS).get(id)
    return (await reqToPromise(req)) || null
  } catch {
    return null
  }
}

export async function createTask(
  input: Omit<LocalTask, 'id' | 'done' | 'createdAt' | 'updatedAt'> & { done?: boolean },
): Promise<LocalTask> {
  const task: LocalTask = {
    ...input,
    id: uid(),
    title: input.title.trim() || 'Untitled task',
    done: input.done ?? false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  await mutate(async (db) => {
    await reqToPromise(db.transaction(TASKS, 'readwrite').objectStore(TASKS).put(task))
  })
  return task
}

export async function updateTask(
  id: string,
  patch: Partial<Omit<LocalTask, 'id' | 'createdAt'>>,
): Promise<LocalTask | null> {
  return mutate(async (db) => {
    const store = db.transaction(TASKS, 'readwrite').objectStore(TASKS)
    const existing = (await reqToPromise(store.get(id))) as LocalTask | undefined
    if (!existing) return null
    const updated: LocalTask = { ...existing, ...patch, id, updatedAt: nowIso() }
    await reqToPromise(store.put(updated))
    return updated
  })
}

export async function deleteTask(id: string): Promise<void> {
  await mutate(async (db) => {
    await reqToPromise(db.transaction(TASKS, 'readwrite').objectStore(TASKS).delete(id))
  })
}

/* ─────────────────────────── Knowledge base ─────────────────────────── */

export async function listKbItems(): Promise<LocalKbItem[]> {
  if (typeof window === 'undefined') return []
  try {
    const db = await openDb()
    const index = db.transaction(KB, 'readonly').objectStore(KB).index('by-updated')
    const all = (await reqToPromise(index.getAll())) as LocalKbItem[]
    return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  } catch {
    return []
  }
}

export async function getKbItem(id: string): Promise<LocalKbItem | null> {
  if (typeof window === 'undefined') return null
  try {
    const db = await openDb()
    const req = db.transaction(KB, 'readonly').objectStore(KB).get(id)
    return (await reqToPromise(req)) || null
  } catch {
    return null
  }
}

export async function createKbItem(
  input: Omit<LocalKbItem, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<LocalKbItem> {
  const item: LocalKbItem = {
    ...input,
    id: uid(),
    title: input.title.trim() || 'Untitled',
    tags: input.tags ?? [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  await mutate(async (db) => {
    await reqToPromise(db.transaction(KB, 'readwrite').objectStore(KB).put(item))
  })
  return item
}

export async function updateKbItem(
  id: string,
  patch: Partial<Omit<LocalKbItem, 'id' | 'createdAt'>>,
): Promise<LocalKbItem | null> {
  return mutate(async (db) => {
    const store = db.transaction(KB, 'readwrite').objectStore(KB)
    const existing = (await reqToPromise(store.get(id))) as LocalKbItem | undefined
    if (!existing) return null
    const updated: LocalKbItem = { ...existing, ...patch, id, updatedAt: nowIso() }
    await reqToPromise(store.put(updated))
    return updated
  })
}

export async function deleteKbItem(id: string): Promise<void> {
  await mutate(async (db) => {
    await reqToPromise(db.transaction(KB, 'readwrite').objectStore(KB).delete(id))
  })
}

/** Case-insensitive search over title + content + sourceUrl + tags. */
export async function searchKbItems(q: string): Promise<LocalKbItem[]> {
  const all = await listKbItems()
  const needle = q.trim().toLowerCase()
  if (!needle) return all
  return all.filter(
    (i) =>
      i.title.toLowerCase().includes(needle) ||
      i.content.toLowerCase().includes(needle) ||
      (i.sourceUrl ?? '').toLowerCase().includes(needle) ||
      (i.tags ?? []).some((t) => t.toLowerCase().includes(needle)),
  )
}
