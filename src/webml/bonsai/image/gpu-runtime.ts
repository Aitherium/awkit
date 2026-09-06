// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/**
 * Dispatches the Flux2 MMDiT on a real GPU. This is the thing that RUNS the model.
 *
 * `mmdit.ts` is the CPU reference — proven stage-by-stage against a real Flux2 forward.
 * `image_ops.wgsl` holds the kernels — each proven against that reference on hardware.
 * Neither of those runs a model. This does: it walks the same op sequence, in the same
 * order, dispatching compute passes instead of calling functions.
 *
 * MIRRORING `forward()` OP FOR OP IS THE POINT. The two can then be compared on identical
 * inputs and must agree to f32 rounding, and `taps` uses the SAME stage names, so a
 * divergence names a block. A GPU path written to its own design would be checkable only
 * end-to-end — for a 25-block model, one number that is right or wrong with nothing in
 * between, which is exactly the situation the stage differential was built to escape.
 *
 * 🚨 ONE COMMAND ENCODER, ONE SUBMIT. A submit per op is ~700 round trips to the queue on
 * a 25-block forward, and driver overhead then dominates the arithmetic completely.
 * Buffers are pooled by size for the same reason: allocating ~700 GPUBuffers per forward
 * is its own bottleneck, and WebGPU warns about neither.
 *
 * 🚨 EVERY RESHAPE IS A KERNEL, NOT A BUFFER COPY, AND THAT IS NOT AN OPTIMISATION.
 * `copyBufferToBuffer` cannot be recorded inside an open compute pass. The first version
 * of this runtime queued its slices, concatenations and de-interleaves as copies and
 * replayed them after `pass.end()` -- so every dispatch that CONSUMED one of those
 * buffers read it before it had been written. Each kernel was individually verified on
 * hardware, all 27 differential cases passed, and the assembled model was still wrong,
 * diverging at the first double block. A comment in this very header asserted the
 * arrangement was sound.
 *
 * That is precisely the gap this file exists in: individually-correct kernels with
 * nothing sequencing them are not an implementation, and the sequencing is where buffer
 * lifetimes go wrong. Splitting the pass at each copy would also be correct, but the
 * single-stream blocks de-interleave a fused projection per token -- ~15,000 pass
 * boundaries per forward at 768 tokens. `copy_strided` does it in one dispatch and the
 * whole graph stays in one pass.
 *
 * WHAT THIS IS NOT, YET: it runs f32 weights. The shipped checkpoint is Q2_0 and
 * `q2_0_q8_0_matmul.wgsl` exists for it, but swapping that in changes the numerics, so it
 * could not be differentially compared against the f32 reference that proves this path
 * correct at all. Correctness first, in the order this codebase already learned. The
 * quantized matmul is a drop-in for `matmul` once this is green.
 */

import type { Flux2Config, ForwardInput, ForwardTaps } from "./mmdit";
import {
  innerDim, ffInnerDim, splitModulation, ropeTables, timestepEmbedding, silu,
  TIMESTEP_SCALE,
} from "./mmdit";

/** Weight lookup returning torch-convention [out, in] row-major f32. */
export type GpuWeightFn = (name: string) => Float32Array;

const ENTRY = {
  matmul: "matmul_main",
  layernorm: "layernorm_main",
  modulate: "modulate_main",
  add_gated: "add_gated_main",
  rope: "rope_interleaved_main",
  attn: "attn_full_main",
  swiglu: "swiglu_fused_main",
  rmsheads: "rmsnorm_heads_main",
  copy: "copy_strided_main",
} as const;
type OpName = keyof typeof ENTRY;

export interface ImageRuntime {
  device: GPUDevice;
  forward(input: ForwardInput, cfg: Flux2Config, w: GpuWeightFn,
          taps?: ForwardTaps): Promise<Float32Array>;
  destroy(): void;
}

function align16(n: number): number {
  return Math.max(16, Math.ceil(n / 16) * 16);
}

/** Uniform block. Types are per KERNEL, never keyed on field name — two structs here
 *  both have a field called `scale` with opposite types, and a name-keyed writer wrote
 *  one as the other, which no side can detect. */
function uniformBytes(words: Array<[number, boolean]>): ArrayBuffer {
  const ub = new ArrayBuffer(align16(words.length * 4));
  const dv = new DataView(ub);
  words.forEach(([v, isFloat], i) =>
    isFloat ? dv.setFloat32(i * 4, v, true) : dv.setUint32(i * 4, v, true));
  return ub;
}

export async function createImageRuntime(
  device: GPUDevice, wgsl: string,
): Promise<ImageRuntime> {
  const module = device.createShaderModule({ code: wgsl });
  const info = await module.getCompilationInfo?.();
  const errs = (info?.messages ?? []).filter((m) => m.type === "error");
  if (errs.length) {
    throw new Error("image kernels failed to compile: "
      + errs.map((e) => `${e.lineNum}: ${e.message}`).join(" | "));
  }
  const pipelines = new Map<OpName, GPUComputePipeline>();
  for (const [name, entryPoint] of Object.entries(ENTRY) as Array<[OpName, string]>) {
    pipelines.set(name, device.createComputePipeline({
      layout: "auto", compute: { module, entryPoint },
    }));
  }

  const owned: GPUBuffer[] = [];
  const newBuffer = (bytes: number, extra = 0): GPUBuffer => {
    const b = device.createBuffer({
      size: align16(bytes),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        | extra,
    });
    owned.push(b);
    return b;
  };

  async function forward(
    input: ForwardInput, cfg: Flux2Config, w: GpuWeightFn, taps?: ForwardTaps,
  ): Promise<Float32Array> {
    const dim = innerDim(cfg);
    const inner = ffInnerDim(cfg);
    const H = cfg.numAttentionHeads;
    const D = cfg.attentionHeadDim;
    const nImg = input.nImg;
    const nTxt = input.nTxt;
    const nAll = nTxt + nImg;

    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    const readbacks: Array<{ name: string; buf: GPUBuffer; bytes: number;
                            src: GPUBuffer }> = [];

    const buf = (elems: number) => newBuffer(elems * 4);
    const upload = (data: Float32Array): GPUBuffer => {
      const b = newBuffer(data.byteLength);
      device.queue.writeBuffer(b, 0, data.buffer as ArrayBuffer, data.byteOffset,
                               data.byteLength);
      return b;
    };
    const wcache = new Map<string, GPUBuffer>();
    const weight = (name: string): GPUBuffer => {
      let b = wcache.get(name);
      if (!b) { b = upload(w(name)); wcache.set(name, b); }
      return b;
    };

    const dispatch = (op: OpName, bindings: GPUBuffer[], uni: ArrayBuffer,
                      workgroups: number) => {
      const p = pipelines.get(op)!;
      const ub = newBuffer(uni.byteLength, GPUBufferUsage.UNIFORM);
      device.queue.writeBuffer(ub, 0, uni);
      const entries: GPUBindGroupEntry[] = bindings.map((buffer, binding) =>
        ({ binding, resource: { buffer } }));
      entries.push({ binding: bindings.length, resource: { buffer: ub } });
      pass.setPipeline(p);
      pass.setBindGroup(0,
        device.createBindGroup({ layout: p.getBindGroupLayout(0), entries }));
      // WebGPU caps each dimension at 65535; the kernels' flat-index expressions fold
      // the excess into y, so the split here must match them exactly.
      const x = Math.min(workgroups, 65535);
      const y = Math.ceil(Math.max(1, workgroups) / 65535);
      pass.dispatchWorkgroups(Math.max(1, x), Math.max(1, y));
    };

    /** Record a stage under the CPU reference own stage name. The copy to a mappable
     *  buffer is recorded after the pass, since nothing dispatches from it. */
    const tap = (name: string, src: GPUBuffer, elems: number) => {
      if (!taps) return;
      const bytes = elems * 4;
      const dst = device.createBuffer({
        size: align16(bytes), usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      readbacks.push({ name, buf: dst, bytes, src });
    };

    // -- ops ---------------------------------------------------------------
    const matmul = (x: GPUBuffer, wname: string, tokens: number, inDim: number,
                    outDim: number): GPUBuffer => {
      const y = buf(tokens * outDim);
      dispatch("matmul", [x, weight(wname), y],
        uniformBytes([[tokens, false], [inDim, false], [outDim, false], [0, false]]),
        tokens * outDim);
      return y;
    };
    const layerNorm = (x: GPUBuffer, tokens: number): GPUBuffer => {
      const y = buf(tokens * dim);
      dispatch("layernorm", [x, y],
        uniformBytes([[dim, false], [cfg.eps, true], [0, false], [0, false]]), tokens);
      return y;
    };
    const modulate = (x: GPUBuffer, shift: GPUBuffer, scale: GPUBuffer,
                      tokens: number): GPUBuffer => {
      const y = buf(tokens * dim);
      dispatch("modulate", [x, shift, scale, y],
        uniformBytes([[dim, false], [tokens, false], [0, false], [0, false]]),
        Math.ceil((tokens * dim) / 64));
      return y;
    };
    const addGated = (x: GPUBuffer, delta: GPUBuffer, gate: GPUBuffer,
                      tokens: number): GPUBuffer => {
      const y = buf(tokens * dim);
      dispatch("add_gated", [x, delta, gate, y],
        uniformBytes([[dim, false], [tokens, false], [0, false], [0, false]]),
        Math.ceil((tokens * dim) / 64));
      return y;
    };
    const rmsHeads = (x: GPUBuffer, wname: string, tokens: number): GPUBuffer => {
      const y = buf(tokens * H * D);
      dispatch("rmsheads", [x, weight(wname), y],
        uniformBytes([[tokens, false], [H, false], [D, false], [cfg.eps, true]]),
        tokens * H);
      return y;
    };
    const rope = (x: GPUBuffer, cos: GPUBuffer, sin: GPUBuffer,
                  tokens: number): GPUBuffer => {
      const y = buf(tokens * H * D);
      dispatch("rope", [x, cos, sin, y],
        uniformBytes([[tokens, false], [H, false], [D, false], [0, false]]),
        Math.ceil((tokens * H * (D / 2)) / 64));
      return y;
    };
    const attention = (q: GPUBuffer, k: GPUBuffer, v: GPUBuffer,
                       tokens: number): GPUBuffer => {
      const y = buf(tokens * H * D);
      dispatch("attn", [q, k, v, y],
        uniformBytes([[tokens, false], [H, false], [D, false], [1 / Math.sqrt(D), true]]),
        tokens * H);
      return y;
    };
    const swiglu = (x: GPUBuffer, tokens: number): GPUBuffer => {
      const y = buf(tokens * inner);
      dispatch("swiglu", [x, y],
        uniformBytes([[tokens, false], [inner, false], [0, false], [0, false]]),
        Math.ceil((tokens * inner) / 64));
      return y;
    };

    // -- reshapes, as DISPATCHES so they order correctly inside the pass ----
    const strided = (src: GPUBuffer, dst: GPUBuffer, tokens: number, width: number,
                     srcStride: number, srcOff: number,
                     dstStride: number, dstOff: number) => {
      dispatch("copy", [src, dst],
        uniformBytes([[tokens, false], [width, false], [srcStride, false],
                      [srcOff, false], [dstStride, false], [dstOff, false],
                      [0, false], [0, false]]),
        Math.ceil((tokens * width) / 64));
    };
    /** [txt ; img] along the TOKEN axis. */
    const concatTok = (a: GPUBuffer, na: number, b: GPUBuffer, nb: number,
                       width: number): GPUBuffer => {
      const y = buf((na + nb) * width);
      strided(a, y, na, width, width, 0, width, 0);
      strided(b, y, nb, width, width, 0, width, na * width);
      return y;
    };
    /** A contiguous element range -- used to take the img or txt half back out. */
    const sliceTok = (src: GPUBuffer, offElems: number, elems: number): GPUBuffer => {
      const y = buf(elems);
      strided(src, y, 1, elems, elems, offElems, elems, 0);
      return y;
    };
    /** Column range of a [tokens, stride] tensor -> [tokens, width]. */
    const columns = (src: GPUBuffer, tokens: number, stride: number, off: number,
                     width: number): GPUBuffer => {
      const y = buf(tokens * width);
      strided(src, y, tokens, width, stride, off, width, 0);
      return y;
    };
    /** [a | b] per token -> [tokens, wa + wb]. */
    const joinCols = (a: GPUBuffer, wa: number, b: GPUBuffer, wb: number,
                      tokens: number): GPUBuffer => {
      const y = buf(tokens * (wa + wb));
      strided(a, y, tokens, wa, wa, 0, wa + wb, 0);
      strided(b, y, tokens, wb, wb, 0, wa + wb, wa);
      return y;
    };

    // ── conditioning: computed on the CPU, deliberately ───────────────────
    // These are 1-token, dim-sized matmuls — four of them. Dispatching a workgroup per
    // output element for a single token costs more in queue overhead than the
    // arithmetic, and they are already proven exact by the CPU differential. Everything
    // TOKEN-PARALLEL runs on the GPU, which is all of the actual work.
    const cpuMat = (v: Float32Array, wname: string, outDim: number): Float32Array => {
      const wm = w(wname);
      const inDim = v.length;
      const out = new Float32Array(outDim);
      for (let o = 0; o < outDim; o++) {
        let s = 0;
        for (let i = 0; i < inDim; i++) s += v[i] * wm[o * inDim + i];
        out[o] = s;
      }
      return out;
    };
    const sin0 = timestepEmbedding(input.timestep * TIMESTEP_SCALE, cfg.timestepChannels);
    const t1 = Float32Array.from(
      cpuMat(sin0, "time_guidance_embed.timestep_embedder.linear_1.weight", dim), silu);
    const temb = cpuMat(t1, "time_guidance_embed.timestep_embedder.linear_2.weight", dim);
    if (taps) taps["stage_temb"] = temb;
    const tembAct = Float32Array.from(temb, silu);

    const modImgRaw = cpuMat(tembAct, "double_stream_modulation_img.linear.weight", dim * 6);
    const modTxtRaw = cpuMat(tembAct, "double_stream_modulation_txt.linear.weight", dim * 6);
    const modSglRaw = cpuMat(tembAct, "single_stream_modulation.linear.weight", dim * 3);
    if (taps) {
      taps["stage_mod_img"] = modImgRaw;
      taps["stage_mod_txt"] = modTxtRaw;
      taps["stage_mod_single"] = modSglRaw;
    }
    const modImg = splitModulation(modImgRaw, dim, 2);
    const modTxt = splitModulation(modTxtRaw, dim, 2);
    const modSgl = splitModulation(modSglRaw, dim, 1)[0];
    // subarray views cannot be uploaded directly (writeBuffer would take the whole
    // backing store), so each modulation vector is copied into its own buffer once.
    const up = (a: Float32Array) => upload(Float32Array.from(a));

    // ── the graph ─────────────────────────────────────────────────────────
    let img = matmul(upload(input.hiddenStates), "x_embedder.weight",
                     nImg, cfg.inChannels, dim);
    tap("stage_x_embed", img, nImg * dim);
    let txt = matmul(upload(input.encoderHiddenStates), "context_embedder.weight",
                     nTxt, cfg.jointAttentionDim, dim);
    tap("stage_context_embed", txt, nTxt * dim);

    const axes = cfg.axesDimsRope.length;
    const ids = new Float32Array(nAll * axes);
    ids.set(input.txtIds.subarray(0, nTxt * axes), 0);
    ids.set(input.imgIds.subarray(0, nImg * axes), nTxt * axes);
    const tbl = ropeTables(ids, nAll, cfg.axesDimsRope, cfg.ropeTheta);
    const cosB = upload(tbl.cos);
    const sinB = upload(tbl.sin);

    for (let b = 0; b < cfg.numLayers; b++) {
      const p = `transformer_blocks.${b}`;
      const i1 = modImg[0];
      const t1m = modTxt[0];
      const imgN = modulate(layerNorm(img, nImg), up(i1.shift), up(i1.scale), nImg);
      const txtN = modulate(layerNorm(txt, nTxt), up(t1m.shift), up(t1m.scale), nTxt);

      const q = rmsHeads(matmul(imgN, `${p}.attn.to_q.weight`, nImg, dim, dim),
                         `${p}.attn.norm_q.weight`, nImg);
      const k = rmsHeads(matmul(imgN, `${p}.attn.to_k.weight`, nImg, dim, dim),
                         `${p}.attn.norm_k.weight`, nImg);
      const v = matmul(imgN, `${p}.attn.to_v.weight`, nImg, dim, dim);
      const eq = rmsHeads(matmul(txtN, `${p}.attn.add_q_proj.weight`, nTxt, dim, dim),
                          `${p}.attn.norm_added_q.weight`, nTxt);
      const ek = rmsHeads(matmul(txtN, `${p}.attn.add_k_proj.weight`, nTxt, dim, dim),
                          `${p}.attn.norm_added_k.weight`, nTxt);
      const ev = matmul(txtN, `${p}.attn.add_v_proj.weight`, nTxt, dim, dim);

      // TEXT FIRST (convention 6), and RoPE AFTER the QK-norm (convention 4).
      const Q = rope(concatTok(eq, nTxt, q, nImg, dim), cosB, sinB, nAll);
      const K = rope(concatTok(ek, nTxt, k, nImg, dim), cosB, sinB, nAll);
      const V = concatTok(ev, nTxt, v, nImg, dim);
      const attn = attention(Q, K, V, nAll);

      img = addGated(img,
        matmul(sliceTok(attn, nTxt * dim, nImg * dim), `${p}.attn.to_out.0.weight`,
               nImg, dim, dim), up(i1.gate), nImg);
      txt = addGated(txt,
        matmul(sliceTok(attn, 0, nTxt * dim), `${p}.attn.to_add_out.weight`,
               nTxt, dim, dim), up(t1m.gate), nTxt);

      const i2 = modImg[1];
      const t2 = modTxt[1];
      const ffIn = modulate(layerNorm(img, nImg), up(i2.shift), up(i2.scale), nImg);
      const ffH = swiglu(matmul(ffIn, `${p}.ff.linear_in.weight`, nImg, dim, inner * 2), nImg);
      img = addGated(img, matmul(ffH, `${p}.ff.linear_out.weight`, nImg, inner, dim),
                     up(i2.gate), nImg);

      const fcIn = modulate(layerNorm(txt, nTxt), up(t2.shift), up(t2.scale), nTxt);
      const fcH = swiglu(matmul(fcIn, `${p}.ff_context.linear_in.weight`, nTxt, dim, inner * 2), nTxt);
      txt = addGated(txt, matmul(fcH, `${p}.ff_context.linear_out.weight`, nTxt, inner, dim),
                     up(t2.gate), nTxt);

      tap(`stage_double_${b}_0`, txt, nTxt * dim);
      tap(`stage_double_${b}_1`, img, nImg * dim);
    }

    let x = concatTok(txt, nTxt, img, nImg, dim);
    const fusedW = 3 * dim + 2 * inner;
    for (let b = 0; b < cfg.numSingleLayers; b++) {
      const p = `single_transformer_blocks.${b}`;
      const xn = modulate(layerNorm(x, nAll), up(modSgl.shift), up(modSgl.scale), nAll);
      const qkvMlp = matmul(xn, `${p}.attn.to_qkv_mlp_proj.weight`, nAll, dim, fusedW);

      const q = rope(rmsHeads(columns(qkvMlp, nAll, fusedW, 0, dim),
                              `${p}.attn.norm_q.weight`, nAll), cosB, sinB, nAll);
      const k = rope(rmsHeads(columns(qkvMlp, nAll, fusedW, dim, dim),
                              `${p}.attn.norm_k.weight`, nAll), cosB, sinB, nAll);
      const v = columns(qkvMlp, nAll, fusedW, 2 * dim, dim);
      const mlpIn = columns(qkvMlp, nAll, fusedW, 3 * dim, inner * 2);

      const cat = joinCols(attention(q, k, v, nAll), dim, swiglu(mlpIn, nAll), inner, nAll);
      x = addGated(x, matmul(cat, `${p}.attn.to_out.weight`, nAll, dim + inner, dim),
                   up(modSgl.gate), nAll);
      tap(`stage_single_${b}`, x, nAll * dim);
    }

    // CONVENTION 11: the final AdaLN chunks (scale, shift) — the OPPOSITE order from
    // every block modulation, which is (shift, scale, gate).
    const no = cpuMat(tembAct, "norm_out.linear.weight", dim * 2);
    const oScale = no.subarray(0, dim);
    const oShift = no.subarray(dim, dim * 2);
    const normed = modulate(layerNorm(sliceTok(x, nTxt * dim, nImg * dim), nImg),
                            up(oShift), up(oScale), nImg);
    const out = matmul(normed, "proj_out.weight", nImg, dim, cfg.inChannels);
    tap("stage_proj_out", out, nImg * cfg.inChannels);

    // ── submit ────────────────────────────────────────────────────────────
    pass.end();
    // The ONLY copies left are readbacks into mappable buffers, which nothing dispatches
    // from -- so recording them after the pass is sound, unlike the reshapes that used
    // to live here.
    for (const r of readbacks) enc.copyBufferToBuffer(r.src, 0, r.buf, 0, r.bytes);
    const outBytes = nImg * cfg.inChannels * 4;
    const rb = device.createBuffer({
      size: align16(outBytes), usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    enc.copyBufferToBuffer(out, 0, rb, 0, outBytes);
    device.queue.submit([enc.finish()]);

    for (const r of readbacks) {
      await r.buf.mapAsync(GPUMapMode.READ);
      taps![r.name] = new Float32Array(r.buf.getMappedRange().slice(0, r.bytes));
      r.buf.unmap();
      r.buf.destroy();
    }
    await rb.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(rb.getMappedRange().slice(0, outBytes));
    rb.unmap();
    rb.destroy();
    return result;
  }

  return {
    device,
    forward,
    destroy: () => { for (const b of owned) b.destroy(); owned.length = 0; },
  };
}
