/**
 * The Image Studio on a PHONE (390 px wide): one job per surface.
 *
 * Pins: the first surface is a prompt and one Generate button over a full-width grid of
 * your images (no canvas, no brush, no radio list); typing and tapping Generate is the whole
 * "make an image" path; every other knob is behind one Options sheet and starts at the
 * server default; tapping an image opens it full screen with Save / Share / Edit / Use as
 * avatar; Edit opens the canvas editor and Back returns; when the image service is offline,
 * busy or silent the studio SAYS so and Generate comes back — never a spinner forever.
 * The wide layout is pinned by ImageStudioPanel.test.tsx and is unchanged.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import ImageStudioPanel from '../ImageStudioPanel'

type Handler = (method: string, url: string, body: any) => { status: number; body: unknown } | undefined | 'hang'

const TXT2IMG = {
  name: 'txt2img', label: 'Generate', group: 'generate', summary: '', credits: 150, inputs: [],
  params: [
    { name: 'prompt', type: 'str' },
    { name: 'width', type: 'int', default: 1024, min: 256, max: 2048 },
    { name: 'height', type: 'int', default: 1024, min: 256, max: 2048 },
    { name: 'steps', type: 'int', default: 28, min: 1, max: 60 },
    { name: 'count', type: 'int', default: 1, min: 1, max: 8 },
    { name: 'model', type: 'str', default: 'auto', choices: ['auto', 'photo', 'anime'] },
  ],
}

function catalogue(over: Record<string, unknown> = {}) {
  return {
    craft: { id: 'image-studio', name: 'Image Studio' }, live: true,
    ops: [TXT2IMG, { name: 'inpaint', label: 'Inpaint', group: 'edit', summary: '', credits: 100, params: [], inputs: [{ name: 'image', type: 'image' }] }],
    shell_ops: { inpaint: true, edit_instruct: false, remove_bg: true, txt2img: true },
    ...over,
  }
}

const M = (id: number, folder: string | null = null) => ({ id, op: 'txt2img', has_preview: true, url: `/craft/media/${id}`, folder_id: folder, source_id: null, created: id })

function library(extra: any[] = []) {
  return { folders: [{ id: 'f1', name: 'Heroes', created: 1 }], characters: [], media: [...extra, M(11), M(12, 'f1')] }
}

function serve(handler: Handler) {
  const calls: Array<{ method: string; url: string; body: any }> = []
  ;(global as any).fetch = jest.fn((url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : init?.body
    calls.push({ method, url, body })
    const r = handler(method, url, body)
    if (r === 'hang') {
      return new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })
    }
    const out = r ?? { status: 404, body: { detail: 'Not Found' } }
    return Promise.resolve({
      ok: out.status < 300, status: out.status,
      json: async () => out.body,
      blob: async () => new Blob(['png'], { type: 'image/png' }),
    })
  })
  return calls
}

function base(cat: unknown = catalogue(), lib: unknown = library()): Handler {
  return (method, url) => {
    if (url.startsWith('/api/iris/craft/ops')) return { status: 200, body: cat }
    if (url === '/api/iris/craft/library') return { status: 200, body: lib }
    if (url.startsWith('/api/iris/craft/media/')) return { status: 200, body: {} }
    if (method === 'POST' && url === '/api/iris/craft/estimate') return { status: 200, body: { ok: true, credits: 150, units: 1 } }
    return undefined
  }
}

// A phone: every ResizeObserver reports a 390 x 760 box.
const RealRO = (global as any).ResizeObserver
beforeAll(() => {
  ;(global as any).ResizeObserver = class {
    cb: (e: any[]) => void
    constructor(cb: (e: any[]) => void) { this.cb = cb }
    observe() { this.cb([{ contentRect: { width: 390, height: 760 } }]) }
    disconnect() { /* nothing */ }
    unobserve() { /* nothing */ }
  }
})
afterAll(() => { (global as any).ResizeObserver = RealRO })
beforeEach(() => jest.useRealTimers())

async function phone(props: Partial<React.ComponentProps<typeof ImageStudioPanel>> = {}) {
  const utils = render(<ImageStudioPanel {...props} />)
  await waitFor(() => expect(screen.getByTestId('image-studio').getAttribute('data-layout')).toBe('compact-portrait'))
  return utils
}

describe('ImageStudioPanel on a phone', () => {
  it('opens on one job: a prompt, one Generate, and your images full width', async () => {
    serve(base())
    await phone()
    expect(screen.getByTestId('image-studio').getAttribute('data-view')).toBe('create')
    expect(screen.getByRole('textbox', { name: 'Describe your image' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Options/ })).toBeTruthy()
    // Every image, not just one folder: the phone has no folder picker in the way.
    const grid = await screen.findByRole('list', { name: 'Your images' })
    await waitFor(() => expect(within(grid).getAllByRole('listitem')).toHaveLength(2))
    // The canvas tools are not on the first surface.
    expect(screen.queryByLabelText('Brush size')).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'What to do' })).toBeNull()
  })

  it('every control on the first surface is a 44 px target and the prompt does not zoom iOS', async () => {
    serve(base())
    await phone()
    await screen.findByRole('list', { name: 'Your images' })
    const create = screen.getByTestId('studio-create')
    for (const b of [...within(create).getAllByRole('button'), ...within(create).getAllByRole('listitem')]) {
      expect(parseInt(b.style.minHeight || '0', 10)).toBeGreaterThanOrEqual(44)
    }
    expect((screen.getByRole('textbox', { name: 'Describe your image' }) as HTMLElement).style.fontSize).toBe('16px')
  })

  it('type a prompt, tap Generate: one tap sends txt2img and the new image lands first', async () => {
    let made = false
    const calls = serve((m, url, body) => {
      if (m === 'POST' && url === '/api/iris/craft/op/txt2img') {
        made = true
        return { status: 200, body: { ok: true, credits_charged: 150, media: [M(99)] } }
      }
      if (url === '/api/iris/craft/library') return { status: 200, body: library(made ? [M(99)] : []) }
      return base()(m, url, body)
    })
    await phone()
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe your image' }), { target: { value: 'a red fox' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate' })) })
    expect(calls.find(c => c.url === '/api/iris/craft/op/txt2img')!.body).toEqual({ params: { prompt: 'a red fox' } })
    expect((await screen.findByTestId('studio-status')).textContent).toBe('Done — 150 credits charged.')
    const grid = screen.getByRole('list', { name: 'Your images' })
    await waitFor(() => expect(within(grid).getAllByRole('listitem')[0].getAttribute('data-media-id')).toBe('99'))
  })

  it('an empty prompt is refused on the phone without a request', async () => {
    const calls = serve(base())
    await phone()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate' })) })
    expect((await screen.findByTestId('studio-status')).textContent).toBe('Type what to make first.')
    expect(calls.some(c => c.url.startsWith('/api/iris/craft/op/'))).toBe(false)
  })

  it('Options is one sheet: size presets, then the knobs, all at server defaults', async () => {
    const calls = serve((m, url, body) => {
      if (m === 'POST' && url === '/api/iris/craft/op/txt2img') return { status: 200, body: { ok: true, credits_charged: 150, media: [] } }
      return base()(m, url, body)
    })
    await phone()
    await waitFor(() => expect(screen.getByRole('button', { name: /^Options/ }).textContent).toMatch(/Square/))
    fireEvent.click(screen.getByRole('button', { name: /^Options/ }))
    const sheet = screen.getByRole('dialog', { name: 'Options' })
    expect(within(sheet).getByRole('radio', { name: 'Square' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Landscape' }))
    expect(within(sheet).getByLabelText('Steps')).toBeTruthy()
    expect(within(sheet).getByLabelText('Model')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog', { name: 'Options' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Options/ }).textContent).toMatch(/Landscape/)
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe your image' }), { target: { value: 'a fox' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate' })) })
    expect(calls.find(c => c.url === '/api/iris/craft/op/txt2img')!.body).toEqual({ params: { prompt: 'a fox', width: 1216, height: 832 } })
  })

  it('Reset puts every option back to the server default', async () => {
    serve(base())
    await phone()
    await waitFor(() => expect(screen.getByRole('button', { name: /^Options/ }).textContent).toMatch(/Square/))
    fireEvent.click(screen.getByRole('button', { name: /^Options/ }))
    const sheet = screen.getByRole('dialog', { name: 'Options' })
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Portrait' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reset' }))
    expect(within(sheet).getByRole('radio', { name: 'Square' }).getAttribute('aria-checked')).toBe('true')
  })

  it('tap an image: full screen with Save, Share, Edit and Use as avatar', async () => {
    serve(base())
    const onUseAsAvatar = jest.fn(async () => 'Profile picture updated.')
    ;(navigator as any).share = jest.fn(async () => undefined)
    await phone({ onUseAsAvatar })
    fireEvent.click(await screen.findByRole('listitem', { name: 'Image 11' }))
    const viewer = screen.getByRole('dialog', { name: 'Image 11' })
    expect(within(viewer).getByRole('img', { name: 'Image 11' }).getAttribute('src')).toBe('/api/iris/craft/media/11')
    for (const name of ['Save', 'Share', 'Edit', 'Use as avatar']) expect(within(viewer).getByRole('button', { name })).toBeTruthy()
    await act(async () => { fireEvent.click(within(viewer).getByRole('button', { name: 'Use as avatar' })) })
    expect(onUseAsAvatar).toHaveBeenCalledTimes(1)
    expect((onUseAsAvatar.mock.calls[0] as any[])[1]).toMatchObject({ id: 11 })
    expect(within(viewer).getByRole('status').textContent).toBe('Profile picture updated.')
    fireEvent.click(within(viewer).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Image 11' })).toBeNull()
    delete (navigator as any).share
  })

  it('hides the actions this host cannot do (no share sheet, no avatar hook)', async () => {
    serve(base())
    delete (navigator as any).share
    await phone()
    fireEvent.click(await screen.findByRole('listitem', { name: 'Image 11' }))
    const viewer = screen.getByRole('dialog', { name: 'Image 11' })
    expect(within(viewer).queryByRole('button', { name: 'Share' })).toBeNull()
    expect(within(viewer).queryByRole('button', { name: 'Use as avatar' })).toBeNull()
    expect(within(viewer).getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('Edit opens the canvas editor on that image; Back returns to Create', async () => {
    serve(base())
    await phone()
    fireEvent.click(await screen.findByRole('listitem', { name: 'Image 12' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Image 12' })).getByRole('button', { name: 'Edit' }))
    expect(screen.getByTestId('image-studio').getAttribute('data-view')).toBe('edit')
    expect(screen.getByAltText('Image being edited').getAttribute('src')).toBe('/api/iris/craft/media/12')
    expect(screen.getByLabelText('Brush size')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Create' }))
    expect(screen.getByTestId('image-studio').getAttribute('data-view')).toBe('create')
  })

  it('says the image service is offline and does not offer Generate as if it worked', async () => {
    serve(base(catalogue({ live: false })))
    await phone()
    expect((await screen.findByTestId('service-banner')).textContent).toMatch(/Image service offline/)
    expect((screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a busy engine says so, nothing is charged, and Generate comes back', async () => {
    serve((m, url, body) => {
      if (m === 'POST' && url === '/api/iris/craft/op/txt2img') {
        return { status: 200, body: { ok: false, error_code: 'engine_unavailable', error: 'txt2img is unavailable right now', credits_charged: 0, media: [] } }
      }
      return base()(m, url, body)
    })
    await phone()
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe your image' }), { target: { value: 'a fox' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate' })) })
    const banner = await screen.findByTestId('service-banner')
    // ONE message: the banner says what happened, with the server's own words under it.
    expect(banner.textContent).toMatch(/busy or offline/)
    expect(within(banner).getByTestId('service-detail').textContent).toBe('txt2img is unavailable right now Nothing was charged.')
    expect(screen.queryByTestId('studio-status')).toBeNull()
    expect((screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a run that never answers stops at its deadline: no spinner forever', async () => {
    serve((m, url, body) => (m === 'POST' && url === '/api/iris/craft/op/txt2img' ? 'hang' : base()(m, url, body)))
    await phone({ generateTimeoutMs: 30 })
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe your image' }), { target: { value: 'a fox' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate' })) })
    expect(screen.getByRole('button', { name: /Generating/ })).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeTruthy())
    expect(screen.getByTestId('service-banner').textContent).toMatch(/did not answer/)
    expect(screen.getByTestId('service-detail').textContent).toMatch(/did not answer in time/)
  })
})
