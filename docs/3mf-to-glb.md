# 3mf-to-glb

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Units](#units)
- [Limits](#limits)
- [See Also](#see-also)

## Introduction

3mf-to-glb converts 3D manufacturing `.3mf` files (slicers, CAD, print repos) into GLB files using the headless three.js `ThreeMFLoader`, which unzips the OPC package with bundled fflate. A tag-tree DOM shim feeds the loader without a browser, extended with indexed attributes and descendant selectors for its namespace scans. It needs the `three` dependency (`npm install` covers it).

## Usage

```bash
node converters/3mf-to-glb.js <in.3mf> [--out out.glb] [--units mm] [--scale 1]
  [--target-max 0.3] [--target-height 0.2] [--no-center] [--no-ground]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.glb` | Output path. |
| `--units` | `mm` | Source units. The 3MF spec defaults to millimeters, so this does too. |
| `--scale` | `1` | Extra explicit multiplier, combined with `--units`. |
| `--target-max` | off | Auto-fit the longest bbox side to M meters. |
| `--target-height` | off | Auto-fit the bbox Y height to M meters. |
| `--no-center` / `--no-ground` | off | Keep original offsets. |

## Examples

```bash
node converters/3mf-to-glb.js ./assets/bracket.3mf --out ./assets/bracket.glb --target-max 0.3
# BBox raw: 300.000,300.000,31.900 → factor x0.001
# Scene: 1 mesh(es).
# Wrote ./assets/bracket.glb (598.6 KB)
```

## Units

Unlike every other importer here, `--units` defaults to `mm`: the 3MF spec says millimeters when the file states nothing, and slicer files honor that.

## Limits

- Geometry only in practice. Textures strip headless (no canvas), colors and factors survive.
- Non-ZIP input exits 1 with a pointer at [pk3-to-dir](pk3-to-dir.md).
- Beam-lattice extensions parse best-effort; exotic producer extensions fall back to the slicer path.

## See Also

- [stl-to-glb](stl-to-glb.md): plain STL from the same slicers.
- [gltf-report](gltf-report.md): confirm units and verdict after converting.
