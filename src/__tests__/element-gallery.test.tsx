// @vitest-environment jsdom
/**
 * ElementGallery — the uiverse-style grid: one LIVE tile per element, search
 * and category filtering, the code drawer with the element's exact source, and
 * `?element=<id>` as a shareable deep link.
 *
 * Rendered with react-dom in jsdom (the awkit test convention) over a small
 * injected element set, so the count assertions do not drift as authors add
 * elements to the real registry.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import ElementGallery from '../panels/ElementGallery'
import type { ElementEntry } from '../elements/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeEntry(
  id: string,
  title: string,
  category: ElementEntry['category'],
  tags: string[],
  code: string,
): ElementEntry {
  function Live() {
    return <span data-testid={`live-${id}`}>{title}</span>
  }
  return { id, title, category, tags, code, Component: Live }
}

const ENTRIES: ElementEntry[] = [
  makeEntry('buttons-alpha', 'Alpha Button', 'buttons', ['alpha', 'primary', 'click'], "<button>Alpha</button>\n"),
  makeEntry('loaders-spin', 'Spinning Loader', 'loaders', ['spinner', 'loading', 'motion'], 'const spin = true\n'),
  makeEntry('cards-stat', 'Stat Card', 'cards', ['stat', 'metric', 'dashboard'], 'export const card = 1\n'),
]

let container: HTMLDivElement
let root: Root

async function renderGallery(elements: ElementEntry[] = ENTRIES) {
  await act(async () => {
    root.render(<ElementGallery elements={elements} />)
  })
}

function get(testId: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (!el) throw new Error(`no [data-testid=${testId}]`)
  return el
}

function queryAll(testId: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`))
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click()
  })
}

async function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.history.replaceState({}, '', '/')
})

describe('ElementGallery', () => {
  it('renders one live tile per element and counts them per category', async () => {
    await renderGallery()

    expect(queryAll('awk-gallery-tile')).toHaveLength(ENTRIES.length)
    // Each tile mounts the element itself, not a screenshot.
    expect(get('live-buttons-alpha').textContent).toBe('Alpha Button')
    expect(get('live-loaders-spin').textContent).toBe('Spinning Loader')

    expect(get('awk-gallery-cat-all').textContent).toContain('3')
    expect(get('awk-gallery-cat-buttons').textContent).toContain('1')
    expect(get('awk-gallery-cat-cards').textContent).toContain('1')
    expect(get('awk-gallery-cat-badges').textContent).toContain('0')
  })

  it('filters by title, id and tag from the search box', async () => {
    await renderGallery()
    const search = get('awk-gallery-search') as HTMLInputElement

    await typeInto(search, 'spinner')
    expect(queryAll('awk-gallery-tile')).toHaveLength(1)
    expect(container.textContent).toContain('Spinning Loader')

    await typeInto(search, 'cards-stat')
    expect(queryAll('awk-gallery-tile')).toHaveLength(1)
    expect(container.textContent).toContain('Stat Card')

    await typeInto(search, 'nothing-matches-this')
    expect(queryAll('awk-gallery-tile')).toHaveLength(0)
    expect(get('awk-gallery-empty').textContent).toContain('No elements match')

    await click(get('awk-gallery-empty').querySelector('button') as HTMLElement)
    expect(queryAll('awk-gallery-tile')).toHaveLength(ENTRIES.length)
  })

  it('filters by category and combines it with search', async () => {
    await renderGallery()

    await click(get('awk-gallery-cat-loaders'))
    expect(queryAll('awk-gallery-tile')).toHaveLength(1)
    expect(container.textContent).toContain('Spinning Loader')

    await click(get('awk-gallery-cat-all'))
    await click(get('awk-gallery-cat-buttons'))
    expect(queryAll('awk-gallery-tile')).toHaveLength(1)

    await typeInto(get('awk-gallery-search') as HTMLInputElement, 'stat')
    expect(queryAll('awk-gallery-tile')).toHaveLength(0)
    expect(get('awk-gallery-empty')).not.toBeNull()
  })

  it('opens the code drawer with the exact source and writes ?element=<id>', async () => {
    await renderGallery()

    await click(get('awk-gallery-code-cards-stat'))

    const drawer = get('awk-gallery-drawer')
    expect(drawer.getAttribute('role')).toBe('dialog')
    expect(get('awk-gallery-source').textContent).toBe('export const card = 1\n')
    expect(drawer.textContent).toContain('cards-stat')
    expect(new URLSearchParams(window.location.search).get('element')).toBe('cards-stat')

    // Escape closes and removes the deep-link parameter.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.querySelector('[data-testid="awk-gallery-drawer"]')).toBeNull()
    expect(new URLSearchParams(window.location.search).get('element')).toBeNull()
  })

  it('opens the drawer from a ?element= deep link on mount', async () => {
    window.history.replaceState({}, '', '/?element=loaders-spin&tab=elements')
    await renderGallery()

    const drawer = get('awk-gallery-drawer')
    expect(drawer.textContent).toContain('Spinning Loader')
    expect(get('awk-gallery-source').textContent).toBe('const spin = true\n')
    // Other query parameters survive.
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('elements')
  })

  it('ignores an unknown ?element= id instead of showing an empty drawer', async () => {
    window.history.replaceState({}, '', '/?element=buttons-does-not-exist')
    await renderGallery()
    expect(container.querySelector('[data-testid="awk-gallery-drawer"]')).toBeNull()
    expect(queryAll('awk-gallery-tile')).toHaveLength(ENTRIES.length)
  })

  it('switches the preview background between dark, light and accent', async () => {
    await renderGallery()
    const gallery = get('awk-gallery')

    expect(gallery.getAttribute('data-preview')).toBe('dark')
    await click(get('awk-gallery-preview-light'))
    expect(gallery.getAttribute('data-preview')).toBe('light')
    expect(get('awk-gallery-preview-light').getAttribute('aria-pressed')).toBe('true')
    await click(get('awk-gallery-preview-accent'))
    expect(gallery.getAttribute('data-preview')).toBe('accent')
  })
})
