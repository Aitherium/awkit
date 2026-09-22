'use client'

/**
 * StudioPanel — the Media Forge studio, as ONE panel on the Living Desktop.
 *
 * The catalogue is LIVE. Every card on this panel comes from media-forge's own
 * `GET /ops` manifest (through the host proxy), which self-describes each op's
 * group, params, and cost — the same manifest `agents/Iris/tool_agent.py` turns
 * into function tools. That is the whole design: the panel and the artist share one
 * catalogue, so an op media-forge ships is in the customer's Studio the moment it
 * ships, with no release here. The skeleton this replaced carried a hard-coded list
 * of seven families and twenty op names; a hard-coded catalogue does not fail when
 * it drifts, it just quietly offers ops that no longer exist and hides ones that do.
 *
 * Two rules this panel does not bend:
 *
 *   - media-forge unreachable is a NAMED ERROR CARD, never a stub image. A
 *     placeholder that stops announcing itself is how a fake integration ships
 *     (the same rule CDC003 enforces on the Python side).
 *   - every result says which backend produced it, next to the picture.
 *
 * Long ops: the curated `POST /op/{name}` runs the op to completion and answers
 * with the result — media-forge's job registry lives behind `/api/jobs`, the
 * OWNER-PRIVATE surface, so there is no job id on this side to poll. A `heavy` op
 * is therefore a long request, and the card says "this takes minutes" and shows the
 * elapsed clock rather than pretending to have a queue position.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronRight, Loader2, Play, Wand2 } from 'lucide-react'

import { describeError } from './creative/fetching'
import { subscribeHandoff, opForHandoff, HANDOFF_FORM, type CreativeHandoff } from './creative/handoff'
import {
  buildOpBody, costLabel, defaultValue, formParams, getHealth, groupOps, isHeavy,
  listOps, mediaUrl, runOp, unsupportedParams, type OpFamily,
} from './creative/studio-client'
import type { ForgeOp, ForgeOpParam, ForgeOpResult } from './creative/types'

export interface StudioPanelProps {
  /** '' for same-origin. */
  apiBase?: string
  /** Ask Iris to critique a result. Absent = the button is not offered. */
  onCritique?: (imageUrl: string, prompt: string) => void
  className?: string
}

type FormValues = Record<string, string | number | boolean>

interface RunRecord {
  op: ForgeOp
  startedAt: number
  finishedAt?: number
  result?: ForgeOpResult
  error?: string
  prompt: string
}

function ParamField({
  param, value, onChange,
}: {
  param: ForgeOpParam
  value: string | number | boolean
  onChange: (v: string | number | boolean) => void
}): React.ReactElement {
  const label = (
    <span className="block text-[11px] text-slate-400 mb-0.5">
      {param.name}
      {param.help && <span className="text-slate-600"> — {param.help}</span>}
    </span>
  )

  if (param.type === 'bool') {
    return (
      <label className="flex items-center gap-2 text-[11px] text-slate-400">
        <input type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} className="accent-purple-500" />
        {param.name}
      </label>
    )
  }

  if ((param.type === 'enum' || param.type === 'style') && param.choices?.length) {
    return (
      <label className="block">
        {label}
        <select
          value={String(value)}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
        >
          {param.choices.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
    )
  }

  const numeric = param.type === 'int' || param.type === 'float' || param.type === 'seed'
  const isPrompt = /prompt|description|text/i.test(param.name)

  return (
    <label className="block">
      {label}
      {isPrompt ? (
        <textarea
          value={String(value)}
          onChange={e => onChange(e.target.value)}
          rows={3}
          className="w-full bg-slate-800/60 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
        />
      ) : (
        <input
          type={numeric ? 'number' : 'text'}
          value={String(value)}
          min={typeof param.min === 'number' ? param.min : undefined}
          max={typeof param.max === 'number' ? param.max : undefined}
          onChange={e => onChange(numeric ? e.target.value : e.target.value)}
          className="w-full bg-slate-800/60 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
        />
      )}
    </label>
  )
}

export default function StudioPanel({
  apiBase = '',
  onCritique,
  className = '',
}: StudioPanelProps): React.ReactElement {
  const [ops, setOps] = useState<ForgeOp[]>([])
  const [backend, setBackend] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [catalogueError, setCatalogueError] = useState('')

  const [openFamily, setOpenFamily] = useState<string>('')
  const [activeOp, setActiveOp] = useState<ForgeOp | null>(null)
  const [values, setValues] = useState<FormValues>({})
  const [handoffNote, setHandoffNote] = useState('')

  const [runs, setRuns] = useState<RunRecord[]>([])
  const [running, setRunning] = useState(false)
  const [tick, setTick] = useState(0)

  const opts = useMemo(() => ({ apiBase }), [apiBase])
  const opsRef = useRef<ForgeOp[]>([])
  opsRef.current = ops

  const openOp = useCallback((op: ForgeOp, prefill?: Record<string, string>) => {
    setActiveOp(op)
    const next: FormValues = {}
    for (const p of formParams(op)) next[p.name] = defaultValue(p)
    if (prefill) {
      for (const [k, v] of Object.entries(prefill)) {
        if (k in next) next[k] = v
      }
    }
    setValues(next)
  }, [])

  // Catalogue
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setCatalogueError('')
    void (async () => {
      try {
        const health = await getHealth(opts)
        if (!cancelled) setBackend(health.backend || 'media-forge')
        const listed = await listOps(opts)
        if (cancelled) return
        setOps(listed.ops)
        setBackend(listed.backend || health.backend || 'media-forge')
        if (!listed.ops.length) {
          setCatalogueError('The Studio backend answered, but its op catalogue is empty. Nothing can be run until it publishes ops.')
        }
      } catch (e) {
        if (!cancelled) {
          setOps([])
          setCatalogueError(describeError(e, 'Media Forge'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [opts])

  // The Play panel's "illustrate this beat" handoff.
  useEffect(() => subscribeHandoff((handoff: CreativeHandoff) => {
    const form = HANDOFF_FORM[handoff.action]
    const op = opForHandoff(handoff.action, opsRef.current)
    if (!op) {
      setHandoffNote(
        `${form.title}: this Studio is not serving an op for that (looked for ${form.preferOps.join(', ')} `
        + `and anything in the "${form.group}" family). Nothing was run.`,
      )
      return
    }
    const refs = handoff.characterRefs?.length ? ` Featuring: ${handoff.characterRefs.join(', ')}.` : ''
    const prefill: Record<string, string> = {}
    for (const p of formParams(op)) {
      if (/prompt|description|text/i.test(p.name)) prefill[p.name] = `${handoff.text}${refs}`
      else if (/image|source|ref/i.test(p.name) && handoff.imageUrl) prefill[p.name] = handoff.imageUrl
    }
    setOpenFamily('')
    openOp(op, prefill)
    setHandoffNote(`${form.title} — from ${handoff.source || 'Play'}${handoff.world ? ` (${handoff.world})` : ''}, pre-filled into ${op.name}.`)
  }), [openOp])

  // One clock for the elapsed line on a long op.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [running])

  const families: OpFamily[] = useMemo(() => groupOps(ops), [ops])

  const submit = useCallback(async () => {
    if (!activeOp || running) return
    const op = activeOp
    const body = buildOpBody(op, values)
    const promptKey = formParams(op).find(p => /prompt|description|text/i.test(p.name))?.name
    const prompt = promptKey ? String(values[promptKey] ?? '') : ''

    const record: RunRecord = { op, startedAt: Date.now(), prompt }
    setRuns(prev => [record, ...prev].slice(0, 12))
    setRunning(true)
    try {
      const result = await runOp(opts, op.name, body, isHeavy(op) ? 1800000 : 600000)
      setRuns(prev => prev.map(r => (r === record ? { ...r, result, finishedAt: Date.now() } : r)))
    } catch (e) {
      setRuns(prev => prev.map(r => (r === record ? { ...r, error: describeError(e, backend || 'Media Forge'), finishedAt: Date.now() } : r)))
    } finally {
      setRunning(false)
    }
  }, [activeOp, backend, opts, running, values])

  const elapsed = (r: RunRecord): string => {
    const end = r.finishedAt ?? Date.now()
    return `${Math.max(0, Math.round((end - r.startedAt) / 1000))}s`
  }

  return (
    <div className={`bg-slate-900/60 backdrop-blur-xl border border-purple-500/20 rounded-lg flex flex-col min-h-0 ${className}`}>
      <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
        <Wand2 className="w-5 h-5 text-purple-400" />
        <h3 className="text-lg font-medium text-slate-100">Studio</h3>
        <span className="ml-auto text-[11px] text-slate-500">
          {loading ? 'loading catalogue…' : catalogueError ? 'offline' : `${ops.length} live ops · ${backend}`}
        </span>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Catalogue */}
        <div className="lg:w-72 border-b lg:border-b-0 lg:border-r border-slate-700 overflow-auto p-3 flex-shrink-0">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Asking Media Forge what it can do…
            </p>
          )}

          {!loading && catalogueError && (
            <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 space-y-1">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertCircle className="w-4 h-4" /> Media Forge is not reachable
              </p>
              <p className="text-xs">{catalogueError}</p>
              <p className="text-xs opacity-80">
                Nothing is rendered while it is down — this panel will not show you a placeholder image.
              </p>
            </div>
          )}

          {!loading && !catalogueError && families.map(f => (
            <div key={f.id} className="mb-1">
              <button
                type="button"
                onClick={() => setOpenFamily(openFamily === f.id ? '' : f.id)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-slate-800/60 text-left"
              >
                {openFamily === f.id
                  ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                <span className="text-sm text-slate-200">{f.label}</span>
                <span className="ml-auto text-[10px] text-slate-500">{f.ops.length}</span>
              </button>
              {openFamily === f.id && (
                <div className="pl-6 pb-2">
                  <p className="text-[11px] text-slate-500 mb-1">{f.blurb}</p>
                  {f.ops.map(op => (
                    <button
                      key={op.name}
                      type="button"
                      onClick={() => openOp(op)}
                      className={`block w-full text-left px-2 py-1 rounded text-xs ${activeOp?.name === op.name
                        ? 'bg-purple-600/30 text-purple-100'
                        : 'text-slate-300 hover:bg-slate-800/60'}`}
                    >
                      {op.label || op.name}
                      <span className="block text-[10px] text-slate-500">{op.name} · {costLabel(op)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Form + results */}
        <div className="flex-1 overflow-auto p-4 space-y-4 min-w-0">
          {handoffNote && (
            <div className="rounded border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs text-purple-100">
              {handoffNote}
            </div>
          )}

          {!activeOp && !loading && !catalogueError && (
            <p className="text-sm text-slate-400">
              Pick an op on the left. Every card is read live from this Studio’s own catalogue, so what you
              see here is exactly what the backend can run right now.
            </p>
          )}

          {activeOp && (
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-medium text-slate-100">{activeOp.label || activeOp.name}</h4>
                <p className="text-xs text-slate-500">
                  {activeOp.summary || 'No summary published for this op.'}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  <code className="text-slate-400">{activeOp.name}</code> · {activeOp.group} · {costLabel(activeOp)}
                  {isHeavy(activeOp) && <span className="text-amber-300"> — sprite sheets and trainings take minutes; the request stays open until it finishes.</span>}
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {formParams(activeOp).map(p => (
                  <ParamField
                    key={p.name}
                    param={p}
                    value={values[p.name] ?? defaultValue(p)}
                    onChange={v => setValues(prev => ({ ...prev, [p.name]: v }))}
                  />
                ))}
              </div>

              {unsupportedParams(activeOp).length > 0 && (
                <p className="text-[11px] text-amber-300/80">
                  {unsupportedParams(activeOp).map(p => p.name).join(', ')} need a canvas selection this panel
                  cannot make, so this op runs with its own defaults for them.
                </p>
              )}

              <button
                type="button"
                onClick={() => void submit()}
                disabled={running}
                className="px-3 py-2 rounded bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 text-slate-100 text-sm inline-flex items-center gap-2"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {running ? 'Running…' : `Run ${activeOp.name}`}
              </button>
            </div>
          )}

          {runs.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-700">
              {runs.map((r, i) => (
                <div key={`${r.op.name}-${r.startedAt}-${i}`} className="rounded border border-slate-700 bg-slate-800/40 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-200 font-medium">{r.op.label || r.op.name}</span>
                    <span className="text-slate-500">backend: {backend || 'media-forge'}</span>
                    <span className="ml-auto text-slate-500">
                      {r.finishedAt ? elapsed(r) : `${elapsed(r)} elapsed${tick >= 0 ? '' : ''}`}
                    </span>
                  </div>

                  {!r.finishedAt && (
                    <p className="mt-1 text-xs text-slate-400 flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {isHeavy(r.op) ? 'This one takes minutes. Leave the panel open.' : 'Running…'}
                    </p>
                  )}

                  {r.error && (
                    <p className="mt-1 text-xs text-red-300 flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {r.error}
                    </p>
                  )}

                  {r.result && r.result.ok === false && (
                    <p className="mt-1 text-xs text-amber-300">
                      {backend || 'Media Forge'} refused this run: {r.result.error || 'no reason given'}
                      {r.result.safety_level && ` (safety level ${r.result.safety_level})`}
                    </p>
                  )}

                  {r.result && r.result.ok !== false && (
                    <div className="mt-2">
                      {(r.result.images || []).length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {(r.result.images || []).map(src => (
                            <figure key={src} className="space-y-1">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={mediaUrl(opts, src)} alt={r.op.name} className="max-h-56 rounded border border-slate-700" />
                              <figcaption className="text-[10px] text-slate-500">
                                backend: {backend || 'media-forge'}
                                {onCritique && (
                                  <button
                                    type="button"
                                    onClick={() => onCritique(mediaUrl(opts, src), r.prompt)}
                                    className="ml-2 text-purple-300 hover:text-purple-200 underline"
                                  >
                                    critique this
                                  </button>
                                )}
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400">
                          Finished with no image. {(r.result.head_ids || []).length > 0
                            ? `Output ids: ${(r.result.head_ids || []).join(', ')} (this op produces data, not a picture).`
                            : 'The op reported success and returned nothing to show.'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
