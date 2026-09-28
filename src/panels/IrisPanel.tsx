'use client'

/**
 * IrisPanel — "talk to the artist" on the Living Desktop.
 *
 * The loop is brief -> plan -> run -> critique -> refine, and every call goes
 * through `creative/iris-client.ts` to the host's `/api/iris/*` routes
 * (Veil: lib/iris-proxy.ts -> aitheros-iris:8786):
 *
 *   Generate Pipeline  POST /api/iris/preview        the plan, NO GPU work
 *   Run pipeline       POST /api/iris/pipeline       the plan, executed (Pro+)
 *   Sharpen brief      POST /api/iris/enhance-prompt one prompt, improved
 *   Critique           the evaluation Iris attached to a pipeline round
 *   Refine             folds the critique back into the brief and re-plans
 *
 * The critique is read from the pipeline's OWN round evaluation, never from a
 * free-standing `/evaluate` call: Iris /evaluate takes any `image_url` and
 * fetches it (another tenant's ComfyUI output, or an in-fleet URL through
 * AitherVision), so Veil does not route it until Iris scopes that input.
 *
 * Preview comes before run on purpose: the customer sees what Iris is about to
 * make and roughly how long it takes before any GPU is spent. A 403 from the
 * pipeline is a PLAN question and is shown as one; an unreachable Iris is a named
 * error, never a placeholder result.
 */

import React, { useCallback, useState } from 'react'
import { AlertCircle, Loader2, Play, Sparkles, Wand2 } from 'lucide-react'

import { describeError } from './creative/fetching'
import {
  briefFrom, enhancePrompt, pipelineRounds, previewPipeline, runPipeline, scorePercent,
} from './creative/iris-client'
import type { IrisEvaluation, IrisPipelineResult, IrisPlan } from './creative/types'

export interface IrisPanelProps {
  /** '' for same-origin (the host serves /api/iris/*). */
  apiBase?: string
  className?: string
}

type Tab = 'brief' | 'pipeline' | 'critique'
type Busy = null | 'preview' | 'run' | 'enhance'

/** Iris names its suggestion list differently per route; read every spelling. */
export function evaluationSuggestions(ev: IrisEvaluation | undefined): string[] {
  if (!ev) return []
  for (const key of ['fix_suggestions', 'suggestions']) {
    const v = ev[key]
    if (Array.isArray(v)) return v.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
  }
  return []
}

export default function IrisPanel({ apiBase = '', className = '' }: IrisPanelProps) {
  const [brief, setBrief] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('brief')
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<IrisPlan | null>(null)
  const [result, setResult] = useState<IrisPipelineResult | null>(null)
  const [critiqued, setCritiqued] = useState<string | null>(null)
  const [critiquePrompt, setCritiquePrompt] = useState('')
  const [evaluation, setEvaluation] = useState<IrisEvaluation | null>(null)

  const opts = { apiBase }

  const onGeneratePipeline = useCallback(async () => {
    if (!brief.trim()) return
    setBusy('preview'); setError(null); setResult(null)
    try {
      setPlan(await previewPipeline(opts, briefFrom(brief, '', '')))
      setActiveTab('pipeline')
    } catch (err) {
      setError(describeError(err, 'Iris'))
    } finally {
      setBusy(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, apiBase])

  const onRunPipeline = useCallback(async () => {
    if (!brief.trim()) return
    setBusy('run'); setError(null)
    try {
      setResult(await runPipeline(opts, briefFrom(brief, '', '')))
    } catch (err) {
      setError(describeError(err, 'the Iris pipeline'))
    } finally {
      setBusy(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, apiBase])

  const onSharpen = useCallback(async () => {
    if (!brief.trim()) return
    setBusy('enhance'); setError(null)
    try {
      const { enhanced } = await enhancePrompt(opts, brief)
      setBrief(enhanced)
    } catch (err) {
      setError(describeError(err, 'Iris'))
    } finally {
      setBusy(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, apiBase])

  const onRefine = useCallback(() => {
    const suggestions = evaluationSuggestions(evaluation ?? undefined)
    if (suggestions.length === 0) return
    const base = (critiquePrompt || brief).trim()
    setBrief(`${base}\n\nRefine: ${suggestions.join('; ')}`)
    setPlan(null); setResult(null)
    setActiveTab('brief')
  }, [evaluation, critiquePrompt, brief])

  const score = scorePercent(evaluation ?? undefined)
  const suggestions = evaluationSuggestions(evaluation ?? undefined)
  const rounds = result ? pipelineRounds(result) ?? [] : []
  const spin = <Loader2 className="inline w-4 h-4 mr-2 animate-spin" />

  return (
    <div className={`bg-slate-900/60 backdrop-blur-xl border border-purple-500/20 rounded-lg flex flex-col ${className}`}>
      <div className="px-4 py-3 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-medium text-slate-100">Iris</h3>
          <span className="text-xs text-slate-500 ml-auto">The Visual Artisan</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-4 space-y-4">
          <div className="flex gap-2 border-b border-slate-700 pb-3">
            {(['brief', 'pipeline', 'critique'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 text-sm font-medium rounded transition-colors ${
                  activeTab === tab
                    ? 'text-purple-400 border-b-2 border-purple-400'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 text-xs text-red-300 bg-red-950/40 border border-red-800/50 rounded px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'brief' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-400">
                Describe what you want Iris to create or refine.
              </p>
              <textarea
                placeholder="E.g., 'Generate concept art for a cyberpunk cityscape with neon signs...'"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                className="w-full min-h-24 bg-slate-800/50 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={onSharpen}
                  disabled={!brief.trim() || busy !== null}
                  className="px-3 py-2 border border-slate-600 hover:border-slate-500 disabled:opacity-50 text-slate-300 text-sm font-medium rounded transition-colors"
                >
                  {busy === 'enhance' ? spin : <Wand2 className="inline w-4 h-4 mr-2" />}
                  Sharpen
                </button>
                <button
                  onClick={onGeneratePipeline}
                  disabled={!brief.trim() || busy !== null}
                  className="flex-1 px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 text-slate-100 text-sm font-medium rounded transition-colors"
                >
                  {busy === 'preview' ? spin : <Sparkles className="inline w-4 h-4 mr-2" />}
                  Generate Pipeline
                </button>
              </div>
            </div>
          )}

          {activeTab === 'pipeline' && (
            <div className="space-y-3">
              {!plan && (
                <p className="text-xs text-slate-500">Write a brief and press Generate Pipeline to see Iris's plan.</p>
              )}
              {plan && (
                <>
                  <p className="text-sm text-slate-400">
                    Iris plans {plan.assets.length} asset{plan.assets.length === 1 ? '' : 's'}
                    {typeof plan.total_estimated_time_s === 'number' && ` (~${Math.round(plan.total_estimated_time_s)} s)`}.
                  </p>
                  {plan.reasoning && <p className="text-xs text-slate-500">{plan.reasoning}</p>}
                  <ul className="space-y-1">
                    {plan.assets.map((a, i) => (
                      <li key={i} className="text-xs text-slate-300 bg-slate-800/40 rounded px-2 py-1">
                        <span className="text-purple-300">{a.type}</span> via {a.backend}: {a.prompt}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={onRunPipeline}
                    disabled={busy !== null}
                    className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 text-slate-100 text-sm font-medium rounded transition-colors"
                  >
                    {busy === 'run' ? spin : <Play className="inline w-4 h-4 mr-2" />}
                    Run pipeline
                  </button>
                </>
              )}
              {result && (
                <div className="space-y-1">
                  <p className="text-sm text-slate-400">
                    {result.error ? `Pipeline finished with an error: ${result.error}` : `Pipeline finished: ${rounds.length} step(s).`}
                  </p>
                  {rounds.map((r, i) => (
                    <div key={i} className="text-xs text-slate-300 bg-slate-800/40 rounded px-2 py-1">
                      {r.step ?? r.asset_type ?? `step ${i + 1}`} — {r.status ?? 'done'}
                      {typeof r.image === 'string' && r.evaluation && (
                        <button
                          onClick={() => { setCritiqued(r.image as string); setEvaluation(r.evaluation ?? null); setCritiquePrompt(r.prompt ?? brief); setActiveTab('critique') }}
                          className="ml-2 text-purple-300 hover:underline"
                        >
                          critique
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'critique' && (
            <div className="space-y-3">
              {!evaluation && (
                <p className="text-xs text-slate-500">
                  Run the pipeline, then pick a step's critique to see how Iris scored it.
                </p>
              )}
              {critiqued && <p className="text-xs text-slate-500 break-all">{critiqued}</p>}
              {evaluation && (
                <div className="space-y-2 text-xs text-slate-300">
                  <p>Score: {score === null ? 'not given' : `${score}%`}</p>
                  {typeof evaluation.overall === 'string' && <p className="text-slate-400">{evaluation.overall}</p>}
                  {Array.isArray(evaluation.issues) && evaluation.issues.length > 0 && (
                    <ul className="list-disc pl-4">{evaluation.issues.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  )}
                  {suggestions.length > 0 && (
                    <button
                      onClick={onRefine}
                      className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 text-slate-100 text-sm font-medium rounded transition-colors"
                    >
                      Refine the brief with {suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
