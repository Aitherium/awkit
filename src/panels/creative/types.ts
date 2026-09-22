/**
 * Wire types for the three creative panels — Play, Studio, Iris.
 *
 * These mirror the SERVICE contracts, not a UI convenience shape, and each one
 * names the file it mirrors so a drift is findable:
 *
 *   StoryTurnResult / MctsExploration / ContinuityIssue
 *       AitherOS/agents/Saga/storygraph/{router,mcts,continuity}.py
 *   MechanicDefinition
 *       AitherOS/apps/AitherVeil/src/components/saga/mechanics-editor.tsx:48
 *       (the Adventure-mode editor already ships this exact shape; the rail below
 *        RENDERS it and never re-declares it differently)
 *   ForgeOp / ForgeOpParam / ForgeOpResult
 *       media-forge app/ops/base.py (Op/Param/Port/OpResult) as served by the
 *       CURATED GET /ops — the AitherSafety-tiered twin, never /api/ops.
 *   IrisPlan / IrisEvaluation
 *       AitherOS/agents/Iris/service.py /pipeline/preview and /evaluate.
 *
 * Panels are UI: every one of these is optional-tolerant, because a field that
 * disappears from a service response must degrade to "not shown", never to a
 * crashed panel on the Living Desktop.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Saga — the play plane
// ─────────────────────────────────────────────────────────────────────────────

/** Which of the caller's reachable worlds a request addresses (X-Saga-World). */
export type WorldRef = string

export interface WorldOption {
  /** The header value, e.g. `private/default` or `shared/elysium`. */
  ref: WorldRef
  label: string
  /** Shared worlds are community worlds; private ones are only yours. */
  kind: 'private' | 'shared'
  hint?: string
}

export type TurnMode = 'narrative' | 'dialogue' | 'action'

export interface StoryChoice {
  id: string
  text: string
}

export interface DiceResult {
  type: 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100'
  rolls: number[]
  modifier: number
  total: number
  criticalSuccess?: boolean
  criticalFailure?: boolean
  checkType?: string
}

export interface StoryMessage {
  id: string
  role: 'player' | 'narrator' | 'system' | 'dice'
  mode?: TurnMode
  text: string
  at: number
  choices?: StoryChoice[]
  dice?: DiceResult
  /** Images the play plane generated for this beat (Canvas Studio auto-illustrate). */
  images?: string[]
}

/** POST /chat through the Veil proxy, which also runs /story/turn + /turn/complete. */
export interface StoryTurnResult {
  response: string
  images_generated?: string[]
  visual_moments?: Array<Record<string, unknown>>
}

/** GET /story/state. */
export interface StoryState {
  world?: { name?: string; turn_number?: number; last_turn_summary?: string }
  node_count?: number
  memory_count?: number
  [k: string]: unknown
}

/** POST /story/continuity/check. */
export interface ContinuityIssue {
  type: string
  severity: 'error' | 'warning' | 'info' | string
  scene_index?: number
  scene_title?: string
  message: string
  entity_name?: string
  suggestion?: string
}

export interface ContinuityReport {
  issues: ContinuityIssue[]
  count: number
  errors: number
  warnings: number
}

/** mcts.py MCTSBranch — the glass-box tree the panel draws. */
export interface MctsBranch {
  node_id: string
  text_preview?: string
  full_text?: string
  scores?: Record<string, number>
  total_score?: number
  visits?: number
  depth?: number
  selected?: boolean
  children?: MctsBranch[]
}

/** mcts.py MCTSExploration. */
export interface MctsExploration {
  mode?: string
  iterations_run?: number
  total_candidates?: number
  max_depth_reached?: number
  duration_ms?: number
  selected_text?: string
  selected_scores?: Record<string, number>
  selected_total?: number
  alternatives?: Array<Record<string, unknown>>
  tree?: MctsBranch | null
}

/** POST /story/turn/mcts. */
export interface MctsTurnResult {
  mcts: MctsExploration
  selected_response: string
  alternatives_count: number
}

export type MechanicType =
  | 'numeric' | 'range' | 'enum' | 'resource' | 'relationship' | 'boolean' | 'text' | string

/** mechanics-editor.tsx:48 — one definition, two renderers. */
export interface MechanicDefinition {
  name: string
  display_name: string
  type: MechanicType
  description: string
  min_value?: number
  max_value?: number
  default_value?: number | string | boolean
  enum_values?: string[]
  hidden: boolean
  affects_narrative: boolean
  decay_rate?: number
  icon?: string
  color?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Studio — the media-forge curated op surface
// ─────────────────────────────────────────────────────────────────────────────

export type ForgeParamType =
  | 'int' | 'float' | 'str' | 'bool' | 'enum'
  | 'sliders' | 'loras' | 'box' | 'mask' | 'style' | 'seed'

export interface ForgeOpParam {
  name: string
  type: ForgeParamType | string
  default?: unknown
  min?: number | null
  max?: number | null
  choices?: string[] | null
  help?: string
}

export interface ForgeOpPort {
  name: string
  type: string
  required?: boolean
  many?: boolean
  help?: string
}

/** One entry of the curated GET /ops manifest. */
export interface ForgeOp {
  name: string
  group: string
  label?: string
  summary?: string
  inputs?: ForgeOpPort[]
  outputs?: ForgeOpPort[]
  params?: ForgeOpParam[]
  /** 'cheap' answers in seconds; 'heavy' is the one that takes minutes. */
  cost?: 'cheap' | 'gpu' | 'heavy' | string
  safety?: string
}

/** POST /op/{name} — run_recipe's return, plus the refusal shape. */
export interface ForgeOpResult {
  ok: boolean
  error?: string
  head_ids?: number[]
  images?: string[]
  node_outputs?: Record<string, number[]>
  safety_level?: string
  [k: string]: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Iris — the artist
// ─────────────────────────────────────────────────────────────────────────────

export interface IrisPlannedAsset {
  type: string
  prompt: string
  backend: string
  estimated_time_s?: number
}

/** POST /pipeline/preview — the plan, with no GPU work done. */
export interface IrisPlan {
  assets: IrisPlannedAsset[]
  total_estimated_time_s?: number
  reasoning?: string
}

/** POST /evaluate. Iris's own field names vary by round; keep them all optional. */
export interface IrisEvaluation {
  score?: number
  passed?: boolean
  verdict?: string
  critique?: string
  issues?: string[]
  suggestions?: string[]
  refined_prompt?: string
  [k: string]: unknown
}

export interface IrisPipelineRound {
  step?: string
  status?: string
  asset_type?: string
  prompt?: string
  backend?: string
  image?: string
  images?: string[]
  evaluation?: IrisEvaluation
  [k: string]: unknown
}

/** POST /pipeline with stream:false. */
export interface IrisPipelineResult {
  ok?: boolean
  success?: boolean
  project_id?: string
  rounds?: IrisPipelineRound[]
  assets?: IrisPipelineRound[]
  style_card?: Record<string, unknown>
  error?: string
  [k: string]: unknown
}
