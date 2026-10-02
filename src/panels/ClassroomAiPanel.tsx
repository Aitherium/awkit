/**
 * ClassroomAiPanel: "AI your way" -- where ONE class's AI runs.
 *
 * Genesis /api/v1/classroom/classes/{id}/ai (routers/classroom_ai.py):
 *   GET       the choice on record, the four options, key status, readiness
 *   PUT       save a choice (teacher of record only; an outside provider needs the
 *             recorded approval: who, their role, the day, and an account that may
 *             manage the workspace's provider keys: `can_choose_outside`)
 *   POST test one probe that carries no class data, through the same gate the studio and insights use
 *
 * The option copy comes from the server (lib/classroom/ai_choice.py OPTIONS), so the
 * page and the gate can never describe different rules. A provider key is stored
 * through the existing tenant key endpoint (`keysBase`, Genesis /llm-providers/key);
 * this panel sends it once and never reads one back: the server answers provider +
 * last four only (and the last four only to an account that may manage keys).
 *
 * The default option is the server this classroom runs on (mode id `device`, kept for
 * the stored rows): nothing here runs on a teacher's computer, and the copy says so.
 *
 * One primary action (Save this choice). Testing and storing a key are quiet actions.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { C, EASE, FONT_MONO, FONT_UI, LEARN_CSS, LearnModeSwitch } from './learnTheme'
import { CheckRow, Field, Skel, fieldBox, help, mono, primary, quiet } from './learnParts'
import {
  CLASSROOM_API, CLASSROOM_CSS, ClassroomHttpError, classroomFetch, cs, cseg, loadStateOf, send, useClassroomSurface,
} from './classroomApi'

export type AiMode = 'device' | 'school_key' | 'open_api' | 'private_cloud'

export interface AiOption {
  mode: AiMode
  title: string
  where: string
  student_data: string
  providers: string[]
  needs_approval: boolean
}
export interface AiApproval { approved_by: string; approved_role: string; approved_on: string }
export interface AiChoice {
  class_id: string
  configured: boolean
  mode: AiMode
  provider: string
  provider_label: string
  base_url: string
  endpoint_host: string
  model: string
  share_notes: boolean
  approval: AiApproval | null
  recorded_at?: string | null
  student_data: 'stays_here' | 'deidentified'
}
export interface AiKeyStatus { provider: string; label: string; key_set: boolean; key_last4: string }
export interface AiStatus { ready: boolean; code: string; detail: string }
export interface AiView {
  class_id: string
  choice: AiChoice
  options: AiOption[]
  providers: AiKeyStatus[]
  status: AiStatus
  can_edit: boolean
  /** False when this account may not choose an outside provider (the server enforces it). */
  can_choose_outside?: boolean
  self_host_docs?: string
  unavailable_message?: string
}
export interface AiTestResult {
  ok: boolean
  mode: string
  provider: string
  model: string
  latency_ms: number | null
  code: string
  detail: string
}

export interface ClassroomAiPanelProps {
  classId: string
  /** Shown in the heading when the host knows it. */
  className?: string | null
  apiBase?: string
  /** The existing tenant key endpoints (Veil: the /api/genesis allowlist proxy). */
  keysBase?: string
  extraHeaders?: Record<string, string>
}

export const AI_KEYS_BASE = '/api/genesis/llm-providers'
export const AI_HEADING = 'Where this class’s AI runs'
const NOT_YOURS = 'This class is not yours to set up, or it no longer exists.'
const READ_ONLY = 'Only the teacher of record can change this. You can read it and run the test.'
const KEY_FORBIDDEN = 'Your account cannot store a key for this workspace. Ask a workspace admin to add it under AI providers.'
const KEY_NOTE = 'Stored in this server’s secrets vault under your workspace and never shown again. Only the last four characters are displayed.'
export const AI_ON_SERVER = 'on the server this classroom runs on'
const NEEDS_ADMIN = 'Your account cannot choose an outside AI provider for this workspace. Ask a workspace admin to set it for this class.'
const NOTES_LABEL = 'The approval covers sharing notes that teachers and parents wrote, after they are screened'
const RECORD_NOTE = 'This record is kept with the class and in its audit log, and is included in the class export.'
const SAVE_FIRST = 'Save first: the test runs the choice on record.'
const SELF_HOST_LINK = 'How a school runs its own AitherOS →'

const PANEL_CSS = `
.cai-opts{display:grid;grid-template-columns:1fr;gap:12px}
.cai-opt{transition:border-color .2s ${EASE},background-color .2s ${EASE}}
.cai-opt:hover:not(:disabled){border-color:var(--al-hairline-strong)}
.cai-opt:disabled{cursor:default}
.cai-row{display:flex;flex-wrap:wrap;gap:16px}
.cai-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px}
@media (min-width:760px){.cai-opts{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (prefers-reduced-motion:reduce){.cai-opt{transition:none}}
`

const OPT: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, width: '100%', minHeight: 44,
  padding: '18px 18px 20px', borderRadius: 16, textAlign: 'left', cursor: 'pointer', boxSizing: 'border-box',
  background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink, fontFamily: FONT_UI,
}
const OPT_ON: CSSProperties = { ...OPT, border: `1px solid ${C.accent}`, background: C.accentWash }
const PICK: CSSProperties = { ...cs.chip, minHeight: 44, padding: '0 16px' }
const DOT: CSSProperties = { width: 7, height: 7, borderRadius: 999, flexShrink: 0, display: 'inline-block' }

interface Draft {
  mode: AiMode
  provider: string
  baseUrl: string
  model: string
  shareNotes: boolean
  approvedBy: string
  approvedRole: string
  approvedOn: string
}

/** Today as the server counts it (UTC), so "not in the future" agrees on both sides. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function draftOf(choice: AiChoice): Draft {
  return {
    mode: choice.mode,
    provider: choice.provider,
    baseUrl: choice.base_url,
    model: choice.model,
    shareNotes: choice.share_notes,
    approvedBy: choice.approval?.approved_by ?? '',
    approvedRole: choice.approval?.approved_role ?? '',
    approvedOn: choice.approval?.approved_on ?? todayUtc(),
  }
}

/** The request body for a draft (the server re-validates every field). */
export function bodyOf(d: Draft): Record<string, unknown> {
  if (d.mode === 'device') return { mode: 'device' }
  const body: Record<string, unknown> = {
    mode: d.mode,
    provider: d.provider,
    share_notes: d.shareNotes,
    approval: { approved_by: d.approvedBy.trim(), approved_role: d.approvedRole.trim(), approved_on: d.approvedOn },
  }
  if (d.provider === 'custom') body.base_url = d.baseUrl.trim()
  if (d.model.trim()) body.model = d.model.trim()
  return body
}

function complete(d: Draft): boolean {
  if (d.mode === 'device') return true
  if (!d.provider) return false
  if (d.provider === 'custom' && !/^https:\/\/[^\s/]+/.test(d.baseUrl.trim())) return false
  return d.approvedBy.trim().length >= 2 && d.approvedRole.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(d.approvedOn)
}

/** What the header says about the choice ON RECORD (never the unsaved draft). */
export function nowLine(view: AiView): string {
  const c = view.choice
  if (c.mode === 'device') return `now · ${AI_ON_SERVER}`
  const key = view.providers.find((p) => p.provider === c.provider)
  const tail = key?.key_set ? (key.key_last4 ? ` · key ····${key.key_last4}` : ' · key stored') : ' · no key yet'
  return `now · ${c.provider_label || c.provider} · ${c.endpoint_host}${tail}`
}

export default function ClassroomAiPanel({
  classId, className, apiBase = CLASSROOM_API, keysBase = AI_KEYS_BASE, extraHeaders,
}: ClassroomAiPanelProps) {
  const { mode: theme, pref, setPref, rootRef, rootStyle } = useClassroomSurface(cs.root)
  const [view, setView] = useState<AiView | 'loading' | 'offline' | 'missing'>('loading')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle')
  const [keyValue, setKeyValue] = useState('')
  const [keyState, setKeyState] = useState<'idle' | 'storing' | 'stored' | { error: string }>('idle')
  const [test, setTest] = useState<'idle' | 'running' | AiTestResult | { error: string }>('idle')
  const path = `/classes/${cseg(classId)}/ai`

  const load = useCallback(async (keepDraft = false) => {
    if (!keepDraft) setView('loading')
    try {
      const v = await classroomFetch<AiView>(apiBase, path, { extraHeaders })
      setView(v)
      if (!keepDraft) setDraft(draftOf(v.choice))
    } catch (e) {
      if (!keepDraft) setView(loadStateOf(e) === 'missing' ? 'missing' : 'offline')
    }
  }, [apiBase, extraHeaders, path])

  useEffect(() => { load() }, [load])

  const ready = typeof view === 'object'
  const saved = ready ? draftOf(view.choice) : null
  const dirty = useMemo(() => {
    if (!draft || !saved) return false
    if (draft.mode !== saved.mode) return true
    if (draft.mode === 'device') return false
    return JSON.stringify(bodyOf(draft)) !== JSON.stringify(bodyOf(saved))
  }, [draft, saved])

  const patch = (p: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...p } : d))
    setSaving('idle')
  }

  const pick = (o: AiOption) => {
    if (!draft) return
    const keep = o.providers.includes(draft.provider)
    patch({ mode: o.mode, provider: keep ? draft.provider : (o.providers[0] ?? '') })
    setKeyValue('')
    setKeyState('idle')
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft || !ready || !view.can_edit || !complete(draft) || saving === 'saving') return
    setSaving('saving')
    try {
      const v = await send<AiView>(apiBase, path, 'PUT', bodyOf(draft), extraHeaders)
      setView(v)
      setDraft(draftOf(v.choice))
      setSaving('saved')
      setTest('idle')
    } catch (err) {
      const refused = err instanceof ClassroomHttpError && err.status >= 400 && err.status < 500
      setSaving({ error: refused ? (err as ClassroomHttpError).message : 'The classroom could not be reached. Nothing was changed.' })
    }
  }

  const storeKey = async () => {
    if (!draft || !keyValue.trim() || keyState === 'storing') return
    setKeyState('storing')
    const body: Record<string, unknown> = { provider: draft.provider, value: keyValue.trim(), scope: 'tenant' }
    if (draft.provider === 'custom') body.base_url = draft.baseUrl.trim()
    try {
      const res = await fetch(`${keysBase}/key`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { detail?: unknown } | null
        const detail = data && typeof data.detail === 'string' ? data.detail : 'The key was not stored.'
        setKeyState({ error: res.status === 403 ? KEY_FORBIDDEN : detail })
        return
      }
      // The value leaves this component the moment it is stored.
      setKeyValue('')
      setKeyState('stored')
      await load(true)
    } catch {
      setKeyState({ error: 'The key service could not be reached. The key was not stored.' })
    }
  }

  const runTest = async () => {
    if (test === 'running' || dirty) return
    setTest('running')
    try {
      setTest(await send<AiTestResult>(apiBase, `${path}/test`, 'POST', {}, extraHeaders))
      await load(true)
    } catch (err) {
      const refused = err instanceof ClassroomHttpError && err.status >= 400 && err.status < 500
      setTest({ error: refused ? (err as ClassroomHttpError).message : 'The classroom could not be reached. No test ran.' })
    }
  }

  const option = ready && draft ? view.options.find((o) => o.mode === draft.mode) : undefined
  const keyRow = ready && draft ? view.providers.find((p) => p.provider === draft.provider) : undefined
  const locked = !ready || !view.can_edit
  // An outside provider spends the workspace's key: only an account that may manage keys picks one.
  const noOutside = ready && view.can_edit && view.can_choose_outside === false
  const outsideLocked = locked || noOutside

  return (
    <div ref={rootRef} style={rootStyle} data-learn-theme={theme} data-testid="classroom-ai">
      <style>{LEARN_CSS + CLASSROOM_CSS + PANEL_CSS}</style>
      <div className="cr-col" style={{ maxWidth: 880 }}>
        <header className="cr-head al-in">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <span style={mono}>{`aither classroom · ai your way${className ? ` · ${className}` : ''}`}</span>
            <h1 style={cs.h1}>{AI_HEADING}</h1>
            {ready && (
              <span style={{ ...mono, color: C.dim, letterSpacing: '.1em', display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} data-testid="ai-now">
                <span aria-hidden style={{ ...DOT, background: view.status.ready ? C.accent : C.amber }} />
                {nowLine(view)}
                <span style={{ color: view.status.ready ? C.faint : C.amber }} data-testid="ai-ready">
                  {view.status.ready ? '· ready' : `· not available yet${view.status.detail ? `: ${view.status.detail}` : ''}`}
                </span>
              </span>
            )}
          </div>
          <LearnModeSwitch pref={pref} onChange={setPref} />
        </header>

        {view === 'loading' && (
          <section style={cs.tile} aria-busy="true" aria-label="Loading"><Skel w="55%" h={18} /><Skel w="85%" h={14} /><Skel w="70%" h={14} /></section>
        )}
        {view === 'offline' && (
          <div style={cs.offline} data-testid="classroom-offline" role="status">
            <span style={mono}>offline</span>
            <span>This class’s AI settings could not be reached just now. Nothing was changed.</span>
            <button type="button" className="al-quiet al-focus" style={quiet} onClick={() => load()}>Try again</button>
          </div>
        )}
        {view === 'missing' && (
          <div style={cs.offline} data-testid="classroom-ai-missing" role="status">
            <span style={mono}>not found</span>
            <span>{NOT_YOURS}</span>
          </div>
        )}

        {ready && draft && (
          <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 28 }} className="al-in">
            {!view.can_edit && <div style={cs.amberNote} role="note" data-testid="ai-read-only">{READ_ONLY}</div>}
            {noOutside && <div style={cs.amberNote} role="note" data-testid="ai-needs-admin">{NEEDS_ADMIN}</div>}

            <div role="radiogroup" aria-label="Where this class’s AI runs" className="cai-opts">
              {view.options.map((o, i) => {
                const on = draft.mode === o.mode
                return (
                  <button
                    key={o.mode} type="button" role="radio" aria-checked={on} disabled={o.needs_approval ? outsideLocked : locked}
                    className="cai-opt al-focus" style={on ? OPT_ON : OPT} onClick={() => pick(o)} data-testid={`ai-option-${o.mode}`}
                  >
                    <span style={{ ...mono, color: on ? C.accent : C.faint }}>
                      {`0${i + 1}${i === 0 ? ' · default' : ''}${view.choice.mode === o.mode ? ' · on record' : ''}`}
                    </span>
                    <span style={cs.h2}>{o.title}</span>
                    <span style={cs.sub}>{o.where}</span>
                    <span style={{ ...mono, letterSpacing: '.1em', color: C.dim }}>
                      {o.needs_approval ? 'student data · names replaced before it leaves' : 'student data · stays here'}
                    </span>
                    <span style={{ ...help, color: C.dim }}>{o.student_data}</span>
                  </button>
                )
              })}
            </div>

            {option?.needs_approval && (
              <>
                <section style={cs.tile} aria-label="Provider">
                  <span style={mono}>step 1 · provider</span>
                  {option.providers.length > 1 && (
                    <div role="radiogroup" aria-label="Provider" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {option.providers.map((p) => {
                        const label = view.providers.find((k) => k.provider === p)?.label ?? p
                        const on = draft.provider === p
                        return (
                          <button key={p} type="button" role="radio" aria-checked={on} disabled={outsideLocked} className="al-focus"
                            style={on ? { ...PICK, ...cs.chipOn } : PICK} onClick={() => { patch({ provider: p }); setKeyState('idle') }}>
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <div className="cai-row">
                    {draft.provider === 'custom' && (
                      <Field label="Endpoint address" hint="An https address that speaks the OpenAI chat format. It is named in the approval.">
                        <input className="al-field" style={{ ...fieldBox, fontFamily: FONT_MONO, fontSize: 14 }} type="url" inputMode="url"
                          placeholder="https://ai.your-school.example/v1" value={draft.baseUrl} disabled={outsideLocked} autoComplete="off" spellCheck={false}
                          onChange={(e) => patch({ baseUrl: e.target.value })} aria-label="Endpoint address" />
                      </Field>
                    )}
                    <Field label="Model (optional)" hint="Leave empty for the provider’s default.">
                      <input className="al-field" style={{ ...fieldBox, fontFamily: FONT_MONO, fontSize: 14 }} value={draft.model} disabled={outsideLocked}
                        maxLength={96} autoComplete="off" spellCheck={false} onChange={(e) => patch({ model: e.target.value })} aria-label="Model" />
                    </Field>
                  </div>
                  {draft.mode === 'private_cloud' && view.self_host_docs && (
                    <a href={view.self_host_docs} className="al-quiet al-focus" style={{ ...quiet, textDecoration: 'none', alignSelf: 'flex-start' }} data-testid="ai-self-host">
                      {SELF_HOST_LINK}
                    </a>
                  )}
                </section>

                <section style={cs.tile} aria-label="Key">
                  <span style={mono}>step 2 · key</span>
                  <p style={{ ...cs.sub, color: C.ink }} data-testid="ai-key-status">
                    {keyRow?.key_set
                      ? `${keyRow.label}: a key is stored${keyRow.key_last4 ? `, ending in ${keyRow.key_last4}` : ''}.`
                      : `${keyRow?.label ?? 'This provider'}: no key is stored yet.`}
                  </p>
                  <div className="cai-row" style={{ alignItems: 'flex-end' }}>
                    <Field label={keyRow?.key_set ? 'Replace the key' : 'Your school’s key'} hint={KEY_NOTE}>
                      <input className="al-field" style={{ ...fieldBox, fontFamily: FONT_MONO, fontSize: 14 }} type="password" value={keyValue}
                        autoComplete="off" spellCheck={false} disabled={outsideLocked} onChange={(e) => { setKeyValue(e.target.value); setKeyState('idle') }}
                        aria-label="Provider key" data-testid="ai-key-input" />
                    </Field>
                  </div>
                  <div className="cai-actions">
                    <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.ink }} onClick={storeKey}
                      disabled={outsideLocked || !keyValue.trim() || keyState === 'storing' || (draft.provider === 'custom' && !draft.baseUrl.trim())} data-testid="ai-key-store">
                      {keyState === 'storing' ? 'Storing…' : 'Store this key'}
                    </button>
                    {keyState === 'stored' && <span role="status" style={{ ...help, color: C.dim }}>Stored.</span>}
                    {typeof keyState === 'object' && <span role="alert" style={{ ...help, color: C.amber }} data-testid="ai-key-error">{keyState.error}</span>}
                  </div>
                </section>

                <section style={cs.tile} aria-label="Approval">
                  <span style={mono}>step 3 · approval</span>
                  <p style={cs.sub}>Who at your school approved sending this class’s work to this provider, and when?</p>
                  <div className="cai-row">
                    <Field label="Approved by">
                      <input className="al-field" style={fieldBox} value={draft.approvedBy} maxLength={80} disabled={outsideLocked} autoComplete="off"
                        onChange={(e) => patch({ approvedBy: e.target.value })} aria-label="Approved by" />
                    </Field>
                    <Field label="Their role">
                      <input className="al-field" style={fieldBox} value={draft.approvedRole} maxLength={80} disabled={outsideLocked} autoComplete="off"
                        placeholder="Principal, IT director…" onChange={(e) => patch({ approvedRole: e.target.value })} aria-label="Their role" />
                    </Field>
                    <Field label="Approved on">
                      <input className="al-field" style={fieldBox} type="date" value={draft.approvedOn} max={todayUtc()} disabled={outsideLocked}
                        onChange={(e) => patch({ approvedOn: e.target.value })} aria-label="Approved on" />
                    </Field>
                  </div>
                  {outsideLocked
                    ? <p style={help}>{draft.shareNotes ? 'The approval covers screened adult notes.' : 'Adult notes stay in this classroom.'}</p>
                    : <CheckRow checked={draft.shareNotes} onChange={(v) => patch({ shareNotes: v })} ariaLabel="Approval covers adult notes">{NOTES_LABEL}</CheckRow>}
                  <p style={help}>{RECORD_NOTE}</p>
                </section>
              </>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="cai-actions">
                <button type="submit" className="al-primary al-focus" style={primary} disabled={(draft.mode === 'device' ? locked : outsideLocked) || !dirty || !complete(draft) || saving === 'saving'} data-testid="ai-save">
                  {saving === 'saving' ? 'Saving…' : draft.mode === 'device' ? 'Keep it on this server' : 'Save this choice'}
                </button>
                <button type="button" className="al-quiet al-focus" style={quiet} onClick={runTest} disabled={dirty || test === 'running'} data-testid="ai-test">
                  {test === 'running' ? 'Testing…' : 'Test this connection'}
                </button>
                {dirty && <span style={{ ...mono, color: C.amber }} data-testid="ai-dirty">not saved yet</span>}
              </div>
              {dirty && <span style={help}>{SAVE_FIRST}</span>}
              {saving === 'saved' && <span role="status" style={{ ...help, color: C.dim }} data-testid="ai-saved">Saved and recorded in the class audit.</span>}
              {typeof saving === 'object' && <span role="alert" style={{ ...help, color: C.amber }} data-testid="ai-save-error">{saving.error}</span>}
              {typeof test === 'object' && 'error' in test && <span role="alert" style={{ ...help, color: C.amber }} data-testid="ai-test-result">{test.error}</span>}
              {typeof test === 'object' && 'ok' in test && (
                <span role="status" data-testid="ai-test-result" style={{ ...mono, letterSpacing: '.1em', color: test.ok ? C.accent : C.amber }}>
                  {test.ok
                    ? `answered · ${test.provider}${test.model ? ` · ${test.model}` : ''}${test.latency_ms !== null ? ` · ${test.latency_ms} ms` : ''}`
                    : `not available yet · ${test.detail || test.code}`}
                </span>
              )}
            </div>

            {view.choice.approval && (
              <section style={{ ...cs.tile, background: 'transparent' }} aria-label="Approval on record" data-testid="ai-on-record">
                <span style={mono}>on record</span>
                <p style={{ ...cs.sub, color: C.ink }}>
                  {`${view.choice.provider_label} at ${view.choice.endpoint_host}. Approved by ${view.choice.approval.approved_by} (${view.choice.approval.approved_role}) on ${view.choice.approval.approved_on}.`}
                </p>
                <p style={help}>{view.choice.share_notes ? 'Screened adult notes may be sent.' : 'Adult notes are not sent.'}</p>
              </section>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
