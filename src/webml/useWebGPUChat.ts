"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { grantModelConsent, hasModelConsent } from "./consent";
import { getWebMLModel, isWebGPUAvailable } from "./models";
import { suggestBonsaiModelId } from "./bonsai-models";
import type { ChatMessage, WorkerResponse } from "./protocol";
// The deadline lives with the runtime that has to meet it — never a literal here (BIH002).
import { FIRST_TOKEN_FAIL_MS, gpuLaneAllowed, isPhoneDevice } from "./device-class";
import {
  MAX_TOOL_ROUNDS,
  parseToolCalls,
  renderToolsSystemBlock,
  type WebMLTools,
} from "./tool-loop";

export type ChatStatus = "unsupported" | "idle" | "loading" | "ready" | "generating" | "error";

export interface UseWebGPUChatOptions {
  /** Consumer-provided factory — each app instantiates its own bundler-resolvable Worker. */
  workerFactory: () => Worker;
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
  send: (text: string) => void;
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
  // front of every tenant visitor (measured 2026-08-30 on two tenant apps, which
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

  useEffect(() => {
    if (!gpuLaneAllowed() || !isWebGPUAvailable()) setStatus("unsupported");
  }, []);

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
    const w = warm ?? opts.workerFactory();
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
          streamRef.current += msg.text;
          setStreaming(streamRef.current);
          break;
        case "done": {
          if (firstTokenTimerRef.current) {
            clearTimeout(firstTokenTimerRef.current);
            firstTokenTimerRef.current = null;
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

  const load = useCallback(() => {
    // A PHONE NEVER LOADS A MODEL AT ALL (owner directive 2026-09-01; isPhoneDevice is the
    // BCG014 anchor): its memory-killed worker fires no event and cannot be cleaned up, and
    // even the smallest model on the CPU lane froze a Pixel 10 to a reboot. This hook has no
    // CPU lane, so the honest answer is "unsupported" — before consent, so "assume-granted"
    // cannot route around it.
    if (isPhoneDevice() || !gpuLaneAllowed() || !isWebGPUAvailable()) return setStatus("unsupported");
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
  }, [ensureWorker, modelId, opts.consent]);

  // System turn(s) for every generate: the app's prompt plus, when tools are
  // registered, the template-compatible <tools> declaration block.
  const systemMessages = useCallback((): ChatMessage[] => {
    const parts: string[] = [];
    if (opts.system) parts.push(opts.system);
    if (toolsRef.current?.specs?.length) {
      parts.push(renderToolsSystemBlock(toolsRef.current.specs));
    }
    return parts.length ? [{ role: "system" as const, content: parts.join("\n\n") }] : [];
  }, [opts.system]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === "generating") return;
      // send() reaches ensureWorker() too — a phone must not construct one this way either.
      // isPhoneDevice() is explicit here (not just gpuLaneAllowed) so the device gate is a
      // named anchor BCG014 can assert on the second door, assume-granted included.
      if (isPhoneDevice() || !gpuLaneAllowed()) { setStatus("unsupported"); return; }
      // send() reaches ensureWorker() too, so a turn sent from 'idle' would construct a
      // worker without ever passing through load(). Gate the second door as well — the
      // whole lesson of this change is that one chokepoint is only a chokepoint if every
      // path really goes through it.
      if (opts.consent !== "assume-granted" && !hasModelConsent()) {
        setConsentNeeded(true);
        return;
      }
      toolRoundsRef.current = 0; // fresh budget per user turn
      const convo: ChatMessage[] = [
        ...systemMessages(),
        ...messagesRef.current,
        { role: "user" as const, content: trimmed },
      ];
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
      ensureWorker().postMessage({ type: "generate", messages: convo });
    },
    [ensureWorker, systemMessages, status, opts.consent],
  );

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
    messages, streaming, error, tokensPerSecond: tps, load, send, interrupt, reset,
    consentNeeded, grantConsent, declineConsent,
  };
}
