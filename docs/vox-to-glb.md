# vox-to-glb

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Units](#units)
- [Limits](#limits)
- [See Also](#see-also)

## Introduction

vox-to-glb converts MagicaVoxel `.vox` files (voxel art and mods) into GLB files using the headless three.js `VOXLoader` with its greedy mesher. Voxels become a vertex-colored mesh (`COLOR_0`), scene-graph transforms apply where present, and files without a scene graph get their models meshed directly. It needs the `three` dependency (`npm install` covers it).

## Usage

```bash
node converters/vox-to-glb.js <in.vox> [--out out.glb] [--units m] [--scale 1]
  [--target-max 1] [--target-height 1] [--no-center] [--no-ground]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.glb` | Output path. |
| `--units` | raw (1 unit/voxel) | Source units: `mm\|cm\|m\|km\|in\|ft\|yd`. A voxel counts as 1 unit. |
| `--scale` | `1` | Extra explicit multiplier, combined with `--units`. |
| `--target-max` | off | Auto-fit the longest bbox side to M meters. The usual fix. |
| `--target-height` | off | Auto-fit the bbox Y height to M meters. |
| `--no-center` / `--no-ground` | off | Keep original offsets. |

## Examples

```bash
node converters/vox-to-glb.js ./assets/sword.vox --out ./assets/sword.glb --target-max 1
# BBox raw: 8.000,32.000,8.000 voxels → factor x0.03125
# Scene: 1 mesh(es), vertex colors kept.
# Wrote ./assets/sword.glb (12.4 KB)
```

## Units

Voxels are unitless. A 32-wide model at 1 unit per voxel is 32 meters. Always pass `--target-max` (props) or `--target-height` (characters) unless the file was authored at meter scale.

## Limits

- Versions other than 150/200 are refused with the cause; the loader itself just logs and returns nothing.
- Node-less files (old exporters) meshed directly with a note. Same geometry, no transforms.
- Palette-less models use the MagicaVoxel default palette, matching editor behavior.

## See Also

- [md3-to-glb](md3-to-glb.md): Quake 3 models instead.
- [collision-proxy](collision-proxy.md): voxel props make great colliders.
- [glb-optimize](glb-optimize.md): shrink the result as usual.
