// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 * Original Aitherium WebGPU implementation — WGSL kernels ported from the PrismML
 * llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
 * NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
 * Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
 *
 * Worker protocol loop for the Bonsai runtime — the peer of awkit's runWebMLWorker,
 * same injected-dep pattern. Handles load|generate|interrupt, emits progress|ready|token|
 * done|error. `done.text` carries the FULL assembled reply (the OS provider resolves on it
 * directly). Kernel WGSL + GPU device are injected by the consumer (deps), so this module
 * never hardcodes a bundler import.
 */

import { createBonsaiRuntime, type BonsaiRuntime } from "../runtime";
import { visibleAnswerPrefix, completedToolSpans } from "../../bonsai-tools/stream-gate";
import { steerMetaQuestion } from "../../bonsai-tools/meta-steer";
import type { PriorToolResult } from "../../bonsai-tools/meta-steer";
import { bonsaiDebugEnabled } from "../model/forward";
import type { KernelSources } from "../kernels/pipelines";
import type { GpuDeviceLike } from "../kernels/gpu-min";
import { isMobileDevice } from "../gpu-class";

// Tool calling support — uses the verified parser from bonsai-tools
const MAX_TOOL_CALLS_PER_TURN = 5;

/**
 * The LAST turn's tool results, kept across turns for meta-question steering.
 *
 * The page's own history does not persist tool turns — GobboNet stores only the
 * final answer text — so a "how do you know that?" arrives here with no trace of
 * the get_current_time call it asks about, and the model re-invokes the tool to
 * answer a question about a call it has already made (measured live 2026-09-01:
 * the time repeated twice). This memo is the only record the steering can point
 * at. Consumed at the start of each fresh turn by steerMetaQuestion and cleared
 * there; repopulated whenever a turn executes tools.
 */
let lastToolResults: PriorToolResult[] = [];

/**
 * Live KV / recurrent state carried BETWEEN turns, so a reply does not re-read
 * the whole conversation. See model/prefix-cache.ts for when reuse is legal.
 *
 * Module-level because it must outlive one generate() call, and holds GPU
 * buffers — hence `device`, so a cache built on a torn-down device is never
 * reused. It is cleared at the START of every turn and only re-established on
 * success, which makes every error and abort path fail closed to a full prefill
 * without having to know this exists.
 */
let PREFIX_CACHE: {
  device: unknown;
  kv: import("../model/kv_f32").F32KvCache | import("../model/kvcache").KvCache;
  ssm: import("../model/ssm_state").SsmState;
  /** EXACTLY the tokens this state has processed: prompt + everything decoded. */
  tokens: number[];
  signature: string;
  capacity: number;
} | null = null;

// Message contract — structurally identical to awkit's protocol.ts so the OS brain
// speaks one wire format regardless of runtime. Declared locally to keep the core
// dependency-light; the worker ENTRY adapts to the shared protocol types.
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** For assistant messages: tool calls made in this turn (optional, for replay). */
  tool_calls?: Array<{ function: { name: string; arguments: any } }>;
}

export interface ToolFunction {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export type WorkerRequest =
  | { type: "load"; modelId: string }
  | {
      type: "generate";
      messages: ChatMessage[];
      maxTokens?: number;
      temperature?: number;
      topK?: number;
      topP?: number;
      repetitionPenalty?: number;
      /** Tokens the model may spend inside `<think>` before it is force-closed (0 = no cap). */
      reasoningBudget?: number;
      /** Available tools for the model to call. */
      tools?: ToolFunction[];
      /** Page facts this worker cannot observe (no window/document here). */
      context?: {
        pageUrl?: string;
        pageTitle?: string;
        /** Windows the HOST will open — the whitelist open_app is checked against. */
        apps?: Array<{ id: string; title: string; tagline: string }>;
        /** Anon credential + API origin — a Worker can obtain neither itself. */
        anonToken?: string;
        apiBase?: string;
        /** Local AitherBonsaiImage base (127.0.0.1:8798) when the host's probe found one. */
        localImageBase?: string;
      };
    }
  | { type: "interrupt" };
export type WorkerResponse =
  | { type: "progress"; progress?: number; file?: string }
  | { type: "ready"; modelId: string }
  /** `channel` distinguishes chain-of-thought from the reply; absent = "answer" (legacy). */
  | { type: "token"; text: string; channel?: "thinking" | "answer" | "tool" }
  /** A tool asked the HOST to do something the worker cannot do itself (open a window). */
  | { type: "tool_action"; actions: Array<{ kind: "open"; app: string }> }
  /**
   * An image a tool produced. Its own message type because it CANNOT travel through the
   * text stream: the reply channel would render megabytes of base64 verbatim (the stripper
   * knows one marker vocabulary), and the tool observation is fed back to the model, so the
   * bytes would consume the context window too. The host renders `dataUrl` directly and the
   * model is only ever told that an image exists.
   */
  | { type: "image"; images: Array<{ dataUrl: string; alt: string }> }
  | { type: "done"; text: string; reasoning?: string; tokensPerSecond?: number }
  /**
   * `fatal` marks a failure the HOST must not retry.
   *
   * `device-lost` is the one that matters. `GPUDevice.lost` resolving with a reason other
   * than "destroyed" means the platform tore the device out from under us — on Windows the
   * overwhelmingly common cause is a TDR display-driver reset, i.e. a GPU packet that ran
   * past the 2 s deadline. Retrying re-arms the identical reset, and the visitor's SCREEN
   * FLASHES on each one (incident 2026-07-31, Yoga 7i / Iris Xe, where the loop outlived
   * the tab). A host that treats this like an ordinary error and restarts the worker turns
   * one driver reset into a reset loop, so the distinction is carried on the wire rather
   * than left to the host to infer from message text.
   */
  | { type: "error"; message: string; fatal?: "device-lost" };

export interface WorkerScope {
  postMessage(msg: WorkerResponse): void;
  addEventListener(type: "message", cb: (e: { data: WorkerRequest }) => void): void;
}

export interface BonsaiWorkerDeps {
  /** Resolve the WGSL sources (bundler owns the `?raw` imports) + model URL. */
  loadKernels: () => Promise<KernelSources>;
  /** Acquire a WebGPU device (navigator.gpu.requestAdapter().requestDevice()). */
  acquireDevice: () => Promise<GpuDeviceLike>;
  /** Resolve a model id -> GGUF URL (defaults to the registry repo). */
  resolveModelUrl: (modelId: string) => string;
  /** Optional: primary + mirror URLs for the same model, tried in order per range. */
  resolveMirrorUrls?: (modelId: string) => string[];
}

const BONSAI_RUNTIME_TAG = "bonsai-kernels";

export function runBonsaiWorker(scope: WorkerScope, deps: BonsaiWorkerDeps): void {
  let runtime: BonsaiRuntime | null = null;
  let currentModelId = "";
  let stopped = false;
  /**
   * Set once the GPU device dies and NEVER cleared. Every entry point checks it first.
   *
   * Without this the runtime kept submitting into a dead device after a TDR reset: each
   * call throws or silently no-ops, the turn "fails" for an unrelated-looking reason (the
   * one the visitor saw was `Failed to fetch` from a range GET killed alongside the GPU
   * process), and any retry re-triggers the reset that caused it. A device is not
   * recoverable in place — the worker must be torn down and a NEW device acquired, which
   * is the host's decision to make, deliberately, and not on a timer.
   */
  let deviceLost: string | null = null;

  const post = (m: WorkerResponse) => scope.postMessage(m);

  /** Report a lost device once, and latch. */
  function reportDeviceLost(detail: string) {
    if (deviceLost) return;
    deviceLost = detail;
    stopped = true;
    runtime = null;
    // Distinguish the error source and provide specific guidance for TDR resets.
    let guidance = '';
    if (/watchdog|timeout|tdr|hung|exceeded.*deadline/i.test(detail)) {
      guidance =
        ' This is a GPU watchdog timeout (TDR), usually caused by an integrated GPU or ' +
        'weak adapter taking too long on a compute batch. The safest path is a smaller model ' +
        'or the hosted inference ladder. Retrying WILL reset the driver again.';
    } else if (/destroyed/i.test(detail)) {
      guidance = ' (This is an expected shutdown, not an error.)';
    } else {
      guidance =
        ' The GPU device was torn away by the OS (possibly due to an overheating shutdown, ' +
        'driver crash, or resource exhaustion). Retrying may succeed after a delay, but is risky.';
    }
    post({
      type: "error",
      fatal: "device-lost",
      message:
        `bonsai: GPU device lost (${detail}).${guidance} Not retrying automatically — retrying ` +
        `without addressing the root cause will re-trigger the same reset.`,
    });
  }

  async function load(modelId: string) {
    if (deviceLost) {
      return post({
        type: "error",
        fatal: "device-lost",
        message: `bonsai: refusing to load — the GPU device was already lost (${deviceLost}).`,
      });
    }
    try {
      const device = await deps.acquireDevice();
      // OBSERVE THE DEVICE. `lost` resolves (never rejects) when the platform takes the
      // device away; "destroyed" is our own teardown and is not a failure. Nothing in this
      // runtime listened for it before 2026-07-31, which is why a driver reset presented as
      // an unrelated network error and why the surface kept re-arming it.
      if (device.lost) {
        void device.lost.then((info) => {
          if (info?.reason === "destroyed") return; // our own destroy() — expected
          reportDeviceLost(`${info?.reason ?? "unknown"}: ${info?.message ?? "no detail"}`);
        });
      }
      // Uncaptured errors are how out-of-memory and validation failures actually surface —
      // an allocation that fails returns an INVALID buffer and execution continues against
      // it, producing wrong results or a later, unrelated-looking crash. Surface them.
      device.addEventListener?.("uncapturederror", (ev) => {
        const msg = ev?.error?.message ?? "unknown GPU error";
        console.error(`[bonsai] uncaptured GPU error: ${msg}`);
        if (/out of memory|allocation/i.test(msg)) {
          post({
            type: "error",
            message:
              `bonsai: the GPU ran out of memory (${msg}). This model is too large for this ` +
              `adapter — choose a smaller size.`,
          });
          stopped = true;
        } else if (/timeout|watchdog|tdr/i.test(msg)) {
          // GPU watchdog timeout — treat as device-lost-like since recovery is impossible
          reportDeviceLost(`watchdog: ${msg}`);
        } else {
          console.warn(
            `[bonsai] uncaptured GPU error ignored: ${msg} — generation may continue but results may be corrupt`,
          );
        }
      });
      const kernelSources = await deps.loadKernels();
      runtime = createBonsaiRuntime({ device, kernelSources });
      currentModelId = modelId;
      await runtime.load({
        modelUrl: deps.resolveModelUrl(modelId),
        // Mirror list, when the host supplies one. A Worker cannot read the app's env, so
        // like anonToken and apiBase this has to be handed over rather than looked up.
        ...(deps.resolveMirrorUrls ? { mirrorUrls: deps.resolveMirrorUrls(modelId) } : {}),
        onProgress: (p) => post({ type: "progress", progress: p.percent, file: p.detail }),
      });
      post({ type: "ready", modelId });

      // WARM THE BLOCKS NOW, not on the visitor's first message.
      //
      // `load()` resolves once the globals are up; the transformer blocks stream lazily on
      // first use. Measured on the deployed bundle 2026-08-14 (1.7B, RTX 5090, plain
      // visitor path): first message 61,824 ms to first token, second message 140 ms at
      // 42.4 tok/s. The model was never slow — the first turn was paying for the download
      // of every block, with the GPU at 8% / 70 W because that minute is not compute.
      //
      // Started AFTER `ready` is posted so the UI unblocks at exactly the same moment it
      // did before: this can only make the first turn faster, never later to appear. A
      // message arriving mid-warm is not delayed — `ensureLayer` dedupes via its in-flight
      // map, so the turn awaits the same upload rather than starting a second one.
      //
      // `cancelled` is checked per block so a load() for a DIFFERENT model abandons this
      // warm instead of racing it; without that, switching 1.7B -> 27B mid-warm would keep
      // pulling the old model's blocks and evict the new one's under memory pressure.
      const warmingModelId = modelId;
      void runtime
        .warm({ cancelled: () => currentModelId !== warmingModelId })
        .then((resident) => {
          if (currentModelId !== warmingModelId) return;

          console.log(`[bonsai] warm: ${resident} block(s) resident before first turn`);
        })
        .catch(() => { /* speculative — see BonsaiRuntime.warm */ });
    } catch (e) {
      const msg = (e as Error).message;
      const guidance = msg.includes("token_embd") || msg.includes("output_norm")
        ? " This usually means the model download was interrupted or the browser cache " +
          "is corrupted. Try: (1) clear site data and reload, (2) try a smaller model " +
          "(Bonsai 4B is 545 MB), or (3) run locally with `pip install awdk && " +
          "adk bonsai-local` for a faster, more reliable experience."
        : "";
      post({ type: "error", message: `bonsai load failed: ${msg}${guidance}` });
    }
  }

  async function generate(req: Extract<WorkerRequest, { type: "generate" }>) {
    if (deviceLost) {
      return post({
        type: "error",
        fatal: "device-lost",
        message: `bonsai: cannot generate — the GPU device was lost (${deviceLost}).`,
      });
    }
    if (!runtime?.loaded) {
      return post({ type: "error", message: "no model loaded — send {type:'load'} first" });
    }
    stopped = false;
    try {
      const { tokenizer, config, device, pipelines, weights } = runtime.loaded;
      const maxTokens = req.maxTokens ?? 256;
      // Bonsai model-card defaults. Greedy (the old hardcoded temperature 0) makes a 1-bit
      // 27B loop on itself — that is the "1, 1, 1, 1" tail the owner screenshotted.
      const temperature = req.temperature ?? 0.7;
      const topK = req.topK ?? 20;
      const topP = req.topP ?? 0.95;
      const repetitionPenalty = req.repetitionPenalty ?? 1.1;
      // LET THE MODEL THINK. The chat template opens `<think>` for us (Bonsai is a reasoning
      // model), and the default used to force-close the block at half of maxTokens on the
      // theory that a reader should not sit watching raw reasoning.
      //
      // That default was actively producing the bad output. Force-closing lands MID-THOUGHT:
      // `</think>` is injected while the model is still reasoning, and everything after it —
      // the "answer" — is just leftover chain-of-thought. Measured on real weights 2026-07-26
      // at budget 48 and again at 160:
      //   "and then cuts off. Wait, the prompt actually *is* the whole thing: ... 2. **Analyze
      //    the Request:**"                                    <- reasoning, presented as the answer
      // while the SAME pipeline with room to finish returned:
      //   "The capital of France is Paris."                   <- correct
      // The interruption was the defect, not the thinking.
      //
      // So do not cap by default: the model reasons until it emits `</think>` itself, and the
      // generation loop's own maxTokens remains the only bound. A caller that genuinely wants
      // a cap can still pass `reasoningBudget` explicitly. The UI already streams reasoning to
      // its own channel, so the reader is not left staring at a blank bubble.
      //
      // BUT `?? maxTokens` MADE THE FORCE-CLOSE UNREACHABLE, and that was the real defect.
      // The loop runs `while (produced < maxTokens)`, increments, then force-closes on
      // `produced >= reasoningBudget`. With the two equal, that condition can only be true on
      // the final iteration — at which point there is no budget left to answer with. So the
      // block was never closed in time, generation ended mid-thought, and the `reply ||
      // thinkText` fallback below rendered raw chain-of-thought AS THE ANSWER. That is the
      // whole of what looked like "the model babbles at long prompts".
      //
      // PROVEN 2026-07-26 against llama.cpp on the IDENTICAL Bonsai-27B Q1_0 weights this
      // runtime downloads, greeter-length system prompt, temp 0.7 / topP 0.95 / topK 20:
      //   max_tokens=256  -> finish=length, content EMPTY        (truncated mid-think)
      //   max_tokens=1024 -> finish=stop, 652 completion tokens,
      //                      2428 chars of clean reasoning, then
      //                      "Paris! Let me know if you'd like to explore anything else."
      // The model is COHERENT. It simply spends ~650 tokens thinking about a trivial question
      // once a system prompt is present, and we were cutting it off at 768 with no reserve.
      //
      // So: still do not cap thinking by default — but always keep a reserve the model can
      // actually answer in. Thinking that produces no answer is indistinguishable from a
      // broken model to the person reading it.
      const ANSWER_RESERVE = 128;
      const reasoningBudget = req.reasoningBudget
        ?? Math.max(32, maxTokens - ANSWER_RESERVE);

      // META-QUESTION STEERING — "how do you know that?" must not re-run the
      // tool. The memo holds the PREVIOUS turn's tool results (the page's own
      // history never sees tool turns, only the final answer text), so the model
      // gets told it already knows the answer instead of being left to re-invoke
      // the tool that produced it. Measured live 2026-09-01: without this, "how
      // do you know that?" after a get_current_time answer called the tool again
      // and repeated the time, twice.
      const guidedMessages = steerMetaQuestion(req.messages, lastToolResults);
      // A fresh turn consumes the memo (the steer above already baked it into
      // guidedMessages). The same-turn follow-up generation ends with a `tool`
      // message, so it keeps the memo for the recursion.
      if (req.messages[req.messages.length - 1]?.role !== "tool") lastToolResults = [];

      // Encode the prompt with optional tools
      const promptIds = tokenizer.encodeChat(guidedMessages, req.tools);
      const promptLen = promptIds.length;

      // KV CAPACITY IS SIZED TO THIS TURN, NOT TO A CONSTANT.
      //
      // This was a flat 2048 slots, which is invisible on the 27B hybrid (only 16 of its 64
      // layers carry KV) and ruinous on a DENSE model, where EVERY layer does. Bonsai-1.7B:
      // 28 layers x 2 (K+V) x 2048 x 8 kv-heads x 128 dim x 4B = 448 MB of KV for a 236 MB
      // model — more than the weights, and enough to fail allocation on the phones this
      // small size exists to serve. Sizing to (prompt + maxTokens + 1) makes a 512-token
      // greeter turn cost ~112 MB instead.
      //
      // +1 for the `</think>` this loop may FEED itself when the reasoning budget runs out.
      // The ceiling still exists: attention reading past the filled region corrupts a
      // conversation with no error, so overrun stays a loud failure.
      const KV_CEILING = 8192;

      /*
       * HEADROOM, ONLY WHEN CROSS-TURN REUSE IS ON.
       *
       * Sizing capacity to exactly (prompt + maxTokens + 1) makes reuse IMPOSSIBLE
       * rather than merely unlikely: turn 2's prompt has grown by turn 1's reply
       * plus the new question, so it needs more positions than turn 1 allocated
       * and the planner correctly refuses every time.
       *
       * MEASURED on the real 1.7B on a 5090, 2026-07-31, before this existed:
       *   "prefix reuse: none — turn needs 86 positions but the cache holds 45"
       * The equivalence check then PASSED vacuously, because both arms had done
       * full prefills and "identical output" proved nothing. The feature was inert
       * by construction and every unit test still passed — only a real run on real
       * hardware could show it.
       *
       * The headroom is the growth between turns (a reply plus a question), NOT
       * another maxTokens: capacity is allocated up front and maxTokens is a
       * ceiling that is rarely reached, so reserving it twice would double a cost
       * the existing sizing comment already calls ruinous on a dense model
       * (~224 KB per position when every layer carries KV).
       *
       * Charged ONLY when reuse is enabled, so a device that never turns it on
       * pays exactly what it did before.
       */
      const reuseEnabled =
        (globalThis as { __BONSAI_PREFIX_DISABLE?: boolean }).__BONSAI_PREFIX_DISABLE !== true;

      /*
       * HEADROOM IS WHAT THE DEVICE CAN AFFORD, NOT A CONSTANT.
       *
       * This was a flat `REUSE_HEADROOM = 512`, and measured live on 2026-07-31 that made
       * cross-turn reuse INERT in production rather than merely unlikely:
       *
       *   [bonsai] prefix reuse: none — turn needs 2822 positions but the cache holds 2232
       *
       * The greeter sends a ~1290-token prompt with maxTokens 1536, so turn 2's prompt has
       * grown by turn 1's reply plus the new question — past 512 — and the planner correctly
       * refused EVERY turn. The feature shipped switched on, every unit test passed, and it
       * never once did anything; the visible cost is a full ~1285-token re-prefill (~4.5 s)
       * on every single reply.
       *
       * Raising the constant is not the fix: KV costs ~288 KB/position on the dense 4B and
       * ~224 KB on the 1.7B, so another full maxTokens of headroom is ~450 MB — nothing on a
       * 5090, fatal on the phones the small sizes exist to serve. planKvCapacity() asks for
       * what a follow-up turn actually needs and grants only what a memory budget affords,
       * and it can never allocate MORE than the turn already required — so a constrained
       * device gets byte-identical behaviour to the old constant.
       */
      const { kvBytesPerPosition, kvBudgetBytes, planKvCapacity } =
        await import("../model/kv-capacity");
      // KV MODE — which cache layout this turn uses. Resolved BEFORE the capacity plan
      // because the 4-bit cache costs 0.5 B/element instead of 4, and the headroom math
      // must charge the right number. Defaults to 'f32'; `?kv=4bit` / `__BONSAI_KV` /
      // localStorage `bonsai_kv` opt in (resolveKvMode throws on an unknown value rather
      // than silently running F32).
      const { resolveKvMode, supports4bitKv } = await import("../model/kvcache");
      // HEAD_DIM CAPABILITY GATE.
      //
      // kv_quant_4bit.wgsl runs one 128-lane workgroup per row with ONE dim per lane, so a
      // head_dim > 128 would leave the tail of every row unquantized; KvCache's ctor throws
      // rather than half-pack it. That throw is right, and it is also FATAL on the flagship:
      // the 27B hybrid is head_dim=256, and its ctor comment ("every Bonsai size is
      // head_dim=128 today") is simply false for it. So once 4-bit became the DEFAULT
      // (c042520b3f) every 27B turn died with `bonsai-kv: ... got 256`.
      //
      // Measured live on aitherium.com 2026-08-14: the 27B downloads all 3.8 GB, reports
      // `ready`, and then generate is the ONLY thing that fails — the picker offers a model
      // that cannot answer, after the most expensive download in the family. `?kv=f32` was
      // proven to get the same model into prefill, so f32 is not a new path, it is the one
      // this model has always needed.
      //
      // Hence a capability DOWNGRADE, not a failure: take 4-bit where the kernel supports
      // the row width, fall back to the f32 cache where it does not. An explicitly
      // requested mode is still honoured for f32; only the unsupported 4-bit is downgraded.
      const headDim = config.keyLength ?? config.embeddingLength / config.headCount;
      const kv4bitSupported = supports4bitKv(headDim);
      const kvModeRequested = resolveKvMode();
      const kvMode: typeof kvModeRequested =
        kvModeRequested === "4bit" && !kv4bitSupported ? "f32" : kvModeRequested;
      if (kvMode !== kvModeRequested) {
        // Logged every turn it engages: a silent downgrade is how a perf feature quietly
        // stops applying to the one model it was measured on.

        console.log(
          `[bonsai] kv: 4-bit unsupported at head_dim=${headDim} (kernel row width is 128) ` +
            `— falling back to the f32 cache for this model`,
        );
      }
      const kvBytesPerElement = kvMode === "4bit" ? 0.5 : 4.0;
      const kvPlan = planKvCapacity({
        promptLen,
        maxTokens,
        ceiling: KV_CEILING,
        bytesPerPosition: kvBytesPerPosition({
          fullAttnLayerCount: config.fullAttnLayers.length,
          headCountKv: config.headCountKv,
          headDim,
        }, kvBytesPerElement),
        // `navigator.deviceMemory` is coarse and absent outside Chromium; kvBudgetBytes
        // falls back to a conservative floor rather than assuming a big machine.
        budgetBytes: kvBudgetBytes(
          (globalThis as { navigator?: { deviceMemory?: number } }).navigator?.deviceMemory,
        ),
        reuseEnabled,
      });
      const KV_CAPACITY = kvPlan.capacity;
      // Logged every turn: an inert reuse feature is invisible otherwise, which is exactly
      // how the 512 constant survived shipping.
      console.log(`[bonsai] kv capacity ${KV_CAPACITY} — ${kvPlan.reason}`);
      if (promptLen + maxTokens + 1 > KV_CEILING) {
        return post({
          type: "error",
          message:
            `context too long: prompt ${promptLen} + maxTokens ${maxTokens} > ${KV_CEILING} KV slots. ` +
            `Shorten the prompt or lower maxTokens (in-browser Bonsai is capped at ${KV_CEILING} tokens).`,
        });
      }

      // Import runtime types
      const { F32KvCache } = await import("../model/kv_f32");
      const { KvCache } = await import("../model/kvcache");
      const { SsmState } = await import("../model/ssm_state");
      const { f32Buffer, sampleToken, sampleTiming } = await import("../model/ops");
      // Per-TURN attribution, so a long turn's average is not diluted by a previous one.
      sampleTiming.readbackMs = 0; sampleTiming.selectMs = 0; sampleTiming.calls = 0;
      const { prefill, decodeStep } = await import("../model/forward");
      const { embedTokens } = await import("../model/embed_lmhead");

      // ── CROSS-TURN PREFIX REUSE ──────────────────────────────────────────
      // In a chat the prompt is [system][user1][assistant1][user2]; the first
      // three are byte-identical to what the model processed last turn, and
      // prefill is the expensive half. Reusing that prefix stops the model
      // re-reading the conversation from the beginning on every reply.
      //
      // FAIL-CLOSED BY CONSTRUCTION: the module cache is taken and CLEARED here,
      // and only re-established after a turn completes. Every error, abort and
      // early return therefore leaves it null, so the next turn does a full
      // prefill without any of those paths needing to know this feature exists.
      const { planReuse, committedTokens, cacheSignature } =
        await import("../model/prefix-cache");
      const prior = PREFIX_CACHE;
      PREFIX_CACHE = null;

      const headDimForKv = config.keyLength ?? config.embeddingLength / config.headCount;
      const signature = cacheSignature({
        modelId: currentModelId || "unknown",
        quantType: String(weights.weightQuantType()),
        blockCount: config.blockCount,
        embeddingLength: config.embeddingLength,
        headCountKv: config.headCountKv,
        headDim: headDimForKv,
        linearAttnLayerCount: config.linearAttnLayers.length,
        kvMode,
      });

      // Truncation is exact for attention (position t's K/V depend only on token
      // t) and IMPOSSIBLE for a recurrent state, which folds every token into one
      // running value with no inverse. Any linear-attn layer forbids it.
      const canTruncate = config.linearAttnLayers.length === 0;

      const plan = planReuse({
        // A cache built on a different GPUDevice holds dead buffers.
        cache: prior && prior.device === device ? prior : null,
        promptIds,
        signature,
        maxNewTokens: maxTokens,
        canTruncate,
        // ON by default — VERIFIED ON HARDWARE 2026-07-31.
        //
        // Two-arm equivalence check (selftest/PREFIX-REUSE-VERIFY.md, ?prefixcheck=1)
        // on the real Bonsai-1.7B, greedy, headless Chrome over CDP on an NVIDIA
        // Blackwell adapter: turn 2 reused 16 of 61 tokens and produced
        // BYTE-IDENTICAL output to the full-prefill arm. Turn 1 (nothing cached,
        // both paths the same code) also matched, which is what proves the harness
        // rather than the feature.
        //
        // The first run of that check PASSED VACUOUSLY — "turn needs 86 positions
        // but the cache holds 45" meant reuse never engaged and both arms did full
        // prefills. Only the log line showed it. That is why the verify doc leads
        // with "a run whose turn 2 logs `none` has tested nothing".
        //
        // STILL UNVERIFIED: the hybrid/DeltaNet path (27B), which has recurrent
        // state and takes the stricter extend-only branch. It is guarded by
        // planReuse refusing to truncate a state that cannot be rewound, but no
        // equivalence run has covered it.
        //
        // __BONSAI_PREFIX_DISABLE = true remains the kill switch, read fresh each
        // turn so it can be flipped from the page between generations.
        disabled:
          (globalThis as { __BONSAI_PREFIX_DISABLE?: boolean }).__BONSAI_PREFIX_DISABLE === true,
      });

      // Build contexts — REUSING the live buffers when the plan says we may.
      const reusing = plan.mode === "extend" && prior !== null;
      // KV layout: F32 (default) or the gated 4-bit cache. Both implement the SAME
      // append/advance/truncate/reset surface (KvLike), so the rest of this function —
      // reuse, prefill, decode, PREFIX_CACHE — is mode-agnostic. The 4-bit KvCache needs
      // the PipelineCache (its append() dispatches kv_quant_4bit); F32KvCache does not.
      const kv = reusing
        ? prior!.kv
        : kvMode === "4bit"
          ? new KvCache(device as any, {
              fullAttnLayers: config.fullAttnLayers,
              headCountKv: config.headCountKv,
              headDim: headDimForKv,
              capacity: KV_CAPACITY, // guarded above; TODO: configurable context length
            }, pipelines)
          : new F32KvCache(device as any, {
              fullAttnLayers: config.fullAttnLayers,
              headCountKv: config.headCountKv,
              headDim: headDimForKv,
              capacity: KV_CAPACITY, // guarded above; TODO: configurable context length
            });

      // DeltaNet state geometry: one [headDim × headDim] matrix per v-head (NOT per attn
      // head). Bonsai-27B: 48 v-heads, headDim=128 → 48·128·128 f32 per layer.
      //
      // A DENSE model (Bonsai 1.7B/4B/8B — stock qwen3) has NO DeltaNet layers and no ssm.*
      // geometry, so `config.deltaNet` is undefined and there is nothing to allocate.
      // SsmState with an empty layer list allocates no buffers and reset() is a no-op, so
      // the zero-geometry construction below is inert rather than a zero-sized-buffer trap.
      const dn = config.deltaNet;
      // Reused as the SAME INSTANCE on purpose. block_deltanet keys its causal-conv
      // history on this object plus SsmState.generation, re-zeroing when generation
      // moves; keeping the instance AND not calling reset() is exactly what carries
      // that history forward, which is what a continued prefix needs. Constructing a
      // fresh one here would silently discard the recurrent state we are reusing.
      const ssmState = reusing
        ? prior!.ssm
        : new SsmState(device as any, {
            linearAttnLayers: config.linearAttnLayers,
            heads: dn?.numVHeads ?? 0,
            dK: dn?.headDim ?? 0,
            dV: dn?.headDim ?? 0,
            dConv: dn?.convKernel,
            ssmInnerSize: dn?.vDim,
            // Conv runs over q+k+v (10240), not just v (6144) — see SsmState.convDim.
            convDim: dn?.convDim,
          });
      if (!dn && config.linearAttnLayers.length > 0) {
        // Belt and braces: linear-attn layers with no geometry to run them would otherwise
        // reach block_deltanet and read heads=0. Fail at load, where the message is useful.
        throw new Error(
          `bonsai-worker: ${config.linearAttnLayers.length} DeltaNet layers were classified ` +
            `but the model exposes no ssm.* geometry — refusing to run them with zero dims.`,
        );
      }

      // Reset caches for the new generation — but NOT when continuing a prefix.
      //
      // reset() on SsmState bumps `generation`, which is the signal block_deltanet
      // uses to re-zero its conv history. Calling it here would throw away the very
      // state this turn intends to continue from. truncate() drops KV positions
      // past the reused prefix (exact for attention); for a recurrent model the
      // planner guarantees reuseLen === the full cached length, so it is a no-op
      // there and the state stays consistent with the KV.
      if (reusing) {
        kv.truncate(plan.reuseLen);
      } else {
        kv.reset();
        ssmState.reset();
      }

      // A wiring mistake here yields fluent, WRONG output rather than an error —
      // the failure mode block_deltanet's conv-history leak already demonstrated.
      // Since this path cannot be exercised without a WebGPU device, assert the
      // one property that catches it: the cache must start exactly where the
      // partial prefill begins.
      if (kv.filledLength() !== plan.reuseLen) {
        throw new Error(
          `bonsai-prefix: KV length ${kv.filledLength()} != planned reuse ${plan.reuseLen} — `
          + "refusing to prefill at a position the cache does not end on",
        );
      }

      const prefillIds = plan.prefillIds;
      if (plan.savedTokens > 0) {
        console.log(
          `[bonsai] prefix reuse: ${plan.savedTokens}/${promptLen} tokens reused `
          + `(${plan.reason}); prefilling ${prefillIds.length}`,
        );
      } else {
        console.log(`[bonsai] prefix reuse: none — ${plan.reason}`);
      }

      // Sized to what we ACTUALLY prefill, not the whole prompt.
      const hiddenBuffer = f32Buffer(device as any, prefillIds.length * config.embeddingLength, "hidden_prefill");

      // Create layer context carrying whichever cache the mode resolved to. `kvMode` tells
      // the attention body (block_full_attn.ts) HOW to append + whether to pass scale
      // buffers; the cache object itself satisfies the shared KvLike surface so the
      // forward pass is identical in both modes.
      // quantType comes from the FILE (weights.weightQuantType() reads the GGUF header and
      // throws on a mixed-quant model). Omitting it silently defaults every block matmul to
      // the Q1_0 kernel, which on a Q2_0 model reads 34-byte blocks at the 18-byte stride
      // and emits fluent garbage rather than failing.
      const quantType = weights.weightQuantType();
      const ctx = {
        device,
        pipelines,
        weights,
        config,
        kv,
        kvMode,
        ssm: ssmState,
        quantType,
      };

      // Prefill phase: embed all prompt tokens and run all blocks
      post({ type: "progress", progress: 10, file: `prefill ${promptLen} tokens (running ${config.blockCount} layers)` });
      const prefillStart = Date.now();
       
      console.log(`[bonsai] prefill start: ${promptLen} tokens × ${config.blockCount} layers`);
      const prefillResult = await prefill(ctx, hiddenBuffer, prefillIds, tokenizer, (l, total) => {
        // First generation streams weights layer-by-layer; surface it so the UI isn't blank.
        post({ type: "progress", progress: 10 + Math.floor((l / total) * 30), file: `warming layer ${l + 1}/${total}` });
      // posBase: these tokens sit at absolute positions [reuseLen, promptLen). RoPE
      // rotates by absolute position and attention bounds causality on it, so a 0
      // here would rotate a continuation as if it began the conversation.
      }, plan.reuseLen);

      // After prefill the cache must cover the WHOLE prompt, or decode's
      // `pos = promptLen` would write past a hole.
      if (kv.filledLength() !== promptLen) {
        throw new Error(
          `bonsai-prefix: after prefill KV length ${kv.filledLength()} != prompt ${promptLen}`,
        );
      }
      const prefillMs = Date.now() - prefillStart;
       
      console.log(`[bonsai] prefill done in ${prefillMs}ms (${(prefillMs / promptLen).toFixed(0)}ms/token)`);

      // Dump the actual logit DISTRIBUTION, not just the token it picks.
      //
      // 🚨 THIS WAS RUN ON 2026-08-14 AND IT ANSWERED THE QUESTION. The paragraph below used
      // to end "NOTHING so far has looked at that distribution" and then list three
      // hypotheses; leaving that standing sent the next reader to the lm-head matmul, which
      // was never the bug. Keep the probe — it is how the answer was found — but read the
      // verdict first.
      //
      // Measured, 1.7B on the deployed bundle, greedy, prompt "capital of France":
      //   kv=4bit  max 12.408  sd 2.12  margin(top1-top2) 1.26  -> "? ? ? ?"
      //   kv=f32   max 26.630  sd 3.10  margin(top1-top2) 7.13  -> "Paris"
      // and the STOP ids sat at 1.49 / 2.31, nowhere near winning.
      //
      // So against the three hypotheses: it was NOT a noise head (the spread is healthy and
      // bad=0), NOT a privileged stop id (the stops lose by ~11), and NOT semantically lost —
      // on the second probe the right answers were all PRESENT but swamped (" Paris", "Paris",
      // " French", " la", " Dans" all elevated, buried under low-id punctuation). A sharp,
      // correctly-ordered distribution appears the moment the KV cache stops being 4-bit.
      //
      // The head was always fine; its INPUT was degraded. Fixed by defaulting kv to f32
      // (see resolveKvMode). If a future salad reappears, run this probe FIRST and compare
      // the margin — a collapse of the winning margin means "attention input", not "head".
      if (bonsaiDebugEnabled()) {
        const { readbackF32 } = await import("../model/ops");
        const row = await readbackF32({ device: device as any, pipelines }, prefillResult.logits, tokenizer.vocabSize);
        let mn = Infinity, mx = -Infinity, sum = 0, bad = 0;
        for (let i = 0; i < row.length; i++) {
          const v = row[i];
          if (!Number.isFinite(v)) { bad++; continue; }
          if (v < mn) mn = v;
          if (v > mx) mx = v;
          sum += v;
        }
        const mean = sum / row.length;
        let varSum = 0;
        for (let i = 0; i < row.length; i++) {
          const v = row[i];
          if (Number.isFinite(v)) varSum += (v - mean) * (v - mean);
        }
        const sd = Math.sqrt(varSum / row.length);
        // top-32 by bounded selection (a full sort of 248320 would dominate the step)
        const K = 32;
        const top: number[] = [];
        let worst = -Infinity;
        for (let i = 0; i < row.length; i++) {
          const v = row[i];
          if (top.length === K && v <= worst) continue;
          let j = top.length;
          while (j > 0 && row[top[j - 1]] < v) j--;
          top.splice(j, 0, i);
          if (top.length > K) top.pop();
          worst = row[top[top.length - 1]];
        }
        const fmt = top.map((id) => {
          const s = tokenizer.decode([id]).replace(/\n/g, "\\n").slice(0, 14);
          return `${id}:${row[id].toFixed(3)}"${s}"`;
        });
         
        console.log(
          `[bonsai] LOGITS vocab=${row.length} bad=${bad} min=${mn.toFixed(3)} max=${mx.toFixed(3)} ` +
          `mean=${mean.toFixed(4)} sd=${sd.toFixed(4)} margin(top1-top2)=${(row[top[0]] - row[top[1]]).toFixed(4)}`,
        );
         
        console.log(`[bonsai] LOGITS_TOP32 ${fmt.join(" ")}`);
         
        console.log(
          `[bonsai] LOGITS_STOPS ${[...tokenizer.stopIds].map((id) => `${id}=${row[id]?.toFixed(3)}`).join(" ")}`,
        );
      }

      // PREFILL SELF-CONSISTENCY — does prefill(N) agree with prefill(N-1) on the
      // tokens they SHARE?
      //
      // Why this test exists: injecting prefill's exact block-2 row into the decode path did
      // NOT reduce block 3's divergence (96% before, 96% after). So block 3's error does not
      // arrive through its hidden input — and the only other thing it reads is the KV cache,
      // whose earlier entries were written by prefill(N-1) in one path and prefill(N) in the
      // other. For a causal model those must be identical.
      //
      // If they are not, the defect is not in decodeStep at all: prefill has an N-dependence,
      // every incremental scheme built on it is unsound, and that single fact explains both
      // the block-2 divergence and the block-3 explosion.
      //
      // No decode step involved — this compares two prefills at the last SHARED position.
      if ((globalThis as { __BONSAI_PREFILL_DIFF?: boolean }).__BONSAI_PREFILL_DIFF === true && promptLen >= 3) {
        const gp = globalThis as {
          __BONSAI_CAPTURE_TAG?: string;
          __BONSAI_CAPTURE_POS?: number;
          __BONSAI_ROWS?: Record<string, Float32Array>;
        };
        const sharedPos = promptLen - 2; // last token common to both prefills
        gp.__BONSAI_ROWS = {};
        gp.__BONSAI_CAPTURE_POS = sharedPos;

        kv.reset(); ssmState.reset();
        gp.__BONSAI_CAPTURE_TAG = "PN";
        const hPN = f32Buffer(device as any, promptLen * config.embeddingLength, "hidden_pN");
        await prefill(ctx, hPN, promptIds, tokenizer);

        kv.reset(); ssmState.reset();
        gp.__BONSAI_CAPTURE_TAG = "PM";
        // DETERMINISM CONTROL. Before concluding "prefill is not causal", prove prefill is
        // even REPEATABLE: run the SAME token list twice and diff. If that is not
        // bit-identical then the divergence is nondeterminism — a race, or lazy weight
        // streaming (`weights.ensureLayer`) resolving differently on a cold vs warm pass —
        // and the token count is a red herring. This costs one extra prefill and is the
        // control that should have run before any of the causality analysis.
        const sameN = (globalThis as { __BONSAI_DETERMINISM?: boolean }).__BONSAI_DETERMINISM === true;
        const shortIds = sameN ? promptIds : promptIds.slice(0, -1); // N-1 tokens; its LAST token is sharedPos
        if (sameN) {
           
          console.log(`[bonsai] DETERMINISM CONTROL: both runs use the SAME ${promptLen} tokens; expect 0 differing everywhere`);
        }
        const hPM = f32Buffer(device as any, shortIds.length * config.embeddingLength, "hidden_pM");
        await prefill(ctx, hPM, shortIds, tokenizer);
        // THIRD run, only for the determinism control: A is COLD (it streams ~50 MB/layer of
        // weights over HTTP via ensureLayer); B and C are both WARM. That discriminates:
        //   A != B but B == C  -> a cold/warm weight-streaming race; run A computed on
        //                         weights that had not finished uploading
        //   A != B and B != C  -> a genuine race that recurs on every run
        if (sameN) {
          kv.reset(); ssmState.reset();
          gp.__BONSAI_CAPTURE_TAG = "PC";
          const hPC = f32Buffer(device as any, promptLen * config.embeddingLength, "hidden_pC");
          await prefill(ctx, hPC, promptIds, tokenizer);
        }
        gp.__BONSAI_CAPTURE_TAG = undefined;
        gp.__BONSAI_CAPTURE_POS = undefined;

        const rws = gp.__BONSAI_ROWS ?? {};
        if (sameN) {
          for (let l = 0; l < config.blockCount; l++) {
            const rb = rws[`PM:${l}`], rc = rws[`PC:${l}`];
            if (!rb || !rc || rb.length !== rc.length) continue;
            let maxAbs = 0, sumAbs = 0, sumB = 0, nz = 0;
            for (let i = 0; i < rb.length; i++) {
              const d = Math.abs(rb[i] - rc[i]);
              if (d > maxAbs) maxAbs = d;
              sumAbs += d; sumB += Math.abs(rb[i]);
              if (d > 1e-6) nz++;
            }
             
            console.log(
              `[bonsai] WARMDIFF L${l} kind=${config.layerKinds[l]} maxAbs=${maxAbs.toExponential(3)} ` +
              `relative=${(sumAbs / (sumB || 1)).toExponential(3)} differing=${nz}/${rb.length}`,
            );
          }
        }
        for (let l = 0; l < config.blockCount; l++) {
          const ra = rws[`PN:${l}`], rb = rws[`PM:${l}`];
          if (!ra || !rb || ra.length !== rb.length) continue;
          let maxAbs = 0, sumAbs = 0, sumA = 0, nz = 0;
          for (let i = 0; i < ra.length; i++) {
            const d = Math.abs(ra[i] - rb[i]);
            if (d > maxAbs) maxAbs = d;
            sumAbs += d; sumA += Math.abs(ra[i]);
            if (d > 1e-6) nz++;
          }
           
          console.log(
            `[bonsai] PREFILLDIFF L${l} kind=${config.layerKinds[l]} pos=${sharedPos} ` +
            `maxAbs=${maxAbs.toExponential(3)} relative=${(sumAbs / (sumA || 1)).toExponential(3)} differing=${nz}/${ra.length}`,
          );
        }
        gp.__BONSAI_ROWS = {};
        kv.reset(); ssmState.reset();
        await prefill(ctx, hiddenBuffer, promptIds, tokenizer);
      }

      // PREFILL-vs-DECODE differential — the model checked against ITSELF.
      //
      // What remains after the tokenizer fix: prefill's logit distribution is
      // healthy and on-task, but generation degrades WITH POSITION. These two paths must
      // agree by construction — same weights, same math, same position:
      //   A: prefill(t0..tN)                       -> logits at position N
      //   B: prefill(t0..tN-1) then decodeStep(tN) -> logits at position N
      // Measured 2026-07-26 they do NOT: meanAbs 0.28-0.41 on logits of O(15) (~2-3%
      // relative, ~1000x larger than float reassociation) with decode systematically HIGHER.
      //
      // This also captures the hidden row after EVERY block from both paths and diffs them
      // ELEMENTWISE. The earlier meanabs-only version could not do that: meanabs is a
      // summary, so its "block 0 ratio = 1.000" did NOT prove block 0 was identical.
      //
      // Debug-gated: it costs two extra prefills and DESTROYS the KV/SSM state generation
      // needs, hence the restoring re-prefill at the end.
      if ((globalThis as { __BONSAI_DECODE_DIFF?: boolean }).__BONSAI_DECODE_DIFF === true && promptLen >= 2) {
        const { readbackF32 } = await import("../model/ops");
        const g = globalThis as { __BONSAI_CAPTURE_TAG?: string; __BONSAI_ROWS?: Record<string, Float32Array> };
        const vocab = tokenizer.vocabSize;
        g.__BONSAI_ROWS = {};

        // Path A: full prefill, capturing every block's last-token row.
        kv.reset(); ssmState.reset();
        g.__BONSAI_CAPTURE_TAG = "A";
        const hiddenA = f32Buffer(device as any, promptLen * config.embeddingLength, "hidden_diffA");
        const resA = await prefill(ctx, hiddenA, promptIds, tokenizer);
        const a = Array.from(await readbackF32({ device: device as any, pipelines }, resA.logits, vocab));

        // Path B: prefill N-1, then a single decode step for the same position.
        kv.reset(); ssmState.reset();
        g.__BONSAI_CAPTURE_TAG = undefined; // don't capture path B's prefill
        const headIds = promptIds.slice(0, -1);
        const hiddenB = f32Buffer(device as any, headIds.length * config.embeddingLength, "hidden_diffB");
        await prefill(ctx, hiddenB, headIds, tokenizer);
        // Optional injection: hand decode the PREFILL path's row after a chosen block, so
        // every later block sees a provably identical input (see __BONSAI_INJECT).
        const injLayer = (globalThis as { __BONSAI_INJECT_LAYER?: number }).__BONSAI_INJECT_LAYER;
        if (typeof injLayer === "number" && Number.isFinite(injLayer)) {
          const srcRow = (g.__BONSAI_ROWS ?? {})[`A:${injLayer}`];
          if (srcRow) {
            (globalThis as { __BONSAI_INJECT?: { layer: number; row: Float32Array } }).__BONSAI_INJECT =
              { layer: injLayer, row: srcRow };
             
            console.log(`[bonsai] INJECT armed at L${injLayer}`);
          }
        }
        g.__BONSAI_CAPTURE_TAG = "B"; // capture ONLY the decode step
        const decHidden = f32Buffer(device as any, config.embeddingLength, "hidden_diffDec");
        await embedTokens(ctx, [promptIds[promptLen - 1]], decHidden, weights, config.embeddingLength);
        const resB = await decodeStep(ctx, decHidden, promptLen - 1, tokenizer);
        const b = Array.from(await readbackF32({ device: device as any, pipelines }, resB.logits, vocab));
        g.__BONSAI_CAPTURE_TAG = undefined;

        // ---- elementwise per-block divergence: where do the paths FIRST differ? ----
        const rows = g.__BONSAI_ROWS ?? {};
        for (let l = 0; l < config.blockCount; l++) {
          const ra = rows[`A:${l}`], rb = rows[`B:${l}`];
          if (!ra || !rb || ra.length !== rb.length) continue;
          let maxAbs = 0, sumAbs = 0, sumA = 0, nz = 0;
          for (let i = 0; i < ra.length; i++) {
            const d = Math.abs(ra[i] - rb[i]);
            if (d > maxAbs) maxAbs = d;
            sumAbs += d;
            sumA += Math.abs(ra[i]);
            if (d > 1e-6) nz++;
          }
           
          console.log(
            `[bonsai] BLOCKDIFF L${l} kind=${config.layerKinds[l]} maxAbs=${maxAbs.toExponential(3)} ` +
            `meanAbs=${(sumAbs / ra.length).toExponential(3)} relative=${(sumAbs / (sumA || 1)).toExponential(3)} differing=${nz}/${ra.length}`,
          );
        }

        let maxAbsL = 0, sumAbsL = 0, badB = 0;
        for (let i = 0; i < vocab; i++) {
          if (!Number.isFinite(b[i])) { badB++; continue; }
          const d = Math.abs(a[i] - b[i]);
          if (d > maxAbsL) maxAbsL = d;
          sumAbsL += d;
        }
        const argmax = (arr: number[]) => { let bi = -1, bv = -Infinity; for (let i = 0; i < vocab; i++) if (Number.isFinite(arr[i]) && arr[i] > bv) { bv = arr[i]; bi = i; } return bi; };
         
        console.log(
          `[bonsai] DECODE_DIFF pos=${promptLen - 1} maxAbs=${maxAbsL.toFixed(4)} meanAbs=${(sumAbsL / vocab).toFixed(6)} ` +
          `nonFiniteB=${badB} argmaxA=${argmax(a)} argmaxB=${argmax(b)} argmaxAgree=${argmax(a) === argmax(b)}`,
        );

        (globalThis as { __BONSAI_INJECT?: unknown }).__BONSAI_INJECT = undefined;
        g.__BONSAI_ROWS = {};
        // Restore the state generation expects: a clean prefill of the FULL prompt.
        kv.reset(); ssmState.reset();
        await prefill(ctx, hiddenBuffer, promptIds, tokenizer);
      }

      // Allocate a small hidden buffer for decode steps (1 × embeddingLength)
      const decodeHidden = f32Buffer(device, config.embeddingLength, "hidden_decode");

      // Only sampling runs through this one (no matmul), but it carries quantType anyway:
      // an OpCtx without it defaults to the Q1_0 kernel, so the day someone adds a
      // projection here the bug is a silently wrong answer, not an error.
      const opCtx = { device: device as any, pipelines, quantType };
      // PER-PHASE DECODE TIMING (`?timing=1` in the harness → __BONSAI_TIMING).
      // The tok/s clustering across sizes (4B 6.3 / 8B 6.5 / 27B 4.1 — near-identical
      // despite 6.6x the weights) says a fixed per-token cost dominates, not compute. The
      // three candidates are the embed round-trip, the per-layer submits inside decodeStep,
      // and the 600 KB logits readback in sampleToken. Which one is a MEASUREMENT, and this
      // is the probe that answers it — phase wall-time between the awaits, which are
      // exactly the CPU-GPU sync points, so the numbers mean what they look like.
      const TIMING = (globalThis as { __BONSAI_TIMING?: boolean }).__BONSAI_TIMING === true;
      // Pace the decode loop on a phone. Read ONCE per generation rather than per token:
      // it cannot change mid-turn, and isMobileDevice() reads navigator on every call.
      //
      // Deliberately the same predicate the dispatch cap uses, not a second opinion about
      // what a phone is -- two copies of "is this mobile?" drifting apart is exactly what
      // BIH004 exists to catch (iPadOS sends a DESKTOP Safari UA, so a plain regex misses
      // every modern iPad; the shared helper handles that and a fresh one would not).
      const MOBILE_PACING = isMobileDevice();
      const phaseMs = { embed: 0, forward: 0, sample: 0, tokens: 0 };
      /**
       * Every id that goes through the model, in order — the authoritative record
       * of what the KV and recurrent state have absorbed.
       *
       * Taken HERE rather than from answerIds/thinkIds, because those are filtered
       * (think tags are dropped as structure) and a filtered list would describe a
       * state that does not exist. Next turn's reuse is decided by comparing this
       * against the new prompt, so an inaccurate record is silent corruption.
       */
      const fedIds: number[] = [];

      /** Feed one token through the model and return the logits for the NEXT position. */
      const feed = async (id: number, pos: number) => {
        fedIds.push(id);
        const t0 = TIMING ? performance.now() : 0;
        await embedTokens(ctx, [id], decodeHidden, weights, config.embeddingLength);
        const t1 = TIMING ? performance.now() : 0;
        const out = (await decodeStep(ctx, decodeHidden, pos, tokenizer)).logits;
        // DRAIN THE QUEUE ONCE PER TOKEN -- under TIMING for attribution, and on MOBILE
        // because otherwise the device stops responding.
        //
        // The encoders return as soon as work is QUEUED, not executed, so without this the
        // queue depth grows with the token count and the compositor's next frame waits
        // behind all of it. The dispatch cap (#6003) splits one packet into several; it
        // does not make anything WAIT for them. Both halves are needed: the cap bounds how
        // long a single packet occupies the GPU, this bounds how many are outstanding.
        //
        // The cost is real and is the same one the TIMING comment names -- it serialises
        // CPU and GPU. On a phone that is the right trade for a different reason than
        // attribution: the complaint was never throughput, it was a device that answered
        // correctly and locked up while doing it.
        if (TIMING || MOBILE_PACING) {
          await (device as unknown as { queue: { onSubmittedWorkDone(): Promise<void> } }).queue.onSubmittedWorkDone();
        }
        if (TIMING) {
          phaseMs.embed += t1 - t0;
          phaseMs.forward += performance.now() - t1;
          phaseMs.tokens++;
        }
        return out;
      };

      // Streaming text is assembled by decoding the ACCUMULATED id list and emitting the
      // delta, never token-by-token: one BPE token is a byte fragment, so decoding it alone
      // splits multi-byte UTF-8 (every CJK/emoji glyph) into U+FFFD replacement characters.
      //
      // The delta must also stop at the last COMPLETE character. A token that finishes a
      // multi-byte sequence rewrites the U+FFFD the previous decode emitted, so the new
      // string is not a pure append of the old one — slicing blindly would emit garbage and
      // permanently corrupt the bubble (the stream is append-only). Holding back a trailing
      // partial character keeps every emitted prefix stable.
      const REPLACEMENT = "�";
      const stableText = (ids: number[]): string => {
        const s = tokenizer.decode(ids);
        let end = s.length;
        while (end > 0 && s[end - 1] === REPLACEMENT) end--; // trailing partial char: wait
        return s.slice(0, end);
      };
      const thinkIds: number[] = [];
      const answerIds: number[] = [];
      let thinkText = "";
      let answerText = "";
      const emit = (ids: number[], prev: string, channel: "thinking" | "answer") => {
        const next = stableText(ids);
        if (next.length > prev.length && next.startsWith(prev)) {
          post({ type: "token", text: next.slice(prev.length), channel });
          return next;
        }
        return next.length >= prev.length ? next : prev;
      };

      // TOOL MARKUP MUST NOT REACH THE ANSWER BUBBLE.
      //
      // `emit` posts each token the instant it exists, while tool calls were only parsed
      // AFTER the loop ended — so a reader watched `{"name":"get_current_time",...}
      // </tool_call>` type itself into the reply and only then got the real answer. The
      // parse was never wrong, it just ran too late to affect what was rendered, and a
      // stream is append-only so nothing can be taken back afterwards.
      //
      // So the answer channel is gated: post only the prefix that provably cannot be inside
      // a call, and hold the rest until it resolves. Completed calls are posted on their own
      // channel, so the UI can collapse them instead of losing them.
      //
      // `answerText` still accumulates the FULL text — it is what `reply` and the tool
      // orchestrator read. Only what is SHOWN is gated.
      const toolsActive = !!(req.tools && req.tools.length > 0);
      let answerShown = "";
      let toolSpansSent = 0;
      const emitAnswer = (ids: number[]): string => {
        const full = stableText(ids);
        const visible = visibleAnswerPrefix(full, toolsActive);
        if (visible.length > answerShown.length && visible.startsWith(answerShown)) {
          post({ type: "token", text: visible.slice(answerShown.length), channel: "answer" });
          answerShown = visible;
        }
        if (toolsActive) {
          const spans = completedToolSpans(full);
          for (let i = toolSpansSent; i < spans.length; i++) {
            post({ type: "token", text: spans[i], channel: "tool" });
          }
          toolSpansSent = spans.length;
        }
        return full;
      };

      // ARE WE ACTUALLY INSIDE A REASONING BLOCK? DERIVE IT FROM THE PROMPT.
      //
      // This was `tokenizer.thinkEndId !== undefined` — i.e. "the model HAS a </think>
      // token, therefore the prompt must have opened one". Two different places were
      // deciding the same thing independently: renderChatML() chooses whether to append
      // `<think>\n` (switchable via __BONSAI_NO_THINK_PREFILL), and this line assumed it
      // always did. When they disagree, generation starts in thinking mode with no block
      // open, and with `reasoningBudget = 0` the force-close below fires after exactly ONE
      // token — so the FIRST TOKEN OF EVERY ANSWER IS SWALLOWED into the thinking channel.
      //
      // Measured 2026-07-28 on the real Bonsai-4B: we returned "2  \n3  \n4  \n5" for
      // "count from 1 to 5" while llama.cpp returned "1  \n2  \n3  \n4  \n5" from the
      // byte-identical file — same formatting, missing the first token. Every trace showed
      // `think=1`. On another prompt the whole answer was one token long and vanished
      // entirely (`think=1 answer=0`).
      //
      // Scanning the prompt ids removes the assumption: we are inside a block iff the last
      // `<think>` in the prompt is not followed by a `</think>`. That cannot drift from
      // whatever the template did, because it reads the template's actual output.
      let inThink = false;
      if (tokenizer.thinkEndId !== undefined && tokenizer.thinkStartId !== undefined) {
        const lastOpen = promptIds.lastIndexOf(tokenizer.thinkStartId);
        const lastClose = promptIds.lastIndexOf(tokenizer.thinkEndId);
        inThink = lastOpen !== -1 && lastOpen > lastClose;
      }
      let forcedClose = false;
      const REPEAT_WINDOW = 64; // ids the repetition penalty looks back over
      const recent: number[] = []; // rolling window, kept at REPEAT_WINDOW without re-allocating

      let logits = prefillResult.logits;
      let pos = promptLen; // position the next fed token will occupy
      let produced = 0;
      let stopReason: "stop-token" | "max-tokens" | "interrupted" = "max-tokens";
      const decodeStartTime = Date.now();

      while (produced < maxTokens && !stopped) {
        const tS = TIMING ? performance.now() : 0;
        const id = await sampleToken(opCtx, logits, tokenizer.vocabSize, {
          temperature,
          topK,
          topP,
          repetitionPenalty,
          recentIds: recent,
        });
        if (TIMING) phaseMs.sample += performance.now() - tS;
        produced++;

        if (tokenizer.isStop(id)) { stopReason = "stop-token"; break; }

        recent.push(id);
        if (recent.length > REPEAT_WINDOW) recent.shift();

        // `</think>` is STRUCTURE, never content — drop it whatever the current state.
        // The guard used to be `inThink && id === thinkEndId`, which leaked the tag as
        // literal text in the common case: the reasoning budget force-closes the block
        // (setting inThink = false and feeding `</think>` through the model), the model
        // then emits its OWN `</think>` a few tokens later, and with inThink already false
        // that token fell through to the ANSWER channel. Measured 2026-07-26 on real
        // weights — every reply began "</think>\n\nThe capital of France is Paris...".
        if (id === tokenizer.thinkEndId) {
          inThink = false;
        } else if (id === tokenizer.thinkStartId) {
          // SYMMETRIC to the `</think>` rule above, and needed for the same reason: a think
          // tag is STRUCTURE, never content. `</think>` was already dropped unconditionally;
          // `<think>` was not, so when the model OPENED its own block the tag was rendered as
          // literal text at the top of the answer.
          //
          // Measured 2026-07-28 on the real Bonsai-1.7B with a plain (non-think-prefilled)
          // prompt: replies came back as "<think>\n\n\nParis." — the answer was right, with
          // the opening tag printed. Bonsai is a reasoning model, so given a prompt that does
          // NOT pre-open the block it opens one itself; the 4B does not, which is why testing
          // a single size would have missed this.
          inThink = true;
        } else if (inThink) {
          thinkIds.push(id);
          thinkText = emit(thinkIds, thinkText, "thinking");
        } else {
          answerIds.push(id);
          answerText = emitAnswer(answerIds);
        }

        logits = await feed(id, pos++);

        // Out of reasoning budget and still thinking: close the block the way llama.cpp does
        // — feed `</think>` through the model so the KV stays consistent, then let it answer.
        if (inThink && !forcedClose && tokenizer.thinkEndId !== undefined && produced >= reasoningBudget) {
          forcedClose = true;
          inThink = false;
          logits = await feed(tokenizer.thinkEndId, pos++);
          post({ type: "progress", file: "reasoning budget reached — answering" });
        }

        // YIELD A MACROTASK. Draining the GPU queue above is necessary and still not
        // enough on its own: a promise chain that never returns to the event loop keeps
        // this worker runnable forever, and on a phone the browser is scheduling the page,
        // the compositor and this thread against one small budget. `setTimeout(0)` is a
        // macrotask, so it lets the whole queue run; `await Promise.resolve()` would NOT
        // -- a microtask drains without ever giving the loop back, which looks like a
        // yield and is not one.
        if (MOBILE_PACING) await new Promise<void>((r) => setTimeout(r, 0));

        const progress = 10 + Math.floor((produced / maxTokens) * 80);
        const tps = produced / ((Date.now() - decodeStartTime) / 1000);
        const phase = inThink ? "thinking" : "answering";
        post({ type: "progress", progress, file: `${phase} · ${produced} tok · ${tps.toFixed(1)} tok/s` });
        if (produced === 1 || produced % 10 === 0) {
           
          console.log(`[bonsai] ${produced} tokens · ${tps.toFixed(2)} tok/s (${phase})`);
        }
      }
      if (stopped) stopReason = "interrupted";

      const elapsedMs = Date.now() - decodeStartTime;
      const tokensPerSecond = produced > 0 ? (produced / elapsedMs) * 1000 : 0;

      // The reply is the post-`</think>` text. When there is none, DO NOT pass raw
      // chain-of-thought off as the answer: that fallback is what made a truncated thought
      // look like the model babbling, because mid-reasoning text ("the 1753 and 2018 census
      // data for Alabama...") was rendered in the answer bubble. The reasoning still goes to
      // the UI on its own channel, where it is labelled as thinking; here we say plainly that
      // it ran out of room, which is both true and actionable.
      const reply = answerText.trim()
        || (thinkText.trim()
              ? 'I ran out of room to finish that thought — my reasoning is above. Ask again and I\'ll be more direct.'
              : '');
       
      console.log(`[bonsai] done: ${produced} tok, ${stopReason}, think=${thinkIds.length} answer=${answerIds.length}`);
      if (TIMING && phaseMs.tokens > 0) {
        const n = phaseMs.tokens;
        const per = (v: number) => (v / n).toFixed(1);
        const total = phaseMs.embed + phaseMs.forward + phaseMs.sample;
        // SPLIT THE SAMPLE PHASE. Once the attention kernel was fixed, `sample` became the
        // LARGEST per-token cost (119–315 ms on the 4B at 1285-token context, against a
        // 76 ms forward). It is two costs with opposite fixes bolted together — a ~1 MB
        // logits readback (fix: select on the GPU) and a JS pass over all 248,320 elements
        // (fix: a better loop) — so it has to be attributed before it is optimised.
        const st = sampleTiming;
        const sampleSplit = st.calls > 0
          ? ` [readback=${per(st.readbackMs)}ms select=${per(st.selectMs)}ms]`
          : "";
        console.log(
          `[bonsai] TIMING per token over ${n}: embed=${per(phaseMs.embed)}ms ` +
            `forward=${per(phaseMs.forward)}ms sample=${per(phaseMs.sample)}ms${sampleSplit} ` +
            `(${per(total)}ms total, ${(1000 / (total / n)).toFixed(1)} tok/s implied)`,
        );
      }

      // Handle tool calling if tools are available and provided.
      //
      // A TOOL THAT RUNS BUT WHOSE RESULT NEVER REACHES THE READER IS NOT A TOOL CALL.
      // This block used to execute the tool, post the result into a `progress` line, and
      // then answer with `remainingText` — the prose AROUND the call. So "what time is it?"
      // really did run `get_current_time`, and really did answer without the time in it.
      // Every cheap signal passed: the parser was unit-tested, the tool executed, a
      // progress line carried the correct value, and the turn completed. The one thing that
      // did not happen was the model ever SEEING the result, because there was no second
      // pass — the whole point of the loop.
      //
      // So: execute, append the results as a `tool` turn (the chat template renders that
      // role), and re-generate. The follow-up carries NO tools, which makes the recursion
      // terminate by construction rather than by a depth counter.
      if (req.tools && req.tools.length > 0) {
        const { setToolContext, drainToolActions } = await import("../../bonsai-tools/registry");
        // The worker has no window/document; without this every page-context answer
        // is "unknown", which reads as a working tool returning nothing.
        setToolContext(req.context ?? {});
        const { orchestrateToolCalls, extendMessagesWithToolResults } = await import(
          "../../bonsai-tools/tool-orchestrator"
        );
        const { finalText, toolCalls } = await orchestrateToolCalls(
          reply,
          (ev) => {
            if (ev.type === "tool_result") {
              post({ type: "progress", file: `executed ${ev.toolName}: ${ev.result}` });
            }
          },
          MAX_TOOL_CALLS_PER_TURN,
        );
        if (toolCalls.length > 0) {
          // Remember what ran, for the next turn's meta-question steering — the
          // page's history stores only the final answer text, so this memo is
          // the only record a "how do you know that?" can point at.
          lastToolResults = toolCalls
            .filter((e) => e.type === "tool_result" && !!e.toolName && typeof e.result === "string")
            .map((e) => ({ name: e.toolName as string, result: e.result as string }));
          // Hand the host anything a tool asked it to DO. Posted before the follow-up
          // generate so the window opens while the model is still writing its reply —
          // waiting for `done` would make every action feel a full turn late.
          const uiActions = drainToolActions();
          if (uiActions.length > 0) post({ type: "tool_action", actions: uiActions });

          // Same reasoning as the actions above — post BEFORE the follow-up generate so the
          // picture appears while the model is still writing about it, rather than a whole
          // turn later. Draining is destructive: read once, or every later tool call in the
          // turn re-posts the same image.
          const { drainImages } = await import("../../bonsai-tools/image-sink");
          const imgs = drainImages();
          if (imgs.length > 0) post({ type: "image", images: imgs });

          // guidedMessages, not req.messages: the steering note added above must
          // survive into the follow-up generation, or the model that answers the
          // meta-question never sees the note that steered the turn.
          const withAssistant: ChatMessage[] = finalText.trim()
            ? [...guidedMessages, { role: "assistant", content: finalText }]
            : [...guidedMessages];
          await generate({
            ...req,
            messages: extendMessagesWithToolResults(withAssistant, toolCalls),
            tools: undefined,
          });
          return;
        }
      }

      // COMMIT the state for the next turn — the only place this happens, and it
      // is reached only on a clean finish. `fedIds` are as much a part of the
      // state as the prompt: they went through decode, so the KV and recurrent
      // state hold them exactly as if prefilled. Recording them is the difference
      // between reusing the system prompt and reusing the whole conversation.
      PREFIX_CACHE = {
        device,
        kv: kv,
        ssm: ssmState,
        tokens: committedTokens(promptIds, fedIds),
        signature,
        capacity: kv.capacity,
      };

      post({
        type: "done",
        text: reply,
        reasoning: thinkText.trim() || undefined,
        tokensPerSecond,
      });
    } catch (e) {
      const msg = (e as Error).message;
      const isEmbedMissing = msg.includes("not loaded") && (msg.includes("token_embd") || msg.includes("output_norm"));
      const guidance = isEmbedMissing
        ? " The model weights were not fully downloaded. Clear your browser's site data " +
          "(Settings → Privacy → Clear browsing data → Cached images and files), then " +
          "reload this page to re-download the model. Or run locally: " +
          "`pip install awdk && adk bonsai-local` for GPU-accelerated inference."
        : "";
      post({ type: "error", message: `bonsai generate failed: ${msg}${guidance}` });
    }
  }

  scope.addEventListener("message", (e) => {
    const req = e.data;
    if (req.type === "load") void load(req.modelId);
    else if (req.type === "generate") void generate(req);
    else if (req.type === "interrupt") stopped = true;
  });

  // exported for the entry's runtime guard
  void BONSAI_RUNTIME_TAG;
  void currentModelId;
}
