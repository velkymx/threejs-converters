# md3-to-glb

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Skins and Shaders](#skins-and-shaders)
- [Limits](#limits)
- [See Also](#see-also)

## Introduction

md3-to-glb converts Quake 3 MD3 models — still exchanged across OpenArena, Tremulous, and Urban Terror mod scenes — into GLB files with zero dependencies. No three.js loader exists, but the format is documented and small, so the tool walks it exactly: header, frames, tags, surfaces. Frame N becomes a static mesh with spec-correct `/64` vertex unscaling and lat/long normal decode; a sibling `.skin` file names materials after their textures.

## Usage

```bash
node converters/md3-to-glb.js <in.md3> [--out out.glb] [--frame 0]
  [--units m|cm|mm|in] [--scale 1] [--target-max 2] [--color #rrggbb] [--metal 0] [--rough 0.9]
  [--no-center] [--no-ground]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.glb` | Output path. |
| `--frame` | `0` | Animation frame to bake as the static mesh. Out-of-range exits 1. |
| `--units` | `m` | Treats Quake units as these (e.g. `--units in` for inch-scale finds). |
| `--scale` | `1` | Extra explicit multiplier, combined with `--units`. |
| `--target-max` | off | Auto-fit the longest bbox side to M meters. |
| `--color` / `--metal` / `--rough` | gray / `0` / `0.9` | Material factors. |
| `--no-center` / `--no-ground` | off | Keep original offsets. |

## Examples

```bash
node converters/pk3-to-dir.js ./assets/pak0.pk3 --out-dir ./assets/pak0
node converters/md3-to-glb.js ./assets/pak0/models/arena.md3 --out ./assets/arena.glb --target-max 4
# MD3: 12 frame(s), 2 tag(s), 3 surface(s) → frame 0.
#  surface 'body': 420 verts, 700 tris → material 'armor'.
# Scale: x1 offset [...] (size 2.100 x 4.000 x 1.050m)
# Wrote ./assets/arena.glb (86.4 KB) — 2100 tris, 3 surface(s)
```

## Skins and Shaders

A sibling `basename.skin` (`meshname,texture/path` lines, as Q3 ships them) names each surface's material after its texture stem, so the GLB arrives with meaningful material names ready for texture reattachment. `.shader` scripts are intentionally not parsed — surface parameters rarely map 1:1 to PBR; set factors with flags instead.

## Limits

- One frame only — MD3 has no skeleton, so use [anim-trim](anim-trim.md)-style frame picks per export, or convert several frames for flipbook-style playback.
- Tags (attachment points) are read and skipped; nothing references them yet.
- Truncated structs, out-of-range indices, and wrong versions exit 1 naming the struct.

## See Also

- [pk3-to-dir](pk3-to-dir.md) — unpack the mod first.
- [md2-to-glb](md2-to-glb.md) — Quake 2 models instead.
- [glb-optimize](glb-optimize.md) — shrink the result as usual.
