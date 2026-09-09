# svg-to-glb

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Coordinate Handling](#coordinate-handling)
- [Limits](#limits)
- [See Also](#see-also)

## Introduction

svg-to-glb converts SVG vector art (logos, icons) into extruded GLB meshes using the headless three.js `SVGLoader` plus `ExtrudeGeometry`. Paths group by fill color into one mesh per material, unfilled strokes skip with a count, and a DOM shim feeds the loader without a browser. It needs the `three` dependency (`npm install` covers it).

## Usage

```bash
node converters/svg-to-glb.js <in.svg> [--out out.glb] [--depth 10]
  [--units px] [--scale 1] [--target-max 1] [--no-center] [--no-ground]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.glb` | Output path. |
| `--depth` | `10` | Extrusion depth in SVG units, before scale flags apply. |
| `--units` | raw pixels | Adds `px` alongside the usual units. |
| `--scale` | `1` | Extra explicit multiplier. |
| `--target-max` | off | Auto-fit the longest bbox side to M meters. |
| `--target-height` | off | Auto-fit the bbox Y height to M meters. |
| `--no-center` / `--no-ground` | off | Keep original offsets. |

## Examples

```bash
node converters/svg-to-glb.js ./assets/logo.svg --out ./assets/logo.glb --target-max 1
# Shapes: 2 shape(s) in 2 fill(s), depth 10.
# BBox raw: 80.000,40.000,10.000 → factor x0.0125
# Wrote ./assets/logo.glb (11.6 KB)
```

## Coordinate Handling

SVG y runs down, three.js y runs up. Geometry mirrors with `scale(1,-1,1)`, triangle winding flips back, and normals recompute, so front faces stay front (verified by signed volume).

## Limits

- Filled shapes only. Strokes have no area and skip with a count.
- Gradients and filters are loader-level best effort; flat fills are exact.
- Non-SVG input (no `<svg>` root) exits 1.

## See Also

- [glb-optimize](glb-optimize.md): shrink the result as usual.
