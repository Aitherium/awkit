/**
 * The songs on a child's Bookshelf (KidBookshelf over GET /me/shelf `songs`).
 *
 * Pins: songs render from the server contract as cards with one play/pause each; a server
 * that sends no songs draws no songs section (and no error); every song plays through ONE
 * audio element, so one song at a time; a song that ends stops and nothing plays next; the
 * read-aloud voice is stopped when a song starts and a song is stopped when a book opens;
 * five show, then "+N more" reveals the rest; a song is never opened as a book; the audio
 * address is built from the id (the server's `audio` field is not trusted); a refused song
 * is silence on screen; nothing is a link.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import KidBookshelf, { asShelfSong } from '../KidBookshelf'
import { SILENT_CLIP } from '../learnVoice'

const song = (id: string, title: string, topic = 'counting') => ({
  id, kind: 'song', title, seconds: 44, topic, audio: `/me/shelf/${id}/audio`,
})
const COUNT = song('kids-count-to-ten', 'Count to Ten')
const ABC = song('kids-abc', 'The ABC Song', 'alphabet')

type Call = { method: string; url: string }

function fakeServer(shelf: { books?: unknown[]; songs?: unknown[] }, audioStatus: Record<string, number> = {}) {
  const calls: Call[] = []
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method || 'GET', url })
    const json = (data: unknown, status = 200) => ({
      ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => data,
    })
    if (url.endsWith('/me/shelf')) return json(shelf)
    const m = /\/me\/shelf\/([^/]+)\/audio$/.exec(url)
    if (m) {
      const status = audioStatus[m[1]] ?? 200
      if (status !== 200) return json({ detail: { code: 'not_on_shelf', say: 'Not on your shelf.' } }, status)
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'audio/mpeg' }), blob: async () => ({ id: m[1] }) }
    }
    return json({}, 404)
  })
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
  return calls
}

/** A stand-in for the one HTMLAudioElement: records what it was asked to do. */
function fakeAudio() {
  const listeners: Record<string, Array<() => void>> = {}
  const el = {
    src: '', currentTime: 0, paused: true,
    play: jest.fn(async () => { el.paused = false }),
    pause: jest.fn(() => { el.paused = true }),
    addEventListener: (name: string, fn: () => void) => { (listeners[name] ||= []).push(fn) },
    removeEventListener: () => {},
    emit: (name: string) => { for (const fn of listeners[name] || []) fn() },
  }
  return el
}

function mount(props: Partial<React.ComponentProps<typeof KidBookshelf>> = {}) {
  const made: Array<ReturnType<typeof fakeAudio>> = []
  const spoken: string[] = []
  const stop = jest.fn()
  const voice = Object.assign((t: string | undefined) => { if (t) spoken.push(t) }, { prefetch: () => {}, stop })
  const view = render(
    <KidBookshelf apiBase="/api/tutor" makeVoice={() => voice}
      makeAudio={() => { const el = fakeAudio(); made.push(el); return el as unknown as HTMLAudioElement }} {...props} />,
  )
  return { ...view, made, spoken, stop }
}

const pressed = (id: string) => screen.getByTestId(`kid-song-${id}`).getAttribute('aria-pressed')

beforeEach(() => {
  let n = 0
  ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = jest.fn((b: { id: string }) => `blob:${b.id}:${n += 1}`)
  ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = jest.fn()
})

test('asShelfSong keeps named fields only, and only a real song with a path-safe id', () => {
  expect(asShelfSong({ ...COUNT, link: 'https://evil.example' })).toEqual({ id: 'kids-count-to-ten', title: 'Count to Ten', seconds: 44, topic: 'counting' })
  expect(asShelfSong({ ...COUNT, kind: 'book' })).toBeNull()
  expect(asShelfSong({ ...COUNT, id: '../family/learners/x' })).toBeNull()
  expect(asShelfSong({ ...COUNT, id: 'https://evil.example/a.mp3' })).toBeNull()
  expect(asShelfSong(null)).toBeNull()
})

test('songs render from the contract as cards with one play button each', async () => {
  fakeServer({ books: [], songs: [COUNT, ABC] })
  const { container } = mount()
  const section = await screen.findByTestId('kid-songs')
  expect(section.querySelectorAll('button')).toHaveLength(2)
  expect(screen.getByLabelText('Play Count to Ten')).toBeTruthy()
  expect(screen.getByLabelText('Play The ABC Song')).toBeTruthy()
  // each card carries a picture (drawn, not an emoji or an image) so a non-reader can pick
  expect(screen.getByTestId('kid-song-kids-abc').querySelectorAll('svg').length).toBeGreaterThanOrEqual(2)
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelectorAll('a[href]').length).toBe(0)
  // songs alone are not an empty shelf
  expect(screen.queryByTestId('kid-bookshelf-empty')).toBeNull()
})

test.each([
  ['no songs key (a server without songs yet)', { books: [] }],
  ['an empty list', { books: [], songs: [] }],
  ['something that is not a list', { books: [], songs: 'soon' }],
])('no songs means no songs section and no error: %s', async (_name, shelf) => {
  fakeServer(shelf as { books: unknown[] })
  const { made } = mount()
  expect(await screen.findByTestId('kid-bookshelf-empty')).toBeTruthy()
  expect(screen.queryByTestId('kid-songs')).toBeNull()
  expect(screen.queryByText(/My songs/)).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(made).toHaveLength(0)
})

test('one play at a time, over one audio element; the voice stops for a song', async () => {
  const calls = fakeServer({ books: [], songs: [COUNT, ABC] })
  const { made, stop } = mount()
  await screen.findByTestId('kid-songs')

  await act(async () => { fireEvent.click(screen.getByTestId('kid-song-kids-count-to-ten')) })
  expect(made).toHaveLength(1)
  const el = made[0]
  // two starts per fresh song: the silence inside the tap, then the song itself
  expect(el.play).toHaveBeenCalledTimes(2)
  expect(el.src).toMatch(/^blob:kids-count-to-ten/)
  expect(stop).toHaveBeenCalledTimes(1)
  expect(pressed('kids-count-to-ten')).toBe('true')
  expect(screen.getByLabelText('Pause Count to Ten')).toBeTruthy()
  // the address comes from the id, through the tutor proxy
  expect(calls.filter((c) => c.url.includes('/audio')).map((c) => c.url)).toEqual(['/api/tutor/me/shelf/kids-count-to-ten/audio'])

  // a second song: the SAME element, the first one is no longer marked playing
  await act(async () => { fireEvent.click(screen.getByTestId('kid-song-kids-abc')) })
  expect(made).toHaveLength(1)
  expect(el.pause).toHaveBeenCalled()
  expect(el.src).toMatch(/^blob:kids-abc/)
  expect(el.play).toHaveBeenCalledTimes(4)
  expect(pressed('kids-count-to-ten')).toBe('false')
  expect(pressed('kids-abc')).toBe('true')
  expect(document.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)

  // the same card again is pause
  const pauses = el.pause.mock.calls.length
  await act(async () => { fireEvent.click(screen.getByTestId('kid-song-kids-abc')) })
  expect(el.pause.mock.calls.length).toBeGreaterThan(pauses)
  expect(el.play).toHaveBeenCalledTimes(4)
  expect(pressed('kids-abc')).toBe('false')

  // and again: the song is already here, so ONE play(), inside the tap, on the same song
  fireEvent.click(screen.getByTestId('kid-song-kids-abc'))
  expect(el.play).toHaveBeenCalledTimes(5)
  expect(el.src).toMatch(/^blob:kids-abc/)
  await act(async () => { await Promise.resolve() })
  expect(pressed('kids-abc')).toBe('true')
  expect(calls.filter((c) => c.url.includes('/audio'))).toHaveLength(2)
})

test('a song ends and stops: nothing plays next', async () => {
  const calls = fakeServer({ books: [], songs: [COUNT, ABC] })
  const { made } = mount()
  await screen.findByTestId('kid-songs')
  await act(async () => { fireEvent.click(screen.getByTestId('kid-song-kids-count-to-ten')) })
  const el = made[0]
  const plays = el.play.mock.calls.length
  act(() => { el.emit('ended') })
  expect(pressed('kids-count-to-ten')).toBe('false')
  expect(pressed('kids-abc')).toBe('false')
  expect(el.play.mock.calls.length).toBe(plays)
  expect(calls.filter((c) => c.url.includes('/audio'))).toHaveLength(1)
})

test('five songs show, then "+N more" reveals the rest', async () => {
  const many = Array.from({ length: 8 }, (_, i) => song(`kids-song-${i}`, `Song ${i}`))
  fakeServer({ books: [], songs: many })
  mount()
  await screen.findByTestId('kid-songs')
  expect(screen.getAllByLabelText(/^Play Song/)).toHaveLength(5)
  const more = screen.getByTestId('kid-songs-more')
  expect(more.textContent).toBe('+3 more')
  fireEvent.click(more)
  expect(screen.getAllByLabelText(/^Play Song/)).toHaveLength(8)
  expect(screen.queryByTestId('kid-songs-more')).toBeNull()
})

test('a song is never opened as a book, and opening a book stops the song', async () => {
  const book = { id: 'dino_lunch', kind: 'book', title: 'Dino Lunch', art: 'dino', pages: 2, page: 0, finished: false }
  // even if the server listed a song among the books, it is not a book card
  const calls = fakeServer({ books: [book, { ...COUNT, pages: 1 }], songs: [COUNT] })
  const { made } = mount()
  await screen.findByTestId('kid-songs')
  expect(screen.queryByTestId('kid-book-kids-count-to-ten')).toBeNull()

  await act(async () => { fireEvent.click(screen.getByTestId('kid-song-kids-count-to-ten')) })
  expect(calls.some((c) => c.url.endsWith('/me/shelf/kids-count-to-ten'))).toBe(false)
  const pauses = made[0].pause.mock.calls.length
  await act(async () => { fireEvent.click(screen.getByTestId('kid-book-dino_lunch')) })
  expect(made[0].pause.mock.calls.length).toBeGreaterThan(pauses)
})

test('a song the server refuses is silence on screen, never an error', async () => {
  fakeServer({ books: [], songs: [COUNT] }, { 'kids-count-to-ten': 404 })
  const { made, spoken } = mount()
  await screen.findByTestId('kid-songs')
  await act(async () => { fireEvent.click(screen.getByTestId('kid-song-kids-count-to-ten')) })
  await waitFor(() => expect(spoken[spoken.length - 1]).toMatch(/resting/))
  // the only thing the element was ever given is the tap's silence, and it was paused
  expect(made[0].src).toBe(SILENT_CLIP)
  expect(made[0].play).toHaveBeenCalledTimes(1)
  expect(made[0].paused).toBe(true)
  expect(pressed('kids-count-to-ten')).toBe('false')
  expect(screen.getByTestId('kid-song-kids-count-to-ten').getAttribute('data-again')).toBe('0')
  expect(screen.queryByText(/Not on your shelf/)).toBeNull()
  expect(screen.queryByText(/not_on_shelf/)).toBeNull()
})

test('songsFirst draws the songs above the books', async () => {
  const book = { id: 'dino_lunch', kind: 'book', title: 'Dino Lunch', art: 'dino', pages: 2, page: 0, finished: false }
  fakeServer({ books: [book], songs: [COUNT] })
  mount({ songsFirst: true })
  const songs = await screen.findByTestId('kid-songs')
  const cover = screen.getByTestId('kid-book-dino_lunch')
  expect(songs.compareDocumentPosition(cover) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

/** A shelf whose song download stays open until the test lets it finish. */
function slowAudio(shelf: { books?: unknown[]; songs?: unknown[] }) {
  const calls = fakeServer(shelf)
  const quick = (global as unknown as { fetch: (u: string, i?: RequestInit) => Promise<unknown> }).fetch
  let release: () => void = () => {}
  const gate = new Promise<void>((done) => { release = done })
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const res = await quick(url, init)
    if (/\/audio$/.test(url)) await gate
    return res
  })
  return { calls, release: () => release() }
}

test('the one press starts the audio element inside the tap, before the download is back', async () => {
  const { calls, release } = slowAudio({ books: [], songs: [COUNT] })
  const { made } = mount()
  await screen.findByTestId('kid-songs')

  // a plain synchronous click: whatever play() runs here runs inside the child's tap
  fireEvent.click(screen.getByTestId('kid-song-kids-count-to-ten'))
  expect(made).toHaveLength(1)
  const el = made[0]
  expect(el.play).toHaveBeenCalledTimes(1)
  expect(el.src).toBe(SILENT_CLIP)
  expect(calls.filter((c) => c.url.includes('/audio'))).toHaveLength(1)
  expect(pressed('kids-count-to-ten')).toBe('false')

  await act(async () => { release() })
  await waitFor(() => expect(el.src).toMatch(/^blob:kids-count-to-ten/))
  expect(el.play).toHaveBeenCalledTimes(2)
  expect(pressed('kids-count-to-ten')).toBe('true')
})

test('a browser that refuses the play leaves the card asking for one more tap, and that tap plays at once', async () => {
  const calls = fakeServer({ books: [], songs: [COUNT] })
  // make the play after the download be refused, as a browser outside the tap does
  const el = fakeAudio()
  const { spoken } = mount({ makeAudio: () => el as unknown as HTMLAudioElement })
  await screen.findByTestId('kid-songs')
  const card = () => screen.getByTestId('kid-song-kids-count-to-ten')
  const audioCalls = () => calls.filter((c) => c.url.includes('/audio')).length
  el.play
    .mockImplementationOnce(async () => {}) // the unlock inside the tap
    .mockImplementationOnce(async () => { throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' }) })
  await act(async () => { fireEvent.click(card()) })
  await waitFor(() => expect(card().getAttribute('data-again')).toBe('1'))
  expect(pressed('kids-count-to-ten')).toBe('false')
  expect(spoken[spoken.length - 1]).toMatch(/tap/i)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(audioCalls()).toBe(1)

  // the second tap: the song is already here, so play() runs with the song inside the tap
  const before = el.play.mock.calls.length
  fireEvent.click(card())
  expect(el.play.mock.calls.length).toBe(before + 1)
  expect(el.src).toMatch(/^blob:kids-count-to-ten/)
  await act(async () => { await Promise.resolve() })
  expect(pressed('kids-count-to-ten')).toBe('true')
  expect(card().getAttribute('data-again')).toBe('0')
  expect(audioCalls()).toBe(1)
})
