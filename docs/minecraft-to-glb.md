# minecraft-to-glb

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [UV mapping](#uv-mapping)
- [Parents](#parents)
- [Limits](#limits)
- [See Also](#see-also)

## Introduction

minecraft-to-glb converts Minecraft block and item JSON models into GLB files with zero dependencies. Elements become quads with verified outward windings, flat normals, and exact per-face UVs; `parent` chains resolve through `--parent-dir`; block units divide by 16 into meters before the shared scale convention applies.

## Usage

```bash
node converters/minecraft-to-glb.js <model.json> [--out out.glb] [--parent-dir dir]
  [--units mm|cm|m|km|in|ft|yd] [--scale 1] [--target-max 2] [--no-center] [--no-ground]
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.glb` | Output path. |
| `--parent-dir` | model folder | Where `parent` names resolve to `<name>.json`. |
| `--units` | meters | Source units after the /16 block step. |
| `--scale` | `1` | Extra explicit multiplier. |
| `--target-max` | off | Auto-fit the longest bbox side to M meters. |
| `--no-center` / `--no-ground` | off | Keep original offsets. |

## Examples

```bash
node converters/minecraft-to-glb.js ./pack/models/block/crate.json --out ./assets/crate.glb --parent-dir ./pack/models/block --target-max 1
# Parents: resolved 1 level(s).
# Scale: x1 offset [-0.500,0.000,-0.500] (size 1.000 x 1.000 x 1.000m)
#  material 'stone': 12 tris
# Wrote ./assets/crate.glb (1.9 KB) — 12 tris, 1 material(s)
```

## UV mapping

UVs follow viewer-outside geometry per face: u runs screen-right, v runs screen-down in vanilla texture space (then flipped for three.js). Texture `rotation` spins corner assignment clockwise as vanilla does. Element `rotation` rotates positions and normals about its origin; UVs stay attached to faces as in game.

## Parents

`parent` chains resolve to `<parent-dir>/<name>.json` up to 8 deep with cycle detection. Namespace prefixes (`minecraft:block/cube`) are stripped, and nested texture vars (`#down` to `#all` to path) resolve fully. Child textures and elements override ancestors. An unresolvable parent exits 1 naming the expected path.

## Limits

- Textures stay references: materials are named after texture path stems. Convert the PNGs with [texture-convert](texture-convert.md) and reattach.
- `cullface`, `shade`, ambient occlusion, `display` transforms, and element `rescale` are out of scope and ignored.
- Groups, overrides, and non-cube geometry are not supported.

## See Also

- [texture-convert](texture-convert.md): convert the pack PNGs the materials name.
- [pk3-to-dir](pk3-to-dir.md): unpack mod zips carrying JSON models.
- [glb-optimize](glb-optimize.md): shrink the result as usual.
