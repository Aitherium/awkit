/**
 * learnVoice: how Aither Learn reads a prompt aloud to a child.
 *
 * Rung 1 is the voice plane (AitherVoice) through the tutor's own door,
 * POST `${apiBase}/me/say/stream`: a warm neural voice the guardian picked, streamed as
 * MP3 so playback starts on the first chunk (MediaSource where the browser has it, a
 * whole-line blob otherwise). Rung 2, only when the plane is down, is the device's BEST
 * voice: Edge's "Online (Natural)" voices, then Google's, then Apple's enhanced ones,
 * never the engine default (that was the robot). A line the server's minor gate refuses
 * (422) is not read at all, by either rung.
 *
 * Speed: the first sentence goes alone so it comes back fastest; while it plays, the
 * rest is fetched. Every line is cached here (and by content hash on the server), and
 * `speak.prefetch(text)` warms a line the child is about to hear.
 *
 * One line plays at a time; a newer line cancels the older one, and a slow server reply
 * for a line the child has already moved past is dropped. Speech stays a nicety: every
 * failure ends in silence or the device voice, never an error on screen.
 */

import { speakable } from './speakable'

export type LearnSpeak = ((text: string | undefined) => void) & {
  prefetch?: (text: string | undefined) => void
}

const RATE = 0.92
const CACHE_MAX = 64
const SERVER_RETRY_MS = 60_000
/** The server's cap on one line (family_tutor_voice.MAX_CHARS). */
export const MAX_LINE = 240

type Got = HTMLAudioElement | 'refused' | 'down'

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

/**
 * The best voice; `offline` (no network, e.g. the phone away from Wi-Fi) keeps to the
 * on-device voices when there are any, since a network voice then says nothing.
 */
export function pickBestVoice(voices: readonly SpeechSynthesisVoice[], offline = false): SpeechSynthesisVoice | null {
  const pool = offline && voices.some((v) => v.localService) ? voices.filter((v) => v.localService) : voices
  let best: SpeechSynthesisVoice | null = null
  let bestScore = 0
  for (const v of pool) {
    const s = rankVoice(v)
    if (s > bestScore) { best = v; bestScore = s }
  }
  return best
}

function hardSplit(s: string, max: number): string[] {
  const out: string[] = []
  let rest = s
  while (rest.length > max) {
    const cut = rest.lastIndexOf(' ', max)
    const at = cut > 0 ? cut : max
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) out.push(rest)
  return out
}

/**
 * Lines to synthesize: the first sentence alone (fastest first audio), then the rest
 * grouped into lines of at most `max` characters. Exported for tests.
 */
export function splitForSpeech(text: string, max = MAX_LINE): string[] {
  const sentences = (text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [text])
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => hardSplit(s, max))
  if (sentences.length <= 1) return sentences
  const out = [sentences[0]]
  let cur = ''
  for (const s of sentences.slice(1)) {
    if (cur && `${cur} ${s}`.length > max) { out.push(cur); cur = s } else cur = cur ? `${cur} ${s}` : s
  }
  if (cur) out.push(cur)
  return out
}

/** What is speaking now: an audio element (its level can be read), the device voice, or nothing. */
export type SpeakingSource = HTMLAudioElement | 'device' | null

function deviceSpeak(text: string, onSpeaking?: (src: SpeakingSource) => void): void {
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
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    const voice = pickBestVoice(synth.getVoices?.() ?? [], offline)
    if (voice) { u.voice = voice; u.lang = voice.lang }
    u.rate = RATE
    if (onSpeaking) {
      u.onstart = () => onSpeaking('device')
      u.onend = () => onSpeaking(null)
      u.onerror = () => onSpeaking(null)
    }
    synth.speak(u)
  } catch { /* speech is a nicety, never a blocker */ }
}

/** Progressive playback of an MP3 response; null where MediaSource cannot take MP3. */
function streamAudio(res: Response, onComplete: (blob: Blob) => void): HTMLAudioElement | null {
  const MS = (window as unknown as { MediaSource?: typeof MediaSource }).MediaSource
  if (!MS || !res.body || typeof URL.createObjectURL !== 'function') return null
  try { if (!MS.isTypeSupported('audio/mpeg')) return null } catch { return null }
  const ms = new MS()
  const el = new Audio()
  el.src = URL.createObjectURL(ms)
  ms.addEventListener('sourceopen', () => {
    void (async () => {
      const parts: Uint8Array[] = []
      try {
        const sb = ms.addSourceBuffer('audio/mpeg')
        const reader = res.body!.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value || !value.byteLength) continue
          parts.push(value)
          await new Promise<void>((resolve, reject) => {
            sb.addEventListener('updateend', () => resolve(), { once: true })
            sb.addEventListener('error', () => reject(new Error('append')), { once: true })
            sb.appendBuffer(value)
          })
        }
        ms.endOfStream()
        onComplete(new Blob(parts as BlobPart[], { type: 'audio/mpeg' }))
      } catch {
        try { ms.endOfStream() } catch { /* already closed */ }
      }
    })()
  }, { once: true })
  return el
}

export interface LearnVoiceOptions {
  /** Told when a line starts (its audio element, or 'device') and when speech stops (null),
   *  so a body on screen can move its mouth. Never required for speech to work. */
  onSpeaking?: (src: SpeakingSource) => void
}

/**
 * A speak() bound to one tutor proxy. `getHeaders` is read at call time so the host's
 * bearer can change without rebuilding the voice.
 */
export function createLearnVoice(
  apiBase: string,
  getHeaders: () => Record<string, string> = () => ({}),
  options: LearnVoiceOptions = {},
): LearnSpeak {
  const tell = (src: SpeakingSource) => { try { options.onSpeaking?.(src) } catch { /* a nicety */ } }
  const cache = new Map<string, string>()
  const inflight = new Map<string, Promise<string | null>>()
  let serverDownUntil = 0
  let legacy = false // a server without the stream door: use the JSON door
  let seq = 0
  let playing: HTMLAudioElement | null = null
  let endCurrent: (() => void) | null = null

  const canServer = () =>
    Date.now() >= serverDownUntil && typeof fetch === 'function' && typeof Audio !== 'undefined'

  const remember = (text: string, src: string) => {
    cache.set(text, src)
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value as string
      const url = cache.get(oldest)
      cache.delete(oldest)
      if (url && url.startsWith('blob:')) { try { URL.revokeObjectURL(url) } catch { /* gone */ } }
    }
    return src
  }

  const rememberBlob = (text: string, blob: Blob): string | null => {
    if (typeof URL.createObjectURL !== 'function') return null
    return remember(text, URL.createObjectURL(blob))
  }

  const post = (door: string, text: string) => fetch(`${apiBase}${door}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getHeaders() },
    body: JSON.stringify({ text: text.slice(0, MAX_LINE) }),
  })

  /** The old JSON door (base64 MP3); null on any failure. */
  const viaJson = async (text: string): Promise<string | 'refused' | null> => {
    const r = await post('/me/say', text)
    if (r.status === 422) return 'refused'
    const data = (await r.json().catch(() => null)) as { audio_base64?: unknown; format?: unknown } | null
    if (!r.ok || !data || typeof data.audio_base64 !== 'string' || !data.audio_base64) return null
    const mime = data.format === 'wav' ? 'audio/wav' : 'audio/mpeg'
    return remember(text, `data:${mime};base64,${data.audio_base64}`)
  }

  /** Fetch a whole line into the cache (prefetch); never plays, never throws. */
  const warm = (text: string): Promise<string | null> => {
    const hit = cache.get(text)
    if (hit) return Promise.resolve(hit)
    const pending = inflight.get(text)
    if (pending) return pending
    if (!canServer()) return Promise.resolve(null)
    const p = (async () => {
      try {
        if (legacy) { const got = await viaJson(text); return got === 'refused' ? null : got }
        const r = await post('/me/say/stream', text)
        if (!r.ok || !(r.headers?.get('content-type') || '').startsWith('audio/')) return null
        return rememberBlob(text, await r.blob())
      } catch { return null } finally { inflight.delete(text) }
    })()
    inflight.set(text, p)
    return p
  }

  const audioFor = async (text: string): Promise<Got> => {
    const hit = cache.get(text)
    if (hit) return new Audio(hit)
    const pending = inflight.get(text)
    if (pending) {
      const src = await pending
      if (src) return new Audio(src)
    }
    if (!canServer()) return 'down'
    try {
      if (!legacy) {
        const r = await post('/me/say/stream', text)
        if (r.status === 422) return 'refused'
        if (r.status === 429) return 'down' // this line only: the plane is fine
        if (r.status === 404 || r.status === 405) {
          legacy = true
        } else {
          const ctype = r.headers?.get('content-type') || ''
          if (!r.ok || !ctype.startsWith('audio/')) throw new Error(`say ${r.status}`)
          // A workspace (custom:) voice answers whole audio/wav, which an audio/mpeg
          // SourceBuffer cannot take: only MP3 goes to MediaSource.
          const el = ctype.startsWith('audio/mpeg')
            ? streamAudio(r, (blob) => { rememberBlob(text, blob) })
            : null
          if (el) return el
          const src = rememberBlob(text, await r.blob())
          if (!src) throw new Error('no blob url')
          return new Audio(src)
        }
      }
      const got = await viaJson(text)
      if (got === 'refused') return 'refused'
      if (!got) throw new Error('say failed')
      return new Audio(got)
    } catch {
      serverDownUntil = Date.now() + SERVER_RETRY_MS
      return 'down'
    }
  }

  /** Resolves true when the line finished (or was stopped), false when it could not play. */
  const playToEnd = (el: HTMLAudioElement): Promise<boolean> => new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean) => { if (!settled) { settled = true; endCurrent = null; tell(null); resolve(ok) } }
    playing = el
    tell(el)
    endCurrent = () => done(true)
    el.addEventListener?.('ended', () => done(true), { once: true })
    el.addEventListener?.('error', () => done(false), { once: true })
    el.play().catch(() => done(false))
  })

  const stop = () => {
    const end = endCurrent
    endCurrent = null
    if (playing) { try { playing.pause() } catch { /* already gone */ } playing = null }
    if (end) end()
    try { (window as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis?.cancel() } catch { /* none */ }
  }

  const run = async (lines: string[], mine: number) => {
    for (let i = 0; i < lines.length; i++) {
      if (mine !== seq) return
      const next = audioFor(lines[i]) // its request goes out first
      if (i + 1 < lines.length) void warm(lines[i + 1])
      const got = await next
      if (mine !== seq) return
      if (got === 'refused') continue
      if (got === 'down') { deviceSpeak(lines.slice(i).join(' '), tell); return }
      const ok = await playToEnd(got)
      if (mine !== seq) return
      if (!ok) { deviceSpeak(lines.slice(i).join(' '), tell); return }
    }
  }

  const speak: LearnSpeak = (raw) => {
    // Stage directions, emoji and markdown are never read aloud (speakable).
    const text = speakable(raw)
    if (!text || typeof window === 'undefined') return
    // The exact line handed to the voice: the Android app forwards this tag to logcat
    // (MainActivity's console filter), which is how "no *blinks*" is checked on a phone.
    try { console.info(`[aither-speak] ${text}`) } catch { /* no console */ }
    const mine = ++seq
    stop()
    void run(splitForSpeech(text), mine)
  }
  speak.prefetch = (raw) => {
    const text = speakable(raw)
    if (!text || typeof window === 'undefined') return
    for (const line of splitForSpeech(text).slice(0, 2)) void warm(line)
  }
  return speak
}
