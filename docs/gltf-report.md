# gltf-report

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [What It Reports](#what-it-reports)
- [Scale Warnings](#scale-warnings)
- [Verdicts](#verdicts)
- [Examples](#examples)
- [See Also](#see-also)

## Introduction

gltf-report is the first tool to run on any find: it prints tri/vert/draw/material budgets plus a true **world** bounding box with the full node chain (translation, rotation, scale) applied, then gives a ship verdict. It is zero-dependency and runs with plain Node on both `.glb` and `.gltf`.

## Usage

```bash
node converters/gltf-report.js <model.glb|model.gltf> [--json]
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--json` | off | Machine-readable report (budgets, world bbox, scale warnings, verdict). |

## What It Reports

- `verts`, `tris`, `meshes`, `nodes`, `draws` (draw calls = primitives), `materials`, `textures`, `images`, file size.
- World bbox: size in meters, max dimension, center, and `min.y`. These three numbers decide whether a model behaves ingame.
- Fix hints when budgets bust: merge for draws, optimize for tris, texture-convert for weight.

## Scale Warnings

| Flag | Meaning | Fix |
| ---- | ------- | --- |
| `HUGE` (>1000 m) | Suspect millimeters | `glb-optimize --units mm --target-max 2` |
| `LARGE` (>100 m) | Suspect centimeters | `--units cm --target-max 2` |
| `TINY` (<1 cm) / `SMALL` (<10 cm) | Suspect micro units | `--scale 100` or `--target-max 2` |
| `OFF-ORIGIN` | Center far from origin (float jitter) | Default recenter (drop `--no-center`) |
| `FLOATING` / `UNDERGROUND` | Hovers or buried | Default grounding (drop `--no-ground`) |

Two honest limits: primitives without POSITION min/max are counted as partial (re-export the source), and quantized positions are unreadable statically. Run the report on the pre-quantize file instead. Non-triangle primitives (fans/strips) are flagged but draw fine in three.js.

## Verdicts

| Verdict | Rule |
| ------- | ---- |
| `MOBILE-READY` | <100k tris and <50 draws |
| `MOBILE-OK` | <300k tris and <100 draws |
| `DESKTOP-OK` | <1M tris |
| `HEAVY` | Anything above. Optimize or split before use. |

## Examples

```bash
node converters/gltf-report.js ./assets/samba.glb
# Report ./assets/samba.glb (9721.5 KB)
#  verts 165960 | tris 55320 | meshes 2 | nodes 2 | draws 2
#  materials 2 | textures 0 | images 0
#  world 1.834 x 1.700 x 0.343m (max 1.834m) center [-0.00,0.85,0.00] min.y 0.000
# Scale: OK (sane meter range, near origin).
# Verdict: MOBILE-READY — good for games.
```

## See Also

- [budget-gate](budget-gate.md): enforce these budgets in CI (this tool only advises).
- [glb-optimize](glb-optimize.md): the fix for most warnings above.
