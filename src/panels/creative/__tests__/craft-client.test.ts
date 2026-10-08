/**
 * The Image Studio's client to the hosted lane (craft brick B4).
 *
 * Pins: it only ever calls /api/iris/craft/* (never a media-forge path); a refusal resolves
 * with the server's own words whatever the status; a transport failure never claims nothing
 * was charged; the estimate degrades to null when the route is absent; the mask is white where
 * painted; the op bodies match the engine's params.
 */
import * as fs from 'fs'
import * as path from 'path'

import {
  alphaToMask, buildActionParams, costLine, estimate, getLibrary, maskCoverage, mediaInFolder,
  mediaSrc, outcomeText, runCraftOp, serverWords,
  type CraftLibrary, type CraftOpResult,
} from '../craft-client'

type Reply = { status: number; body?: unknown; throws?: boolean }

function mockFetch(reply: Reply | ((url: string, init?: RequestInit) => Reply)) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = typeof reply === 'function' ? reply(url, init) : reply
    if (r.throws) throw new TypeError('Failed to fetch')
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => {
        if (r.body === undefined) throw new SyntaxError('no body')
        return r.body
      },
    }
  })
  return calls
}

const o = { apiBase: '' }

describe('the client talks only to the hosted lane', () => {
  it('names no media-forge path anywhere in its source', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'craft-client.ts'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/\/api\/mediaforge|\/api\/studio|\/api\/op\b|\/api\/ops\b|:8200/)
    expect(code).toMatch(/\/api\/iris\/craft/)
  })

  it('runs an op at /api/iris/craft/op/<name> with the params and folder', async () => {
    const calls = mockFetch({ status: 200, body: { ok: true, credits_charged: 100, media: [] } })
    await runCraftOp(o, 'inpaint', { image: 7, prompt: 'hat', mask: 'data:x' }, 'f_1')
    expect(calls[0].url).toBe('/api/iris/craft/op/inpaint')
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      params: { image: 7, prompt: 'hat', mask: 'data:x' }, folder_id: 'f_1',
    })
  })

  it('reads the library from /api/iris/craft/library and throws the server words on 401', async () => {
    mockFetch({ status: 401, body: { detail: { error: 'Sign in to use Iris; hosted generation is paid with credits.' } } })
    await expect(getLibrary(o)).rejects.toThrow('Sign in to use Iris; hosted generation is paid with credits.')
  })
})

describe('runCraftOp resolves refusals with the server words', () => {
  it('402 out of credits keeps the error, buy_url and zero charge', async () => {
    mockFetch({ status: 402, body: { ok: false, error_code: 'insufficient_credits', error: 'Not enough credits to run inpaint: it costs 100, you have 5.', buy_url: 'https://shop/credits', credits_charged: 0 } })
    const r = await runCraftOp(o, 'inpaint', {})
    expect(r.ok).toBe(false)
    expect(r.error).toBe('Not enough credits to run inpaint: it costs 100, you have 5.')
    expect(r.buy_url).toBe('https://shop/credits')
    expect(outcomeText(r)).toBe('Not enough credits to run inpaint: it costs 100, you have 5. Nothing was charged.')
  })

  it('a 200 ok:false engine failure is a failure, not a success', async () => {
    mockFetch({ status: 200, body: { ok: false, error: 'mask error: bad png', credits_charged: 0, media: [] } })
    const r = await runCraftOp(o, 'inpaint', {})
    expect(r.ok).toBe(false)
    expect(outcomeText(r)).toBe('mask error: bad png Nothing was charged.')
  })

  it('a non-2xx with ok:true is still not a success', async () => {
    mockFetch({ status: 502, body: { ok: true, media: [] } })
    expect((await runCraftOp(o, 'txt2img', {})).ok).toBe(false)
  })

  it('a transport failure does not claim nothing was charged', async () => {
    mockFetch({ status: 0, throws: true })
    const r = await runCraftOp(o, 'txt2img', { prompt: 'x' })
    expect(r.ok).toBe(false)
    expect(r.transport).toBe(true)
    expect(outcomeText(r)).not.toMatch(/Nothing was charged/)
    expect(outcomeText(r)).toMatch(/Check your library/)
  })

  it('reports what WAS charged when the server says so', () => {
    const r: CraftOpResult = { ok: false, error: 'partial', credits_charged: 150, media: [] }
    expect(outcomeText(r)).toBe('partial 150 credits were charged.')
  })

  it('success says what was charged', () => {
    expect(outcomeText({ ok: true, credits_charged: 100, media: [] })).toBe('Done — 100 credits charged.')
    expect(outcomeText({ ok: true, credits_charged: 0, media: [] })).toBe('Done — nothing was charged.')
    expect(outcomeText({ ok: true, credits_charged: 0, unmetered: true, media: [] })).toMatch(/not metered/)
  })
})

describe('estimate', () => {
  it('returns the quote', async () => {
    mockFetch({ status: 200, body: { ok: true, credits: 300, units: 3 } })
    const q = await estimate(o, 'txt2img', { prompt: 'x', count: 3 })
    expect(q).toEqual({ ok: true, credits: 300, units: 3 })
    expect(costLine(q, 100)).toBe('This run costs 300 credits (3 units).')
  })

  it('degrades to null when the route is absent or unreachable', async () => {
    mockFetch({ status: 404, body: { detail: 'Not Found' } })
    expect(await estimate(o, 'txt2img', {})).toBeNull()
    // an older Veil whose allowlist has no estimate row answers 404 with an ok:false body
    mockFetch({ status: 404, body: { ok: false, error: 'not a studio route' } })
    expect(await estimate(o, 'txt2img', {})).toBeNull()
    mockFetch({ status: 0, throws: true })
    expect(await estimate(o, 'txt2img', {})).toBeNull()
    mockFetch({ status: 502, body: { success: false, error: 'iris unreachable' } })
    expect(await estimate(o, 'txt2img', {})).toBeNull()
  })

  it('keeps a server refusal as the answer', async () => {
    mockFetch({ status: 451, body: { ok: false, error_code: 'unavailable_for_legal_reasons', error: 'make_playable is unavailable here' } })
    const q = await estimate(o, 'make_playable', {})
    expect(q?.ok).toBe(false)
    expect(costLine(q, 400)).toBe('make_playable is unavailable here')
  })

  it('falls back to the list price, and never invents a number', () => {
    expect(costLine(null, 100)).toMatch(/list price 100 credits per unit/)
    expect(costLine(null, undefined)).toBe('Estimate unavailable.')
    expect(costLine({ ok: true, credits: 0 }, 100)).toBe('This run is free.')
    expect(costLine({ ok: true, credits: 100, units: 1 }, 100)).toBe('This run costs 100 credits.')
  })
})

describe('op bodies', () => {
  const base = { imageId: 7, text: '  a red hat ', maskDataUrl: 'data:image/png;base64,AAA' }

  it('inpaint sends image, prompt and mask', () => {
    expect(buildActionParams('inpaint', base)).toEqual({ params: { image: 7, prompt: 'a red hat', mask: 'data:image/png;base64,AAA' } })
  })

  it('inpaint refuses without a mask, an image or a prompt', () => {
    expect(buildActionParams('inpaint', { ...base, maskDataUrl: null })).toEqual({ refusal: 'Paint the area to change first.' })
    expect(buildActionParams('inpaint', { ...base, imageId: null })).toEqual({ refusal: 'Pick an image from your library first.' })
    expect(buildActionParams('inpaint', { ...base, text: '   ' })).toEqual({ refusal: 'Describe what to paint.' })
  })

  it('edit_instruct reads the param name from the live spec', () => {
    expect(buildActionParams('edit_instruct', base, { params: [{ name: 'instruction', type: 'str' }] }))
      .toEqual({ params: { image: 7, instruction: 'a red hat' } })
    expect(buildActionParams('edit_instruct', base, { params: [{ name: 'prompt', type: 'str' }] }))
      .toEqual({ params: { image: 7, prompt: 'a red hat' } })
    expect(buildActionParams('edit_instruct', { ...base, text: '' })).toEqual({ refusal: 'Say what to change.' })
  })

  it('remove_bg needs only the image; txt2img only the prompt', () => {
    expect(buildActionParams('remove_bg', { ...base, text: '', maskDataUrl: null })).toEqual({ params: { image: 7 } })
    expect(buildActionParams('remove_bg', { ...base, bg: 'white' })).toEqual({ params: { image: 7, bg: 'white' } })
    expect(buildActionParams('txt2img', { ...base, imageId: null })).toEqual({ params: { prompt: 'a red hat' } })
  })
})

describe('mask', () => {
  it('is white and opaque where painted, black and opaque elsewhere', () => {
    const rgba = new Uint8ClampedArray([255, 70, 90, 140, 0, 0, 0, 0, 10, 10, 10, 1])
    expect(Array.from(alphaToMask(rgba))).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255])
  })

  it('coverage counts painted pixels', () => {
    expect(maskCoverage(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 9]))).toBe(0.5)
    expect(maskCoverage(new Uint8ClampedArray([0, 0, 0, 0]))).toBe(0)
    expect(maskCoverage(new Uint8ClampedArray([]))).toBe(0)
  })
})

describe('library shaping', () => {
  const lib: CraftLibrary = {
    folders: [{ id: 'f1', name: 'A', created: 1 }],
    characters: [],
    media: [
      { id: 1, op: 'txt2img', has_preview: true, url: '/craft/media/1', folder_id: null, source_id: null, created: 2 },
      { id: 2, op: 'inpaint', has_preview: true, url: '/craft/media/2', folder_id: 'f1', source_id: 1, created: 3 },
    ],
  }

  it('splits media by folder', () => {
    expect(mediaInFolder(lib, null).map(m => m.id)).toEqual([1])
    expect(mediaInFolder(lib, 'f1').map(m => m.id)).toEqual([2])
  })

  it('previews only through the owner-checked craft media route', () => {
    expect(mediaSrc({ apiBase: 'https://x' }, { url: '/craft/media/1' })).toBe('https://x/api/iris/craft/media/1')
    expect(mediaSrc(o, { url: '/media/studio/a.png' })).toBeNull()
    expect(mediaSrc(o, { url: null })).toBeNull()
  })

  it('serverWords reads error, detail and detail.error', () => {
    expect(serverWords({ error: 'a' }, 400)).toBe('a')
    expect(serverWords({ detail: 'b' }, 400)).toBe('b')
    expect(serverWords({ detail: { error: 'c' } }, 400)).toBe('c')
    expect(serverWords(null, 503)).toBe('The studio answered HTTP 503.')
  })
})
