// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * GPU CLASSIFICATION AND THE TDR BUDGET — why a browser model can wedge a laptop.
 *
 * INCIDENT 2026-07-31 (Lenovo Yoga 7i, Core i7 / Iris Xe, aitherium.com): the 4B loaded
 * layers, then died with "Failed to fetch", and the visitor's SCREEN BEGAN FLASHING and
 * kept flashing after the tab was gone. That is not a web bug in the usual sense — it is
 * the Windows display driver in a TDR reset loop.
 *
 * TDR = Timeout Detection and Recovery. Windows kills any GPU command packet that has not
 * completed within `TdrDelay`, DEFAULT 2 SECONDS, then resets the display driver — the
 * screen blanks and comes back. From the page's side the GPUDevice is simply LOST. Nothing
 * in this runtime was listening for that, so:
 *
 *   1. `forward.ts` submits ONE command buffer PER TRANSFORMER LAYER (`beginBatch` /
 *      `flushBatch`). On a discrete card that is microseconds of wall time and the whole
 *      point of D-1517's batching. On an Iris Xe running a 4B naive Q1_0 matmul it is
 *      seconds — i.e. over the TDR deadline, by construction.
 *   2. The driver resets. Every in-flight GPU op dies, and the RENDERER's pending work dies
 *      with it — which is where a perfectly healthy layer range GET turns into a bare
 *      `TypeError: Failed to fetch`. **The fetch error was a SYMPTOM of the GPU crash, not
 *      its cause**, and it is the only part the visitor could see. Anyone debugging the
 *      network here is debugging the wrong subsystem.
 *   3. Nothing observed `device.lost`, so the runtime kept submitting into a dead device
 *      and the surface kept auto-booting the same model — each attempt re-arming the same
 *      reset. That is the flashing LOOP, as opposed to one flash.
 *
 * So there are three independent defenses and this file owns the first two:
 *   - CLASSIFY the adapter and refuse work that class cannot finish (`gpuSizeCeilingMb`
 *     in bonsai-models.ts consumes this).
 *   - BOUND the work per submit so a single packet stays under the TDR deadline
 *     (`maxDispatchesPerSubmit`, consumed by kernels/dispatch.ts).
 * The third is observing `device.lost` and never silently retrying — worker-core.ts and
 * webgpu-brain.tsx.
 *
 * HONEST LIMIT, stated because the alternative is a comment that reads like a guarantee:
 * capping dispatches per submit REDUCES packet duration, it does not bound it. One
 * individual matmul dispatch can still exceed 2 s on a weak adapter, and this runtime
 * cannot split a dispatch without new kernels. The capping is mitigation; the CLASS GATE
 * is the actual protection, and the device-lost handler is what makes a failure survivable.
 */

export type GpuClass = 'software' | 'integrated' | 'discrete' | 'unknown';

/** `GPUAdapterInfo` — Chrome 128+ populates a coarse vendor/architecture pair. */
export interface AdapterHint {
  vendor?: string;
  architecture?: string;
  /**
   * The adapter is a SOFTWARE rasteriser the browser substituted for a real GPU.
   *
   * This is decisive and must be checked FIRST, because the vendor string on a fallback
   * adapter is routinely EMPTY — and an empty vendor classified as `unknown`, which this
   * file deliberately routes down the DISCRETE fast path. So a browser silently running on
   * SwiftShader was treated as a 5090.
   *
   * MEASURED 2026-07-31, and it cost an hour of misattribution. Two runs of the SAME 1.7B
   * on the SAME box minutes apart:
   *     bench "browser" (believed GPU)   cold 0.114  warm 0.328 tok/s
   *     forced --use-webgpu-adapter=swiftshader   cold 0.108  warm 0.322 tok/s
   * Identical to three digits — the "GPU" run had silently been on the software adapter the
   * whole time, and the 0.33 was first blamed on fleet GPU contention. A real hardware run
   * on the same box is 41 tok/s, i.e. the fallback is ~125x slower and reports nothing.
   *
   * This matters far more to a VISITOR than to a benchmark: the greeter's composer says
   * "I'm running on your GPU right now". On a fallback adapter that sentence is false, the
   * model is unusably slow, and there is no signal anywhere that anything is wrong.
   */
  isFallbackAdapter?: boolean;
}

/**
 * Vendors that ship ONLY integrated parts in a browser context.
 *
 * `apple` is deliberately absent: Apple Silicon is integrated but fast, and lumping it in
 * on the word "integrated" would apply the heuristic past its evidence. `amd` is absent
 * because the vendor string alone cannot separate a discrete Radeon from an APU, and
 * guessing wrong there downgrades a real GPU.
 */
const INTEGRATED_VENDORS = ['intel', 'arm', 'qualcomm', 'imgtec'] as const;

/** `microsoft` is WARP, Chrome's SOFTWARE rasteriser fallback — no usable GPU present. */
const SOFTWARE_VENDORS = ['microsoft'] as const;

export function classifyAdapter(hint?: AdapterHint): GpuClass {
  // FIRST, and before the vendor string is even read: the browser telling us outright that
  // this is a substituted software adapter outranks any name-based heuristic, and a fallback
  // adapter usually reports NO vendor at all — so checking vendor first sends it to
  // `unknown`, which is the discrete fast path. See AdapterHint.isFallbackAdapter for the
  // measurement that shows what that costs.
  if (hint?.isFallbackAdapter === true) return 'software';
  const vendor = hint?.vendor?.trim().toLowerCase();
  if (!vendor) return 'unknown';
  if ((SOFTWARE_VENDORS as readonly string[]).includes(vendor)) return 'software';
  if ((INTEGRATED_VENDORS as readonly string[]).includes(vendor)) return 'integrated';
  return 'unknown';
}

/**
 * How many compute dispatches may accumulate into ONE `queue.submit()` for this class.
 * `0` means "no cap" — keep the one-submit-per-layer batching D-1517 measured as the fix
 * for the 3–4 ms/layer submit-overhead floor.
 *
 * The number for `integrated`/`software` is chosen to be small enough that a packet is
 * many times under the 2 s TDR deadline even when each dispatch is slow, while still
 * cutting submit count by ~an order of magnitude versus the pre-D-1517 per-op submits.
 * There is no way to derive it exactly: the per-dispatch cost depends on the adapter, the
 * kernel and the prompt length, none of which are known here. It is a safety margin, and
 * it is applied ONLY where a discrete card is not in play, so the fast path is untouched.
 */
export function maxDispatchesPerSubmit(
  cls: GpuClass,
  opts?: { windowsTdr?: boolean; mobile?: boolean },
): number {
  // MOBILE FIRST, and before the class is consulted at all.
  //
  // Reported 2026-08-22: the 1.7B loaded on a phone, started answering, and locked
  // up the WHOLE DEVICE -- not the tab. Memory was never the problem; the model ran.
  //
  // Keying this on the CLASS cannot work, and that is the whole point of putting it
  // above the switch. `GPUAdapterInfo` is Chrome 128+ and Safari exposes none at all,
  // so classifyAdapter() answers 'unknown' on exactly the devices that freeze -- the
  // branch documented as 'an unknown adapter is NOT assumed weak'. That was reasoned
  // about DESKTOP Safari/Firefox. On a phone, 'unknown' is the weakest hardware there
  // is, and it was taking the UNCAPPED discrete path. Same shape as BIH003: teaching
  // the class about mobile would have changed nothing on the affected device.
  //
  // And a phone is the STRICTEST case, not the loosest. The uncapped path is justified
  // above by 'macOS/Linux browsers have no 2s hard reset' -- true of Android too, but a
  // desktop losing its GPU for a second is a stutter, while a phone renders its
  // COMPOSITOR on that same GPU and has no watchdog to reset the driver. Windows gets
  // rescued by TDR; Android just stops responding until the packet finishes.
  //
  // 4 is now MEASURED rather than guessed, and the measurement corrected the diagnosis.
  //
  // Measured 2026-08-22 in Chrome on Blackwell via `timestamp-query` (GPU-side time,
  // immune to CPU load): a memory-bound dispatch over a 4 MB working set costs
  // **8.2 us**, perfectly linear -- 8/16/32 dispatches gave 65.5/131.1/262.1 us. That
  // is ~1023 GB/s effective, ~57% of the card's peak. Phone-class GPUs run ~50-60 GB/s,
  // so ~17-21x slower: **140-168 us per dispatch**. Against a 16 ms compositor frame:
  //
  //     cap  4  ->  0.6-0.7 ms      cap 16  ->  2.2-2.7 ms
  //     cap  8  ->  1.1-1.3 ms      cap 64  ->  9.0-10.7 ms  (marginal)
  //
  // 🚨 WHICH MEANS THE CAP WAS NEVER THE PRIMARY CAUSE. The runtime batches one submit
  // PER LAYER -- ~10 dispatches -- so an UNCAPPED packet was already only 1.4-1.7 ms,
  // comfortably inside a frame. What froze the device was the unbounded QUEUE: nothing
  // awaited completion, so depth grew with every token (~28 layers x 1.5 ms = ~42 ms
  // queued per token, forever), and the compositor's next frame waited behind all of
  // it. The load-bearing fix is the per-token drain in the decode loop; this cap is
  // cheap insurance beside it.
  //
  // 4 rather than the 16 the arithmetic permits, deliberately: the number above comes
  // from a synthetic memory-bound kernel, and a real attention/matmul dispatch may be
  // compute-bound and dearer. At 3x my proxy, cap 16 lands at ~8 ms (marginal) while
  // cap 4 is still ~2 ms. The insurance costs ~65-85 us per extra submit (measured on
  // the same box) -- about 2-3% of a phone token -- so buying 4-6x headroom is nearly
  // free. If throughput ever matters here, 16 is the measured ceiling, not a guess.
  if (opts?.mobile) return 4;

  switch (cls) {
    case 'software':
    case 'integrated':
      return 8;
    // An unknown adapter is NOT assumed weak — Safari and Firefox expose no adapter info
    // at all, and throttling every one of them to protect a class we cannot see would slow
    // the majority to guard the minority. Unknown keeps the discrete path.
    case 'unknown':
    case 'discrete':
    default:
      // "DISCRETE = UNCAPPED" ASSUMES THE CARD IS FREE, and that assumption failed live
      // (owner's desktop, 2026-08-07): an RTX 5090 running this runtime WHILE a local
      // vLLM held 84% utilisation lost the device mid-prefill — "A valid external
      // Instance reference no longer exists" — twice, a day apart. Under external
      // contention a discrete card's packets QUEUE behind the other workload, and it is
      // the queue-to-completion time Windows' 2 s TDR deadline measures, not our packet's
      // own cost. So on Windows even the discrete path carries a cap — loose enough that
      // an uncontended card never notices (a 5090 layer is microseconds; 64 dispatches is
      // still ~an order of magnitude fewer submits than pre-D-1517), tight enough that a
      // contended one yields the queue often. macOS/Linux browsers have no 2 s hard reset,
      // so the uncapped fast path stays theirs.
      return opts?.windowsTdr ? 64 : 0;
  }
}

/**
 * Whether this class should run a browser model UNASKED.
 *
 * A software rasteriser cannot run anything in this family usefully, and an auto-started
 * download on it ends in a hung tab. The hosted ladder carries those visitors instead.
 */
export function mayAutoBoot(cls: GpuClass): boolean {
  if (isMobileDevice()) return false;
  return cls !== 'software';
}

/**
 * Is this a phone or tablet?
 *
 * No adapter field reports the fact that actually decides the outcome: a mobile browser
 * reclaims a background tab's memory and kills the worker holding the weights. Vendor and
 * architecture strings say nothing about that, so the check has to be made separately.
 *
 * The `Macintosh` + touch branch is the half everyone omits. iPadOS 13+ sends a DESKTOP
 * Safari user agent, so a plain UA regex misses every modern iPad — precisely the class this
 * gate exists for. Kept in step with awkit/src/webml/device-class.ts, which BIH004
 * asserts rather than requests.
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
  const touch = (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0;
  return /Macintosh/i.test(ua) && touch > 1;
}

/**
 * Is this a PHONE — never a tablet? Owner directive 2026-09-01: phones may not load ANY
 * in-browser model — GPU lane, wasm lane, tap, or auto — because even the 1.7B on the
 * wasm-cpu lane froze a Pixel 10 to a reboot. Tablets (iPads included) stay allowed, so
 * this is NOT `isMobileDevice()`: Android phones carry "Mobile" in the UA and Android
 * tablets do not; iPhones always contain "iPhone"; iPads (any iPadOS, including the 13+
 * desktop-UA `Macintosh` branch) match none of these. Byte-kept in step with
 * awkit/src/webml/device-class.ts and the gobbonet adapter (BIH004, BCG014).
 */
export function isPhoneDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  return /Android.+Mobile|iPhone|iPod/i.test(ua);
}

/**
 * MAY THIS DEVICE RUN THE WEBGPU LANE AT ALL? Phones: never.
 *
 * `autoBootAllowed` / `mayAutoBoot` only decide whether a model starts UNASKED. On a phone
 * that was the wrong question: iOS 26 Safari and Android Chrome both expose `navigator.gpu`
 * and hand out a real adapter, so the probe requested one, `start()` took the GPU lane on an
 * explicit tap, and the OS killed the worker for memory mid-load. A memory-killed worker
 * posts nothing and on several engines fires no `onerror` (BIH001), so nothing tore it
 * down — the tab crashed, the stale worker and its half-uploaded buffers stayed behind, and
 * "try the CPU version" then fought that corpse for the same RAM (owner report 2026-08-23:
 * "it's still crashing my phone and doesn't clean up on its own, so running the CPU version
 * is impossible").
 *
 * So the GPU lane is refused OUTRIGHT on mobile, tap or no tap, and the brain goes straight
 * to the wasm-cpu lane without ever calling `requestAdapter()`. The decision lives here,
 * next to `isMobileDevice()`, so every caller asks the same question in the same place.
 */
export function gpuLaneAllowed(): boolean {
  return !isMobileDevice();
}

/**
 * The auto-boot question as callers actually have it: an adapter hint that may be NULL.
 *
 * 🚨 THE NULL CASE IS WHY THIS NEEDS ITS OWN ENTRY POINT. Every call site used to be spelled
 * `adapterInfo && !mayAutoBoot(classifyAdapter(adapterInfo))`, which short-circuits to
 * "allowed" whenever the hint is absent. `GPUAdapterInfo` is Chrome 128+ and **Safari exposes
 * nothing**, so on an iPhone `adapterInfo` is null, the guard is skipped entirely, and
 * teaching `mayAutoBoot` about mobile would have changed NOTHING on the single most affected
 * device. The refusal has to live where the null is handled. BIH003 now treats the old
 * spelling as a violation.
 *
 * An absent hint still means "no opinion" for everything else: the software-rasteriser
 * refusal genuinely cannot be made without a hint, and guessing there would park desktop
 * Safari and Firefox in idle for a class they are probably not in.
 */
export function autoBootAllowed(hint?: AdapterHint | null): boolean {
  if (isMobileDevice()) return false;
  if (!hint) return true;
  return mayAutoBoot(classifyAdapter(hint));
}
