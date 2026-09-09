# obj-to-glb

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Limitations](#limitations)
- [See Also](#see-also)

## Introduction

obj-to-glb converts Wavefront OBJ finds into three.js-ready GLB files. It handles `v` / `vt` / `vn` / `f` records with n-gon fan triangulation, computes smooth normals when the file has none, and picks up the diffuse `Kd` color from a sibling `.mtl` file automatically. It is zero-dependency and runs with plain Node.

Scale works like every other model converter here: units are converted to meters, then the mesh is centered on XZ and grounded on Y by default.

## Usage

```bash
node converters/obj-to-glb.js <in.obj> [--out out.glb] [--color #rrggbb] [--metal 0] [--rough 0.9] [--flip-y]
  [--units mm|cm|m|km|in|ft|yd] [--scale 0.01] [--target-max 2] [--no-center] [--no-ground]
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.glb` | Output path. |
| `--color` | MTL `Kd`, else white | Base color override as `#rrggbb`. Pass it to ignore the MTL diffuse. |
| `--metal` | `0` | `metallicFactor`. |
| `--rough` | `0.9` | `roughnessFactor`. |
| `--flip-y` | off | Flip V texture coordinates. |
| `--units` | meters | Source units: `mm\|cm\|m\|km\|in\|ft\|yd`. |
| `--scale` | `1` | Extra explicit multiplier, combined with `--units`. |
| `--target-max` | off | Auto-fit the longest bbox side to M meters. |
| `--no-center` | off | Keep the original XZ offset. |
| `--no-ground` | off | Keep the original Y offset. |

## Examples

Convert a centimeter-authored find into a 2-meter grounded prop:

```bash
node converters/obj-to-glb.js ./assets/chair.obj --out ./assets/chair.glb --units cm --target-max 2
# MTL diffuse Kd → baseColor [0.8,0.6,0.4]
# Scale: x0.01 offset [0.000,0.000,0.000] (size 1.200 x 2.000 x 1.100m)
# Wrote assets/chair.glb (48.2 KB), 2400 tris, 1302 verts, +UVs
```

## Limitations

- All groups and objects merge into a single mesh with one material. Per-part splits need [glb-split](glb-split.md) after conversion, or a DCC round-trip.
- Only the MTL diffuse color (`Kd`) is read. Textures referenced by the MTL are not embedded. Convert those with [texture-convert](texture-convert.md) and reattach them in three.js.
- The OBJ `-Y-up kept as-is` assumption holds for the common case; exotic up-axis files should go through Blender instead.

## See Also

- [gltf-report](gltf-report.md): check the budget and scale verdict next.
- [glb-optimize](glb-optimize.md): shrink and normalize the result.
