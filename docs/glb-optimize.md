# glb-optimize

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [What Runs](#what-runs)
- [Examples](#examples)
- [When to Skip Stages](#when-to-skip-stages)
- [See Also](#see-also)

## Introduction

glb-optimize is the workhorse: it scale-normalizes a model to meters and then shrinks it for the web (dedup, instancing, palette reduction, pruning, resampling, sparse accessors, welding, quantization, and WebP texture compression). Run it on nearly every find before shipping. It needs `@gltf-transform` and `sharp` (`npm install` covers both).

On skinned files, run [rig-normalize](rig-normalize.md) first. Quantization leaves `JOINTS`/`WEIGHTS` alone, but the scale stage must wrap a clean rig.

## Usage

```bash
node converters/glb-optimize.js <in.glb|in.gltf> [--out out.glb] [--texture-size 2048]
  [--no-compress] [--quant 14] [--no-quantize] [--no-scale]
  [--units mm|cm|m|km|in|ft|yd] [--scale 0.01] [--target-max 2] [--target-height 1.8]
  [--no-center] [--no-ground]
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.opt.glb` | Output path. |
| `--texture-size` | `2048` | Max texture dimension for WebP compression (1..16384). |
| `--no-compress` | off | Skip texture compression (geometry stages still run). |
| `--quant` | `14` | POSITION quantization bits (1..16; normals 10, UVs 12, colors 8). |
| `--no-quantize` | off | Skip quantization entirely. Use if the target viewer lacks `KHR_mesh_quantization`. |
| `--no-scale` | off | Skip the scale-normalize stage (inspect-only optimization). |
| `--units` | meters | Source units: `mm\|cm\|m\|km\|in\|ft\|yd`. |
| `--scale` | `1` | Extra explicit multiplier, combined with `--units`. |
| `--target-max` | off | Auto-fit the longest bbox side to M meters. |
| `--target-height` | off | Auto-fit the bbox Y height to M meters. |
| `--no-center` | off | Keep the original XZ offset. |
| `--no-ground` | off | Keep the original Y offset. |

## What Runs

In order, each run performs:

1. **Scale-normalize**: measures the raw world bbox, computes one uniform factor, and wraps every scene in a `SCALE_ROOT` node with that scale plus the centering offset. A uniform wrapper is exact under any hierarchy or rotation, and safe for skins (uniform scale cancels in skinning matrices). Still over 1000 m or under 1 cm afterwards? The tool warns, usually a `--units` mixup.
2. **dedup, instance, palette, prune, resample, sparse, weld**: remove duplicates, fuse instances, shrink palettes, drop unused data, resample animations, sparsify, and weld vertices.
3. **quantize**: packs positions/normals/UVs (skips `JOINTS`/`WEIGHTS`).
4. **textureCompress**: resizes and encodes textures to WebP.

## Examples

```bash
node converters/glb-optimize.js ./assets/chair.glb --out ./assets/chair.opt.glb --target-max 2
# Load ./assets/chair.glb (96.0 KB)…
# BBox raw: min [-1.000,0.000,0.000] max [1.000,2.000,0.000] size [2.000,2.000,0.000]
# Scale: already normalized (factor 1, offset 0). No wrapper.
# Compress textures → webp max 2048px…
# Wrote ./assets/chair.opt.glb (41.3 KB), 57.0% smaller
# Load in three.js: GLTFLoader + WebP support is built-in. 1 unit = 1 meter.
```

Already normalized? The scale stage says so and skips the wrapper. No harm re-running.

## When to Skip Stages

- `--no-scale`: the file is already meter-scale and grounded; you only want the shrink.
- `--no-quantize`: the target viewer cannot read `KHR_mesh_quantization`.
- `--no-compress`: textures are already WebP, or you manage them separately with [texture-convert](texture-convert.md).

## See Also

- [material-normalize](material-normalize.md): run before optimizing when materials are messy.
- [gltf-report](gltf-report.md): confirm the result: size, draws, verdict.
