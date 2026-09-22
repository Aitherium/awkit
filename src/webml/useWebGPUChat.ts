"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { grantModelConsent, hasModelConsent } from "./consent";
import { scheduleSleepPasses, type ConsolidateResult } from "./sleep-time-memory";
import { defaultChatMemory, type ChatMemory } from "./chat-memory";
import { getWebMLModel, isWebGPUAvailable } from "./models";
import { suggestBonsaiModelId } from "./bonsai-models";
import type { ChatMessage, WorkerResponse } from "./protocol";
// The deadline lives with the runtime that has to meet it — never a literal here (BIH002).
import {
  FIRST_TOKEN_FAIL_MS,
  gpuLaneAllowed,
  isPhoneDevice,
  phoneLaneAllowed,
  type PhoneLaneBudget,
} from "./device-class";
import {
  MAX_TOOL_ROUNDS,
  parseToolCalls,
  renderToolsSystemBlock,
  type WebMLTools,
} from "./tool-loop";

export type ChatStatus = "unsupported" | "idle" | "loading" | "ready" | "generating" | "error";

/** Which runtime is actually carrying this session. */
export type WebMLLane = "webgpu" | "wasm";

export interface UseWebGPUChatOptions {
  /**
   * Sleep-time memory (./sleep-time-memory.ts). Pass anything with a `consolidate()` —
   * a `SessionMemory`, a `SleepTimeMemory` over your own store — and the hook runs the
   * deferred update/delete/ignore pass while the tab is HIDDEN and the model is ready,
   * through `generateRaw` (never the visible chat). Consent is re-checked inside the
   * pass, before the first generate(). Omit it and nothing is scheduled.
   */
  /**
   * Conversation memory. DEFAULT `"auto"`: the kit's own `ChatMemory` (IndexedDB per
   * origin, keyword recall until `configureChatMemoryEmbedder()` wires the microembedder)
   * remembers every turn, prepends a recall block, and runs the sleep-time
   * consolidation pass while the tab is hidden. `false` opts out entirely. Pass a
   * `ChatMemory` of your own to keep the behaviour on a store you control.
   */
  memory?: "auto" | false | ChatMemory;
  /** Which conversation the turns belong to (default `"default"`). */
  conversationId?: string;
  onSleepPass?: (r: ConsolidateResult) => void;
  /** Consumer-provided factory — each app instantiates its own bundler-resolvable Worker. */
  workerFactory: () => Worker;
  /**
   * The CPU (wasm) worker, for devices with no usable WebGPU.
   *
   * 🚨 THE HOOK HAD NO CPU LANE AT ALL, and that was the whole gap. Veil's Living OS has
   * had one for weeks (`brain.startCpu()`); this hook — the one every OTHER surface
   * imports — could only answer "unsupported", so an iPhone visitor to any non-Veil
   * surface was offered nothing while the same model ran fine one app over.
   *
   * OPTIONAL, and its ABSENCE is what keeps this change behaviour-neutral: with no
   * factory the lane resolution below can only ever pick `webgpu`, which is exactly what
   * every existing consumer gets today. A surface opts in by passing one.
   */
  wasmWorkerFactory?: () => Worker;
  /**
   * Which runtime to use. `"auto"` (default) prefers WebGPU and falls back to the wasm
   * worker when one is supplied; `"webgpu"` and `"wasm"` pin it.
   *
   * Pinning matters for more than testing: a device CAN have WebGPU and still be the
   * wrong place to use it (a phone whose compositor shares the GPU), and the decision
   * about that belongs to the ratchet and the budget, not to feature detection.
   */
  lane?: WebMLLane | "auto";
  /**
   * What this device can hold, for the phone ratchet.
   *
   * Supplied by the host (which owns the catalogue and the adapter) rather than
   * measured here, so there is one budget per session instead of one per consumer.
   * Omitted, the ratchet refuses -- a phone allowed without knowing what it can hold
   * is the exact claim that produced the freeze.
   */
  phoneBudget?: PhoneLaneBudget;
  modelId?: string;
  /** Optional system prompt prepended to the conversation. */
  system?: string;
  /**
   * Optional host-side tools. Specs are declared in the system turn (the
   * Bonsai template's <tools> contract); <tool_call>s parsed from generated
   * text are executed and the results fed back as role:"tool" messages, then
   * generation continues — capped at MAX_TOOL_ROUNDS per user turn.
   */
  tools?: WebMLTools;
  /**
   * Who is responsible for asking the human before 236 MB - 3.6 GB lands on their device.
   *
   * `"require"` (the DEFAULT, and the only safe default) — `load()` refuses until
   * `grantConsent()` has been called or a prior answer is stored. `consentNeeded` goes true
   * so the host can render its prompt; awkit's own <WebGPUChat> renders one for you.
   *
   * `"assume-granted"` — the host has ALREADY obtained consent through its own flow and
   * takes responsibility for that claim. It must be written out explicitly, because the
   * whole class of defect here is a permission that was never actually asked for while
   * every layer assumed some other layer had asked.
   */
  consent?: "require" | "assume-granted";
}

export interface UseWebGPUChat {
  status: ChatStatus;
  /** 0..1 overall download progress (aggregated across all model files). */
  progress: number;
  /** Bytes downloaded so far across all files (for a "142 / 901 MB" readout). */
  loadedBytes: number;
  /** Total bytes known so far across all files. */
  totalBytes: number;
  /** The file currently downloading (for a subtle "fetching tokenizer.json…" line). */
  currentFile: string | null;
  messages: ChatMessage[];
  /** The assistant text currently streaming (before it's committed to messages). */
  streaming: string;
  error: string | null;
  tokensPerSecond: number | null;
  load: () => void;
  /**
   * Load on the CPU (wasm) lane explicitly.
   *
   * Named `startCpu` to match the verb the Living OS already exposes, so the two surfaces
   * describe the same act the same way. A no-op when no `wasmWorkerFactory` was supplied,
   * and it SAYS so through `error` rather than failing silently — a button that does
   * nothing is the shape this whole family of gates exists to catch.
   */
  startCpu: () => void;
  /** Which lane the current session is on; null before a load has been attempted. */
  lane: WebMLLane | null;
  send: (text: string) => void;
  /**
   * One-shot generate on the SAME worker that never touches `messages`/`streaming` —
   * the backend call a kit consumer (sleep-time memory, a tool, a tenant feature) uses
   * when it needs the model's answer and not a chat turn. Refuses unless status is
   * "ready" so it can never queue in front of a user's send.
   */
  generateRaw: (prompt: string, opts?: { maxTokens?: number }) => Promise<string>;
  /** The conversation memory in use (null when `memory: false`). */
  memory: ChatMemory | null;
  interrupt: () => void;
  reset: () => void;
  /**
   * A load was requested and nobody has agreed yet. Render a prompt and call `grantConsent`.
   *
   * This is a returned FIELD rather than a `status` value on purpose: adding a seventh
   * member to `ChatStatus` would silently fall through every existing consumer's switch and
   * render nothing at all — a consent gate that presents as a blank panel is the same
   * silent no-op it exists to prevent.
   */
  consentNeeded: boolean;
  /** Record the answer and continue the load. `auto` is the "from now on" checkbox. */
  grantConsent: (auto: boolean) => void;
  /** Dismiss without loading and without persisting a "no". */
  declineConsent: () => void;
}

/**
 * Workers that already hold a loaded model, keyed by modelId — module scope, so
 * they OUTLIVE the component.
 *
 * This is the difference between a usable assistant and an unusable one. The
 * worker owns the model weights in GPU/WASM memory; the hook used to terminate
 * it on unmount, and `workerRef` is per-component-instance, so simply switching
 * tabs in the app threw away a download of up to 3.6 GB and started it again
 * from zero on the way back. Nothing errored — it just looked like the model
 * "never finishes loading", because on every visit it was genuinely loading
 * from scratch.
 *
 * Keeping the worker warm is also what makes the size tiering worth anything:
 * a phone pays the 236 MB once per session instead of once per navigation.
 */
const WARM_WORKERS = new Map<string, Worker>();
/** modelId → the model is loaded in that worker and ready to generate. */
const WARM_READY = new Set<string>();

/**
 * Terminate every warm worker and free the weights.
 *
 * Exported because "keep it warm forever" must remain a CHOICE the host app can
 * revoke — a signed-out user's model should not sit in memory. Nothing calls it
 * on unmount by design; that was the bug.
 */
export function disposeWarmWebGPUWorkers(): void {
  for (const w of WARM_WORKERS.values()) w.terminate();
  WARM_WORKERS.clear();
  WARM_READY.clear();
}

export function useWebGPUChat(opts: UseWebGPUChatOptions): UseWebGPUChat {
  // Device-sized default, never the flat catalogue default: DEFAULT_WEBML_MODEL_ID
  // is bonsai-27b-text (3.6 GB) and an un-sized default put a 3.6 GB download in
  // front of every tenant visitor (measured 2026-08-30 on vibe/jgames, which
  // bundle this hook). suggestBonsaiModelId errs small (saveData/slow-link →
  // 1.7b; mobile → 4b/1.7b; desktop ≥8 GB → 8b; else 4b) — the same sizing
  // aitherium.com's own brain uses. Consumers may still pin a model explicitly.
  const modelId = opts.modelId ?? suggestBonsaiModelId();
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [loadedBytes, setLoadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const filesRef = useRef<Record<string, { loaded: number; total: number }>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Conversation memory: default-on, one per origin. Resolved once per mount.
  const memoryRef = useRef<ChatMemory | null>(null);
  if (memoryRef.current === null && opts.memory !== false) {
    memoryRef.current = opts.memory && opts.memory !== "auto" ? opts.memory : defaultChatMemory();
  }
  const conversationId = opts.conversationId ?? "default";
  // generateRaw side channel: while set, token/done/error route HERE, not to the chat.
  const rawRef = useRef<{ buf: string; resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const [consentNeeded, setConsentNeeded] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  // BIH002 — first-token deadline. A worker the browser kills for memory (the ORDINARY end
  // of a turn on a phone) posts no message and on several engines fires no error, so without
  // this the hook never leaves "generating". Armed on entering that state, disarmed by the
  // FIRST token: cutting off a slow-but-alive turn would fabricate a failure, which is worse
  // than the hang because nobody can debug an error that did not happen.
  const firstTokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef("");
  const messagesRef = useRef<ChatMessage[]>([]);
  // Tool-loop state: execute→regenerate rounds used for the CURRENT user turn.
  const toolRoundsRef = useRef(0);
  const toolsRef = useRef(opts.tools);
  toolsRef.current = opts.tools;

  // Which lane this session is on. A REF as well as state: `ensureWorker` runs inside
  // callbacks that captured an earlier render, and picking the factory from a stale
  // closure is how a surface ends up constructing the wrong worker for its own lane.
  const [lane, setLane] = useState<WebMLLane | null>(null);
  const laneRef = useRef<WebMLLane | null>(null);
  // What this device can hold, when the host has measured it. A REF so the ratchet
  // reads the current value from callbacks that captured an earlier render; undefined
  // is the safe default, because phoneLaneAllowed() refuses without a budget.
  const phoneBudgetRef = useRef<PhoneLaneBudget | undefined>(opts.phoneBudget);
  phoneBudgetRef.current = opts.phoneBudget;

  /**
   * The lane this device should take, or null when neither is available.
   *
   * BEHAVIOUR-NEUTRAL BY CONSTRUCTION: with no `wasmWorkerFactory` every branch below
   * either answers `webgpu` or null, which is precisely today's `gpuLaneAllowed() &&
   * isWebGPUAvailable()`. The wasm answers are reachable only for a consumer that opted in.
   */
  const resolveLane = useCallback((forced?: WebMLLane): WebMLLane | null => {
    const wasmOk = !!opts.wasmWorkerFactory;
    const gpuOk = gpuLaneAllowed() && isWebGPUAvailable();
    const want = forced ?? opts.lane ?? "auto";
    if (want === "wasm") return wasmOk ? "wasm" : null;
    if (want === "webgpu") return gpuOk ? "webgpu" : null;
    if (gpuOk) return "webgpu";
    return wasmOk ? "wasm" : null;
  }, [opts.lane, opts.wasmWorkerFactory]);

  useEffect(() => {
    if (!resolveLane()) setStatus("unsupported");
  }, [resolveLane]);

  // Detach this instance's handler on unmount, but do NOT terminate the worker:
  // it holds the loaded weights and the next mount reuses them. Dropping the
  // handler is what stops a stale closure from writing into an unmounted tree.
  useEffect(() => {
    return () => {
      const w = workerRef.current;
      if (w && w.onmessage) w.onmessage = null;
      workerRef.current = null;
    };
  }, []);

  // Adopt an already-warm model so a revisit renders READY instead of replaying
  // the whole download. Without this the weights survive but the UI still says
  // "loading" forever, since nothing would ever send the ready-state.
  useEffect(() => {
    if (WARM_READY.has(modelId) && isWebGPUAvailable()) {
      setStatus("ready");
      setProgress(100);
    }
  }, [modelId]);

  const ensureWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;
    const warm = WARM_WORKERS.get(modelId);
    // Re-bind onmessage below: the handler closes over THIS mount's setters.
    // THE FACTORY FOLLOWS THE LANE. Reading `opts.workerFactory` unconditionally here
    // would construct a WebGPU worker for a session that resolved to wasm -- which does
    // not throw, it just never answers, because the wrong worker ignores the protocol.
    const factory = laneRef.current === "wasm" && opts.wasmWorkerFactory
      ? opts.wasmWorkerFactory
      : opts.workerFactory;
    const w = warm ?? factory();
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      switch (msg.type) {
        case "progress": {
          // transformers.js reports progress PER FILE. Aggregate real bytes across every
          // file so the bar reflects the WHOLE download (not the last file resetting 0→100).
          if (msg.file && typeof msg.total === "number" && msg.total > 0) {
            filesRef.current[msg.file] = { loaded: msg.loaded ?? 0, total: msg.total };
            setCurrentFile(msg.file);
          }
          const files = Object.values(filesRef.current);
          const loaded = files.reduce((a, f) => a + f.loaded, 0);
          const total = files.reduce((a, f) => a + f.total, 0);
          setLoadedBytes(loaded);
          setTotalBytes(total);
          setProgress(total > 0 ? Math.min(1, loaded / total) : typeof msg.progress === "number" ? msg.progress / 100 : 0);
          break;
        }
        case "ready":
          setProgress(1);
          setCurrentFile(null);
          setStatus("ready");
          // Record that THIS worker holds a usable model, so a later mount can
          // adopt it instead of downloading the weights again.
          WARM_READY.add(modelId);
          break;
        case "token":
          if (firstTokenTimerRef.current) {
            clearTimeout(firstTokenTimerRef.current);
            firstTokenTimerRef.current = null;
          }
          if (rawRef.current) {
            rawRef.current.buf += msg.text;
            break;
          }
          streamRef.current += msg.text;
          setStreaming(streamRef.current);
          break;
        case "done": {
          if (firstTokenTimerRef.current) {
            clearTimeout(firstTokenTimerRef.current);
            firstTokenTimerRef.current = null;
          }
          if (rawRef.current) {
            const raw = rawRef.current;
            rawRef.current = null;
            setTps(msg.tokensPerSecond ?? null);
            setStatus("ready");
            raw.resolve(msg.text || raw.buf);
            break;
          }
          const finalText = msg.text || streamRef.current;
          streamRef.current = "";
          setStreaming("");
          setTps(msg.tokensPerSecond ?? null);

          // Host-side tool loop: a <tool_call> in the output is executed and
          // its result fed back as a role:"tool" message, then generation
          // continues. The RAW assistant text (calls included) stays in the
          // convo — the template renders it verbatim and a parse failure must
          // remain visible in the transcript, never silently vanish.
          const tools = toolsRef.current;
          const { calls } = tools ? parseToolCalls(finalText) : { calls: [] };
          const next = [...messagesRef.current, { role: "assistant" as const, content: finalText }];
          messagesRef.current = next;
          setMessages(next);
          void memoryRef.current?.remember(conversationId, "assistant", finalText);

          if (tools && calls.length > 0 && toolRoundsRef.current < MAX_TOOL_ROUNDS) {
            toolRoundsRef.current += 1;
            void (async () => {
              for (const call of calls) {
                let result: string;
                try {
                  result = await tools.execute(call.name, call.arguments);
                } catch (e) {
                  // The model must SEE the failure — an empty/absent response
                  // reads as "the tool returned nothing" and invites confabulation.
                  result = `Tool '${call.name}' failed: ${e instanceof Error ? e.message : String(e)}`;
                }
                const withTool = [
                  ...messagesRef.current,
                  { role: "tool" as const, content: result },
                ];
                messagesRef.current = withTool;
                setMessages(withTool);
              }
              const convo: ChatMessage[] = [
                ...systemMessages(),
                ...messagesRef.current,
              ];
              ensureWorker().postMessage({ type: "generate", messages: convo });
            })();
            break; // stay "generating" while tools run + model continues
          }

          setStatus("ready");
          break;
        }
        case "error":
          if (firstTokenTimerRef.current) {
            clearTimeout(firstTokenTimerRef.current);
            firstTokenTimerRef.current = null;
          }
          if (rawRef.current) {
            const raw = rawRef.current;
            rawRef.current = null;
            raw.reject(new Error(msg.message));
          }
          setError(msg.message);
          setStatus("error");
          break;
      }
    };
    // BIH001 — BOTH handlers, always. `onerror` covers a worker that threw; `onmessageerror`
    // covers a message that could not be deserialised, which fires NO error event and would
    // otherwise settle nothing: status stays "generating" until the tab closes. That silence
    // is the most-reported symptom of this whole class.
    const fail = (why: string) => {
      if (firstTokenTimerRef.current) {
        clearTimeout(firstTokenTimerRef.current);
        firstTokenTimerRef.current = null;
      }
      // The warm-worker cache makes one death PERMANENT if it is not evicted: load() trusts
      // WARM_READY and short-circuits to "ready" without posting anything, so every retry
      // hangs identically and the whole thing reads as "just broken" rather than "died once".
      WARM_WORKERS.delete(modelId);
      WARM_READY.delete(modelId);
      workerRef.current = null;
      try { w.terminate(); } catch { /* already gone */ }
      setError(why);
      setStatus("error");
    };
    w.onerror = (ev: ErrorEvent) => {
      fail(ev?.message
        ? `The model worker crashed: ${ev.message}`
        : "The model worker crashed before it could start.");
    };
    w.onmessageerror = () => {
      fail("A reply from the model could not be read (the message failed to deserialise).");
    };

    workerRef.current = w;
    WARM_WORKERS.set(modelId, w);
    return w;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- systemMessages is
    // declared below; the handler only runs post-mount and reads refs for
    // everything that can change.
  }, [opts]);

  const load = useCallback((forcedLane?: WebMLLane) => {
    // A PHONE NEVER LOADS A MODEL AT ALL (owner directive 2026-09-01; isPhoneDevice is the
    // BCG014 anchor): its memory-killed worker fires no event and cannot be cleaned up, and
    // even the smallest model on the CPU lane froze a Pixel 10 to a reboot. This hook has no
    // CPU lane, so the honest answer is "unsupported" — before consent, so "assume-granted"
    // cannot route around it.
    // RATCHET, not a flag. Every WASP_PHONE_RATCHET cell is `banned` today, so
    // phoneLaneAllowed() is false on every phone and this refuses exactly as the bare
    // isPhoneDevice() did. What changes is that lifting the ban is a TABLE edit with a
    // measured report behind it (BIH015), not an edit to each of these call sites --
    // which is how the previous mobile fixes came to disagree with each other.
    const wanted = resolveLane(forcedLane);
    if (isPhoneDevice() && !phoneLaneAllowed(wanted ?? "wasm", phoneBudgetRef.current)) {
      return setStatus("unsupported");
    }
    const picked = wanted;
    if (!picked) return setStatus("unsupported");
    laneRef.current = picked;
    setLane(picked);
    // ── CONSENT ── before anything that can start a download, and before the warm-adopt
    // branch below: adopting a warm worker is cheap, but reaching it means a load already
    // happened, and this hook must never be the reason one did.
    if (opts.consent !== "assume-granted" && !hasModelConsent()) {
      setConsentNeeded(true);
      setStatus("idle");
      return;
    }
    // Already warm: adopt it. Re-posting "load" would re-run the whole fetch,
    // which is the behaviour that made revisiting the page look broken.
    if (WARM_READY.has(modelId) && WARM_WORKERS.has(modelId)) {
      ensureWorker();
      setError(null);
      setProgress(1);
      setStatus("ready");
      return;
    }
    setError(null);
    setStatus("loading");
    setProgress(0);
    ensureWorker().postMessage({ type: "load", modelId });
  }, [ensureWorker, modelId, opts.consent, resolveLane]);

  /** Force the CPU lane. See `startCpu` on the return type for why it is named that. */
  const startCpu = useCallback(() => {
    if (!opts.wasmWorkerFactory) {
      setError("No CPU runtime is wired into this surface (pass wasmWorkerFactory).");
      setStatus("unsupported");
      return;
    }
    load("wasm");
  }, [load, opts.wasmWorkerFactory]);

  // System turn(s) for every generate: the app's prompt plus, when tools are
  // registered, the template-compatible <tools> declaration block.
  const systemMessages = useCallback((recallBlock?: string): ChatMessage[] => {
    const parts: string[] = [];
    if (opts.system) parts.push(opts.system);
    if (toolsRef.current?.specs?.length) {
      parts.push(renderToolsSystemBlock(toolsRef.current.specs));
    }
    if (recallBlock) parts.push(recallBlock);
    return parts.length ? [{ role: "system" as const, content: parts.join("\n\n") }] : [];
  }, [opts.system]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === "generating") return;
      // send() reaches ensureWorker() too — a phone must not construct one this way either.
      // isPhoneDevice() is explicit here (not just gpuLaneAllowed) so the device gate is a
      // named anchor BCG014 can assert on the second door, assume-granted included.
      const lanePicked = resolveLane();
      // send() reaches ensureWorker() without passing through load(), so the ratchet is
      // asked on this door too -- one chokepoint is only a chokepoint if every path
      // really goes through it.
      if (!lanePicked
        || (isPhoneDevice()
          && !phoneLaneAllowed(lanePicked, phoneBudgetRef.current))) {
        setStatus("unsupported"); return;
      }
      if (!laneRef.current) laneRef.current = lanePicked;
      // send() reaches ensureWorker() too, so a turn sent from 'idle' would construct a
      // worker without ever passing through load(). Gate the second door as well — the
      // whole lesson of this change is that one chokepoint is only a chokepoint if every
      // path really goes through it.
      if (opts.consent !== "assume-granted" && !hasModelConsent()) {
        setConsentNeeded(true);
        return;
      }
      toolRoundsRef.current = 0; // fresh budget per user turn
      const priorTurns = messagesRef.current;
      const shown = [...messagesRef.current, { role: "user" as const, content: trimmed }];
      messagesRef.current = shown;
      setMessages(shown);
      streamRef.current = "";
      setStreaming("");
      setStatus("generating");
      if (firstTokenTimerRef.current) clearTimeout(firstTokenTimerRef.current);
      firstTokenTimerRef.current = setTimeout(() => {
        firstTokenTimerRef.current = null;
        if (streamRef.current) return;   // tokens arrived; the turn is alive
        WARM_WORKERS.delete(modelId);
        WARM_READY.delete(modelId);
        workerRef.current?.terminate();
        workerRef.current = null;
        setError(
          "The model stopped responding before its first token — the browser most likely " +
          "ended the worker to reclaim memory. Try a smaller model.",
        );
        setStatus("error");
      }, FIRST_TOKEN_FAIL_MS);
      // Memory: recall BEFORE the turn is posted (the block rides in the system message),
      // remember the user turn, then generate. Both are guarded — a memory failure never
      // blocks the send; the recall simply comes back empty.
      const mem = memoryRef.current;
      void (async () => {
        let recallBlock = "";
        if (mem) {
          try {
            recallBlock = await mem.recallBlock(conversationId, trimmed);
          } catch {
            recallBlock = "";
          }
          void mem.remember(conversationId, "user", trimmed);
        }
        const convo: ChatMessage[] = [
          ...systemMessages(recallBlock || undefined),
          ...priorTurns,
          { role: "user" as const, content: trimmed },
        ];
        ensureWorker().postMessage({ type: "generate", messages: convo });
      })();
    },
    [ensureWorker, systemMessages, status, opts.consent, conversationId],
  );

  const generateRaw = useCallback(
    (prompt: string, rawOpts: { maxTokens?: number } = {}): Promise<string> => {
      if (status !== "ready") return Promise.reject(new Error(`generateRaw refused: model is ${status}, not ready`));
      if (rawRef.current) return Promise.reject(new Error("generateRaw refused: a raw generate is already in flight"));
      if (!prompt.trim()) return Promise.reject(new Error("generateRaw refused: empty prompt"));
      return new Promise<string>((resolve, reject) => {
        rawRef.current = { buf: "", resolve, reject };
        setStatus("generating");
        try {
          ensureWorker().postMessage({ type: "generate", messages: [{ role: "user", content: prompt }], maxTokens: rawOpts.maxTokens } as never);
        } catch (e) {
          rawRef.current = null;
          setStatus("ready");
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
    [ensureWorker, status],
  );

  // Sleep-time memory: the kit schedules the pass itself when a consumer hands it a memory.
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const generateRawRef = useRef(generateRaw);
  useEffect(() => { generateRawRef.current = generateRaw; }, [generateRaw]);
  const memory = memoryRef.current;
  const onSleepPass = opts.onSleepPass;
  useEffect(() => {
    if (!memory) return;
    return scheduleSleepPasses({
      status: () => statusRef.current,
      generate: (prompt) => generateRawRef.current(prompt, { maxTokens: 160 }),
      memory,
      onResult: onSleepPass,
    });
  }, [memory, onSleepPass]);

  const interrupt = useCallback(() => {
    workerRef.current?.postMessage({ type: "interrupt" });
    if (streamRef.current) {
      const next = [...messagesRef.current, { role: "assistant" as const, content: streamRef.current }];
      messagesRef.current = next;
      setMessages(next);
    }
    streamRef.current = "";
    setStreaming("");
    setStatus("ready");
  }, []);

  const reset = useCallback(() => {
    messagesRef.current = [];
    streamRef.current = "";
    setMessages([]);
    setStreaming("");
    setError(null);
    if (status !== "unsupported") setStatus(getModelReadyStatus());
  }, [status]);

  function getModelReadyStatus(): ChatStatus {
    return workerRef.current ? "ready" : "idle";
  }

  // touch getWebMLModel so a bad modelId surfaces early in dev
  if (process.env.NODE_ENV !== "production" && !getWebMLModel(modelId)) {
    // eslint-disable-next-line no-console
    console.warn(`[useWebGPUChat] unknown modelId '${modelId}'`);
  }

  const grantConsent = useCallback(
    (auto: boolean) => {
      grantModelConsent(auto);
      setConsentNeeded(false);
      // The click that answered the dialog IS the explicit load. Re-enter load(), which now
      // passes the gate and runs every other guard again.
      load();
    },
    [load],
  );

  // No "no" is persisted: a refusal remembered forever is how a mis-click costs someone the
  // feature with no route back, and an unanswered gate already refuses.
  const declineConsent = useCallback(() => setConsentNeeded(false), []);

  return {
    status, progress, loadedBytes, totalBytes, currentFile,
    messages, streaming, error, tokensPerSecond: tps, load, startCpu, lane, send, generateRaw, memory: memoryRef.current, interrupt, reset,
    consentNeeded, grantConsent, declineConsent,
  };
}
