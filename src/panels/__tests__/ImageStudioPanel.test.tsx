/**
 * The Image Studio panel (craft brick B4) against a fake hosted lane.
 *
 * Pins: the library is what the SERVER returned (folders, media, characters); the price is on
 * screen before Run; a failed run shows the server's own words and "Nothing was charged.";
 * an op the engine does not serve cannot be run; a success refreshes the library.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import ImageStudioPanel from '../ImageStudioPanel'

type Handler = (method: string, url: string, body: any) => { status: number; body: unknown } | undefined

const CATALOGUE = {
  craft: { id: 'image-studio', name: 'Image Studio' },
  live: true,
  ops: [
    { name: 'txt2img', label: 'Generate', group: 'generate', summary: '', credits: 150, params: [{ name: 'prompt', type: 'str' }], inputs: [] },
    { name: 'remove_bg', label: 'Remove background', group: 'edit', summary: '', credits: 100, params: [], inputs: [{ name: 'image', type: 'image' }] },
    { name: 'inpaint', label: 'Inpaint', group: 'edit', summary: '', credits: 100, params: [], inputs: [{ name: 'image', type: 'image' }] },
  ],
  shell_ops: { inpaint: true, edit_instruct: false, remove_bg: true, txt2img: true },
  buy_url: 'https://aitherium.com/shop/credits',
}

function library(extra: any[] = []) {
  return {
    folders: [{ id: 'f1', name: 'Heroes', created: 1 }],
    characters: [{ id: 'c1', name: 'Vex', media_ids: [11], created: 1 }],
    media: [
      ...extra,
      { id: 11, op: 'txt2img', has_preview: true, url: '/craft/media/11', folder_id: null, source_id: null, created: 2 },
      { id: 12, op: 'txt2img', has_preview: true, url: '/craft/media/12', folder_id: 'f1', source_id: null, created: 1 },
    ],
  }
}

function serve(handler: Handler) {
  const calls: Array<{ method: string; url: string; body: any }> = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    const r = handler(method, url, body) ?? { status: 404, body: { detail: 'Not Found' } }
    return { ok: r.status < 300, status: r.status, json: async () => r.body }
  })
  return calls
}

function base(lib = library()): Handler {
  return (method, url) => {
    if (url.startsWith('/api/iris/craft/ops')) return { status: 200, body: CATALOGUE }
    if (url === '/api/iris/craft/library') return { status: 200, body: lib }
    return undefined
  }
}

beforeEach(() => jest.useRealTimers())

describe('ImageStudioPanel', () => {
  it('shows the library the server returned, by folder, and its characters', async () => {
    serve(base())
    render(<ImageStudioPanel />)
    const media = await screen.findByRole('list', { name: 'Media' })
    await waitFor(() => expect(within(media).getAllByRole('listitem')).toHaveLength(1))   // Unfiled
    expect(within(media).getByAltText('txt2img #11')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Heroes' }))
    await waitFor(() => expect(within(media).getByAltText('txt2img #12')).toBeTruthy())
    expect(within(media).queryByAltText('txt2img #11')).toBeNull()
    expect(screen.getByText('Vex')).toBeTruthy()
    // Previews come from the owner-checked lane, never a media-forge path.
    expect((within(media).getByAltText('txt2img #12') as HTMLImageElement).getAttribute('src')).toBe('/api/iris/craft/media/12')
  })

  it('shows the server estimate before the run', async () => {
    const calls = serve((m, url, body) => {
      if (m === 'POST' && url === '/api/iris/craft/estimate') return { status: 200, body: { ok: true, op: body.op, credits: 100, units: 1 } }
      return base()(m, url, body)
    })
    render(<ImageStudioPanel />)
    fireEvent.click(await screen.findByAltText('txt2img #11'))
    fireEvent.click(screen.getByLabelText(/Remove background/))
    await waitFor(() => expect(screen.getByTestId('cost-line').textContent).toBe('This run costs 100 credits.'), { timeout: 3000 })
    const est = calls.find(c => c.url === '/api/iris/craft/estimate')!
    expect(est.body).toEqual({ op: 'remove_bg', params: { image: 11 } })
  })

  it('falls back to the list price when the estimate route is absent', async () => {
    serve(base())
    render(<ImageStudioPanel />)
    fireEvent.click(await screen.findByAltText('txt2img #11'))
    fireEvent.click(screen.getByLabelText(/Remove background/))
    await waitFor(() => expect(screen.getByTestId('cost-line').textContent).toMatch(/list price 100 credits per unit/), { timeout: 3000 })
  })

  it("shows a failed run in the server's own words and that nothing was charged", async () => {
    serve((m, url, body) => {
      if (m === 'POST' && url === '/api/iris/craft/op/remove_bg') {
        return { status: 200, body: { ok: false, error: 'remove_bg is unavailable right now; nothing was charged, try again', error_code: 'engine_unavailable', credits_charged: 0, media: [] } }
      }
      return base()(m, url, body)
    })
    render(<ImageStudioPanel />)
    fireEvent.click(await screen.findByAltText('txt2img #11'))
    fireEvent.click(screen.getByLabelText(/Remove background/))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run' })) })
    const out = await screen.findByTestId('run-outcome')
    expect(out.textContent).toBe('remove_bg is unavailable right now; nothing was charged, try again Nothing was charged.')
    expect(out.getAttribute('role')).toBe('alert')
  })

  it('shows an out-of-credits refusal from a 402', async () => {
    serve((m, url, body) => {
      if (m === 'POST' && url === '/api/iris/craft/op/txt2img') {
        return { status: 402, body: { ok: false, error_code: 'insufficient_credits', error: 'Not enough credits to run txt2img: it costs 150, you have 0.', credits_charged: 0 } }
      }
      return base()(m, url, body)
    })
    render(<ImageStudioPanel />)
    fireEvent.click(await screen.findByLabelText(/New image/))
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'a fox' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run' })) })
    expect((await screen.findByTestId('run-outcome')).textContent)
      .toBe('Not enough credits to run txt2img: it costs 150, you have 0. Nothing was charged.')
  })

  it('refuses locally, without a request, when the inputs cannot make a call', async () => {
    const calls = serve(base())
    render(<ImageStudioPanel />)
    await screen.findByAltText('txt2img #11')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run' })) })   // inpaint, nothing picked
    expect((await screen.findByTestId('run-outcome')).textContent).toBe('Pick an image from your library first.')
    expect(calls.some(c => c.url.startsWith('/api/iris/craft/op/'))).toBe(false)
  })

  it('cannot run an op the engine does not serve yet', async () => {
    serve(base())
    render(<ImageStudioPanel />)
    fireEvent.click(await screen.findByLabelText(/Edit by instruction/))
    expect(screen.getByText('(not served yet)')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('cost-line').textContent).toBe('The studio engine does not serve this yet.')
  })

  it('a successful run refreshes the library and selects the new image', async () => {
    let made = false
    const calls = serve((m, url, body) => {
      if (m === 'POST' && url === '/api/iris/craft/op/txt2img') {
        made = true
        return { status: 200, body: { ok: true, credits_charged: 150, media: [{ id: 99, op: 'txt2img', has_preview: true, url: '/craft/media/99', folder_id: null }] } }
      }
      if (url === '/api/iris/craft/library') {
        return { status: 200, body: library(made ? [{ id: 99, op: 'txt2img', has_preview: true, url: '/craft/media/99', folder_id: null, source_id: null, created: 9 }] : []) }
      }
      return base()(m, url, body)
    })
    render(<ImageStudioPanel />)
    fireEvent.click(await screen.findByLabelText(/New image/))
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'a fox' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run' })) })
    expect((await screen.findByTestId('run-outcome')).textContent).toBe('Done — 150 credits charged.')
    await waitFor(() => expect(screen.getByAltText('Image being edited').getAttribute('src')).toBe('/api/iris/craft/media/99'))
    expect(calls.filter(c => c.url === '/api/iris/craft/library').length).toBeGreaterThanOrEqual(2)
    expect(calls.find(c => c.url === '/api/iris/craft/op/txt2img')!.body).toEqual({ params: { prompt: 'a fox' } })
  })

  it('creates a folder through the server and shows a refusal in its words', async () => {
    const calls = serve((m, url, body) => {
      if (m === 'POST' && url === '/api/iris/craft/library/folders') return { status: 400, body: { detail: { error: 'a folder needs a name of 1 to 80 characters' } } }
      return base()(m, url, body)
    })
    render(<ImageStudioPanel />)
    await screen.findByAltText('txt2img #11')
    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'x'.repeat(5) } })
    await act(async () => { fireEvent.submit(screen.getByLabelText('New folder name').closest('form')!) })
    expect((await screen.findByTestId('run-outcome')).textContent).toBe('a folder needs a name of 1 to 80 characters')
    expect(calls.find(c => c.url === '/api/iris/craft/library/folders')!.body).toEqual({ name: 'xxxxx' })
  })

  it('says so when the caller is not signed in', async () => {
    serve((m, url) => (url.startsWith('/api/iris/craft/') ? { status: 401, body: { success: false, error: 'Authentication required' } } : undefined))
    render(<ImageStudioPanel />)
    expect((await screen.findByRole('alert')).textContent).toBe('Authentication required')
  })
})
