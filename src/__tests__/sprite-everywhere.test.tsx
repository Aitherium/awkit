/**
 * Kids suite S6, "Sprite everywhere": one look on every awkit surface.
 *
 * - LearnerSprite (the Learn home card), the Classroom strip, the Family console and the Sprite
 *   app all show the child's OWN creature: the host's live renderer for the one big Sprite,
 *   the snapshot PNG of the same design everywhere else; never an emoji, a CSS blob or the
 *   retired Bun/Blob art. With nothing to draw yet the Sprite is "waking up".
 * - The measured fallback: perfVerdict drops a slow device (p95 > 40 ms over the first 3 s),
 *   a 4 GB device or reduced motion to the snapshot; a Pixel-Tablet-class run at <= 33 ms
 *   keeps the live creature.
 * - SpritePanel: PREFER_CSS_CREATURE is false and the creature view never draws a CSS blob.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import * as fs from 'fs'
import * as path from 'path'
import { KidSpriteCard } from '../panels/LearnerSprite'
import { SpriteFace, SpriteRendererProvider, expressionFor, snapshotSrc, type SpriteRendererProps } from '../panels/spriteLook'
import { PERF_FALLBACK_P95_MS, PERF_TARGET_P95_MS, percentile, perfVerdict } from '../panels/spritePerf'
import SpritePanel, { PREFER_CSS_CREATURE } from '../panels/SpritePanel'

const KEY = 'ab'.repeat(32)
const SPRITE = { name: 'Comet', species: 'fox', stage: 'child', stage_word: 'Little', level: 3, snapshot: KEY }
const EMOJI_LOOK = /[\u{1F331}\u{1F95A}\u{1F98A}\u{1F989}\u{1F430}\u{1F432}\u{1F422}\u{1F431}\u{1F9A6}]/u

const SNAP_DESIGN = { species: 'fox', palette: 'twilight', wear: { head: 'bow' } }
/** The Sprite proxy as a fetch: the snapshot is the cleaned design, read in-household. */
function snapshotFetch() {
  const calls: string[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.credentials || ''} ${url}`)
    if (url === `/api/sprite/snapshots/${KEY}.json`) return { ok: true, status: 200, json: async () => ({ key: KEY, design: SNAP_DESIGN }) } as Response
    return { ok: false, status: 404, json: async () => ({}) } as Response
  })
  return calls
}

function FakeRenderer({ sprite, height }: SpriteRendererProps) {
  return <div data-testid="fake-3d" data-species={sprite.species ?? ''} style={{ height }} />
}

describe('one Sprite look on every surface', () => {
  it('the Learn card shows the live creature when the host has a renderer', () => {
    render(<SpriteRendererProvider renderer={FakeRenderer}><KidSpriteCard sprite={SPRITE} /></SpriteRendererProvider>)
    expect(screen.getByTestId('fake-3d').getAttribute('data-species')).toBe('fox')
    expect(screen.getByTestId('kid-sprite-card').textContent || '').not.toMatch(EMOJI_LOOK)
  })

  it('without a renderer it draws the snapshot design (fetched in-household), never an image or emoji', async () => {
    const calls = snapshotFetch()
    render(<KidSpriteCard sprite={SPRITE} />)
    const snap = await screen.findByTestId('sprite-snapshot')
    const svg = snap.querySelector('svg')!
    expect(svg.getAttribute('data-species')).toBe('fox')
    expect(svg.querySelector('[data-layer="head"]')).not.toBeNull()
    expect(svg.getAttribute('aria-label')).toBe('Comet')
    expect(snap.querySelector('img')).toBeNull()
    expect(calls).toContain(`same-origin /api/sprite/snapshots/${KEY}.json`)
    expect(screen.getByTestId('kid-sprite-card').textContent || '').not.toMatch(EMOJI_LOOK)
  })

  it('a snapshot it may not read (another household, gone) leaves the Sprite waking', async () => {
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response)
    render(<SpriteFace sprite={{ ...SPRITE, snapshot: 'cd'.repeat(32) }} size={64} />)
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(0))
    expect(screen.getByTestId('sprite-waking')).toBeTruthy()
    expect(screen.queryByTestId('sprite-snapshot')).toBeNull()
  })

  it('with neither, the Sprite is waking up, not a stand-in', () => {
    render(<KidSpriteCard sprite={{ ...SPRITE, snapshot: null }} />)
    expect(screen.getByTestId('sprite-waking')).toBeTruthy()
    expect(screen.queryByTestId('sprite-snapshot')).toBeNull()
    expect(screen.getByTestId('kid-sprite-card').textContent || '').not.toMatch(EMOJI_LOOK)
  })

  it('small faces never run the live renderer (one live creature per screen)', async () => {
    snapshotFetch()
    render(<SpriteRendererProvider renderer={FakeRenderer}><SpriteFace sprite={SPRITE} size={36} /></SpriteRendererProvider>)
    expect(screen.queryByTestId('fake-3d')).toBeNull()
    expect(await screen.findByTestId('sprite-snapshot')).toBeTruthy()
  })

  it('only a real snapshot key becomes a URL', () => {
    expect(snapshotSrc(KEY)).toBe(`/api/sprite/snapshots/${KEY}.json`)
    for (const bad of ['', '../x', 'AB'.repeat(32), `${KEY}0`, null, 42]) expect(snapshotSrc(bad)).toBeNull()
  })

  it('no awkit surface or Learn component still carries the retired emoji or blob looks', () => {
    const roots = [path.resolve(__dirname, '..'), path.resolve(__dirname, '../../../../AitherVeil/src/components/learn')]
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(tsx?|css)$/.test(e.name) && /[\u{1F331}\u{1F95A}]/u.test(fs.readFileSync(p, 'utf-8'))) hits.push(p)
      }
    }
    roots.forEach(walk)
    expect(hits).toEqual([])
  })
})

describe('perf budget: measured fallback to the snapshot', () => {
  const frames = (ms: number, n = 120) => Array.from({ length: n }, (_, i) => ms + (i % 10 === 0 ? 4 : 0))

  it('a tablet holding 30 fps keeps the live creature', () => {
    const v = perfVerdict(frames(PERF_TARGET_P95_MS - 6), 3200, { deviceMemory: 8 })
    expect(v.mode).toBe('live')
    expect(v.p95!).toBeLessThanOrEqual(PERF_TARGET_P95_MS)
  })

  it('a slow device (p95 over 40 ms) drops to the snapshot', () => {
    const v = perfVerdict(frames(PERF_FALLBACK_P95_MS + 5), 3200, { deviceMemory: 8 })
    expect(v).toMatchObject({ mode: 'snapshot', reason: 'slow' })
  })

  it('low memory and reduced motion never run the live creature', () => {
    expect(perfVerdict([], 0, { deviceMemory: 4 })).toMatchObject({ mode: 'snapshot', reason: 'low-memory' })
    expect(perfVerdict([], 0, { reducedMotion: true })).toMatchObject({ mode: 'snapshot', reason: 'reduced-motion' })
  })

  it('keeps measuring until three seconds and enough frames are in', () => {
    expect(perfVerdict(frames(16), 1500).mode).toBe('measuring')
    expect(perfVerdict(frames(16, 5), 3500).mode).toBe('measuring')
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5)
    expect(percentile([], 95)).toBeNull()
  })
})

describe('SpritePanel creature', () => {
  it('PREFER_CSS_CREATURE is false and the creature is the design, not a blob', async () => {
    expect(PREFER_CSS_CREATURE).toBe(false)
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/me/status')) {
        return { ok: true, status: 200, json: async () => ({
          name: 'Comet', species: 'fox', stage: 'child', form: 'balanced', needs: {}, mood: { valence: 0.5, arousal: 0.5 },
          mood_label: 'content', dormant: false, age_days: 3,
        }) } as Response
      }
      if (url.endsWith('/me/snapshot')) return { ok: true, status: 200, json: async () => ({ key: KEY, design_hash: 'ab'.repeat(16) }) } as Response
      if (url.endsWith(`/snapshots/${KEY}.json`)) return { ok: true, status: 200, json: async () => ({ key: KEY, design: SNAP_DESIGN }) } as Response
      return { ok: false, status: 404, json: async () => ({}) } as Response
    })
    render(<SpritePanel apiBase="/api/sprite" />)
    const view = await screen.findByTestId('sprite-creature-view')
    await waitFor(() => expect(view.getAttribute('data-look')).toBe('snapshot'))
    await waitFor(() => expect(view.querySelector('svg')?.getAttribute('data-species')).toBe('fox'))
    expect(view.querySelector('img')).toBeNull()
    expect(view.textContent || '').not.toMatch(/[◡‿⌒⌢]/)
  })
})

describe('sprites v2: the vector art is the Sprite on every surface', () => {
  const DESIGN = { species: 'owl', palette: 'ocean', wear: { head: 'party_hat' } }

  it('a card that carries its design draws the vector Sprite (no renderer, no snapshot needed)', () => {
    render(<SpriteFace sprite={{ ...SPRITE, snapshot: null, design: DESIGN }} size={64} />)
    const face = screen.getByTestId('sprite-vector-face')
    expect(face.getAttribute('data-look')).toBe('vector')
    const svg = face.querySelector('svg')!
    expect(svg.getAttribute('data-species')).toBe('owl')
    expect(svg.querySelector('[data-layer="head"]')).not.toBeNull()
    expect(screen.queryByTestId('sprite-snapshot')).toBeNull()
    expect(screen.queryByTestId('sprite-waking')).toBeNull()
  })

  it('the design beats a stale snapshot; the host live renderer still wins when asked for', () => {
    const { unmount } = render(<SpriteFace sprite={{ ...SPRITE, design: DESIGN }} size={120} />)
    expect(screen.getByTestId('sprite-vector-face')).toBeTruthy()
    expect(screen.queryByTestId('sprite-snapshot')).toBeNull()
    unmount()
    render(<SpriteRendererProvider renderer={FakeRenderer}><SpriteFace sprite={{ ...SPRITE, design: DESIGN }} size={160} live /></SpriteRendererProvider>)
    expect(screen.getByTestId('fake-3d')).toBeTruthy()
  })

  it('maps surface actions onto the six expressions', () => {
    expect(expressionFor('cheer')).toBe('happy')
    expect(expressionFor('think')).toBe('curious')
    expect(expressionFor('sleepy')).toBe('sleepy')
    expect(expressionFor('nod')).toBe('proud')
    expect(expressionFor('surprised')).toBe('surprised')
    expect(expressionFor(undefined)).toBe('content')
    expect(expressionFor('anything else')).toBe('content')
    render(<SpriteFace sprite={{ ...SPRITE, design: DESIGN }} size={80} action="think" />)
    expect(screen.getByTestId('sprite-vector-face').querySelector('svg')!.getAttribute('data-expression')).toBe('curious')
  })
})
