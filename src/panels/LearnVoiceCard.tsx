/**
 * LearnVoiceCard: the guardian picks the voice that reads Aither Learn aloud to one child.
 *
 * - GET/PUT {apiBase}/family/learners/{lid}/voice: the current pick and the fixed
 *   roster the server offers (a child can never choose; anything off the roster is 422).
 * - POST {apiBase}/family/voice/preview {voice}: MP3 of one short line, so the guardian
 *   hears a voice before picking it.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { C, FONT_UI } from './learnTheme'
import { SheetHeading, help, mono, primary, quiet } from './learnParts'

type Call = (path: string, method?: string, body?: object) => Promise<{ status: number; ok: boolean; data: unknown }>

export interface LearnVoiceCardProps {
  call: Call
  apiBase: string
  getHeaders: () => Record<string, string>
  lid: string
  alias?: string
  onNote?: (message: string) => void
}

interface Choice { id: string; name: string; about?: string }
interface VoiceView { voice?: string; choices?: Choice[] }

const S: Record<string, CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', gap: 12, fontFamily: FONT_UI, color: C.ink },
  row: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  pick: { display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start', minWidth: 120 },
}

export default function LearnVoiceCard({ call, apiBase, getHeaders, lid, alias, onNote }: LearnVoiceCardProps) {
  const name = alias || 'this child'
  const base = `/family/learners/${encodeURIComponent(lid)}/voice`
  const [view, setView] = useState<VoiceView | null>(null)
  const [offline, setOffline] = useState(false)
  const [busy, setBusy] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let alive = true
    call(base)
      .then((r) => { if (!alive) return; if (r.ok && r.data) setView(r.data as VoiceView); else setOffline(true) })
      .catch(() => { if (alive) setOffline(true) })
    return () => { alive = false; try { audio.current?.pause() } catch { /* gone */ } }
  }, [call, base])

  const choose = async (id: string) => {
    if (busy || view?.voice === id) return
    setBusy(true)
    const r = await call(base, 'PUT', { voice: id }).catch(() => null)
    setBusy(false)
    if (r?.ok && r.data) {
      setView(r.data as VoiceView)
      const picked = (view?.choices || []).find((c) => c.id === id)
      onNote?.(`${name} will hear ${picked?.name || 'the new voice'}.`)
    } else onNote?.('Could not change the voice.')
  }

  const hear = async (id: string) => {
    try {
      const r = await fetch(`${apiBase}/family/voice/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: JSON.stringify({ voice: id }),
      })
      if (!r.ok) throw new Error(String(r.status))
      const url = URL.createObjectURL(await r.blob())
      try { audio.current?.pause() } catch { /* gone */ }
      const a = new Audio(url)
      audio.current = a
      a.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })
      await a.play()
    } catch {
      onNote?.('Could not play that voice right now.')
    }
  }

  return (
    <div style={S.card} data-testid="learn-voice">
      <SheetHeading label="read-aloud voice" title={`The voice ${name} hears`} />
      {offline && <div style={mono}>voice settings are offline</div>}
      {!offline && !view && <div style={mono}>loading</div>}
      {view && (
        <div style={S.row} role="radiogroup" aria-label="Read-aloud voice">
          {(view.choices || []).map((c) => {
            const on = view.voice === c.id
            return (
              <div key={c.id} style={S.pick}>
                <button type="button" role="radio" aria-checked={on} disabled={busy}
                  className={on ? 'al-primary al-focus' : 'al-quiet al-focus'} style={on ? primary : quiet}
                  onClick={() => choose(c.id)} data-testid={`voice-${c.id}`}>
                  {c.name}
                </button>
                {c.about && <span style={help}>{c.about}</span>}
                <button type="button" className="al-quiet al-focus" style={{ ...quiet, padding: '4px 10px' }}
                  onClick={() => hear(c.id)} aria-label={`Hear ${c.name}`}>Hear it</button>
              </div>
            )
          })}
        </div>
      )}
      <span style={help}>If the voice service is out of reach, {name}’s phone reads with its own best voice.</span>
    </div>
  )
}
