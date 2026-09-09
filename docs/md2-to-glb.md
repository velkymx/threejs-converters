# md2-to-glb

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Frames](#frames)
- [Limits](#limits)
- [See Also](#see-also)

## Introduction

md2-to-glb converts Quake 2 MD2 models (retro FPS art and mods) into GLB files using the headless three.js `MD2Loader`. MD3's older sibling stores vertex-animation frames instead of a skeleton, so the tool bakes `--frame` N as a static mesh with its own IDP2 magic/version/truncation pre-checks (the loader only logs and returns nothing on bad input). It needs the `three` dependency (`npm install` covers it).

## Usage

```bash
node converters/md2-to-glb.js <in.md2> [--out out.glb] [--frame 0]
  [--units mm|cm|m|km|in|ft|yd] [--scale 1] [--target-max 2] [--target-height 1.7] [--color #rrggbb] [--metal 0] [--rough 0.9]
  [--no-center] [--no-ground]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.glb` | Output path. |
| `--frame` | `0` | Animation frame to bake. Out-of-range exits 1. |
| `--units` | raw units (1:1) | Source units: `mm\|cm\|m\|km\|in\|ft\|yd`. |
| `--scale` | `1` | Extra explicit multiplier, combined with `--units`. |
| `--target-max` | off | Auto-fit the longest bbox side to M meters. |
| `--target-height` | off | Auto-fit the bbox Y height to M meters. |
| `--color` / `--metal` / `--rough` | gray / `0` / `0.9` | Material factors. |
| `--no-center` / `--no-ground` | off | Keep original offsets. |

## Examples

```bash
node converters/md2-to-glb.js ./assets/ogro.md2 --out ./assets/ogro.glb --target-max 2 --frame 0
# MD2: 198 frame(s) → baked 'frame0'.
# BBox raw: 1.200,2.400,1.100 → factor x1
# Wrote ./assets/ogro.glb (96.0 KB)
```

## Frames

The base mesh holds frame 0 expanded per triangle, and every other frame rides along as a morph target in the same layout. Baking copies one morph over the base with zero reindexing, then drops the rest. Convert several `--frame` picks for idle/attack poses.

## Limits

- Static poses only. Morph clips are dropped, not exported as animations.
- MD2 skins are ignored entirely. Reattach game textures via [texture-convert](texture-convert.md).
- Quake 3 models use [md3-to-glb](md3-to-glb.md) instead. Wrong magic is refused with that pointer.

## See Also

- [md3-to-glb](md3-to-glb.md): Quake 3 models instead.
- [glb-optimize](glb-optimize.md): shrink the result as usual.
