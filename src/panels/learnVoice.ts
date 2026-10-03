/**
 * learnVoice: how Aither Learn reads a prompt aloud to a child.
 *
 * Rung 1 is the voice plane (AitherVoice / awvoice) through the tutor's own door,
 * POST `${apiBase}/me/say`: a neural voice, the same on every device. Rung 2, only when
 * that fails, is the device's BEST voice: Edge's "Online (Natural)" voices, then
 * Google's, then Apple's enhanced ones, never the engine default (that was the robot).
 *
 * One line plays at a time; a newer line cancels the older one, and a slow server reply
 * for a line the child has already moved past is dropped. Speech stays a nicety: every
 * failure ends in silence or the device voice, never an error on screen.
 */

export type LearnSpeak = (text: string | undefined) => void

const RATE = 0.92
const CACHE_MAX = 64
const SERVER_RETRY_MS = 60_000

/** Higher is better; -1 = not an English voice. Exported for tests. */
export function rankVoice(v: Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService'>): number {
  if (!/^en(-|_|$)/i.test(v.lang || '')) return -1
  const n = v.name || ''
  let score = 0
  if (/online \(natural\)/i.test(n)) score = 100
  else if (/natural|neural/i.test(n)) score = 90
  else if (/^google/i.test(n)) score = 80
  else if (/premium|enhanced|siri/i.test(n)) score = 70
  else if (/samantha|ava|allison|karen|serena/i.test(n)) score = 60
  else if (!v.localService) score = 50
  else score = 10
  if (/aria|jenny|ana\b|emma|sonia|libby|michelle/i.test(n)) score += 5
  if (/en-us/i.test(v.lang)) score += 2
  return score
}

export function pickBestVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null
  let bestScore = 0
  for (const v of voices) {
    const s = rankVoice(v)
    if (s > bestScore) { best = v; bestScore = s }
  }
  return best
}

function deviceSpeak(text: string): void {
  const w = window as unknown as {
    speechSynthesis?: SpeechSynthesis
    SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance
  }
  const synth = w.speechSynthesis
  const Utter = w.SpeechSynthesisUtterance
  if (!synth || !Utter) return
  try {
    synth.cancel()
    const u = new Utter(text)
    const voice = pickBestVoice(synth.getVoices?.() ?? [])
    if (voice) { u.voice = voice; u.lang = voice.lang }
    u.rate = RATE
    synth.speak(u)
  } catch { /* speech is a nicety, never a blocker */ }
}

/**
 * A speak() bound to one tutor proxy. `getHeaders` is read at call time so the host's
 * bearer can change without rebuilding the voice.
 */
export function createLearnVoice(apiBase: string, getHeaders: () => Record<string, string> = () => ({})): LearnSpeak {
  const cache = new Map<string, string>()
  let serverDownUntil = 0
  let seq = 0
  let playing: HTMLAudioElement | null = null

  const stop = () => {
    if (playing) { try { playing.pause() } catch { /* already gone */ } playing = null }
    try { (window as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis?.cancel() } catch { /* none */ }
  }

  const play = (src: string, text: string, mine: number) => {
    if (mine !== seq) return
    const a = new Audio(src)
    playing = a
    a.play().catch(() => { if (mine === seq) deviceSpeak(text) })
  }

  return (raw) => {
    const text = (raw ?? '').replace(/\s+/g, ' ').trim()
    if (!text || typeof window === 'undefined') return
    const mine = ++seq
    stop()
    const hit = cache.get(text)
    if (hit) { play(hit, text, mine); return }
    if (Date.now() < serverDownUntil || typeof fetch !== 'function' || typeof Audio === 'undefined') {
      deviceSpeak(text)
      return
    }
    void (async () => {
      try {
        const r = await fetch(`${apiBase}/me/say`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getHeaders() },
          body: JSON.stringify({ text: text.slice(0, 240) }),
        })
        const data = (await r.json().catch(() => null)) as { audio_base64?: unknown; format?: unknown } | null
        if (!r.ok || !data || typeof data.audio_base64 !== 'string' || !data.audio_base64) {
          throw new Error(`say ${r.status}`)
        }
        const mime = data.format === 'wav' ? 'audio/wav' : 'audio/mpeg'
        const src = `data:${mime};base64,${data.audio_base64}`
        cache.set(text, src)
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
        play(src, text, mine)
      } catch {
        serverDownUntil = Date.now() + SERVER_RETRY_MS
        if (mine === seq) deviceSpeak(text)
      }
    })()
  }
}
