// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/**
 * The Flux2 MMDiT forward: latent tokens + text embeddings -> velocity prediction.
 *
 * This is the model itself -- 5 joint (double-stream) blocks then 20 single-stream
 * blocks, 24 heads x 128 dims. Everything here is f32 CPU arithmetic expressed as
 * small named ops, for the same reason the VAE graph is data: it is the REFERENCE a
 * WGSL implementation gets differentially compared against. A GPU kernel that has
 * never been compared to a correct CPU result is not fast, it is unverified.
 *
 * 🚨 EVERY CONVENTION BELOW WAS READ OUT OF THE REFERENCE IMPLEMENTATION, NOT
 * INFERRED FROM A PAPER, and each one is silent when wrong -- a wrong convention
 * yields a plausible, wrong image, never an error. They are listed here because they
 * are exactly what a reimplementation gets wrong:
 *
 *   1. FF is SwiGLU with the GATE FIRST: `linear_in` emits 2*inner, and the
 *      activation is `silu(x1) * x2` where x1 is the FIRST half. Swapping the halves
 *      is dimensionally identical and numerically wrong.
 *   2. Modulation is `linear(silu(temb))` split into 3*sets chunks, grouped as
 *      (shift, scale, gate) TRIPLES -- not (scale, shift, gate), and not
 *      per-parameter interleaved.
 *   3. Modulation weights are SHARED ACROSS BLOCKS. There is exactly one
 *      `double_stream_modulation_img.linear` for all 5 double blocks and one
 *      `single_stream_modulation.linear` for all 20 single ones. A per-block
 *      assumption looks for weights that do not exist.
 *   4. QK-RMSNorm is applied BEFORE RoPE, and per HEAD (weight is [head_dim]).
 *   5. RoPE is the INTERLEAVED (adjacent-pair) convention: `[-x1, x0]` on pairs,
 *      with cos/sin repeat-interleaved. The half-split convention used by
 *      Llama-family models is the other one, and both produce correctly-shaped
 *      garbage.
 *   6. Text is concatenated FIRST: `cat([txt, img])`, matching `cat([txt_ids,
 *      img_ids])`. Reversing it silently misaligns every position.
 *   7. The single blocks fuse qkv AND the gated MLP input into ONE projection
 *      (3*dim + 2*inner), and fuse attn-out with mlp-out into ONE output
 *      projection (dim + inner).
 *   8. The timestep embedding is `flip_sin_to_cos=true` -- COS FIRST, then sin --
 *      with downscale_freq_shift 0. Sin-first is the other common spelling.
 *   9. `guidance_embeds` is FALSE on this checkpoint. The captured golden carries a
 *      `guidance` tensor anyway; it is recorded input that the model IGNORES. There
 *      is no guidance embedder to feed it to.
 *  10. THE TIMESTEP IS SCALED BY 1000 BEFORE THE SINUSOID. The scheduler works in
 *      sigmas on [0, 1]; the embedding expects the DDPM-era 0..1000 range. This one
 *      was found by the stage differential rather than by reading: passing the raw
 *      sigma runs the model at the wrong point on the noise schedule, which is not
 *      an error -- every shape is right, every stage runs, and the image is simply
 *      denoised by the wrong amount.
 *  11. THE FINAL AdaLN CHUNKS (scale, shift) -- THE OPPOSITE ORDER FROM EVERY BLOCK
 *      MODULATION, which is (shift, scale, gate). Two adaptive-norm mechanisms in
 *      one model disagreeing about ordering, because the output norm is the shared
 *      `AdaLayerNormContinuous` whose order was set by an unrelated model. Also
 *      found by the stage differential: it was the ONLY stage still failing once
 *      all 25 blocks matched to 1e-7.
 *
 * Weights are torch-convention [out, in] and multiplied as x @ W^T, with NO BIASES
 * anywhere in this model.
 */

export interface Flux2Config {
  inChannels: number;
  numLayers: number;
  numSingleLayers: number;
  attentionHeadDim: number;
  numAttentionHeads: number;
  jointAttentionDim: number;
  axesDimsRope: number[];
  ropeTheta: number;
  mlpRatio: number;
  eps: number;
  /** Sinusoidal channels for the timestep embedding. */
  timestepChannels: number;
}

/** The shipped bonsai-image-4b checkpoint, read from its own GGUF metadata. */
export const BONSAI_IMAGE_4B: Flux2Config = {
  inChannels: 128,
  numLayers: 5,
  numSingleLayers: 20,
  attentionHeadDim: 128,
  numAttentionHeads: 24,
  jointAttentionDim: 7680,
  axesDimsRope: [32, 32, 32, 32],
  ropeTheta: 2000,
  mlpRatio: 3.0,
  eps: 1e-6,
  timestepChannels: 256,
};

export function innerDim(c: Flux2Config): number {
  return c.numAttentionHeads * c.attentionHeadDim;
}
export function ffInnerDim(c: Flux2Config): number {
  return Math.trunc(innerDim(c) * c.mlpRatio);
}

/** Weight lookup. Returns torch-convention [out, in] row-major, or throws. */
export type WeightFn = (name: string) => Float32Array;

// -- primitive ops ----------------------------------------------------------

/** y[t, o] = sum_i x[t, i] * W[o, i]. No bias: this model has none. */
export function linear(
  x: Float32Array, w: Float32Array, tokens: number, inDim: number, outDim: number,
): Float32Array {
  if (x.length !== tokens * inDim) {
    throw new Error("linear: x has " + x.length + ", expected " + tokens + "x" + inDim);
  }
  if (w.length !== outDim * inDim) {
    throw new Error("linear: W has " + w.length + ", expected " + outDim + "x" + inDim);
  }
  const y = new Float32Array(tokens * outDim);
  for (let t = 0; t < tokens; t++) {
    const xo = t * inDim;
    for (let o = 0; o < outDim; o++) {
      let s = 0;
      const wo = o * inDim;
      for (let i = 0; i < inDim; i++) s += x[xo + i] * w[wo + i];
      y[t * outDim + o] = s;
    }
  }
  return y;
}

export function silu(x: number): number {
  return x / (1 + Math.exp(-x));
}

/**
 * LayerNorm with NO learnable affine -- the modulated norms in this model are
 * `elementwise_affine=False`, and the shift/scale come from the modulation instead.
 * Adding an affine here would double-apply the conditioning.
 */
export function layerNorm(
  x: Float32Array, tokens: number, dim: number, eps: number,
): Float32Array {
  const y = new Float32Array(x.length);
  for (let t = 0; t < tokens; t++) {
    const o = t * dim;
    let mean = 0;
    for (let i = 0; i < dim; i++) mean += x[o + i];
    mean /= dim;
    let v = 0;
    for (let i = 0; i < dim; i++) {
      const d = x[o + i] - mean;
      v += d * d;
    }
    const inv = 1 / Math.sqrt(v / dim + eps);
    for (let i = 0; i < dim; i++) y[o + i] = (x[o + i] - mean) * inv;
  }
  return y;
}

/** Per-head RMSNorm over the head dimension, with a [headDim] weight. */
export function rmsNormHeads(
  x: Float32Array, tokens: number, heads: number, headDim: number,
  weight: Float32Array, eps: number,
): Float32Array {
  const y = new Float32Array(x.length);
  for (let t = 0; t < tokens; t++) {
    for (let h = 0; h < heads; h++) {
      const o = (t * heads + h) * headDim;
      let s = 0;
      for (let i = 0; i < headDim; i++) s += x[o + i] * x[o + i];
      const inv = 1 / Math.sqrt(s / headDim + eps);
      for (let i = 0; i < headDim; i++) y[o + i] = x[o + i] * inv * weight[i];
    }
  }
  return y;
}

/** `silu(first half) * second half`. Convention 1 -- gate is the FIRST half. */
export function swiglu(x: Float32Array, tokens: number, twoInner: number): Float32Array {
  if (twoInner % 2 !== 0) throw new Error("swiglu: " + twoInner + " is not even");
  const inner = twoInner / 2;
  const y = new Float32Array(tokens * inner);
  for (let t = 0; t < tokens; t++) {
    const o = t * twoInner;
    for (let i = 0; i < inner; i++) y[t * inner + i] = silu(x[o + i]) * x[o + inner + i];
  }
  return y;
}

/**
 * Sinusoidal timestep embedding. Convention 8: COS FIRST (flip_sin_to_cos),
 * downscale_freq_shift = 0, max_period 10000.
 */
export const TIMESTEP_SCALE = 1000;

export function timestepEmbedding(t: number, dim: number): Float32Array {
  const half = dim >> 1;
  const out = new Float32Array(dim);
  for (let i = 0; i < half; i++) {
    const freq = Math.exp((-Math.log(10000) * i) / half);
    const a = t * freq;
    out[i] = Math.cos(a);
    out[half + i] = Math.sin(a);
  }
  return out;
}

/**
 * RoPE cos/sin tables from position ids, one axis per column of `ids`.
 *
 * Convention 5: each frequency is REPEAT-INTERLEAVED (freq k occupies slots 2k and
 * 2k+1), matching `repeat_interleave_real=True`. Axis tables are concatenated, so
 * sum(axesDims) must equal headDim.
 */
export function ropeTables(
  ids: Float32Array, tokens: number, axesDims: number[], theta: number,
): { cos: Float32Array; sin: Float32Array } {
  const nAxes = axesDims.length;
  const headDim = axesDims.reduce((a, b) => a + b, 0);
  const cos = new Float32Array(tokens * headDim);
  const sin = new Float32Array(tokens * headDim);
  for (let t = 0; t < tokens; t++) {
    let off = 0;
    for (let a = 0; a < nAxes; a++) {
      const d = axesDims[a];
      const pos = ids[t * nAxes + a];
      for (let k = 0; k < d / 2; k++) {
        const f = pos / Math.pow(theta, (2 * k) / d);
        const c = Math.cos(f);
        const s = Math.sin(f);
        // repeat-interleave: the pair (2k, 2k+1) shares one frequency.
        cos[t * headDim + off + 2 * k] = c;
        cos[t * headDim + off + 2 * k + 1] = c;
        sin[t * headDim + off + 2 * k] = s;
        sin[t * headDim + off + 2 * k + 1] = s;
      }
      off += d;
    }
  }
  return { cos, sin };
}

/**
 * Apply RoPE in place-free form. Convention 5: pairs are ADJACENT --
 * `out = x*cos + [-x1, x0]*sin` over each (even, odd) pair.
 */
export function applyRope(
  x: Float32Array, tokens: number, heads: number, headDim: number,
  cos: Float32Array, sin: Float32Array,
): Float32Array {
  const y = new Float32Array(x.length);
  for (let t = 0; t < tokens; t++) {
    for (let h = 0; h < heads; h++) {
      const o = (t * heads + h) * headDim;
      const p = t * headDim;
      for (let i = 0; i < headDim; i += 2) {
        const a = x[o + i];
        const b = x[o + i + 1];
        y[o + i] = a * cos[p + i] - b * sin[p + i];
        y[o + i + 1] = b * cos[p + i + 1] + a * sin[p + i + 1];
      }
    }
  }
  return y;
}

/**
 * Multi-head scaled dot-product attention, no mask.
 *
 * Layout is [token][head][dim] throughout -- the reference unflattens the projection
 * to (heads, headDim) on the LAST axis, so head h of token t is contiguous. Reading
 * it as [head][token][dim] transposes silently and is shape-compatible.
 */
export function attention(
  q: Float32Array, k: Float32Array, v: Float32Array,
  tokens: number, heads: number, headDim: number,
): Float32Array {
  const out = new Float32Array(tokens * heads * headDim);
  const scale = 1 / Math.sqrt(headDim);
  const scores = new Float32Array(tokens);
  for (let h = 0; h < heads; h++) {
    for (let i = 0; i < tokens; i++) {
      const qo = (i * heads + h) * headDim;
      let max = -Infinity;
      for (let j = 0; j < tokens; j++) {
        const ko = (j * heads + h) * headDim;
        let s = 0;
        for (let d = 0; d < headDim; d++) s += q[qo + d] * k[ko + d];
        s *= scale;
        scores[j] = s;
        if (s > max) max = s;
      }
      let sum = 0;
      for (let j = 0; j < tokens; j++) {
        scores[j] = Math.exp(scores[j] - max);
        sum += scores[j];
      }
      const oo = (i * heads + h) * headDim;
      for (let j = 0; j < tokens; j++) {
        const wt = scores[j] / sum;
        if (wt === 0) continue;
        const vo = (j * heads + h) * headDim;
        for (let d = 0; d < headDim; d++) out[oo + d] += wt * v[vo + d];
      }
    }
  }
  return out;
}

/** `x * (1 + scale) + shift`, broadcasting a per-channel modulation over tokens. */
export function modulate(
  x: Float32Array, tokens: number, dim: number,
  shift: Float32Array, scale: Float32Array,
): Float32Array {
  const y = new Float32Array(x.length);
  for (let t = 0; t < tokens; t++) {
    const o = t * dim;
    for (let i = 0; i < dim; i++) y[o + i] = x[o + i] * (1 + scale[i]) + shift[i];
  }
  return y;
}

export interface ModSet {
  shift: Float32Array;
  scale: Float32Array;
  gate: Float32Array;
}

/** Split a modulation vector into `sets` (shift, scale, gate) triples. Convention 2. */
export function splitModulation(
  mod: Float32Array, dim: number, sets: number,
): ModSet[] {
  if (mod.length !== dim * 3 * sets) {
    throw new Error("splitModulation: got " + mod.length + ", expected " + dim * 3 * sets);
  }
  const chunk = (i: number) => mod.subarray(i * dim, (i + 1) * dim);
  const out: ModSet[] = [];
  for (let s = 0; s < sets; s++) {
    out.push({ shift: chunk(3 * s), scale: chunk(3 * s + 1), gate: chunk(3 * s + 2) });
  }
  return out;
}

function addGated(
  x: Float32Array, delta: Float32Array, tokens: number, dim: number, gate: Float32Array,
): Float32Array {
  const y = new Float32Array(x.length);
  for (let t = 0; t < tokens; t++) {
    const o = t * dim;
    for (let i = 0; i < dim; i++) y[o + i] = x[o + i] + gate[i] * delta[o + i];
  }
  return y;
}

function concatTokens(
  a: Float32Array, na: number, b: Float32Array, nb: number, dim: number,
): Float32Array {
  const y = new Float32Array((na + nb) * dim);
  y.set(a.subarray(0, na * dim), 0);
  y.set(b.subarray(0, nb * dim), na * dim);
  return y;
}

// -- blocks -----------------------------------------------------------------

export interface ForwardTaps {
  [stage: string]: Float32Array;
}

/**
 * One joint (double-stream) block: image and text attend together, then each stream
 * runs its OWN feed-forward (`ff` and `ff_context`).
 */
export function doubleBlock(
  img: Float32Array, txt: Float32Array, nImg: number, nTxt: number,
  cfg: Flux2Config, w: WeightFn, prefix: string,
  modImg: ModSet[], modTxt: ModSet[],
  cos: Float32Array, sin: Float32Array,
): { img: Float32Array; txt: Float32Array } {
  const dim = innerDim(cfg);
  const H = cfg.numAttentionHeads;
  const D = cfg.attentionHeadDim;
  const nAll = nTxt + nImg;

  const i1 = modImg[0];
  const t1 = modTxt[0];
  const imgN = modulate(layerNorm(img, nImg, dim, cfg.eps), nImg, dim, i1.shift, i1.scale);
  const txtN = modulate(layerNorm(txt, nTxt, dim, cfg.eps), nTxt, dim, t1.shift, t1.scale);

  let q = linear(imgN, w(prefix + ".attn.to_q.weight"), nImg, dim, dim);
  let k = linear(imgN, w(prefix + ".attn.to_k.weight"), nImg, dim, dim);
  const v = linear(imgN, w(prefix + ".attn.to_v.weight"), nImg, dim, dim);
  let eq = linear(txtN, w(prefix + ".attn.add_q_proj.weight"), nTxt, dim, dim);
  let ek = linear(txtN, w(prefix + ".attn.add_k_proj.weight"), nTxt, dim, dim);
  const ev = linear(txtN, w(prefix + ".attn.add_v_proj.weight"), nTxt, dim, dim);

  // Convention 4: QK-norm BEFORE RoPE, per head.
  q = rmsNormHeads(q, nImg, H, D, w(prefix + ".attn.norm_q.weight"), cfg.eps);
  k = rmsNormHeads(k, nImg, H, D, w(prefix + ".attn.norm_k.weight"), cfg.eps);
  eq = rmsNormHeads(eq, nTxt, H, D, w(prefix + ".attn.norm_added_q.weight"), cfg.eps);
  ek = rmsNormHeads(ek, nTxt, H, D, w(prefix + ".attn.norm_added_k.weight"), cfg.eps);

  // Convention 6: TEXT FIRST.
  let Q = concatTokens(eq, nTxt, q, nImg, dim);
  let K = concatTokens(ek, nTxt, k, nImg, dim);
  const V = concatTokens(ev, nTxt, v, nImg, dim);
  Q = applyRope(Q, nAll, H, D, cos, sin);
  K = applyRope(K, nAll, H, D, cos, sin);

  const attn = attention(Q, K, V, nAll, H, D);
  const attnTxt = attn.slice(0, nTxt * dim);
  const attnImg = attn.slice(nTxt * dim);

  let outImg = addGated(
    img, linear(attnImg, w(prefix + ".attn.to_out.0.weight"), nImg, dim, dim),
    nImg, dim, i1.gate);
  let outTxt = addGated(
    txt, linear(attnTxt, w(prefix + ".attn.to_add_out.weight"), nTxt, dim, dim),
    nTxt, dim, t1.gate);

  const inner = ffInnerDim(cfg);
  const i2 = modImg[1];
  const t2 = modTxt[1];

  const ffIn = modulate(layerNorm(outImg, nImg, dim, cfg.eps), nImg, dim, i2.shift, i2.scale);
  const ffH = swiglu(
    linear(ffIn, w(prefix + ".ff.linear_in.weight"), nImg, dim, inner * 2), nImg, inner * 2);
  outImg = addGated(
    outImg, linear(ffH, w(prefix + ".ff.linear_out.weight"), nImg, inner, dim),
    nImg, dim, i2.gate);

  const fcIn = modulate(layerNorm(outTxt, nTxt, dim, cfg.eps), nTxt, dim, t2.shift, t2.scale);
  const fcH = swiglu(
    linear(fcIn, w(prefix + ".ff_context.linear_in.weight"), nTxt, dim, inner * 2),
    nTxt, inner * 2);
  outTxt = addGated(
    outTxt, linear(fcH, w(prefix + ".ff_context.linear_out.weight"), nTxt, inner, dim),
    nTxt, dim, t2.gate);

  return { img: outImg, txt: outTxt };
}

/**
 * One single-stream block over the concatenated [txt, img] sequence.
 *
 * Convention 7: attention and MLP run in PARALLEL off one fused projection, and
 * their outputs are concatenated into one fused output projection.
 */
export function singleBlock(
  x: Float32Array, nAll: number, cfg: Flux2Config, w: WeightFn, prefix: string,
  mod: ModSet, cos: Float32Array, sin: Float32Array,
): Float32Array {
  const dim = innerDim(cfg);
  const H = cfg.numAttentionHeads;
  const D = cfg.attentionHeadDim;
  const inner = ffInnerDim(cfg);
  const fused = 3 * dim + 2 * inner;

  const xn = modulate(layerNorm(x, nAll, dim, cfg.eps), nAll, dim, mod.shift, mod.scale);
  const qkvMlp = linear(xn, w(prefix + ".attn.to_qkv_mlp_proj.weight"), nAll, dim, fused);

  const q0 = new Float32Array(nAll * dim);
  const k0 = new Float32Array(nAll * dim);
  const v0 = new Float32Array(nAll * dim);
  const mlpIn = new Float32Array(nAll * inner * 2);
  for (let t = 0; t < nAll; t++) {
    const o = t * fused;
    q0.set(qkvMlp.subarray(o, o + dim), t * dim);
    k0.set(qkvMlp.subarray(o + dim, o + 2 * dim), t * dim);
    v0.set(qkvMlp.subarray(o + 2 * dim, o + 3 * dim), t * dim);
    mlpIn.set(qkvMlp.subarray(o + 3 * dim, o + fused), t * inner * 2);
  }

  let q = rmsNormHeads(q0, nAll, H, D, w(prefix + ".attn.norm_q.weight"), cfg.eps);
  let k = rmsNormHeads(k0, nAll, H, D, w(prefix + ".attn.norm_k.weight"), cfg.eps);
  q = applyRope(q, nAll, H, D, cos, sin);
  k = applyRope(k, nAll, H, D, cos, sin);

  const attn = attention(q, k, v0, nAll, H, D);
  const mlp = swiglu(mlpIn, nAll, inner * 2);

  // Fused output: [attn | mlp] -> one projection of width dim + inner.
  const cat = new Float32Array(nAll * (dim + inner));
  for (let t = 0; t < nAll; t++) {
    cat.set(attn.subarray(t * dim, (t + 1) * dim), t * (dim + inner));
    cat.set(mlp.subarray(t * inner, (t + 1) * inner), t * (dim + inner) + dim);
  }
  const out = linear(cat, w(prefix + ".attn.to_out.weight"), nAll, dim + inner, dim);
  return addGated(x, out, nAll, dim, mod.gate);
}

// -- the whole forward ------------------------------------------------------

export interface ForwardInput {
  /** [nImg, inChannels] */
  hiddenStates: Float32Array;
  /** [nTxt, jointAttentionDim] */
  encoderHiddenStates: Float32Array;
  /** [nImg, axes] */
  imgIds: Float32Array;
  /** [nTxt, axes] */
  txtIds: Float32Array;
  timestep: number;
  nImg: number;
  nTxt: number;
}

/**
 * Run the model. `taps` (optional) records each stage under the SAME names the
 * reference dumper emits, so a divergence is attributed to a stage rather than to
 * "the output is wrong".
 */
export function forward(
  input: ForwardInput, cfg: Flux2Config, w: WeightFn, taps?: ForwardTaps,
): Float32Array {
  const nImg = input.nImg;
  const nTxt = input.nTxt;
  const dim = innerDim(cfg);
  const nAll = nTxt + nImg;
  const rec = (n: string, v: Float32Array) => {
    if (taps) taps[n] = v;
  };

  let img = linear(input.hiddenStates, w("x_embedder.weight"), nImg, cfg.inChannels, dim);
  rec("stage_x_embed", img);
  let txt = linear(input.encoderHiddenStates, w("context_embedder.weight"),
                   nTxt, cfg.jointAttentionDim, dim);
  rec("stage_context_embed", txt);

  // Convention 8/9/10: cos-first sinusoid, timestep scaled by 1000, and NO
  // guidance term on this checkpoint.
  const sin0 = timestepEmbedding(input.timestep * TIMESTEP_SCALE, cfg.timestepChannels);
  const t1 = linear(sin0, w("time_guidance_embed.timestep_embedder.linear_1.weight"),
                    1, cfg.timestepChannels, dim);
  const t1a = new Float32Array(dim);
  for (let i = 0; i < dim; i++) t1a[i] = silu(t1[i]);
  const temb = linear(t1a, w("time_guidance_embed.timestep_embedder.linear_2.weight"),
                      1, dim, dim);
  rec("stage_temb", temb);

  // Convention 3: ONE modulation per stream, shared by every block of that kind.
  const tembAct = new Float32Array(dim);
  for (let i = 0; i < dim; i++) tembAct[i] = silu(temb[i]);
  const modImgRaw = linear(tembAct, w("double_stream_modulation_img.linear.weight"),
                           1, dim, dim * 6);
  const modTxtRaw = linear(tembAct, w("double_stream_modulation_txt.linear.weight"),
                           1, dim, dim * 6);
  const modSglRaw = linear(tembAct, w("single_stream_modulation.linear.weight"),
                           1, dim, dim * 3);
  rec("stage_mod_img", modImgRaw);
  rec("stage_mod_txt", modTxtRaw);
  rec("stage_mod_single", modSglRaw);

  const modImg = splitModulation(modImgRaw, dim, 2);
  const modTxt = splitModulation(modTxtRaw, dim, 2);
  const modSgl = splitModulation(modSglRaw, dim, 1)[0];

  // Convention 6: ids concatenated text-first, matching the token order.
  const axes = cfg.axesDimsRope.length;
  const ids = new Float32Array(nAll * axes);
  ids.set(input.txtIds.subarray(0, nTxt * axes), 0);
  ids.set(input.imgIds.subarray(0, nImg * axes), nTxt * axes);
  const rope = ropeTables(ids, nAll, cfg.axesDimsRope, cfg.ropeTheta);

  for (let b = 0; b < cfg.numLayers; b++) {
    const r = doubleBlock(img, txt, nImg, nTxt, cfg, w, "transformer_blocks." + b,
                          modImg, modTxt, rope.cos, rope.sin);
    img = r.img;
    txt = r.txt;
    rec("stage_double_" + b + "_0", txt);
    rec("stage_double_" + b + "_1", img);
  }

  let x = concatTokens(txt, nTxt, img, nImg, dim);
  for (let b = 0; b < cfg.numSingleLayers; b++) {
    x = singleBlock(x, nAll, cfg, w, "single_transformer_blocks." + b, modSgl,
                    rope.cos, rope.sin);
    rec("stage_single_" + b, x);
  }

  // Only the image half becomes the prediction; the text half is discarded.
  const imgOut = x.slice(nTxt * dim);

  // 🚨 CONVENTION 11, and it is the nastiest one in this file: the FINAL AdaLN
  // chunks SCALE FIRST, THEN SHIFT -- the OPPOSITE ORDER from the block modulation
  // above, which is (shift, scale, gate). Two adaptive-norm mechanisms in one model
  // with opposite conventions. Both orderings type-check, both produce an image, and
  // the wrong one is wrong by an amount that looks like a style difference. It comes
  // from `AdaLayerNormContinuous`, a SHARED diffusers component whose ordering was
  // fixed by some other model years earlier; nothing in Flux2 reconciles the two.
  const normOut = linear(tembAct, w("norm_out.linear.weight"), 1, dim, dim * 2);
  const oScale = normOut.subarray(0, dim);
  const oShift = normOut.subarray(dim, dim * 2);
  const normed = modulate(layerNorm(imgOut, nImg, dim, cfg.eps), nImg, dim, oShift, oScale);
  const out = linear(normed, w("proj_out.weight"), nImg, dim, cfg.inChannels);
  rec("stage_proj_out", out);
  return out;
}

// -- the weight manifest ----------------------------------------------------

export interface PlannedWeight {
  name: string;
  /** Rows in torch convention, i.e. the OUT dimension. */
  out: number;
  /** Columns in torch convention, i.e. the IN dimension. 1 for a vector. */
  in: number;
}

/**
 * Exactly the weights `forward` will ask for, as data.
 *
 * This exists so the checkpoint can be validated WITHOUT running the model. The real
 * forward is ~3.9 B parameters; asking "does the file contain what we need, under the
 * names we use, at the shapes we assume" is a question that should cost milliseconds
 * and no GPU, and it is the question that fails first when a loader is wired wrong.
 *
 * It is kept honest by construction rather than by discipline: the test drives the
 * REAL `forward` through a recording weight function and asserts the requested set is
 * exactly this set. A manifest that drifts from the code it describes is worse than
 * no manifest -- it reads as authoritative.
 */
export function planWeights(cfg: Flux2Config): PlannedWeight[] {
  const dim = innerDim(cfg);
  const inner = ffInnerDim(cfg);
  const D = cfg.attentionHeadDim;
  const w: PlannedWeight[] = [
    { name: "x_embedder.weight", out: dim, in: cfg.inChannels },
    { name: "context_embedder.weight", out: dim, in: cfg.jointAttentionDim },
    { name: "time_guidance_embed.timestep_embedder.linear_1.weight",
      out: dim, in: cfg.timestepChannels },
    { name: "time_guidance_embed.timestep_embedder.linear_2.weight", out: dim, in: dim },
    { name: "double_stream_modulation_img.linear.weight", out: dim * 6, in: dim },
    { name: "double_stream_modulation_txt.linear.weight", out: dim * 6, in: dim },
    { name: "single_stream_modulation.linear.weight", out: dim * 3, in: dim },
  ];
  for (let b = 0; b < cfg.numLayers; b++) {
    const p = "transformer_blocks." + b;
    for (const n of ["to_q", "to_k", "to_v", "add_q_proj", "add_k_proj", "add_v_proj",
                     "to_out.0", "to_add_out"]) {
      w.push({ name: p + ".attn." + n + ".weight", out: dim, in: dim });
    }
    for (const n of ["norm_q", "norm_k", "norm_added_q", "norm_added_k"]) {
      w.push({ name: p + ".attn." + n + ".weight", out: D, in: 1 });
    }
    for (const f of ["ff", "ff_context"]) {
      w.push({ name: p + "." + f + ".linear_in.weight", out: inner * 2, in: dim });
      w.push({ name: p + "." + f + ".linear_out.weight", out: dim, in: inner });
    }
  }
  for (let b = 0; b < cfg.numSingleLayers; b++) {
    const p = "single_transformer_blocks." + b;
    w.push({ name: p + ".attn.to_qkv_mlp_proj.weight", out: 3 * dim + 2 * inner, in: dim });
    for (const n of ["norm_q", "norm_k"]) {
      w.push({ name: p + ".attn." + n + ".weight", out: D, in: 1 });
    }
    w.push({ name: p + ".attn.to_out.weight", out: dim, in: dim + inner });
  }
  w.push({ name: "norm_out.linear.weight", out: dim * 2, in: dim });
  w.push({ name: "proj_out.weight", out: cfg.inChannels, in: dim });
  return w;
}
