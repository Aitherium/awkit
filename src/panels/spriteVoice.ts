/**
 * spriteVoice: may a child's Sprite read its lines aloud right now?
 *
 * The server decides the rules (GET `${tutorBase}/me/sprite-body`, routers/family_sprite_body.py):
 * the guardian's lock (`none` lets the child mute, `muted`, `on`) and the Sprite's parental
 * chat-off switch, which always wins. The child's own mute is a per-device convenience kept
 * in localStorage; it only counts while the guardian has not locked the voice. The voice
 * itself is always the guardian's pick (the tutor's /me/say door): the child never names one.
 */

export type SpriteVoiceLock = 'none' | 'muted' | 'on'

export interface SpriteVoiceRule {
  lock: SpriteVoiceLock
  chatOff: boolean
}

/** Until the server answers, the Sprite stays quiet. */
export const QUIET_RULE: SpriteVoiceRule = { lock: 'muted', chatOff: false }

const MUTE_KEY = 'aither.learn.spriteMuted'

/** The rule from a /me/sprite-body body; anything unexpected is the quiet rule. */
export function asVoiceRule(data: unknown): SpriteVoiceRule {
  const v = (data && typeof data === 'object' ? (data as { voice?: unknown }).voice : null) as
    { lock?: unknown; chat_off?: unknown } | null
  if (!v || typeof v !== 'object') return QUIET_RULE
  const lock = v.lock === 'none' || v.lock === 'muted' || v.lock === 'on' ? v.lock : 'muted'
  return { lock, chatOff: v.chat_off === true }
}

/** True when the Sprite may speak, given the rule and the child's own mute. */
export function spriteMaySpeak(rule: SpriteVoiceRule, childMuted: boolean): boolean {
  if (rule.chatOff || rule.lock === 'muted') return false
  if (rule.lock === 'on') return true
  return !childMuted
}

/** The child may flip their own mute only while the guardian has not locked it. */
export function childMayToggle(rule: SpriteVoiceRule): boolean {
  return !rule.chatOff && rule.lock === 'none'
}

export function readChildMuted(): boolean {
  try { return window.localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}

export function writeChildMuted(muted: boolean): void {
  try { window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* a per-device nicety */ }
}

/** GET the rule; the quiet rule on any failure. */
export async function fetchVoiceRule(tutorBase: string, headers: Record<string, string>): Promise<SpriteVoiceRule> {
  try {
    const r = await fetch(`${tutorBase}/me/sprite-body`, { headers })
    if (!r.ok) return QUIET_RULE
    return asVoiceRule(await r.json().catch(() => null))
  } catch {
    return QUIET_RULE
  }
}
