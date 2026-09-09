# 3ds-to-glb

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Best-Effort Limits](#best-effort-limits)
- [Blender Path](#blender-path)
- [See Also](#see-also)

## Introduction

3ds-to-glb converts legacy 3ds Max finds into GLB files using the headless three.js `TDSLoader`. Geometry comes across with a `SCALE_ROOT` wrapper applying the usual meter normalization. It needs the `three` dependency (`npm install` covers it).

## Usage

```bash
node converters/3ds-to-glb.js <in.3ds> [--out out.glb] [--units cm] [--scale 1]
  [--target-max 2] [--target-height 1.7] [--z-up] [--keep-textures] [--no-center] [--no-ground]
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.glb` | Output path. |
| `--units` | meters | Source units: `mm\|cm\|m\|km\|in\|ft\|yd`. Max-era files are often inches or centimeters. |
| `--scale` | `1` | Extra explicit multiplier, combined with `--units`. |
| `--target-max` | off | Auto-fit the longest bbox side to M meters. |
| `--target-height` | off | Auto-fit the bbox Y height to M meters. |
| `--z-up` | off | Apply a −90° X rotation first. 3ds Max is Z-up, so try this when the model arrives lying down. |
| `--keep-textures` | off | Attempt to keep embedded textures. Usually fails headless (see below). |
| `--no-center` | off | Keep the original XZ offset. |
| `--no-ground` | off | Keep the original Y offset. |

## Examples

```bash
node converters/3ds-to-glb.js ./assets/retro-car.3ds --out ./assets/retro-car.glb --units in --target-max 4
# BBox raw: 180.000,72.000,60.000 → factor x0.02222222
# Scene: 12 mesh(es). (3DS rigs/anims do not survive, geometry only.)
# Wrote assets/retro-car.glb (210.3 KB)
```

## Best-Effort Limits

- **Geometry only.** 3DS rigs and animations do not survive in practice. The tool says so in its output instead of implying otherwise.
- **Textures are stripped by default.** Node has no canvas; reattach game textures converted with [texture-convert](texture-convert.md), or use the Blender path.

## Blender Path

For textured scenes: File → Import `.3ds` → Export glTF 2.0 (`.glb`), +Y Up, Apply Modifiers, UVs + Normals checked. Then continue with [glb-optimize](glb-optimize.md) as usual.

## See Also

- [dae-to-glb](dae-to-glb.md): same headless pattern for COLLADA finds.
- [gltf-report](gltf-report.md): confirm units and verdict after converting.
