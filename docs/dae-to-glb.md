# dae-to-glb

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Best-Effort Limits](#best-effort-limits)
- [Blender Path](#blender-path)
- [See Also](#see-also)

## Introduction

dae-to-glb converts COLLADA finds (old Sketchfab downloads, warehouse models) into GLB files using headless three.js loaders. Geometry, rigs, and animations come across; a `SCALE_ROOT` wrapper applies the usual meter normalization. It needs the `three` dependency (`npm install` covers it), plus a small built-in DOM shim. Node has no `DOMParser`, so the tool ships a tag-tree parser covering the geometry/material/scene subset the loader walks.

## Usage

```bash
node converters/dae-to-glb.js <in.dae> [--out out.glb] [--units cm] [--scale 1]
  [--target-max 1.8] [--target-height 1.7] [--z-up] [--keep-textures] [--no-center] [--no-ground]
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.glb` | Output path. |
| `--units` | meters | Source units: `mm\|cm\|m\|km\|in\|ft\|yd`. Sketchfab-era DAEs are usually meters or centimeters. |
| `--scale` | `1` | Extra explicit multiplier, combined with `--units`. |
| `--target-max` | off | Auto-fit the longest bbox side to M meters. |
| `--target-height` | off | Auto-fit the bbox Y height to M meters. |
| `--z-up` | off | Apply a −90° X rotation first. Only for Z-up authored files. |
| `--keep-textures` | off | Attempt to keep embedded textures. Usually fails headless (see below). |
| `--no-center` | off | Keep the original XZ offset. |
| `--no-ground` | off | Keep the original Y offset. |

## Examples

```bash
node converters/dae-to-glb.js ./assets/old-chair.dae --out ./assets/old-chair.glb --target-max 2
# BBox raw: 1.400,0.900,1.200 → factor x1.4285714
# Scene: 3 mesh(es), 0 bone(s), 0 animation(s).
# Wrote assets/old-chair.glb (64.8 KB)
```

Then check scale before trusting it. DAE-era units vary:

```bash
node converters/gltf-report.js ./assets/old-chair.glb
```

## Best-Effort Limits

COLLADA is sprawling, so this tool is honest about what it cannot do:

- **Textures are stripped by default.** Node has no canvas, so texture maps are set to `null` (colors and factors survive). Reattach game textures converted with [texture-convert](texture-convert.md), or use the Blender path.
- **Exotic extensions fall back.** Files leaning on unusual COLLADA extensions fail with the Blender path instead of a corrupt file.

## Blender Path

For textured or complex rigs: File → Import `.dae` → Export glTF 2.0 (`.glb`), +Y Up, Apply Modifiers, UVs + Normals checked. Then continue with [glb-optimize](glb-optimize.md) as usual.

## See Also

- [fbx-to-glb](fbx-to-glb.md): same headless pattern for FBX finds.
- [gltf-report](gltf-report.md): confirm units and verdict after converting.
