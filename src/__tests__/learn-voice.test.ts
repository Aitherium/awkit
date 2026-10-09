/**
 * learnVoice (Aither Learn read-aloud): the voice plane's stream door first, the
 * device's best voice only as a fallback, never the engine's default robot voice; a
 * line the minor gate refuses is not read by either; the first sentence goes alone and
 * the rest is fetched while it plays.
 * Runs under AitherVeil's jest (its roots include awkit/src).
 */
import { createLearnVoice, pickBestVoice, rankVoice, splitForSpeech } from '../panels/learnVoice'

type V = { name: string; lang: string; localService: boolean }
const v = (name: string, lang = 'en-US', localService = true): V => ({ name, lang, localService })

const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }

describe('rankVoice / pickBestVoice', () => {
  it('prefers Edge natural, then Google, over the local default', () => {
    const voices = [
      v('Microsoft David - English (United States)'),
      v('Google US English', 'en-US', false),
      v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false),
      v('Microsoft Hortense - French', 'fr-FR'),
    ]
    expect(pickBestVoice(voices as unknown as SpeechSynthesisVoice[])?.name).toMatch(/Aria Online \(Natural\)/)
    expect(pickBestVoice(voices.slice(0, 2) as unknown as SpeechSynthesisVoice[])?.name).toBe('Google US English')
  })

  it('offline, keeps to the on-device voices', () => {
    const voices = [
      v('Google US English', 'en-US', false),
      v('English United States', 'en-US', true),
    ] as unknown as SpeechSynthesisVoice[]
    expect(pickBestVoice(voices)?.name).toBe('Google US English')
    expect(pickBestVoice(voices, true)?.name).toBe('English United States')
  })

  it('never picks a non-English voice', () => {
    expect(rankVoice(v('Microsoft Denise Online (Natural)', 'fr-FR', false))).toBe(-1)
    expect(pickBestVoice([v('Anna', 'de-DE')] as unknown as SpeechSynthesisVoice[])).toBeNull()
  })
})

describe('splitForSpeech', () => {
  it('sends the first sentence alone and groups the rest', () => {
    expect(splitForSpeech('Great job! The cat sat. Tap the mat.')).toEqual(['Great job!', 'The cat sat. Tap the mat.'])
    expect(splitForSpeech('Wiggle break!')).toEqual(['Wiggle break!'])
    expect(splitForSpeech('no punctuation here')).toEqual(['no punctuation here'])
  })

  it('never makes a line longer than the server cap', () => {
    const long = `${'word '.repeat(80)}end. ${'more '.repeat(60)}`
    const lines = splitForSpeech(long, 240)
    expect(lines.length).toBeGreaterThan(2)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(240)
    expect(lines.join(' ').replace(/\s+/g, ' ')).toBe(long.trim().replace(/\s+/g, ' '))
  })
})

type Reply = { status: number; ctype?: string; json?: unknown }

describe('createLearnVoice', () => {
  let played: string[]
  let spoken: { text: string; voice?: string }[]
  let fetchMock: jest.Mock
  let blobN: number

  const reply = (r: Reply) => ({
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? (r.ctype ?? 'application/json') : null) },
    json: async () => r.json ?? null,
    blob: async () => ({ size: 3 }),
    body: null,
  })
  const audio = () => reply({ status: 200, ctype: 'audio/mpeg' })
  const bodyOf = (i: number) => JSON.parse(fetchMock.mock.calls[i][1].body).text

  beforeEach(() => {
    played = []
    spoken = []
    blobN = 0
    ;(global as unknown as { Audio: unknown }).Audio = class {
      private ends: (() => void)[] = []
      constructor(public src: string) {}
      addEventListener(ev: string, fn: () => void) { if (ev === 'ended') this.ends.push(fn) }
      play() { played.push(this.src); setTimeout(() => this.ends.forEach((f) => f()), 0); return Promise.resolve() }
      pause() { /* noop */ }
    }
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = () => `blob:${++blobN}`
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {}
    const best = { name: 'Microsoft Jenny Online (Natural)', lang: 'en-US', localService: false }
    ;(window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      cancel: () => {},
      getVoices: () => [{ name: 'Microsoft David', lang: 'en-US', localService: true }, best],
      speak: (u: { text: string; voice?: { name: string } }) => spoken.push({ text: u.text, voice: u.voice?.name }),
    }
    ;(window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      voice?: unknown
      lang = ''
      rate = 1
      constructor(public text: string) {}
    }
    fetchMock = jest.fn()
    ;(global as unknown as { fetch: unknown }).fetch = fetchMock
  })

  it('streams the line from the stream door and caches a replay', async () => {
    fetchMock.mockImplementation(async () => audio())
    const speak = createLearnVoice('/api/tutor', () => ({ Authorization: 'Bearer t' }))
    speak('Which letter makes this sound?')
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/tutor/me/say/stream')
    expect(JSON.parse(init.body)).toEqual({ text: 'Which letter makes this sound?' })
    expect(init.headers.Authorization).toBe('Bearer t')
    expect(played).toEqual(['blob:1'])
    speak('Which letter makes this sound?')
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(played).toEqual(['blob:1', 'blob:1'])
    expect(spoken).toEqual([])
  })

  it('plays the first sentence, fetching the rest while it plays', async () => {
    fetchMock.mockImplementation(async () => audio())
    const speak = createLearnVoice('/api/tutor')
    speak('Nice try! Let us look again. Count the dots.')
    await flush(10)
    expect(bodyOf(0)).toBe('Nice try!')
    expect(bodyOf(1)).toBe('Let us look again. Count the dots.')
    expect(played).toHaveLength(2)
  })

  it('prefetch warms a line so speaking it costs no new request', async () => {
    fetchMock.mockImplementation(async () => audio())
    const speak = createLearnVoice('/api/tutor')
    speak.prefetch?.('Tap the word: cat.')
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    speak('Tap the word: cat.')
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(played).toEqual(['blob:1'])
  })

  it('a refused line (minor gate, 422) is read by nobody', async () => {
    fetchMock.mockImplementation(async () => reply({ status: 422, json: { detail: { refused: true } } }))
    const speak = createLearnVoice('/api/tutor')
    speak('something the gate refuses')
    await flush()
    expect(played).toEqual([])
    expect(spoken).toEqual([])
  })

  it('never falls back to a device voice when the plane fails (stays silent), then stops asking it', async () => {
    fetchMock.mockImplementation(async () => reply({ status: 503, json: { detail: 'Voice unavailable' } }))
    const speak = createLearnVoice('/api/tutor')
    speak('Wiggle break!')
    await flush()
    expect(spoken).toEqual([])
    speak('Saved, all done!')
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(spoken).toEqual([])
    expect(played).toEqual([])
  })

  it('uses the JSON door on a server without the stream door', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/me/say/stream')
      ? reply({ status: 404, json: { detail: 'Not Found' } })
      : reply({ status: 200, json: { audio_base64: 'QUFB', format: 'mp3' } })))
    const speak = createLearnVoice('/api/tutor')
    speak('Yay!')
    await flush()
    expect(played).toEqual(['data:audio/mpeg;base64,QUFB'])
    speak('Saved!')
    await flush()
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/tutor/me/say/stream', '/api/tutor/me/say', '/api/tutor/me/say'])
  })

  it('plays a workspace voice (audio/wav) from a blob, never through MediaSource', async () => {
    let sourceBuffers = 0
    const MS = class {
      static isTypeSupported() { return true }
      addEventListener() { /* never opens in this test */ }
      addSourceBuffer() { sourceBuffers++ }
    }
    ;(window as unknown as { MediaSource?: unknown }).MediaSource = MS
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL =
      (o: unknown) => (o instanceof MS ? 'blob:mediasource' : `blob:${++blobN}`)
    try {
      fetchMock.mockImplementation(async () => ({ ...reply({ status: 200, ctype: 'audio/wav' }), body: {} }))
      const speak = createLearnVoice('/api/tutor')
      speak('Tap the cat.')
      await flush()
      expect(played).toEqual(['blob:1'])
      expect(sourceBuffers).toBe(0)
      expect(spoken).toEqual([])
    } finally {
      delete (window as unknown as { MediaSource?: unknown }).MediaSource
    }
  })

  it('drops a slow reply for a line the child has moved past', async () => {
    let release: (v: unknown) => void = () => {}
    fetchMock
      .mockImplementationOnce(() => new Promise((r) => { release = r }))
      .mockImplementation(async () => audio())
    const speak = createLearnVoice('/api/tutor')
    speak('old line')
    speak('new line')
    await flush()
    release(audio())
    await flush()
    expect(played).toEqual(['blob:1'])
    expect(bodyOf(1)).toBe('new line')
  })
})
