# stl-to-glb

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Flat vs. Smooth](#flat-vs-smooth)
- [See Also](#see-also)

## Introduction

stl-to-glb converts 3D-print finds from Thingiverse, Printables, and friends into three.js-ready GLB files. It auto-detects binary vs. ASCII input (the byte-size check wins, since binary headers may start with the word `solid`), drops zero-area degenerate facets with a count, and keeps flat shading by default. It is zero-dependency and runs with plain Node.

STL files are unitless, but the slicer world is millimeters. So unlike the other converters, `--units` defaults to `mm` here.

## Usage

```bash
node converters/stl-to-glb.js <in.stl> [--out out.glb] [--units mm] [--scale 1] [--target-max 2]
  [--smooth] [--color #rrggbb] [--metal 0.1] [--rough 0.8] [--no-center] [--no-ground]
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.glb` | Output path. |
| `--units` | `mm` | Source units: `mm\|cm\|m\|km\|in\|ft\|yd`. |
| `--scale` | `1` | Extra explicit multiplier, combined with `--units`. |
| `--target-max` | off | Auto-fit the longest bbox side to M meters. |
| `--smooth` | off | Average face normals per position (organic prints). Off keeps crisp flat shading. |
| `--color` | light gray | Base color as `#rrggbb`. |
| `--metal` | `0.1` | `metallicFactor`. |
| `--rough` | `0.8` | `roughnessFactor`. |
| `--no-center` | off | Keep the original XZ offset. |
| `--no-ground` | off | Keep the original Y offset. |

## Examples

Convert a millimeter print into a 20 cm game prop:

```bash
node converters/stl-to-glb.js ./assets/bracket.stl --out ./assets/bracket.glb --target-max 0.3
# STL binary: 1240 facets.
# Scale: x0.001 (--units mm) offset [-0.062,0.000,-0.041] size 0.300 x 0.180 x 0.124m
# Wrote assets/bracket.glb (24.6 KB) — 1240 tris, 622 verts (flat, no UVs)
```

ASCII STL works the same way:

```bash
node converters/stl-to-glb.js assets/tri.ascii.stl --out examples-out/stl-tri.glb
# STL ASCII: 1 facets.
```

## Flat vs. Smooth

The default dedupe key is position + normal, so coplanar facets merge while edges stay crisp, which is what mechanical prints want. Pass `--smooth` for organic sculpts: normals are averaged per position, at the cost of softening hard edges.

> [!NOTE]
> STL carries no UVs, so the output has none either. If the prop needs a textured material, unwrap it in a DCC first, or use a plain PBR color via `--color` / `--metal` / `--rough`.

## See Also

- [glb-optimize](glb-optimize.md): usually with the same `--target-max`.
- [collision-proxy](collision-proxy.md): prints often double as colliders.
