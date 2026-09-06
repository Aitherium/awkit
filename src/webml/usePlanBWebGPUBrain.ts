'use client'

/**
 * Plan B Ledger WebGPU brain — on-device parsing with graceful fallback.
 *
 * Mirrors the Python `brain.py` parser (bonsai + deterministic fallback). This
 * hook wraps useWebGPUChat as a single-turn classifier for ledger entries.
 *
 * The model output schema MUST match what the Python brain returns:
 *   {kind: "bill"|"expense"|"income", desc, amount, bill_name, category}
 *
 * On any error/timeout/malformed output it returns null and the caller falls
 * back to parseCapture(). The deterministic path is the final fallback and must
 * always work with zero GPU and zero model.
 *
 * TWO REACT RULES THIS FILE EXISTS TO GET RIGHT — both were live bugs here:
 *
 * 1. `useWebGPUChat` is called UNCONDITIONALLY at the top level. An earlier
 *    version called it lazily inside an async IIFE inside a useCallback, to
 *    avoid constructing it until first use. That is a Rules-of-Hooks violation:
 *    hook order must be identical on every render, so React would throw
 *    "change in the order of Hooks called". Laziness belongs on the LOAD
 *    (`chat.load()` is explicit and still deferred until first parse), never on
 *    the hook call — constructing the hook costs nothing and downloads nothing.
 *
 * 2. Async pollers read `chatRef.current`, never a captured `chat`. A closure
 *    captures the object from the render it was created in, whose `status` and
 *    `messages` are frozen at those values. Polling the captured object would
 *    spin until timeout even after the model became ready — a hang that looks
 *    exactly like a slow model.
 */

import { useCallback, useMemo, useRef, useState } from 'react'

import { getBonsaiModel, suggestBonsaiModelId } from './bonsai-models'
import { useWebGPUChat } from './useWebGPUChat'
import { mayAutoLoadModel } from './consent'

interface ParsedEntry {
  kind: 'bill' | 'expense' | 'income'
  desc: string
  amount: string | null
  bill_name: string | null
  category: string
  brain: string
}

export interface UsePlanBWebGPUBrainOptions {
  /** Worker factory for the Bonsai runtime. */
  workerFactory: () => Worker
  /** Which Bonsai model to use. Defaults to a device-appropriate suggestion. */
  modelId?: string
  /** Known bills, for prompt context. */
  bills?: Array<{ name: string }>
}

export interface UsePlanBWebGPUBrain {
  /** The model is loaded and can answer. */
  ready: boolean
  /** A load or a parse is in flight. */
  busy: boolean
  /** Human text during load, else null. */
  loadStatus: string | null
  status: 'unsupported' | 'loading' | 'ready' | 'error'
  /** One-shot parse. Returns null on ANY failure so the caller falls back. */
  parse: (text: string) => Promise<ParsedEntry | null>
  /**
   * Start downloading/initialising the model. MUST exist as a separate trigger.
   *
   * Without it the feature deadlocks and is silently dead: a caller naturally
   * guards `if (brain.ready) brain.parse(...)`, but `ready` only becomes true
   * after a load, and the load only happens inside `parse()`. Nothing ever
   * calls parse, so nothing ever loads, so `ready` is never true — and the
   * symptom is not an error, it is the deterministic fallback quietly handling
   * every capture forever. That was live here on 2026-08-09.
   */
  enable: () => void
}

const LOAD_TIMEOUT_MS = 120_000
const PARSE_TIMEOUT_MS = 30_000

/** Poll `probe` until it returns a boolean, or give up. null = keep waiting. */
async function _waitFor(
  probe: () => boolean | null,
  timeoutMs: number,
  stepMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const verdict = probe()
    if (verdict !== null) return verdict
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, stepMs))
  }
}

export function usePlanBWebGPUBrain(
  opts: UsePlanBWebGPUBrainOptions,
): UsePlanBWebGPUBrain {
  const modelId = opts.modelId ?? suggestBonsaiModelId()

  // Stable unless the roster actually changes — a new object identity every
  // render would churn the underlying chat session.
  const billKey = (opts.bills ?? []).map(b => b.name).join('|')
  const system = useMemo(
    () => _systemPrompt((opts.bills ?? []).map(b => b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by name list
    [billKey],
  )

  // Top level, unconditional. Constructing this neither downloads nor runs
  // anything; `load()` below is what costs.
  const chat = useWebGPUChat({
    workerFactory: opts.workerFactory,
    modelId,
    system,
  })

  // The async pollers MUST read through this ref, not the captured `chat`.
  const chatRef = useRef(chat)
  chatRef.current = chat

  const [busy, setBusy] = useState(false)
  const loadRequested = useRef(false)

  const ensureLoaded = useCallback(async (): Promise<boolean> => {
    const current = chatRef.current
    if (current.status === 'unsupported' || current.status === 'error') return false
    if (current.status === 'ready') return true
    if (!getBonsaiModel(modelId)) return false

    // THIS IS AN UNATTENDED LOAD. `parse()` is called from a poller on the caller's behalf,
    // so there is no click behind it and nothing here can render a prompt. It therefore
    // needs the STANDING permission — the "load automatically from now on" checkbox — not
    // merely a past one-time yes.
    //
    // Returning false immediately rather than calling load() and waiting is the point: the
    // gate leaves the hook idle, so `_waitFor` would burn LOAD_TIMEOUT_MS and then report
    // the same false. A slow false and a fast false look identical to the caller and utterly
    // different to whoever debugs it.
    if (!mayAutoLoadModel()) return false

    if (!loadRequested.current) {
      loadRequested.current = true
      try {
        current.load()
      } catch {
        return false
      }
    }
    return _waitFor(() => {
      const s = chatRef.current.status
      if (s === 'ready') return true
      if (s === 'error' || s === 'unsupported') return false
      return null
    }, LOAD_TIMEOUT_MS)
  }, [modelId])

  const parse = useCallback(
    async (text: string): Promise<ParsedEntry | null> => {
      setBusy(true)
      try {
        if (!(await ensureLoaded())) return null

        const before = chatRef.current.messages.length
        try {
          chatRef.current.send(text)
        } catch {
          return null
        }

        const answered = await _waitFor(() => {
          const c = chatRef.current
          if (c.status === 'error' || c.status === 'unsupported') return false
          if (c.status === 'ready' && c.messages.length > before) return true
          return null
        }, PARSE_TIMEOUT_MS, 100)
        if (!answered) return null

        const msgs = chatRef.current.messages
        const last = msgs[msgs.length - 1]
        if (!last || last.role !== 'assistant') return null
        return _parseModelOutput(last.content, modelId)
      } catch {
        return null
      } finally {
        setBusy(false)
      }
    },
    [ensureLoaded, modelId],
  )

  const status: UsePlanBWebGPUBrain['status'] =
    chat.status === 'unsupported'
      ? 'unsupported'
      : chat.status === 'error'
        ? 'error'
        : chat.status === 'ready'
          ? 'ready'
          : 'loading'

  const enable = useCallback(() => {
    // Fire-and-forget: the caller wants the download started, not awaited.
    void ensureLoaded()
  }, [ensureLoaded])

  return {
    enable,
    ready: chat.status === 'ready',
    busy: busy || chat.status === 'generating',
    loadStatus: status === 'loading' && loadRequested.current
      ? `loading ${modelId}…`
      : null,
    status,
    parse,
  }
}

/**
 * System prompt for the parsing task. Kept in step with `brain.py`'s _SYSTEM —
 * the two must agree or the same sentence categorises differently per face.
 */
function _systemPrompt(billNames: string[]): string {
  const categories = ['Bills', 'Food', 'Auto', 'Home', 'Fun', 'Income', 'Other']
  return (
    'You turn one sentence about money into JSON. Output ONLY a JSON object, no prose. ' +
    'Schema: {"kind": "bill"|"expense"|"income", "desc": string, "amount": number|null, ' +
    '"bill_name": string|null, "category": one of ' +
    JSON.stringify(categories) +
    '}. ' +
    '"paid <name>" with a known bill name -> kind=bill. Money in -> income. ' +
    'Known bills: ' +
    (billNames.length ? billNames.join(', ') : '(none)')
  )
}

/** Parse model output; any malformed shape returns null so the caller falls back. */
function _parseModelOutput(content: string, modelId: string): ParsedEntry | null {
  try {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as Record<string, unknown>

    if (
      typeof parsed.kind !== 'string' ||
      !['bill', 'expense', 'income'].includes(parsed.kind) ||
      typeof parsed.desc !== 'string' ||
      parsed.category === undefined ||
      (parsed.bill_name !== null &&
        parsed.bill_name !== undefined &&
        typeof parsed.bill_name !== 'string')
    ) {
      return null
    }

    let amount: string | null = null
    if (parsed.amount !== null && parsed.amount !== undefined) {
      amount = String(parsed.amount)
    }

    return {
      kind: parsed.kind as ParsedEntry['kind'],
      desc: parsed.desc,
      amount,
      bill_name: (parsed.bill_name as string | null) ?? null,
      category: String(parsed.category),
      brain: modelId,
    }
  } catch {
    return null
  }
}
