/**
 * The chat panel forwards the desktop snapshot the host window manager publishes on
 * `window.__AITHER_DESKTOP__`, so the workspace agent knows what is open.
 */
import { desktopContext } from '../ChatPanel'

afterEach(() => { delete (globalThis as any).__AITHER_DESKTOP__ })

test('returns the published snapshot', () => {
  const snap = { focused: 'Documents', windows: [{ app: 'document', title: 'Documents' }] }
  ;(globalThis as any).__AITHER_DESKTOP__ = snap
  expect(desktopContext()).toBe(snap)
})

test('is undefined with no desktop or a malformed value', () => {
  expect(desktopContext()).toBeUndefined()
  ;(globalThis as any).__AITHER_DESKTOP__ = 'nope'
  expect(desktopContext()).toBeUndefined()
})
