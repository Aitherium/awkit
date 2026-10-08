/**
 * Bounded undo/redo of patches. Pure: the patch type is opaque, the caller says how big
 * each one is, and the oldest entries fall off once the byte or entry budget is spent.
 * A new entry clears the redo side, as every editor does.
 */

export interface PatchStackOptions {
  /** Total bytes kept across undo + redo. Default 192 MiB. */
  maxBytes?: number
  /** Most undo steps kept. Default 50. */
  maxEntries?: number
}

export class PatchStack<T> {
  private undoList: { patch: T; bytes: number }[] = []
  private redoList: { patch: T; bytes: number }[] = []
  private bytes = 0
  private readonly maxBytes: number
  private readonly maxEntries: number

  constructor(opts: PatchStackOptions = {}) {
    this.maxBytes = opts.maxBytes ?? 192 * 1024 * 1024
    this.maxEntries = Math.max(1, opts.maxEntries ?? 50)
  }

  get canUndo(): boolean { return this.undoList.length > 0 }
  get canRedo(): boolean { return this.redoList.length > 0 }
  get size(): { undo: number; redo: number; bytes: number } {
    return { undo: this.undoList.length, redo: this.redoList.length, bytes: this.bytes }
  }

  push(patch: T, bytes: number): void {
    for (const r of this.redoList) this.bytes -= r.bytes
    this.redoList = []
    this.undoList.push({ patch, bytes })
    this.bytes += bytes
    while (this.undoList.length > 1 && (this.undoList.length > this.maxEntries || this.bytes > this.maxBytes)) {
      const dropped = this.undoList.shift()!
      this.bytes -= dropped.bytes
    }
  }

  /** The patch to revert, moved to the redo side; null when there is nothing to undo. */
  undo(): T | null {
    const e = this.undoList.pop()
    if (!e) return null
    this.redoList.push(e)
    return e.patch
  }

  /** The patch to re-apply, moved back to the undo side; null when there is nothing to redo. */
  redo(): T | null {
    const e = this.redoList.pop()
    if (!e) return null
    this.undoList.push(e)
    return e.patch
  }

  clear(): void {
    this.undoList = []
    this.redoList = []
    this.bytes = 0
  }
}
