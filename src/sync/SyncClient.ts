/**
 * SyncClient — Offline-first sync layer with IndexedDB + Strata
 * ============================================================
 * Manages local-first synchronization via IndexedDB mirror (aither-sync),
 * with a mutation queue that flushes when online (navigator.onLine + 'online' event).
 *
 * Conflict resolution: Last-Write-Wins (LWW) by client-supplied ts field.
 *
 * Wire contract:
 *   GET  /api/sync/[namespace]          → { namespace, entries: [...], lastSync, online }
 *   GET  /api/sync/[namespace]/[key]    → { value, ts, deleted, synced, lastSync }
 *   PUT  /api/sync/[namespace]/[key]    → POST { value, ts } → { ok, synced, ts, lastSync }
 *   DELETE /api/sync/[namespace]/[key]  → POST { ts } → { ok, synced, ts, deleted, lastSync }
 */

interface SyncEntry {
  key: string
  value: any
  ts: number
  deleted?: boolean
}

interface MutationRecord {
  id: string
  namespace: string
  key: string
  operation: 'set' | 'delete'
  value?: any
  ts: number
  attempted: number
  createdAt: number
}

/**
 * SyncClient manages offline-first sync for a single namespace.
 * Create one per namespace/feature.
 */
export class SyncClient {
  private dbName = 'aither-sync'
  private storeName = 'data'
  private mutationQueueName = 'mutations'
  private namespace: string
  private db: IDBDatabase | null = null
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
  private listeners: Set<() => void> = new Set()
  private flushInProgress = false

  constructor(namespace: string) {
    this.namespace = namespace
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline())
      window.addEventListener('offline', () => this.handleOffline())
    }
  }

  /**
   * Initialize IndexedDB (one-time, safe to call multiple times).
   */
  async init(): Promise<void> {
    if (this.db) return

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1)

      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        this.db = req.result
        resolve()
      }

      req.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains(this.mutationQueueName)) {
          db.createObjectStore(this.mutationQueueName, { keyPath: 'id', autoIncrement: true })
        }
      }
    })
  }

  /**
   * Get a value from the local mirror (returns immediately).
   */
  async get(key: string): Promise<any> {
    await this.init()
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      const tx = this.db.transaction([this.storeName], 'readonly')
      const store = tx.objectStore(this.storeName)
      const req = store.get(`${this.namespace}:${key}`)

      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const record = req.result
        resolve(record ? record.value : undefined)
      }
    })
  }

  /**
   * Set a value locally (queues for sync).
   * Returns immediately with the local value.
   */
  async set(key: string, value: any): Promise<void> {
    await this.init()
    const ts = Date.now()

    return new Promise<void>((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      // Write to local store
      const tx = this.db.transaction([this.storeName, this.mutationQueueName], 'readwrite')
      const store = tx.objectStore(this.storeName)
      const mutQueue = tx.objectStore(this.mutationQueueName)

      const entry: SyncEntry = {
        key: `${this.namespace}:${key}`,
        value,
        ts,
        deleted: false,
      }

      const mutation: MutationRecord = {
        id: `${this.namespace}:${key}:${ts}`,
        namespace: this.namespace,
        key,
        operation: 'set',
        value,
        ts,
        attempted: 0,
        createdAt: Date.now(),
      }

      const storeReq = store.put(entry)
      const mutReq = mutQueue.add(mutation)

      tx.onerror = () => reject(tx.error)
      tx.oncomplete = () => {
        this.notifyListeners()
        resolve(undefined)
      }
    }).then(() => {
      // Attempt flush immediately if online
      if (this.isOnline) {
        this.flushMutations().catch((_e) => {
          // Silently fail; will retry on next flush
        })
      }
    })
  }

  /**
   * Delete a key (tombstone; queues for sync).
   */
  async delete(key: string): Promise<void> {
    await this.init()
    const ts = Date.now()

    return new Promise<void>((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      const tx = this.db.transaction([this.storeName, this.mutationQueueName], 'readwrite')
      const store = tx.objectStore(this.storeName)
      const mutQueue = tx.objectStore(this.mutationQueueName)

      const entry: SyncEntry = {
        key: `${this.namespace}:${key}`,
        value: null,
        ts,
        deleted: true,
      }

      const mutation: MutationRecord = {
        id: `${this.namespace}:${key}:${ts}`,
        namespace: this.namespace,
        key,
        operation: 'delete',
        ts,
        attempted: 0,
        createdAt: Date.now(),
      }

      const storeReq = store.put(entry)
      const mutReq = mutQueue.add(mutation)

      tx.onerror = () => reject(tx.error)
      tx.oncomplete = () => {
        this.notifyListeners()
        resolve(undefined)
      }
    }).then(() => {
      if (this.isOnline) {
        this.flushMutations().catch((_e) => {
          // Silently fail
        })
      }
    })
  }

  /**
   * Pull and merge entries from the server (LWW by ts).
   * Updates local store with newer entries.
   */
  async pull(): Promise<{ lastSync: string; online: boolean; entriesUpdated: number }> {
    await this.init()

    try {
      const resp = await fetch(`/api/sync/${this.namespace}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      })

      if (!resp.ok) {
        return { lastSync: new Date().toISOString(), online: false, entriesUpdated: 0 }
      }

      const data = await resp.json()
      const entries: SyncEntry[] = data.entries || []

      // Merge into local store (LWW by ts)
      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error('Database not initialized'))
          return
        }

        const tx = this.db.transaction([this.storeName], 'readwrite')
        const store = tx.objectStore(this.storeName)
        let updated = 0

        for (const entry of entries) {
          const localKey = `${this.namespace}:${entry.key}`
          const getReq = store.get(localKey)

          getReq.onsuccess = () => {
            const local = getReq.result
            // Keep the newer entry (LWW)
            if (!local || entry.ts > local.ts) {
              store.put({
                ...entry,
                key: localKey,
              })
              updated++
            }
          }
        }

        tx.onerror = () => reject(tx.error)
        tx.oncomplete = () => {
          this.notifyListeners()
          resolve({
            lastSync: data.lastSync || new Date().toISOString(),
            online: data.online !== false,
            entriesUpdated: updated,
          })
        }
      })
    } catch (_e) {
      return { lastSync: new Date().toISOString(), online: false, entriesUpdated: 0 }
    }
  }

  /**
   * Flush pending mutations to the server (with backoff retry).
   */
  private async flushMutations(): Promise<void> {
    if (this.flushInProgress || !this.isOnline) return

    this.flushInProgress = true

    try {
      await this.init()

      const mutations = await this.getMutations()
      if (mutations.length === 0) {
        this.flushInProgress = false
        return
      }

      for (const mut of mutations) {
        const success = await this.flushMutation(mut)
        if (!success) {
          break // Backoff; retry next flush
        }
      }
    } finally {
      this.flushInProgress = false
    }
  }

  private async flushMutation(mut: MutationRecord): Promise<boolean> {
    const endpoint = `/api/sync/${mut.namespace}/${mut.key}`

    try {
      const resp = await fetch(endpoint, {
        method: mut.operation === 'delete' ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: mut.operation === 'set' ? mut.value : undefined,
          ts: mut.ts,
        }),
        signal: AbortSignal.timeout(5000),
      })

      if (resp.ok) {
        // Remove from queue
        await this.removeMutation(mut.id)
        return true
      } else if (resp.status >= 500) {
        // Server error; retry later
        return false
      } else if (resp.status === 400) {
        // Client error; skip this mutation
        await this.removeMutation(mut.id)
        return true
      }

      return false
    } catch (_e) {
      // Network error; retry later
      return false
    }
  }

  private async getMutations(): Promise<MutationRecord[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      const tx = this.db.transaction([this.mutationQueueName], 'readonly')
      const store = tx.objectStore(this.mutationQueueName)
      const req = store.getAll()

      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        resolve(req.result)
      }
    })
  }

  private async removeMutation(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      const tx = this.db.transaction([this.mutationQueueName], 'readwrite')
      const store = tx.objectStore(this.mutationQueueName)
      const req = store.delete(id)

      req.onerror = () => reject(req.error)
      tx.oncomplete = () => resolve()
    })
  }

  /**
   * Subscribe to local changes (for React hook re-renders).
   */
  onLocalChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notifyListeners(): void {
    this.listeners.forEach((fn) => fn())
  }

  private handleOnline(): void {
    this.isOnline = true
    this.flushMutations().catch((_e) => {
      // Silently fail
    })
  }

  private handleOffline(): void {
    this.isOnline = false
  }

  getOnlineStatus(): boolean {
    return this.isOnline
  }
}
