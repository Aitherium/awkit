'use client'

/**
 * SagaPlayPanel — Play, on the Living Desktop.
 *
 * This is the play plane (`agents/Saga`, the 39 `/story/*` routes), not the project
 * plane. The distinction is the product: the project plane is a manuscript editor,
 * the play plane is a world that runs. What that buys, and what this panel puts on
 * screen because nothing else does:
 *
 *   - a WORLD SELECTOR. `X-Saga-World` names which of the caller's reachable worlds
 *     a turn addresses — `private/default`, `shared/elysium`, or a project's own
 *     world. A world outside your reach answers 404 by design (never 403, so a
 *     stranger cannot probe which ids exist), which is why "that world is not
 *     yours" is a first-class state here.
 *   - the CONTINUITY CHECKER's verdict on the beat that was just written — dead
 *     characters, bilocation, contradicted relationships. An AI-Dungeon-class loop
 *     cannot say any of that; this one runs it every turn and shows the answer.
 *   - the MCTS BRANCH TREE, opt-in. `/story/turn/mcts` explores several
 *     continuations, scores them on coherence/consistency/tension and returns the
 *     whole tree. It is OPT-IN because it costs several completions per turn — on a
 *     small local model that is tens of seconds, and spending it on every turn
 *     without asking is how a feature becomes a reason to leave.
 *   - the project's MECHANIC DEFINITIONS as a rail, from the same shape the
 *     Adventure-mode mechanics editor writes.
 *
 * The turn itself goes to `/api/saga/chat`, which the Veil proxy expands into the
 * real three-step loop (assemble the world -> generate -> record the beat). The
 * panel deliberately does NOT re-implement that assembly: `saga-story-context.ts`
 * records what happens when a screen grounds itself instead of using the proxy —
 * a fluent, confident answer set in the wrong world, indistinguishable from a
 * working one.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Check, Dices, Feather, GitBranch, Image as ImageIcon,
  Loader2, Send, Sparkles,
} from 'lucide-react'

import { describeError, PanelError } from './creative/fetching'
import { publishHandoff, type CreativeHandoff } from './creative/handoff'
import {
  BASE_WORLDS, checkContinuity, diceAsTurn, exploreBranches, framedMessage,
  getMechanics, getState, parseChoices, rollDice, takeTurn, worldForProject,
} from './creative/saga-client'
import type {
  ContinuityIssue, DiceResult, MctsBranch, MctsExploration, MechanicDefinition,
  StoryMessage, StoryState, TurnMode, WorldOption,
} from './creative/types'

export interface SagaPlayPanelProps {
  projectId?: string
  /** '' for same-origin. */
  apiBase?: string
  /** Host-supplied handoff sink (Veil's creative hub). Defaults to the awkit bus. */
  onIllustrate?: (handoff: CreativeHandoff) => void
  className?: string
}

const MODES: Array<{ id: TurnMode; label: string; hint: string }> = [
  { id: 'narrative', label: 'Narrate', hint: 'Describe what happens.' },
  { id: 'dialogue', label: 'Say', hint: 'Speak in character.' },
  { id: 'action', label: 'Do', hint: 'Take an action.' },
]

const DICE: Array<DiceResult['type']> = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-views
// ─────────────────────────────────────────────────────────────────────────────

function BranchNode({ node, depth }: { node: MctsBranch; depth: number }): React.ReactElement {
  const score = typeof node.total_score === 'number' ? node.total_score.toFixed(2) : '—'
  return (
    <div style={{ marginLeft: depth * 12 }} className="mt-2">
      <div className={`rounded border px-2 py-1.5 ${node.selected
        ? 'border-emerald-500/60 bg-emerald-500/10'
        : 'border-slate-700 bg-slate-800/40'}`}>
        <div className="flex items-center gap-2 text-[11px]">
          {node.selected && <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />}
          <span className="text-slate-300 font-mono">{score}</span>
          {typeof node.visits === 'number' && (
            <span className="text-slate-500">{node.visits} visit{node.visits === 1 ? '' : 's'}</span>
          )}
          {node.scores && Object.entries(node.scores).slice(0, 3).map(([k, v]) => (
            <span key={k} className="text-slate-500">{k} {typeof v === 'number' ? v.toFixed(2) : String(v)}</span>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-300 whitespace-pre-wrap">
          {node.text_preview || node.full_text || '(no text)'}
        </p>
      </div>
      {(node.children || []).map(child => (
        <BranchNode key={child.node_id} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

function ContinuityList({ issues }: { issues: ContinuityIssue[] }): React.ReactElement | null {
  if (!issues.length) return null
  return (
    <div className="mt-2 space-y-1">
      {issues.map((issue, i) => (
        <div
          key={`${issue.type}-${i}`}
          className={`flex items-start gap-2 rounded border px-2 py-1.5 text-xs ${issue.severity === 'error'
            ? 'border-red-500/40 bg-red-500/10 text-red-200'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-200'}`}
        >
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            <span className="uppercase tracking-wide opacity-70">{issue.type}</span>{' — '}
            {issue.message}
            {issue.suggestion && <span className="block opacity-80">{issue.suggestion}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

function MechanicsRail({ mechanics }: { mechanics: MechanicDefinition[] }): React.ReactElement {
  const visible = mechanics.filter(m => !m.hidden)
  if (!mechanics.length) {
    return (
      <p className="text-xs text-slate-500">
        No mechanics defined for this project. Add them in the mechanics editor and they appear here.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {visible.map(m => (
        <div key={m.name} className="rounded border border-slate-700 bg-slate-800/40 px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-200">{m.display_name || m.name}</span>
            <span className="text-[10px] uppercase tracking-wide text-slate-500">{m.type}</span>
          </div>
          {m.description && <p className="text-[11px] text-slate-500 mt-0.5">{m.description}</p>}
          {typeof m.default_value !== 'undefined' && (
            <p className="text-[11px] text-slate-400 mt-0.5">
              starts at <span className="font-mono">{String(m.default_value)}</span>
              {typeof m.min_value === 'number' && typeof m.max_value === 'number'
                && <span className="text-slate-500"> · {m.min_value}–{m.max_value}</span>}
              {m.affects_narrative && <span className="text-purple-300"> · drives the story</span>}
            </p>
          )}
        </div>
      ))}
      {visible.length < mechanics.length && (
        <p className="text-[11px] text-slate-500">
          {mechanics.length - visible.length} hidden mechanic(s) the narrator can see and you cannot.
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────────────

export default function SagaPlayPanel({
  projectId,
  apiBase = '',
  onIllustrate,
  className = '',
}: SagaPlayPanelProps): React.ReactElement {
  const worlds: WorldOption[] = useMemo(
    () => (projectId ? [worldForProject(projectId), ...BASE_WORLDS] : BASE_WORLDS),
    [projectId],
  )

  const [world, setWorld] = useState<string>(worlds[0].ref)
  const [state, setState] = useState<StoryState | null>(null)
  const [stateError, setStateError] = useState<string>('')
  const [loadingState, setLoadingState] = useState(true)

  const [messages, setMessages] = useState<StoryMessage[]>([])
  const [mechanics, setMechanics] = useState<MechanicDefinition[]>([])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<TurnMode>('narrative')
  const [busy, setBusy] = useState(false)
  const [turnError, setTurnError] = useState('')

  const [explore, setExplore] = useState(false)
  const [exploration, setExploration] = useState<MctsExploration | null>(null)
  const [continuity, setContinuity] = useState<ContinuityIssue[]>([])
  const [continuityNote, setContinuityNote] = useState('')

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const opts = useMemo(() => ({ apiBase, world }), [apiBase, world])

  // World state + mechanics, re-read whenever the selected world changes.
  useEffect(() => {
    let cancelled = false
    setLoadingState(true)
    setStateError('')
    setMessages([])
    setExploration(null)
    setContinuity([])
    setContinuityNote('')

    void (async () => {
      try {
        const s = await getState(opts)
        if (!cancelled) setState(s)
      } catch (e) {
        if (cancelled) return
        setState(null)
        setStateError(
          e instanceof PanelError && e.kind === 'not-found'
            ? 'That world is not yours. Pick another world, or ask its owner to add you.'
            : describeError(e, 'Saga'),
        )
      } finally {
        if (!cancelled) setLoadingState(false)
      }

      try {
        const m = await getMechanics(opts, projectId)
        if (!cancelled) setMechanics(m)
      } catch {
        // The rail is an aid; a mechanics read that fails leaves it empty and says
        // so in its own empty state rather than blocking play.
        if (!cancelled) setMechanics([])
      }
    })()

    return () => { cancelled = true }
  }, [opts, projectId])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const runContinuity = useCallback(async (prose: string) => {
    setContinuityNote('')
    try {
      const report = await checkContinuity(opts, [{ title: `Turn ${Date.now()}`, prose: [prose] }])
      setContinuity(report.issues || [])
      if (!report.issues?.length) setContinuityNote('Continuity checker found nothing.')
    } catch (e) {
      setContinuity([])
      setContinuityNote(`Continuity check did not run: ${describeError(e, 'the continuity checker')}`)
    }
  }, [opts])

  const submit = useCallback(async (raw: string, turnMode: TurnMode) => {
    const text = raw.trim()
    if (!text || busy) return

    setBusy(true)
    setTurnError('')
    setExploration(null)
    setMessages(prev => [...prev, {
      id: nextId('player'), role: 'player', mode: turnMode, text: framedMessage(text, turnMode), at: Date.now(),
    }])

    try {
      let prose: string
      let images: string[] = []

      if (explore) {
        const result = await exploreBranches(opts, text, turnMode)
        setExploration(result.mcts)
        prose = result.selected_response || result.mcts?.selected_text || ''
      } else {
        const result = await takeTurn(opts, text, turnMode)
        prose = result.response || ''
        images = Array.isArray(result.images_generated) ? result.images_generated : []
      }

      if (!prose) {
        setTurnError('Saga answered with an empty turn. Nothing was written to the world.')
        return
      }

      setMessages(prev => [...prev, {
        id: nextId('narrator'),
        role: 'narrator',
        text: prose,
        at: Date.now(),
        choices: parseChoices(prose),
        images,
      }])
      setInput('')
      await runContinuity(prose)
      try {
        setState(await getState(opts))
      } catch {
        // A turn that landed but whose state re-read failed is still a turn; the
        // header simply keeps the previous turn number.
      }
    } catch (e) {
      setTurnError(describeError(e, explore ? 'the branch explorer' : 'Saga'))
    } finally {
      setBusy(false)
    }
  }, [busy, explore, opts, runContinuity])

  const roll = useCallback((type: DiceResult['type']) => {
    const result = rollDice(type, 0, mode === 'action' ? 'action' : undefined)
    setMessages(prev => [...prev, { id: nextId('dice'), role: 'dice', text: diceAsTurn(result), at: Date.now(), dice: result }])
    void submit(diceAsTurn(result), 'action')
  }, [mode, submit])

  const illustrate = useCallback((message: StoryMessage) => {
    const handoff: CreativeHandoff = {
      action: 'render',
      text: message.text,
      characterRefs: [],
      imageUrl: message.images?.[0],
      source: 'Saga · Play',
      world,
    }
    if (onIllustrate) onIllustrate(handoff)
    else publishHandoff(handoff)
  }, [onIllustrate, world])

  const selectedWorld = worlds.find(w => w.ref === world) ?? worlds[0]
  const turnNumber = state?.world?.turn_number
  const worldName = state?.world?.name

  return (
    <div className={`bg-slate-900/60 backdrop-blur-xl border border-purple-500/20 rounded-lg flex flex-col min-h-0 ${className}`}>
      <div className="px-4 py-3 border-b border-slate-700 flex flex-wrap items-center gap-2">
        <Feather className="w-5 h-5 text-purple-400 flex-shrink-0" />
        <h3 className="text-lg font-medium text-slate-100">Play</h3>
        <select
          aria-label="World"
          value={world}
          onChange={e => setWorld(e.target.value)}
          className="ml-auto bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
        >
          {worlds.map(w => <option key={w.ref} value={w.ref}>{w.label}</option>)}
        </select>
        <span className="text-[11px] text-slate-500 w-full sm:w-auto">
          {selectedWorld.hint}
          {worldName ? ` · ${worldName}` : ''}
          {typeof turnNumber === 'number' ? ` · turn ${turnNumber}` : ''}
        </span>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Story column */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-3">
            {loadingState && (
              <p className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Opening the world…
              </p>
            )}

            {!loadingState && stateError && (
              <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {stateError}
              </div>
            )}

            {!loadingState && !stateError && !messages.length && (
              <div className="text-sm text-slate-400 space-y-1">
                <p>{worldName ? `${worldName} is open.` : 'The world is open.'} Take a turn and it moves.</p>
                <p className="text-xs text-slate-500">
                  Every turn is assembled from the story graph, written into it, and checked for
                  continuity. Turn on <span className="text-purple-300">Explore branches</span> to see the
                  alternatives the narrator considered and why it picked one.
                </p>
              </div>
            )}

            {messages.map(m => (
              <div key={m.id} className={m.role === 'player' ? 'text-right' : ''}>
                <div className={`inline-block max-w-full rounded px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === 'player' ? 'bg-purple-600/30 text-slate-100'
                    : m.role === 'dice' ? 'bg-slate-800/60 text-amber-200 font-mono text-xs'
                    : 'bg-slate-800/60 text-slate-200'}`}>
                  {m.text}
                </div>

                {m.images && m.images.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.images.map(src => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={src} src={src} alt="Scene" className="max-h-48 rounded border border-slate-700" />
                    ))}
                  </div>
                )}

                {m.choices && m.choices.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.choices.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        disabled={busy}
                        onClick={() => void submit(c.text, 'action')}
                        className="px-2 py-1 rounded border border-purple-500/40 text-xs text-purple-200 hover:bg-purple-500/20 disabled:opacity-50"
                      >
                        {c.text}
                      </button>
                    ))}
                    <span className="self-center text-[10px] text-slate-500">read from the narrator’s own options</span>
                  </div>
                )}

                {m.role === 'narrator' && (
                  <button
                    type="button"
                    onClick={() => illustrate(m)}
                    className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-600 text-xs text-slate-300 hover:border-purple-400 hover:text-purple-200"
                  >
                    <ImageIcon className="w-3 h-3" /> Illustrate this beat
                  </button>
                )}
              </div>
            ))}

            {busy && (
              <p className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                {explore ? 'Exploring branches — several completions, this is the slow one…' : 'The world is answering…'}
              </p>
            )}

            {turnError && (
              <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {turnError}
              </div>
            )}
          </div>

          <div className="border-t border-slate-700 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {MODES.map(m => (
                <button
                  key={m.id}
                  type="button"
                  title={m.hint}
                  onClick={() => setMode(m.id)}
                  className={`px-2 py-1 rounded text-xs border ${mode === m.id
                    ? 'border-purple-400 text-purple-200 bg-purple-500/20'
                    : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
                >
                  {m.label}
                </button>
              ))}
              <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={explore}
                  onChange={e => setExplore(e.target.checked)}
                  className="accent-purple-500"
                />
                <GitBranch className="w-3.5 h-3.5" /> Explore branches
              </label>
            </div>

            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void submit(input, mode)
                  }
                }}
                placeholder={MODES.find(m => m.id === mode)?.hint}
                disabled={busy || !!stateError}
                rows={2}
                className="flex-1 bg-slate-800/50 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void submit(input, mode)}
                disabled={busy || !input.trim() || !!stateError}
                className="px-3 py-2 rounded bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 text-slate-100 text-sm"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <Dices className="w-3.5 h-3.5 text-slate-500" />
              {DICE.map(d => (
                <button
                  key={d}
                  type="button"
                  disabled={busy || !!stateError}
                  onClick={() => roll(d)}
                  className="px-1.5 py-0.5 rounded border border-slate-700 text-[11px] text-slate-400 hover:text-amber-200 hover:border-amber-500/50 disabled:opacity-40"
                >
                  {d}
                </button>
              ))}
              <span className="text-[10px] text-slate-500 ml-1">a roll is told to the narrator as an action</span>
            </div>
          </div>
        </div>

        {/* Rail */}
        <div className="lg:w-72 border-t lg:border-t-0 lg:border-l border-slate-700 overflow-auto p-3 space-y-4 flex-shrink-0">
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Mechanics</h4>
            <MechanicsRail mechanics={mechanics} />
          </section>

          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Continuity
            </h4>
            {continuity.length > 0
              ? <ContinuityList issues={continuity} />
              : <p className="text-xs text-slate-500">{continuityNote || 'Runs after every turn.'}</p>}
          </section>

          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5" /> Branches
            </h4>
            {exploration ? (
              <div>
                <p className="text-[11px] text-slate-500">
                  {exploration.total_candidates ?? 0} candidate(s), depth {exploration.max_depth_reached ?? 0}
                  {typeof exploration.duration_ms === 'number' && `, ${Math.round(exploration.duration_ms)} ms`}
                  {exploration.mode && ` · ${exploration.mode}`}
                </p>
                {exploration.tree
                  ? <BranchNode node={exploration.tree} depth={0} />
                  : <p className="mt-2 text-xs text-slate-500">The search ran but returned no tree.</p>}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                <Sparkles className="inline w-3 h-3 mr-1" />
                Turn on <span className="text-purple-300">Explore branches</span> and the next turn shows every
                continuation the narrator scored, and which one it took.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
