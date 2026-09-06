'use client'

/**
 * SpritePanel — the AitherSprite companion creature.
 *
 * Render tiers (highest available wins, per .PRODUCTS/.SPRITE/04-ARCHITECTURE):
 *   1. Generated animated idle sheet (media-forge auto-sprite), frame-stepped
 *   2. Generated mood still (alpha-keyed cutout) + blink-frame flipbook
 *   3. Live CSS creature (always available — gameplay never blocks on the GPU)
 *
 * Art keys follow the atelier convention: `${stage}/${form}/${moodLabel}`,
 * plus `/blink` (2-frame flipbook partner) and `/idle` (sheet).
 * Every mutating action shows a busy state — a pet must feel alive, never dead
 * (demo-verified 2026-07-08: silent 2s clicks read as "broken").
 */

import { useState, useEffect, useCallback, useRef, ReactNode } from 'react'

interface SpriteStatus {
  name: string
  stage: string
  form: string
  needs: Record<string, number>
  mood: { valence: number; arousal: number }
  mood_label: string
  dormant: boolean
  age_days: number
  knowledge_count?: number
  intellect?: { tier: number; label: string }
}

interface KnowledgeEntry {
  id: string
  kind: string
  title: string
  content: string
  visibility?: 'private' | 'public' | 'pending' | 'rejected'
  created_at: number
  updated_at: number
}

interface AssetEntry {
  status: 'pending' | 'ready' | 'failed'
  file: string | null
  hash: string
}

interface Appearance {
  stage: string
  form: string
  mood_label: string
  assets: Record<string, AssetEntry>
}

export interface SpritePanelProps {
  apiBase?: string
  extraHeaders?: Record<string, string>
}

const MOOD_THEME: Record<string, { aura: string; face: string; label: string; speed: string }> = {
  joyful:  { aura: '#4ade80', face: '◡', label: 'Joyful',  speed: '2.3s' },
  content: { aura: '#40C4FF', face: '‿', label: 'Content', speed: '3.4s' },
  curious: { aura: '#00E5FF', face: 'o', label: 'Curious', speed: '2.8s' },
  sleepy:  { aura: '#7C4DFF', face: '~', label: 'Sleepy',  speed: '4.4s' },
  grumpy:  { aura: '#f59e0b', face: '⌒', label: 'Grumpy',  speed: '3.0s' },
  sad:     { aura: '#536DFE', face: '⌢', label: 'Sad',     speed: '4.6s' },
  dormant: { aura: '#2A4A6A', face: '-', label: 'Dormant…', speed: '6s' },
}

const STAGE_SCALE: Record<string, number> = {
  egg: 0.72, baby: 0.76, child: 0.9, teen: 1.0, adult: 1.15, elder: 1.1,
}

// Owner call (2026-07-24, reaffirmed 2026-08-08): the generated SDXL creature
// ("the bunny") never reads as well as the live CSS creature (the blob), which
// genuinely breathes/blinks/floats. Default to the blob for now and skip ALL
// generated-art tiers — including the looping WebP, which landed AFTER the
// blob-default fix and used to bypass this flag (the bunny won again once the
// loop finished rendering). Flip to false to restore loop > anim-sheet > idle >
// still > CSS once the generated art is good enough to be the default.
const PREFER_CSS_CREATURE = true

// KNOWLEDGE MODEL: this creature is not fed food — it is fed knowledge.
// "hunger" is its appetite to learn; the Teach flow (Mind section) sates it.
const NEED_META: Record<string, { icon: string; color: string; label: string }> = {
  hunger:  { icon: '📚', color: '#f87171', label: 'Curiosity' },
  energy:  { icon: '⚡', color: '#f59e0b', label: 'Energy' },
  hygiene: { icon: '🫧', color: '#40C4FF', label: 'Clean' },
  bond:    { icon: '💙', color: '#ec4899', label: 'Bond' },
}

const CARE_BUTTONS = [
  { action: 'play',  icon: '🎾', label: 'Play' },
  { action: 'clean', icon: '🫧', label: 'Clean' },
  { action: 'rest',  icon: '🌙', label: 'Rest' },
]

const KNOWLEDGE_KINDS = [
  { kind: 'fact',  icon: '💡', label: 'Fact' },
  { kind: 'skill', icon: '🛠️', label: 'Skill' },
  { kind: 'link',  icon: '🔗', label: 'Link' },
  { kind: 'lore',  icon: '📜', label: 'Lore' },
]

export default function SpritePanel({ apiBase = '/api/sprite', extraHeaders = {} }: SpritePanelProps) {
  const [sprite, setSprite] = useState<SpriteStatus | null>(null)
  const [appearance, setAppearance] = useState<Appearance | null>(null)
  const [needsHatch, setNeedsHatch] = useState(false)
  // Sprite requires an authenticated user. Without this, a 401 fell through the
  // generic `!r.ok` branch and the panel rendered "Sprite service unreachable",
  // reporting a sign-in requirement as an outage (D-814).
  const [needsAuth, setNeedsAuth] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)  // which action is in flight
  const [hatchName, setHatchName] = useState('')
  const [chat, setChat] = useState('')
  const [bubble, setBubble] = useState<string | null>(null)
  const [thinking, setThinking] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [reaction, setReaction] = useState<string | null>(null)
  const [showMind, setShowMind] = useState(false)
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([])
  const [teachKind, setTeachKind] = useState('fact')
  const [teachTitle, setTeachTitle] = useState('')
  const [teachContent, setTeachContent] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [entitlementError, setEntitlementError] = useState<string | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [revealedText, setRevealedText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [currentQuiz, setCurrentQuiz] = useState<{ id: string; kind: string; title: string; content: string } | null>(null)
  const [quizRevealed, setQuizRevealed] = useState(false)
  const [heartParticles, setHeartParticles] = useState<Array<{ id: string; x: number; y: number }>>([])
  const prevStage = useRef<string | null>(null)
  const prevIntellect = useRef<number | null>(null)
  const artPumping = useRef(false)
  const artImgRef = useRef<HTMLImageElement | null>(null)
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const whisperTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const typewriterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/me/status`, { headers: extraHeaders })
      if (r.status === 404) { setNeedsHatch(true); setSprite(null); setLoading(false); return }
      // 401/403 is a sign-in requirement, NOT an outage — say so plainly.
      // /api/sprite/me/status returns {"detail":"authenticated user required"}
      // for an anonymous visitor, which is exactly who opens this from the
      // Living OS desktop.
      if (r.status === 401 || r.status === 403) {
        setNeedsAuth(true); setSprite(null); setLoading(false); return
      }
      if (!r.ok) { setLoading(false); return }
      setNeedsAuth(false)
      const s: SpriteStatus = await r.json()
      if (prevStage.current && prevStage.current !== s.stage) {
        setToast(`✨ ${s.name} evolved into a ${s.stage}! ✨`)
        setTimeout(() => setToast(null), 6000)
      } else if (
        s.intellect && prevIntellect.current !== null &&
        s.intellect.tier > prevIntellect.current
      ) {
        setToast(`🧠 ${s.name}'s mind is growing — now ${s.intellect.label}!`)
        setTimeout(() => setToast(null), 6000)
      }
      prevStage.current = s.stage
      prevIntellect.current = s.intellect ? s.intellect.tier : null
      setNeedsHatch(false)
      setSprite(s)
    } catch { /* transient — keep last state */ }
    setLoading(false)
  }, [apiBase, extraHeaders])

  const fetchAppearance = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/me/appearance`, { headers: extraHeaders })
      if (r.ok) setAppearance(await r.json())
    } catch { /* placeholder art still works */ }
  }, [apiBase, extraHeaders])

  // Load soundEnabled from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sprite_sound')
      setSoundEnabled(stored === null ? true : stored !== 'false')
    }
  }, [])

  // Persist soundEnabled to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sprite_sound', soundEnabled ? 'true' : 'false')
    }
  }, [soundEnabled])

  // Generate Web Audio chirp for babble
  const playChirp = useCallback((tier: number) => {
    if (!soundEnabled || typeof window === 'undefined') return
    if (!audioCtxRef.current) {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        audioCtxRef.current = ctx
      } catch {
        return
      }
    }
    const ctx = audioCtxRef.current
    const now = ctx.currentTime
    const pitches = [900, 800, 650, 500, 350]
    const basePitch = pitches[Math.min(tier, 4)]
    const detune = Math.random() * 100 - 50
    try {
      const osc = ctx.createOscillator()
      osc.type = Math.random() > 0.5 ? 'sine' : 'triangle'
      osc.frequency.setValueAtTime(basePitch + detune, now)
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.08, now)
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.06)
    } catch {
      /* audio unavailable */
    }
  }, [soundEnabled])

  /** Background art pump: one render at a time, waits out 429 throttles. */
  const kickArt = useCallback(async () => {
    if (artPumping.current) return
    artPumping.current = true
    try {
      for (let i = 0; i < 40; i++) {
        const r = await fetch(`${apiBase}/me/appearance/generate`, { method: 'POST', headers: extraHeaders })
        if (r.status === 429) { await sleep(21000); continue }
        if (!r.ok) break
        const d = await r.json().catch(() => null)
        if (!d) break
        if (d.status === 'rendered') { await fetchAppearance(); await sleep(2000); continue }
        if (d.status === 'complete') { await fetchAppearance(); break }
        if (d.status === 'mediaforge_offline') break
        if (d.status === 'failed') { await sleep(15000); continue }
        await sleep(4000)
      }
    } finally { artPumping.current = false }
  }, [apiBase, fetchAppearance, extraHeaders])

  const handlePet = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (busy) return
    // Add heart particle at click location
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left - 128
    const y = e.clientY - rect.top - 128
    const id = `heart-${Date.now()}`
    setHeartParticles(p => [...p, { id, x, y }])
    setTimeout(() => setHeartParticles(p => p.filter(h => h.id !== id)), 1200)
    // Send pet action
    react('bounce')
    const data = await doPost('/me/care', 'pet', { action: 'pet' })
    if (data) setSprite(prev => ({ ...(prev as SpriteStatus), ...data }))
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => {
    setDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (!sprite || sprite.dormant) return
    let kind = 'fact'
    let title = ''
    let content = ''
    const text = e.dataTransfer.getData('text/plain')
    const uriList = e.dataTransfer.getData('text/uri-list')
    const url = uriList || (text && /^https?:\/\//.test(text) ? text : null)
    if (url) {
      kind = 'link'
      title = url.slice(0, 120)
      content = ''
    } else if (text) {
      const lines = text.split('\n')
      title = lines[0].slice(0, 120)
      content = lines.slice(1).join('\n').slice(0, 4000)
    }
    if (title) {
      setTeachKind(kind)
      setTeachTitle(title)
      setTeachContent(content)
      setShowMind(true)
    }
  }

  const handleFetchQuiz = async () => {
    try {
      const r = await fetch(`${apiBase}/me/quiz`, { headers: extraHeaders })
      if (r.ok) {
        const d = await r.json()
        if (d.quiz) {
          setCurrentQuiz(d.quiz)
          setQuizRevealed(false)
        } else {
          setToast('Teach me something first!')
          setTimeout(() => setToast(null), 3000)
        }
      }
    } catch { /* quiz unavailable */ }
  }

  const handleFetchWhisper = useCallback(async () => {
    if (!sprite || sprite.dormant || !document) return
    try {
      const r = await fetch(`${apiBase}/me/whisper`, { headers: extraHeaders })
      if (r.ok) {
        const d = await r.json()
        if (d.whisper && !bubble) {
          setBubble(d.whisper)
          setRevealedText(d.whisper)
          if (d.sprite) setSprite(prev => ({ ...(prev as SpriteStatus), ...d.sprite }))
          if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
          bubbleTimerRef.current = setTimeout(() => {
            setBubble(null)
            setRevealedText('')
          }, 12_000)
        }
      }
    } catch { /* whisper unavailable */ }
  }, [apiBase, extraHeaders, sprite, bubble, bubbleTimerRef])

  useEffect(() => {
    fetchStatus(); fetchAppearance()
    const statusTimer = setInterval(() => { if (!document.hidden) fetchStatus() }, 60_000)
    const artTimer = setInterval(() => { if (!document.hidden) fetchAppearance() }, 300_000)
    // Whisper polling every 90s
    if (typeof document !== 'undefined') {
      whisperTimerRef.current = setInterval(() => {
        if (!document.hidden && sprite && !sprite.dormant) {
          handleFetchWhisper()
        }
      }, 90_000)
    }
    return () => {
      clearInterval(statusTimer)
      clearInterval(artTimer)
      if (whisperTimerRef.current) clearInterval(whisperTimerRef.current)
      if (typewriterTimerRef.current) clearInterval(typewriterTimerRef.current)
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
    }
  }, [fetchStatus, fetchAppearance, handleFetchWhisper, sprite])

  // Blink flipbook: open-eyes ↔ blink still on a human-ish cadence.
  useEffect(() => {
    if (blinkTimer.current) { clearTimeout(blinkTimer.current); blinkTimer.current = null }
    const img = artImgRef.current
    const blinkSrc = img?.dataset.blink
    if (!img || !blinkSrc) return
    const open = img.src
    const preload = new Image(); preload.src = blinkSrc
    const cycle = () => {
      const el = artImgRef.current
      if (!el) return
      el.src = blinkSrc
      setTimeout(() => { if (artImgRef.current) artImgRef.current.src = open }, 130)
      blinkTimer.current = setTimeout(cycle, 1800 + Math.random() * 2600)
    }
    blinkTimer.current = setTimeout(cycle, 1200)
    return () => { if (blinkTimer.current) clearTimeout(blinkTimer.current) }
  }, [appearance, sprite?.mood_label, sprite?.stage])

  const doPost = useCallback(async (path: string, tag: string, body?: object) => {
    setBusy(tag)
    setEntitlementError(null)
    try {
      const r = await fetch(`${apiBase}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await r.json().catch(() => null)
      if (r.ok) return data
      if (r.status === 402) {
        setEntitlementError('🌍 Taught knowledge joins the community commons (CC BY-SA 4.0). Want it private? Subscribe.')
        return null
      }
      if (data?.detail) { setToast(`⚠ ${data.detail}`); setTimeout(() => setToast(null), 4000) }
    } catch { /* surfaced by unchanged UI */ }
    finally { setBusy(null) }
    return null
  }, [apiBase, extraHeaders])

  const react = (kind: string) => {
    setReaction(kind)
    setTimeout(() => setReaction(null), 900)
  }

  const handleCare = async (action: string) => {
    react(action === 'play' ? 'bounce' : 'shiver')
    const data = await doPost('/me/care', action, { action })
    if (data) setSprite(prev => ({ ...(prev as SpriteStatus), ...data }))
  }

  const handleTalk = async () => {
    const message = chat.trim()
    if (!message) return
    setChat('')
    setThinking(true); setBubble(null); setRevealedText('')
    const data = await doPost('/me/talk', 'talk', { message })
    setThinking(false)
    if (data?.reply) {
      react('bounce')
      if (data.sprite) setSprite(prev => ({ ...(prev as SpriteStatus), ...data.sprite }))
      // Typewriter reveal
      const fullText = data.reply
      let idx = 0
      const tier = data.sprite?.intellect?.tier ?? 0
      const startTime = Date.now()
      const maxDuration = 6000
      if (typewriterTimerRef.current) clearInterval(typewriterTimerRef.current)
      typewriterTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime
        const pct = Math.min(elapsed / maxDuration, 1)
        const targetIdx = Math.floor(pct * fullText.length)
        const charsAdded = targetIdx - idx
        // Play chirp for every 2-3 non-space chars (approx)
        if (charsAdded > 0 && Math.random() > (2 / 3)) {
          playChirp(tier)
        }
        setRevealedText(fullText.slice(0, targetIdx))
        if (targetIdx >= fullText.length) {
          clearInterval(typewriterTimerRef.current!)
          typewriterTimerRef.current = null
        }
        idx = targetIdx
      }, 30)
      // Clear bubble after 15s
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
      bubbleTimerRef.current = setTimeout(() => {
        setBubble(null)
        setRevealedText('')
      }, 15_000)
    }
  }

  const handleHatch = async () => {
    const data = await doPost('/hatch', 'hatch', { name: hatchName.trim() || 'Sprite' })
    if (data) { setNeedsHatch(false); setSprite(data); fetchAppearance(); kickArt() }
  }

  const handleRevive = async () => {
    const data = await doPost('/me/revive', 'revive')
    if (data) setSprite(prev => ({ ...(prev as SpriteStatus), ...data }))
  }

  // ── The Mind: knowledge base (teaching IS feeding) ──────────────────────
  const loadKnowledge = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/me/knowledge?limit=100`, {
        headers: extraHeaders,
      })
      if (r.ok) {
        const d = await r.json()
        setKnowledge(Array.isArray(d.entries) ? d.entries : [])
      }
    } catch { /* list stays as-is */ }
  }, [apiBase, extraHeaders])

  useEffect(() => { if (showMind) loadKnowledge() }, [showMind, loadKnowledge])

  const handleTeach = async () => {
    const title = teachTitle.trim()
    if (!title) return
    react('bounce')
    const data = await doPost('/me/teach', 'teach', {
      kind: teachKind, title, content: teachContent.trim(),
    })
    if (data?.sprite) {
      setSprite(prev => ({ ...(prev as SpriteStatus), ...data.sprite }))
      setTeachTitle(''); setTeachContent('')
      if (data.entry) setKnowledge(prev => [data.entry, ...prev])
    }
  }

  const handleForget = async (id: string) => {
    setBusy(`forget-${id}`)
    try {
      const r = await fetch(`${apiBase}/me/knowledge/${id}`, {
        method: 'DELETE',
        headers: extraHeaders,
      })
      if (r.ok) {
        const data = await r.json().catch(() => null)
        if (data) setSprite(prev => ({ ...(prev as SpriteStatus), ...data }))
        setKnowledge(prev => prev.filter(e => e.id !== id))
      }
    } catch { /* entry stays visible */ }
    finally { setBusy(null) }
  }

  const handleRevise = async (id: string) => {
    setBusy(`revise-${id}`)
    try {
      const r = await fetch(`${apiBase}/me/knowledge/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: JSON.stringify({ content: editContent }),
      })
      if (r.ok) {
        const d = await r.json().catch(() => null)
        if (d?.entry) setKnowledge(prev => prev.map(e => (e.id === id ? d.entry : e)))
        setEditingId(null)
      }
    } catch { /* edit box stays open */ }
    finally { setBusy(null) }
  }

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
      Finding your sprite…
    </div>
  }

  if (needsHatch) {
    return (
      <div style={{ padding: '2rem', maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <SpriteKeyframes />
        <div style={{ fontSize: '5rem', animation: 'sprite-wobble 2.5s ease-in-out infinite' }}>🥚</div>
        <h2 style={{ color: 'var(--text-primary)', margin: '1rem 0 0.5rem' }}>Hatch your Sprite</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          A tiny companion that lives in your workspace. It doesn&apos;t eat food — it
          eats <strong>knowledge</strong>. Teach it facts and skills, curate its little
          wiki of a mind, and watch it grow into something real.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: '1rem' }}>
          <input
            value={hatchName}
            onChange={e => setHatchName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleHatch()}
            placeholder="Name your creature…"
            maxLength={40}
            style={inputStyle()}
          />
          <button onClick={handleHatch} disabled={busy !== null} style={btnStyle(true, busy === 'hatch')}>
            {busy === 'hatch' ? 'Hatching…' : 'Hatch 🐣'}
          </button>
        </div>
      </div>
    )
  }

  if (needsAuth) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', lineHeight: 1.6 }}>
      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🥚</div>
      <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: '0.35rem' }}>
        Your sprite is waiting on an account.
      </div>
      <div style={{ fontSize: '0.85rem' }}>
        A sprite grows with you over time, so it needs somewhere to live.
        Sign in (free) and it hatches on the spot.
      </div>
    </div>
  }

  if (!sprite) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
      Sprite service unreachable — try again shortly.
    </div>
  }

  const theme = MOOD_THEME[sprite.mood_label] ?? MOOD_THEME.content
  const moodKey = sprite.dormant ? 'content' : sprite.mood_label
  const loop = appearance?.assets?.[`${sprite.stage}/${sprite.form}/loop`]
  const still = appearance?.assets?.[`${sprite.stage}/${sprite.form}/${moodKey}`]
  const blink = appearance?.assets?.[`${sprite.stage}/${sprite.form}/blink`]
  const idle = appearance?.assets?.[`${sprite.stage}/${sprite.form}/idle`]
  const pendingCount = appearance
    ? Object.values(appearance.assets).filter((a: any) => a.status !== 'ready').length
    : null

  return (
    <div style={{ padding: '1.5rem', maxWidth: 760, margin: '0 auto' }}>
      <SpriteKeyframes />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>
          {sprite.name}
          <span style={{ marginLeft: 10, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {sprite.stage} · {sprite.form} · {sprite.age_days.toFixed(1)} days
            {typeof sprite.knowledge_count === 'number' &&
              ` · 📚 ${sprite.knowledge_count} learned`}
            {sprite.intellect && ` · 🧠 ${sprite.intellect.label}`}
          </span>
        </h2>
        <span style={{
          fontSize: '0.8rem', padding: '2px 10px', borderRadius: 999, transition: 'all .5s',
          background: `${theme.aura}22`, color: theme.aura, border: `1px solid ${theme.aura}55`,
        }}>
          {theme.label}
        </span>
      </div>

      {toast && (
        <div style={{
          margin: '0.75rem 0', padding: '10px 14px', borderRadius: 10, textAlign: 'center',
          background: 'linear-gradient(90deg, #7C4DFF33, #00E5FF33)',
          border: '1px solid var(--accent-secondary)', color: 'var(--text-primary)',
          animation: 'sprite-pop 0.4s ease-out',
        }}>{toast}</div>
      )}

      {/* Creature stage */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          position: 'relative', height: 340, margin: '1rem 0', borderRadius: 16,
          background: dragOver
            ? `radial-gradient(ellipse at 50% 68%, ${theme.aura}33 0%, transparent 62%), var(--bg-deep)`
            : `radial-gradient(ellipse at 50% 68%, ${theme.aura}20 0%, transparent 62%), var(--bg-deep)`,
          border: dragOver ? `2px dashed ${theme.aura}` : '1px solid var(--glass-border)',
          overflow: 'hidden', transition: 'background .2s, border .2s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        {(bubble || thinking) && (
          <div style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
            maxWidth: '82%', padding: '10px 16px', borderRadius: 14, zIndex: 3,
            background: 'var(--bg-elevated)', border: `1px solid ${theme.aura}66`,
            color: 'var(--text-primary)', fontSize: '0.9rem',
            animation: 'sprite-pop 0.3s ease-out',
          }}>
            {thinking ? <ThinkingDots /> : (revealedText || bubble)}
          </div>
        )}

        {/* Heart particles for petting */}
        {heartParticles.map(h => (
          <div
            key={h.id}
            style={{
              position: 'absolute',
              left: `calc(50% + ${h.x}px)`,
              top: `calc(50% + ${h.y}px)`,
              fontSize: 24,
              pointerEvents: 'none',
              animation: 'sprite-heart-float 1.2s ease-out forwards',
              zIndex: 2,
            }}
          >
            ❤️
          </div>
        ))}

        <CreatureView
          sprite={sprite} loop={loop} still={still} blink={blink} idle={idle}
          theme={theme} apiBase={apiBase} reaction={reaction} artImgRef={artImgRef}
          onPetClick={handlePet} appearance={appearance}
        />

        {sprite.dormant && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(6,13,26,0.8)', zIndex: 2,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 12,
          }}>
            <div style={{ color: 'var(--text-secondary)' }}>
              {sprite.name} went dormant from neglect…
            </div>
            <button onClick={handleRevive} disabled={busy !== null}
              style={btnStyle(true, busy === 'revive')}>
              💫 Revive
            </button>
          </div>
        )}

        {pendingCount !== null && pendingCount > 0 && !sprite.dormant && (
          <button
            onClick={kickArt}
            title="Generated art renders in the background — click to nudge the queue"
            style={{
              position: 'absolute', bottom: 10, right: 10, fontSize: '0.7rem',
              padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
              background: 'var(--bg-elevated)', color: 'var(--text-muted)',
              border: '1px solid var(--glass-border)',
            }}
          >
            🎨 rendering art… {Object.values(appearance!.assets).filter((a: any) => a.status === 'ready').length}
            /{Object.keys(appearance!.assets).length}
          </button>
        )}
      </div>

      {/* Needs bars */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {Object.entries(NEED_META).map(([need, meta]) => {
          const v = sprite.needs[need] ?? 0
          return (
            <div key={need} style={{
              padding: '10px 12px', borderRadius: 10, background: 'var(--bg-elevated)',
              border: '1px solid var(--glass-border)',
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem',
                color: 'var(--text-secondary)', marginBottom: 6,
              }}>
                <span>{meta.icon} {meta.label}</span>
                <span style={{ color: v < 0.25 ? 'var(--accent-danger)' : 'var(--text-muted)' }}>
                  {Math.round(v * 100)}%
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-deep)' }}>
                <div style={{
                  height: '100%', borderRadius: 3, width: `${Math.round(v * 100)}%`,
                  background: meta.color, transition: 'width 0.6s cubic-bezier(.2,.9,.3,1.2)',
                  boxShadow: v > 0.05 ? `0 0 6px ${meta.color}88` : 'none',
                }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Care actions — Teach leads: knowledge is this creature's food */}
      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <button
          onClick={() => setShowMind(v => !v)}
          disabled={busy !== null}
          style={{ ...btnStyle(true, false), flex: 1.4, minWidth: 130 }}
        >
          📚 {showMind ? 'Close the Mind' : 'Teach'}
        </button>
        {CARE_BUTTONS.map(b => (
          <button
            key={b.action}
            onClick={() => handleCare(b.action)}
            disabled={busy !== null || sprite.dormant}
            style={{ ...btnStyle(false, busy === b.action), flex: 1, minWidth: 110 }}
          >
            {b.icon} {b.label}
          </button>
        ))}
      </div>

      {/* The Mind — wiki-style knowledge base the owner curates */}
      {showMind && (
        <div style={{
          marginTop: 12, padding: 14, borderRadius: 12,
          background: 'var(--bg-elevated)', border: '1px solid var(--glass-border)',
        }}>
          <div style={{
            fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10,
          }}>
            {sprite.name} grows by what you teach — every lesson becomes a page in
            its mind. Curate it like a tiny wiki: revise pages, or let it forget.
          </div>

          {/* Teach form */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <select
              value={teachKind}
              onChange={e => setTeachKind(e.target.value)}
              style={{ ...inputStyle(), width: 110, flex: 'none' }}
            >
              {KNOWLEDGE_KINDS.map(k => (
                <option key={k.kind} value={k.kind}>{k.icon} {k.label}</option>
              ))}
            </select>
            <input
              value={teachTitle}
              onChange={e => setTeachTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && busy === null && handleTeach()}
              placeholder={`Teach ${sprite.name} something…`}
              maxLength={120}
              disabled={busy !== null || sprite.dormant}
              style={{ ...inputStyle(), flex: 1, minWidth: 180 }}
            />
            <button
              onClick={handleTeach}
              disabled={busy !== null || sprite.dormant || !teachTitle.trim()}
              style={btnStyle(true, busy === 'teach')}
            >
              {busy === 'teach' ? 'Learning…' : '✨ Teach'}
            </button>
          </div>
          <textarea
            value={teachContent}
            onChange={e => setTeachContent(e.target.value)}
            placeholder="Details (optional) — the full lesson, a how-to, a link…"
            maxLength={4000}
            rows={2}
            disabled={busy !== null || sprite.dormant}
            style={{ ...inputStyle(), width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
          />

          {/* Visibility notice for non-entitled users */}
          {entitlementError && (
            <div style={{
              marginTop: 8, padding: '8px 12px', borderRadius: 8,
              background: 'rgba(147, 197, 253, 0.1)',
              border: '1px solid rgba(147, 197, 253, 0.3)',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem',
            }}>
              {entitlementError}
            </div>
          )}

          {/* Quiz section */}
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button
              onClick={handleFetchQuiz}
              disabled={busy !== null || sprite.dormant}
              style={{
                ...btnStyle(false, false),
                flex: 1,
                padding: '8px 12px',
                fontSize: '0.8rem',
              }}
            >
              ❓ Quiz me
            </button>
          </div>

          {/* Quiz flashcard */}
          {currentQuiz && (
            <div style={{
              marginTop: 10, padding: 12, borderRadius: 10,
              background: 'var(--bg-deep)', border: `1px solid ${theme.aura}44`,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {KNOWLEDGE_KINDS.find(k => k.kind === currentQuiz.kind)?.icon ?? '💡'} {currentQuiz.kind}
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                {currentQuiz.title}
              </div>
              {!quizRevealed ? (
                <button
                  onClick={() => setQuizRevealed(true)}
                  style={{
                    ...btnStyle(true, false),
                    padding: '8px 12px',
                    fontSize: '0.8rem',
                    alignSelf: 'flex-start',
                  }}
                >
                  Reveal
                </button>
              ) : (
                <>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
                    {currentQuiz.content}
                  </div>
                  <button
                    onClick={handleFetchQuiz}
                    style={{
                      ...btnStyle(false, false),
                      padding: '6px 12px',
                      fontSize: '0.75rem',
                      alignSelf: 'flex-start',
                    }}
                  >
                    Another
                  </button>
                </>
              )}
            </div>
          )}

          {/* Knowledge pages */}
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {knowledge.length === 0 && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: 8 }}>
                An empty mind — teach {sprite.name} its first thing above.
              </div>
            )}
            {knowledge.map(e => {
              const visibilityIcon = e.visibility === 'private' ? '🔒'
                : e.visibility === 'public' ? '🌍'
                : e.visibility === 'pending' ? '⏳'
                : '❓'
              return (
              <div key={e.id} style={{
                padding: '8px 10px', borderRadius: 8, background: 'var(--bg-deep)',
                border: '1px solid var(--glass-border)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                    {KNOWLEDGE_KINDS.find(k => k.kind === e.kind)?.icon ?? '💡'} {e.title}
                    {e.visibility && <span style={{ marginLeft: 6, fontSize: '0.8rem' }} title={e.visibility}>{visibilityIcon}</span>}
                  </span>
                  <span style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    <button
                      onClick={() => { setEditingId(editingId === e.id ? null : e.id); setEditContent(e.content) }}
                      style={{ ...btnStyle(false, false), padding: '2px 8px', fontSize: '0.7rem' }}
                    >✏️</button>
                    <button
                      onClick={() => handleForget(e.id)}
                      disabled={busy !== null}
                      title="Forget this"
                      style={{ ...btnStyle(false, busy === `forget-${e.id}`), padding: '2px 8px', fontSize: '0.7rem' }}
                    >🗑️</button>
                  </span>
                </div>
                {editingId === e.id ? (
                  <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                    <textarea
                      value={editContent}
                      onChange={ev => setEditContent(ev.target.value)}
                      maxLength={4000}
                      rows={2}
                      style={{ ...inputStyle(), flex: 1, resize: 'vertical', fontFamily: 'inherit' }}
                    />
                    <button
                      onClick={() => handleRevise(e.id)}
                      disabled={busy !== null}
                      style={btnStyle(true, busy === `revise-${e.id}`)}
                    >Save</button>
                  </div>
                ) : e.content ? (
                  <div style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
                    {e.content.length > 240 ? `${e.content.slice(0, 240)}…` : e.content}
                  </div>
                ) : null}
              </div>
            )
            })}
          </div>
        </div>
      )}

      {/* Talk */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          value={chat}
          onChange={e => setChat(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && busy === null && handleTalk()}
          placeholder={
            sprite.dormant ? `${sprite.name} is dormant…`
            : (sprite.intellect?.tier ?? 2) === 0 ? `${sprite.name} can only babble — teach it words!`
            : (sprite.intellect?.tier ?? 2) === 1 ? `${sprite.name} is learning to talk — keep teaching…`
            : `Say something to ${sprite.name}…`
          }
          disabled={busy !== null || sprite.dormant}
          maxLength={2000}
          style={{ ...inputStyle(), flex: 1 }}
        />
        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          title={soundEnabled ? 'Mute babble sounds' : 'Unmute babble sounds'}
          style={{
            padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
            border: '1px solid var(--glass-border)', background: 'var(--bg-elevated)',
            color: 'var(--text-primary)', fontSize: '1rem', lineHeight: 1,
          }}>
          {soundEnabled ? '🔊' : '🔇'}
        </button>
        <button onClick={handleTalk}
          disabled={busy !== null || sprite.dormant || !chat.trim()}
          style={btnStyle(true, busy === 'talk')}>
          💬 Talk
        </button>
      </div>
    </div>
  )
}

/** Creature renderer — looping WebP > live CSS blob > (legacy) mood anim/idle/still.
 * The transparent looping WebP is the primary "alive" render; when it isn't ready
 * yet, PREFER_CSS_CREATURE shows the animated blob rather than the janky flipbook. */
function CreatureView({ sprite, loop, still, blink, idle, theme, apiBase, reaction, artImgRef, onPetClick, appearance }: {
  sprite: SpriteStatus
  loop: AssetEntry | undefined
  still: AssetEntry | undefined
  blink: AssetEntry | undefined
  idle: AssetEntry | undefined
  theme: { aura: string; face: string; speed: string }
  apiBase: string
  reaction: string | null
  artImgRef: React.MutableRefObject<HTMLImageElement | null>
  onPetClick: (e: React.MouseEvent) => void
  appearance: Appearance | null
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const scale = STAGE_SCALE[sprite.stage] ?? 1
  const expressive = ['joyful', 'grumpy', 'sad'].includes(sprite.mood_label)
  const wrapAnim = sprite.dormant
    ? 'none'
    : reaction === 'bounce' ? 'sprite-bounce 0.8s ease-out'
    : reaction === 'shiver' ? 'sprite-shiver 0.5s ease-in-out 2'
    : `sprite-float ${theme.speed} ease-in-out infinite`

  // TOP TIER: the looping transparent WebP is the real animation — a smooth WAN
  // i2v clip with alpha that floats over the UI. When it's ready it would beat
  // everything (including the CSS blob), so it is gated off while
  // PREFER_CSS_CREATURE — the animated blob is the default until the generated
  // art animates well enough to win on its own. The wrapper still carries the
  // float + reaction so pet/bounce/shiver read through. Renders as a plain
  // animated <img>.
  const loopReady = loop?.status === 'ready'

  // F6: Check for mood animation sheet (preference order: anim > idle > still+blink > CSS)
  // Gated off while PREFER_CSS_CREATURE — the blob wins until generated art animates well.
  const moodAnimKey = `${sprite.stage}/${sprite.form}/anim-${sprite.mood_label}`
  const moodAnim = appearance?.assets?.[moodAnimKey]
  let sheetToUse: { type: string; asset: AssetEntry } | null = null
  if (!PREFER_CSS_CREATURE) {
    if (moodAnim?.status === 'ready') {
      sheetToUse = { type: 'mood-anim', asset: moodAnim }
    } else if (idle?.status === 'ready' && !(expressive && still?.status === 'ready')) {
      sheetToUse = { type: 'idle', asset: idle }
    }
  }

  // Sheet frame stepper (frame count = width / height; single-row strip, 8-frame standard size = 128px cells).
  useEffect(() => {
    const el = sheetRef.current
    if (!sheetToUse || !el) return
    const src = `${apiBase}/assets/${sheetToUse.asset.hash}`
    const img = new Image()
    let timer: ReturnType<typeof setInterval> | null = null
    img.onload = () => {
      const frames = Math.max(1, Math.round(img.width / img.height))
      const size = 256
      el.style.backgroundImage = `url(${src})`
      el.style.backgroundSize = `${frames * size}px ${size}px`
      let f = 0
      timer = setInterval(() => {
        f = (f + 1) % frames
        el.style.backgroundPositionX = `-${f * size}px`
      }, 125)
    }
    img.src = src
    return () => { if (timer) clearInterval(timer) }
  }, [sheetToUse, apiBase])

  // TOP TIER: looping transparent WebP (the real WAN i2v animation, alpha-matted).
  // Skipped while PREFER_CSS_CREATURE — the animated blob is the default.
  if (loopReady && loop && !PREFER_CSS_CREATURE) {
    return (
      <div onClick={onPetClick} style={{ animation: wrapAnim, transform: `scale(${scale})`, cursor: 'pointer' }}>
        <img
          src={`${apiBase}/assets/${loop.hash}`}
          alt={sprite.name}
          style={{
            height: 260, width: 'auto', display: 'block',
            filter: `drop-shadow(0 0 30px ${theme.aura}66)`,
          }}
        />
      </div>
    )
  }

  if (sheetToUse) {
    return (
      <div onClick={onPetClick} style={{ animation: wrapAnim, scale: String(scale), cursor: 'pointer' }}>
        <div ref={sheetRef} style={{
          width: 256, height: 256, backgroundRepeat: 'no-repeat',
          filter: `drop-shadow(0 0 30px ${theme.aura}66)`,
        }} />
      </div>
    )
  }

  if (!PREFER_CSS_CREATURE && still?.status === 'ready') {
    return (
      <div onClick={onPetClick} style={{ animation: wrapAnim, position: 'relative', cursor: 'pointer' }}>
        <img
          ref={el => { artImgRef.current = el }}
          src={`${apiBase}/assets/${still.hash}`}
          // Blink flipbook disabled pending inpaint-based blink frames: SDXL
          // same-seed "eyes closed" variants drift the pose (live-verified
          // 2026-07-08) and read as a glitch. Wire data-blink to re-enable.
          data-blink={undefined}
          alt={sprite.name}
          style={{
            height: 280 * scale, animation: 'sprite-artlife 4.2s ease-in-out infinite',
            filter: `drop-shadow(0 0 30px ${theme.aura}66)`,
            cursor: 'pointer',
          }}
        />
        {sprite.mood_label === 'joyful' && <>
          <span style={sparkStyle(-6, -20)}>✨</span>
          <span style={{ ...sparkStyle(undefined, undefined, 10, -22), animationDelay: '.7s' }}>✨</span>
        </>}
        {(sprite.mood_label === 'sleepy' || sprite.dormant) &&
          <span style={{ position: 'absolute', top: -14, right: -34, animation: 'sprite-float 2s ease-in-out infinite' }}>💤</span>}
      </div>
    )
  }

  // Live CSS creature — always available, mood-driven.
  if (sprite.stage === 'egg') {
    // A styled speckled egg (not the bare 🥚 glyph, which read as broken while
    // the real art renders). Glossy shell, mood-tinted, faint glowing crack.
    const ew = 116 * scale
    const speckles: [number, number, number][] = [
      [32, 40, 7], [60, 28, 5], [72, 56, 6], [42, 66, 5], [26, 58, 4], [66, 74, 4],
    ]
    return (
      <div onClick={onPetClick} style={{
        animation: sprite.dormant ? 'none' : 'sprite-wobble 2.6s ease-in-out infinite',
        filter: `drop-shadow(0 0 26px ${theme.aura}55)`,
        cursor: 'pointer',
      }}>
        <div style={{
          width: ew, height: ew * 1.32, position: 'relative',
          borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
          background: `radial-gradient(ellipse at 38% 30%, #ffffff 0%, ${theme.aura}dd 44%, ${theme.aura}99 100%)`,
          boxShadow: `inset -10px -14px 26px ${theme.aura}55, inset 8px 10px 22px #ffffff88`,
        }}>
          {speckles.map(([l, t, r], i) => (
            <span key={i} style={{
              position: 'absolute', left: `${l}%`, top: `${t}%`,
              width: r, height: r, borderRadius: '50%', background: '#ffffffcc',
            }} />
          ))}
          <span style={{
            position: 'absolute', left: '47%', top: '28%', width: 2, height: '36%',
            background: `linear-gradient(#ffffff, ${theme.aura})`, boxShadow: '0 0 8px #fff',
            transform: 'rotate(13deg)', animation: sprite.dormant ? 'none' : 'sprite-think 2.4s infinite',
          }} />
        </div>
      </div>
    )
  }
  const sleepy = sprite.mood_label === 'sleepy' || sprite.dormant
  return (
    <div onClick={onPetClick} style={{ animation: wrapAnim, transform: `scale(${scale})`, cursor: 'pointer' }}>
      <div style={{
        width: 150, height: 128, position: 'relative',
        background: `radial-gradient(circle at 35% 30%, ${theme.aura}cc, ${theme.aura}55 70%)`,
        borderRadius: '46% 54% 52% 48% / 58% 56% 44% 42%',
        boxShadow: `0 0 44px ${theme.aura}44, inset -8px -10px 24px rgba(0,0,0,0.25)`,
        animation: sprite.dormant ? 'none' : 'sprite-breathe 3s ease-in-out infinite',
      }}>
        <div style={{ position: 'absolute', top: 44, left: 36, display: 'flex', gap: 38 }}>
          {[0, 1].map(i => (
            <div key={i} style={{
              width: 15, height: sleepy ? 3 : 19,
              borderRadius: '50%', background: '#0A1628', transition: 'height .4s',
              animation: sprite.dormant ? 'none' : 'sprite-blink 4.5s infinite',
            }} />
          ))}
        </div>
        <div style={{
          position: 'absolute', top: 78, left: '50%', transform: 'translateX(-50%)',
          color: '#0A1628', fontSize: 22, fontWeight: 700, lineHeight: 1, transition: 'all .4s',
        }}>
          {theme.face}
        </div>
      </div>
      {sleepy && (
        <div style={{
          position: 'absolute', marginTop: -100, marginLeft: 130,
          color: 'var(--text-muted)', animation: 'sprite-float 2s ease-in-out infinite',
        }}>💤</div>
      )}
    </div>
  )
}

function ThinkingDots() {
  return <span>
    {[0, 1, 2].map(i => (
      <span key={i} style={{
        display: 'inline-block', animation: 'sprite-think 1.2s infinite',
        animationDelay: `${i * 0.2}s`, marginRight: 3,
      }}>●</span>
    ))}
  </span>
}

function SpriteKeyframes() {
  return (
    <style>{`
      @keyframes sprite-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-14px) } }
      @keyframes sprite-breathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.04, 0.97) } }
      @keyframes sprite-wobble { 0%,100% { transform: rotate(-4deg) } 50% { transform: rotate(4deg) } }
      @keyframes sprite-blink { 0%, 93%, 100% { transform: scaleY(1) } 95%, 98% { transform: scaleY(0.1) } }
      @keyframes sprite-pop { 0% { transform: scale(0.85); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }
      @keyframes sprite-artlife { 0%,100% { transform:scale(1) rotate(-1.2deg) } 25% { transform:scale(1.015,.985) rotate(0deg) } 50% { transform:scale(.99,1.01) rotate(1.2deg) } 75% { transform:scale(1.01,.99) rotate(0deg) } }
      @keyframes sprite-bounce { 0%{transform:translateY(0)} 30%{transform:translateY(-30px) scale(1.05,.95)} 55%{transform:translateY(0) scale(.97,1.04)} 75%{transform:translateY(-10px)} 100%{transform:translateY(0)} }
      @keyframes sprite-shiver { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-5px) rotate(-2deg)} 75%{transform:translateX(5px) rotate(2deg)} }
      @keyframes sprite-think { 0%,100%{opacity:.25} 50%{opacity:1} }
      @keyframes sprite-spin { to { transform: rotate(360deg) } }
      @keyframes sprite-heart-float { 0% { transform: scale(1) translateY(0); opacity: 1 } 100% { transform: scale(0.2) translateY(-60px); opacity: 0 } }
    `}</style>
  )
}

function sparkStyle(top?: number, left?: number, bottom?: number, right?: number): React.CSSProperties {
  return {
    position: 'absolute', top, left, bottom, right, fontSize: 15,
    animation: 'sprite-think 1.6s infinite',
  }
}

function inputStyle(): React.CSSProperties {
  return {
    padding: '10px 14px', borderRadius: 10,
    border: '1px solid var(--glass-border)', background: 'var(--bg-elevated)',
    color: 'var(--text-primary)', fontSize: '0.9rem',
  }
}

function btnStyle(primary: boolean, isBusy?: boolean): React.CSSProperties {
  return {
    padding: '10px 16px', borderRadius: 10, fontSize: '0.85rem',
    cursor: isBusy ? 'default' : 'pointer', position: 'relative',
    border: primary ? 'none' : '1px solid var(--glass-border)',
    background: primary ? 'var(--accent-primary)' : 'var(--bg-elevated)',
    color: primary ? '#06121F' : 'var(--text-primary)', fontWeight: 600,
    opacity: isBusy ? 0.6 : 1, transition: 'opacity .2s',
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
