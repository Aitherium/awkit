// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * MOVED — this module now lives at `../wasp/source.ts`.
 *
 * The range transport (retry ladder, stall watchdog, per-request mirror failover) is not
 * a GGUF concern: it will stream any file from any host that answers Range with CORS, and
 * it is the network half of WASP, the weight-streaming plane. It sat under `gguf/` only
 * because the GGUF parser was its first caller.
 *
 * THIS FILE STAYS, AS A RE-EXPORT, DELIBERATELY. Fourteen modules import `../gguf/reader`
 * — the parser, the weight store, the runtime, four selftest entrypoints and two jest
 * suites — and rewriting all of them in the same commit that moves the code turns a move
 * into a change nobody can review. More to the point, the awkit mirror is generated from
 * this tree by a path-preserving sync and is vendored by product repos that import
 * `webml/bonsai/gguf/*` BY PATH; deleting this file would remove a published subpath,
 * which is a breaking change for consumers this repo cannot see.
 *
 * So: one canonical implementation, one compatibility surface. New code imports
 * `../wasp/source`; nothing that already worked stops working.
 */

export {
  RangeReader,
  httpRangeFetcher,
  mirroredRangeFetcher,
} from "../wasp/source";
export type { RangeFetcher, RangeReaderInit } from "../wasp/source";
