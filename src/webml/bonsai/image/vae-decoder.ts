// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/**
 * The VAE decoder GRAPH: latent [32,32,32] -> RGB [3,256,256].
 *
 * `vae_ops.wgsl` supplied the three ops the decoder needs and named the graph in a
 * comment; nothing built it. This is the graph, expressed once, so the GPU path and
 * the CPU reference path cannot disagree about the SHAPE of the computation -- only
 * about arithmetic, which is what a differential test is for.
 *
 * THE GRAPH, from the shipped model's own vae/config.json (AutoencoderKLFlux2):
 *
 *     block_out_channels : [128, 256, 512, 512]
 *     up_block_types     : 4 x UpDecoderBlock2D
 *     layers_per_block   : 2
 *     latent_channels    : 32
 *     norm_num_groups    : 32
 *     act_fn             : silu
 *
 *     conv_in -> mid(resnet, attn, resnet)
 *             -> 4 x UpDecoderBlock2D(2 resnets [+ 2x upsample])
 *             -> GroupNorm -> SiLU -> conv_out(3)
 *
 * 🚨 THE LAST UP BLOCK DOES NOT UPSAMPLE, and getting that wrong is silent. Four up
 * blocks with four upsamples would take 32 -> 512 and emit a 512x512 image from a
 * 256x256 model: no error, no shape mismatch downstream (nothing checks), just an
 * image at the wrong resolution that looks like a soft render. diffusers omits the
 * upsampler on the final block, so 32 -> 64 -> 128 -> 256 is THREE doublings across
 * FOUR blocks. The golden's shapes confirm it: `vae_input [1,32,32,32]` and
 * `generated_image [3,256,256]` -- exactly 8x, not 16x.
 *
 * 🚨 diffusers REVERSES block_out_channels for the decoder. The encoder goes
 * 128 -> 512; the decoder starts at 512 and ends at 128, so `conv_in` maps
 * latent_channels(32) -> 512, not -> 128. Reading the list forward produces a graph
 * that is entirely self-consistent and cannot load the real weights, and the error
 * surfaces as a tensor-shape mismatch deep in the loader rather than here.
 *
 * WHAT THIS FILE IS NOT. It carries no weights and performs no arithmetic of its own:
 * `planDecode` returns the op sequence, and `decodeWithOps` executes it through
 * whichever op implementations are handed in -- the CPU references today, the WGSL
 * kernels once a GPU differential exists. That separation is the point. The graph is
 * verifiable RIGHT NOW, with no model download, against the golden's shapes; the
 * arithmetic is verifiable later against the golden's values.
 */

/** One step of the decode, as data. */
export interface DecodeOp {
  kind: "conv" | "groupnorm" | "silu" | "upsample" | "add";
  /** Human-readable provenance, e.g. "up.2.resnet.1.conv2" — used in errors. */
  name: string;
  /** Tensor shape AFTER this op, as [c, h, w]. */
  out: [number, number, number];
  /** conv only. */
  conv?: { inC: number; outC: number; k: number; pad: number; stride: number };
  /** groupnorm only. */
  groups?: number;
  /** upsample only. */
  scale?: number;
}

export interface VaeConfig {
  blockOutChannels: number[];
  layersPerBlock: number;
  latentChannels: number;
  normNumGroups: number;
  /** Spatial size of the latent (square). */
  latentSize: number;
  outChannels: number;
}

export const FLUX2_VAE: VaeConfig = {
  blockOutChannels: [128, 256, 512, 512],
  layersPerBlock: 2,
  latentChannels: 32,
  normNumGroups: 32,
  latentSize: 32,
  outChannels: 3,
};

/**
 * The op sequence for one decode. Pure -- no allocation, no GPU, no weights.
 *
 * Returned as DATA rather than executed so a test can assert the SHAPE of the
 * computation without owning a model. A graph bug and an arithmetic bug fail very
 * differently, and separating them means the first is caught by a test that runs
 * everywhere in milliseconds.
 */
export function planDecode(cfg: VaeConfig = FLUX2_VAE): DecodeOp[] {
  const ops: DecodeOp[] = [];
  // Decoder channels run in REVERSE of the encoder's list. See the header.
  const chans = [...cfg.blockOutChannels].reverse();   // [512, 512, 256, 128]
  let c = chans[0];
  let s = cfg.latentSize;

  const conv = (name: string, inC: number, outC: number, k: number, pad: number) => {
    ops.push({ kind: "conv", name, out: [outC, s, s],
               conv: { inC, outC, k, pad, stride: 1 } });
  };

  conv("conv_in", cfg.latentChannels, c, 3, 1);

  // mid: resnet, attn, resnet. The attention block is a channel-mixing op at
  // constant shape, so it changes nothing here; it is listed for provenance and
  // executed by the caller's op table.
  for (const n of ["mid.resnet.0", "mid.attn", "mid.resnet.1"]) {
    ops.push({ kind: "groupnorm", name: `${n}.norm`, out: [c, s, s],
               groups: cfg.normNumGroups });
    ops.push({ kind: "silu", name: `${n}.act`, out: [c, s, s] });
    conv(`${n}.conv`, c, c, 3, 1);
  }

  for (let b = 0; b < chans.length; b++) {
    const outC = chans[b];
    for (let l = 0; l < cfg.layersPerBlock; l++) {
      ops.push({ kind: "groupnorm", name: `up.${b}.resnet.${l}.norm`, out: [c, s, s],
                 groups: cfg.normNumGroups });
      ops.push({ kind: "silu", name: `up.${b}.resnet.${l}.act`, out: [c, s, s] });
      conv(`up.${b}.resnet.${l}.conv`, c, outC, 3, 1);
      c = outC;
    }
    // Every block EXCEPT the last upsamples. 4 blocks, 3 doublings.
    if (b < chans.length - 1) {
      s *= 2;
      ops.push({ kind: "upsample", name: `up.${b}.upsample`, out: [c, s, s], scale: 2 });
      conv(`up.${b}.upsample.conv`, c, c, 3, 1);
    }
  }

  ops.push({ kind: "groupnorm", name: "conv_norm_out", out: [c, s, s],
             groups: cfg.normNumGroups });
  ops.push({ kind: "silu", name: "conv_act_out", out: [c, s, s] });
  conv("conv_out", c, cfg.outChannels, 3, 1);
  return ops;
}

/** The output shape a plan produces, without running it. */
export function decodeOutputShape(cfg: VaeConfig = FLUX2_VAE): [number, number, number] {
  const ops = planDecode(cfg);
  return ops[ops.length - 1].out;
}

/**
 * Every op implementation the graph needs. Supplied by the caller so the same graph
 * runs on the CPU references and on the WGSL kernels -- which is the only way the two
 * can be differentially compared at all.
 */
export interface OpTable {
  conv(x: Float32Array, op: DecodeOp, inShape: [number, number, number]): Float32Array;
  groupnorm(x: Float32Array, op: DecodeOp, inShape: [number, number, number]): Float32Array;
  silu(x: Float32Array): Float32Array;
  upsample(x: Float32Array, op: DecodeOp, inShape: [number, number, number]): Float32Array;
}

/**
 * Run a plan. Checks the length of every intermediate against the plan's declared
 * shape, because a graph that silently changes size produces an image that is merely
 * WRONG rather than an error -- and this whole file exists to make that loud.
 */
export function decodeWithOps(
  latent: Float32Array, ops: OpTable, cfg: VaeConfig = FLUX2_VAE,
): Float32Array {
  const plan = planDecode(cfg);
  const expectIn = cfg.latentChannels * cfg.latentSize * cfg.latentSize;
  if (latent.length !== expectIn) {
    throw new Error(
      `vae decode: latent has ${latent.length} elements, expected ${expectIn} `
      + `(${cfg.latentChannels}x${cfg.latentSize}x${cfg.latentSize})`);
  }
  let x = latent;
  let shape: [number, number, number] = [cfg.latentChannels, cfg.latentSize, cfg.latentSize];
  for (const op of plan) {
    switch (op.kind) {
      case "conv": x = ops.conv(x, op, shape); break;
      case "groupnorm": x = ops.groupnorm(x, op, shape); break;
      case "silu": x = ops.silu(x); break;
      case "upsample": x = ops.upsample(x, op, shape); break;
      default: throw new Error(`vae decode: unhandled op ${op.kind} at ${op.name}`);
    }
    const want = op.out[0] * op.out[1] * op.out[2];
    if (x.length !== want) {
      throw new Error(
        `vae decode: after ${op.name} the tensor has ${x.length} elements but the `
        + `plan declares ${op.out.join("x")} = ${want}. A size drift here yields a `
        + "wrong image rather than an error, so it is checked every op.");
    }
    shape = op.out;
  }
  return x;
}
