/**
 * The Iris client — the artist, not a second image API.
 *
 * Iris PLANS, enhances the prompt, calls media-forge ops in a real tool loop,
 * evaluates the result against a quality threshold and refines. The panel therefore
 * only ever asks Iris for four things:
 *
 *   preview   POST /pipeline/preview   the asset plan, with NO GPU work
 *   run       POST /pipeline           the plan, executed (stream:false here)
 *   critique  POST /evaluate           score + suggestions for one image
 *   sharpen   POST /enhance-prompt     one prompt, improved
 *
 * Preview-before-full is the whole point of the two-call shape: the plan says what
 * it is about to make and roughly how long it will take, so a customer approves the
 * spend instead of discovering it. `/pipeline` is license-gated (Pro+) and answers
 * 403 when it is not held — the panel must show that as a plan question, not as a
 * crash.
 */

import { fetchJson, PanelError } from './fetching'
import type {
  IrisEvaluation,
  IrisPipelineResult,
  IrisPlan,
} from './types'

export interface IrisClientOptions {
  apiBase?: string
}

function base(o: IrisClientOptions): string {
  return `${o.apiBase ?? ''}/api/iris`
}

/**
 * The brief Iris plans from.
 *
 * `intent` is the sentence the customer typed; everything else narrows it. Kept
 * loose (`Record<string, unknown>` upstream) because `DesignPipelineRequest.brief`
 * is a free dict and pinning a stricter shape here would reject briefs the planner
 * accepts.
 */
export interface DesignBrief {
  intent: string
  output_type?: string
  style?: string
  brand?: Record<string, unknown>
  composition?: Record<string, unknown>
  constraints?: Record<string, unknown>
  [k: string]: unknown
}

export function briefFrom(intent: string, outputType: string, style: string): DesignBrief {
  const brief: DesignBrief = { intent: intent.trim() }
  if (outputType) brief.output_type = outputType
  if (style) brief.style = style
  return brief
}

/** POST /api/iris/preview -> Iris /pipeline/preview. Plan only; no GPU work. */
export async function previewPipeline(o: IrisClientOptions, brief: DesignBrief): Promise<IrisPlan> {
  const data = await fetchJson<Partial<IrisPlan>>(`${base(o)}/preview`, {
    method: 'POST',
    body: { brief },
    timeoutMs: 120000,
  })
  return {
    assets: Array.isArray(data.assets) ? data.assets : [],
    total_estimated_time_s: data.total_estimated_time_s,
    reasoning: data.reasoning,
  }
}

/** POST /api/iris/pipeline -> Iris /pipeline, non-streaming so the panel gets rounds. */
export async function runPipeline(
  o: IrisClientOptions,
  brief: DesignBrief,
  projectId?: string,
): Promise<IrisPipelineResult> {
  return fetchJson<IrisPipelineResult>(`${base(o)}/pipeline`, {
    method: 'POST',
    body: { brief, project_id: projectId, stream: false },
    timeoutMs: 900000,
  })
}

/** POST /api/iris/evaluate -> Iris /evaluate. "Critique this" for any Studio result. */
export async function critique(
  o: IrisClientOptions,
  imageUrl: string,
  originalPrompt: string,
  optimizedPrompt = '',
): Promise<IrisEvaluation> {
  return fetchJson<IrisEvaluation>(`${base(o)}/evaluate`, {
    method: 'POST',
    body: { image_url: imageUrl, original_prompt: originalPrompt, optimized_prompt: optimizedPrompt },
    timeoutMs: 180000,
  })
}

/** POST /api/iris/enhance-prompt -> Iris /enhance-prompt. */
export async function enhancePrompt(
  o: IrisClientOptions,
  prompt: string,
  stage = 'txt2img',
): Promise<{ enhanced: string; reasoning?: string }> {
  const data = await fetchJson<Record<string, unknown>>(`${base(o)}/enhance-prompt`, {
    method: 'POST',
    body: { prompt, stage },
    timeoutMs: 120000,
  })
  // Iris has answered under three field names across its own routes; take the
  // first that is a non-empty string rather than showing an empty box.
  for (const key of ['enhanced_prompt', 'enhanced', 'optimized_prompt', 'prompt']) {
    const v = data[key]
    if (typeof v === 'string' && v.trim()) {
      const reasoning = typeof data.reasoning === 'string' ? data.reasoning : undefined
      return { enhanced: v, reasoning }
    }
  }
  throw new PanelError('bad-response', 'Iris answered with no enhanced prompt.', 200, JSON.stringify(data).slice(0, 200))
}

/** The rounds a pipeline result carries, under either of the two field names. */
export function pipelineRounds(result: IrisPipelineResult): IrisPipelineResult['rounds'] {
  if (Array.isArray(result.rounds)) return result.rounds
  if (Array.isArray(result.assets)) return result.assets
  return []
}

/** A 0..1 or 0..100 score, normalised to a percentage for display, or null. */
export function scorePercent(evaluation: IrisEvaluation | undefined): number | null {
  if (!evaluation || typeof evaluation.score !== 'number') return null
  const s = evaluation.score
  if (Number.isNaN(s)) return null
  return Math.round(s <= 1 ? s * 100 : s)
}
