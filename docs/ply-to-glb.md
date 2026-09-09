# ply-to-glb

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Formats and Limits](#formats-and-limits)
- [See Also](#see-also)

## Introduction

ply-to-glb converts PLY scan finds — photogrammetry exports, MeshLab cleanups, scanner output — into three.js-ready GLB files. It parses ASCII, little-endian binary, and big-endian binary PLYs with zero dependencies: positions plus normals, UVs, and vertex colors when present, `vertex_indices` faces with n-gon fan triangulation, smooth normals computed when the file has none.

Scale works like every other model converter here: units are converted to meters, then the mesh is centered on XZ and grounded on Y by default.

## Usage

```bash
node converters/ply-to-glb.js <in.ply> [--out out.glb] [--color #rrggbb] [--metal 0] [--rough 0.9]
  [--units mm|cm|m|km|in|ft|yd] [--scale 0.01] [--target-max 2] [--no-center] [--no-ground]
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.glb` | Output path. |
| `--color` | vertex colors, else gray | Base color override as `#rrggbb`. Pass it to ignore embedded vertex colors. |
| `--metal` | `0` | `metallicFactor`. |
| `--rough` | `0.9` | `roughnessFactor`. |
| `--units` | meters | Source units: `mm\|cm\|m\|km\|in\|ft\|yd`. Scans are often millimeters. |
| `--scale` | `1` | Extra explicit multiplier, combined with `--units`. |
| `--target-max` | off | Auto-fit the longest bbox side to M meters. |
| `--no-center` | off | Keep the original XZ offset. |
| `--no-ground` | off | Keep the original Y offset. |

## Examples

Convert a millimeter scan into a 2-meter prop, keeping its vertex colors:

```bash
node converters/ply-to-glb.js ./assets/scan.ply --out ./assets/scan.glb --units mm --target-max 2
# PLY binary_little_endian: 48210 verts, 96000 tris, +colors.
# Scale: x0.001 (--units mm) offset [-0.311,0.000,-0.204] size 2.000 x 1.420 x 1.104m
# Vertex colors kept as COLOR_0 (base white).
# Wrote assets/scan.glb (1150.4 KB) — 96000 tris, 48210 verts
```

## Formats and Limits

- **Supported:** `ascii`, `binary_little_endian`, `binary_big_endian`; all scalar property types (`char` through `double`); extra fixed-stride elements are skipped.
- **Point clouds and splats refused:** a PLY with vertices but no faces is not a mesh. The tool exits 1 with the MeshLab Poisson-reconstruction path instead of guessing.
- **Exotic elements refused:** non-vertex/face elements carrying list properties cannot be stride-skipped; the tool names the element and exits 1.
- Embedded `red/green/blue` (`uchar` or float) become `COLOR_0` with a white base factor, so three.js renders them directly.

## See Also

- [gltf-report](gltf-report.md) — check the budget and scale verdict next.
- [glb-optimize](glb-optimize.md) — scans are heavy; weld + quantize usually pay off.
