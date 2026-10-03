/**
 * learnVoice (Aither Learn read-aloud): the voice plane first, the device's best voice
 * only as a fallback, never the engine's default robot voice.
 * Runs under AitherVeil's jest (its roots include awkit/src).
 */
import { createLearnVoice, pickBestVoice, rankVoice } from '../panels/learnVoice'

type V = { name: string; lang: string; localService: boolean }
const v = (name: string, lang = 'en-US', localService = true): V => ({ name, lang, localService })

const flush = () => new Promise((r) => setTimeout(r, 0))

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

  it('never picks a non-English voice', () => {
    expect(rankVoice(v('Microsoft Denise Online (Natural)', 'fr-FR', false))).toBe(-1)
    expect(pickBestVoice([v('Anna', 'de-DE')] as unknown as SpeechSynthesisVoice[])).toBeNull()
  })
})

describe('createLearnVoice', () => {
  let played: string[]
  let spoken: { text: string; voice?: string }[]
  let fetchMock: jest.Mock

  beforeEach(() => {
    played = []
    spoken = []
    ;(global as unknown as { Audio: unknown }).Audio = class {
      constructor(public src: string) {}
      play() { played.push(this.src); return Promise.resolve() }
      pause() { /* noop */ }
    }
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

  it('plays the voice plane audio and caches a replayed line', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ audio_base64: 'QUFB', format: 'mp3' }) })
    const speak = createLearnVoice('/api/tutor', () => ({ Authorization: 'Bearer t' }))
    speak('Which letter makes this sound?')
    await flush(); await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/tutor/me/say')
    expect(JSON.parse(init.body)).toEqual({ text: 'Which letter makes this sound?' })
    expect(init.headers.Authorization).toBe('Bearer t')
    expect(played).toEqual(['data:audio/mpeg;base64,QUFB'])
    speak('Which letter makes this sound?')
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(played).toHaveLength(2)
    expect(spoken).toEqual([])
  })

  it('falls back to the best device voice when the plane fails, then stops asking it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ detail: 'Voice unavailable' }) })
    const speak = createLearnVoice('/api/tutor')
    speak('Wiggle break!')
    await flush(); await flush()
    expect(spoken).toEqual([{ text: 'Wiggle break!', voice: 'Microsoft Jenny Online (Natural)' }])
    speak('Saved, all done!')
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(spoken[1]).toEqual({ text: 'Saved, all done!', voice: 'Microsoft Jenny Online (Natural)' })
    expect(played).toEqual([])
  })

  it('drops a slow reply for a line the child has moved past', async () => {
    let release: (v: unknown) => void = () => {}
    fetchMock
      .mockImplementationOnce(() => new Promise((r) => { release = r }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ audio_base64: 'TkVX', format: 'mp3' }) })
    const speak = createLearnVoice('/api/tutor')
    speak('old line')
    speak('new line')
    await flush(); await flush()
    release({ ok: true, status: 200, json: async () => ({ audio_base64: 'T0xE', format: 'mp3' }) })
    await flush(); await flush()
    expect(played).toEqual(['data:audio/mpeg;base64,TkVX'])
  })
})
