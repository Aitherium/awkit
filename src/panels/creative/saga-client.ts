/**
 * The Saga PLAY-plane client.
 *
 * Every call goes through the host's `/api/saga/*` proxy
 * (AitherVeil `src/app/api/saga/[...slug]/route.ts`), never at :8770 directly:
 * that proxy is what attaches the caller's identity, forwards the `X-Saga-World`
 * selector, and — for a narrative turn — runs the THREE-STEP loop the engine
 * actually has:
 *
 *     POST /story/turn            assemble the world  -> context_text
 *     POST /chat                  generate, GIVEN that context
 *     POST /story/turn/complete   record the beat back into the graph
 *
 * `saga-story-context.ts` documents why that lives in the proxy: a component-level
 * version grounds the one screen someone edited and leaves every other caller
 * silently ungrounded. So this client posts the MIDDLE step and gets all three —
 * it must not re-implement the assembly, or the panel becomes the second
 * ungrounded caller the proxy exists to prevent.
 *
 * The world selector is a HEADER, not a body field, for the reason stated in
 * auth-headers.ts: it names which of the caller's own worlds to address, and the
 * SCOPE is still derived from the authenticated caller. A world outside your reach
 * answers 404, never 403.
 */

import { fetchJson, PanelError } from './fetching'
import type {
  ContinuityReport,
  DiceResult,
  MctsTurnResult,
  MechanicDefinition,
  StoryChoice,
  StoryState,
  StoryTurnResult,
  TurnMode,
  WorldOption,
  WorldRef,
} from './types'

/** The two worlds every caller has, before any project is named. */
export const BASE_WORLDS: WorldOption[] = [
  { ref: 'private/default', kind: 'private', label: 'My world', hint: 'Only you can read or write it.' },
  { ref: 'shared/elysium', kind: 'shared', label: 'Elysium (shared)', hint: 'The community world — everyone who joins plays in the same one.' },
]

/** A project id becomes a private world of its own. */
export function worldForProject(projectId: string): WorldOption {
  return {
    ref: `private/${projectId}`,
    kind: 'private',
    label: projectId,
    hint: 'This project’s own world.',
  }
}

export interface SagaClientOptions {
  /** '' for same-origin (the normal Living Desktop / Veil case). */
  apiBase?: string
  world: WorldRef
  displayName?: string
}

function headers(o: SagaClientOptions): Record<string, string> {
  return { 'X-Saga-World': o.world }
}

function base(o: SagaClientOptions): string {
  return `${o.apiBase ?? ''}/api/saga`
}

/** GET /story/state — turn number and world name for the header rail. */
export async function getState(o: SagaClientOptions): Promise<StoryState> {
  return fetchJson<StoryState>(`${base(o)}/story/state`, { headers: headers(o), timeoutMs: 15000 })
}

/**
 * Take one turn.
 *
 * `mode` is carried in the message envelope the way the shipped Adventure mode
 * does it — an action turn is written as an action, a dialogue turn as speech —
 * because the play plane's `/chat` body has no mode field and inventing one here
 * would be a contract the service does not have.
 */
export async function takeTurn(
  o: SagaClientOptions,
  message: string,
  mode: TurnMode,
): Promise<StoryTurnResult> {
  return fetchJson<StoryTurnResult>(`${base(o)}/chat`, {
    method: 'POST',
    headers: headers(o),
    body: {
      message: framedMessage(message, mode),
      display_name: o.displayName || 'Player',
    },
    timeoutMs: 180000,
  })
}

/** How a mode is expressed to the narrator. Kept in one place so it cannot drift. */
export function framedMessage(message: string, mode: TurnMode): string {
  const text = message.trim()
  if (mode === 'action') return `*${text}*`
  if (mode === 'dialogue') return `"${text}"`
  return text
}

/** POST /story/turn/mcts — the opt-in branch search, with the full tree. */
export async function exploreBranches(
  o: SagaClientOptions,
  message: string,
  mode: TurnMode,
): Promise<MctsTurnResult> {
  return fetchJson<MctsTurnResult>(`${base(o)}/story/turn/mcts`, {
    method: 'POST',
    headers: headers(o),
    body: { message: framedMessage(message, mode), display_name: o.displayName || 'Player' },
    timeoutMs: 600000,
  })
}

/**
 * POST /story/continuity/check.
 *
 * The body is a bare LIST of scenes (`scenes: List[Dict] = Body(...)`), not an
 * object — posting `{scenes: [...]}` returns 422, which reads in the UI as "the
 * continuity checker found nothing".
 */
export async function checkContinuity(
  o: SagaClientOptions,
  scenes: Array<{ title?: string; prose: string[] }>,
): Promise<ContinuityReport> {
  return fetchJson<ContinuityReport>(`${base(o)}/story/continuity/check`, {
    method: 'POST',
    headers: headers(o),
    body: scenes,
    timeoutMs: 60000,
  })
}

/**
 * The project's mechanic definitions.
 *
 * These live on the PROJECT plane (`/api/saga/projects/{id}`), which is a different
 * service from the play plane — so a project with no mechanics, or no project at
 * all, is an empty rail and not an error. Only a real transport failure propagates.
 */
export async function getMechanics(
  o: SagaClientOptions,
  projectId: string | undefined,
): Promise<MechanicDefinition[]> {
  if (!projectId) return []
  try {
    const project = await fetchJson<{ mechanics?: unknown; settings?: { mechanics?: unknown } }>(
      `${base(o)}/projects/${encodeURIComponent(projectId)}`,
      { headers: headers(o), timeoutMs: 15000 },
    )
    const raw = project.mechanics ?? project.settings?.mechanics
    return Array.isArray(raw) ? (raw as MechanicDefinition[]) : []
  } catch (e) {
    // A missing project is "no mechanics", not a broken panel. An auth failure is
    // NOT swallowed: it is the one the player has to see.
    if (e instanceof PanelError && (e.kind === 'not-found' || e.kind === 'forbidden')) return []
    throw e
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Narrative helpers — parsing what the model actually returns
// ─────────────────────────────────────────────────────────────────────────────

const CHOICE_LINE = /^\s*(?:(\d{1,2})[.)]|[-*•])\s+(.{2,180})$/

/**
 * Pull an options block out of the narrator's prose.
 *
 * The play plane's `/chat` returns `{response, images_generated, visual_moments}`
 * and NOTHING structured for choices — so choices are read from the prose, and the
 * panel labels them as read from the prose. The alternative (a fixed menu, as the
 * shipped Adventure welcome message uses) would be a menu that does not correspond
 * to the story, which is worse than no menu.
 *
 * Only a run of 2+ list lines at the END of the response counts: a mid-prose bullet
 * list is description, not a prompt to choose.
 */
export function parseChoices(prose: string): StoryChoice[] {
  const lines = prose.split(/\r?\n/)
  const tail: StoryChoice[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.trim()) {
      if (tail.length) break
      continue
    }
    const m = CHOICE_LINE.exec(line)
    if (!m) break
    tail.unshift({ id: `choice-${i}`, text: m[2].trim().replace(/\*\*/g, '') })
    if (tail.length > 8) break
  }
  return tail.length >= 2 ? tail : []
}

const DICE_SIDES: Record<DiceResult['type'], number> = {
  d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 100,
}

/** A roll, made client-side exactly as the shipped Adventure mode makes it. */
export function rollDice(type: DiceResult['type'], modifier = 0, checkType?: string): DiceResult {
  const sides = DICE_SIDES[type]
  const roll = Math.floor(Math.random() * sides) + 1
  return {
    type,
    rolls: [roll],
    modifier,
    total: roll + modifier,
    criticalSuccess: type === 'd20' && roll === 20,
    criticalFailure: type === 'd20' && roll === 1,
    checkType,
  }
}

/** How a roll is told to the narrator, so the world reacts to it. */
export function diceAsTurn(result: DiceResult): string {
  const mod = result.modifier !== 0 ? ` ${result.modifier > 0 ? '+' : '-'} ${Math.abs(result.modifier)}` : ''
  const label = result.checkType ? `${result.checkType} check` : 'roll'
  return `Rolled ${result.total} on a ${label} (${result.type}: ${result.rolls.join(', ')}${mod})`
}
