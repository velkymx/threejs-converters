# rig-normalize

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [What It Fixes](#what-it-fixes)
- [Ordering](#ordering)
- [Examples](#examples)
- [See Also](#see-also)

## Introduction

rig-normalize makes any skinned GLB three.js-safe. It clamps bone influences to the `vec4` hard limit, renormalizes weights, strips dead second influence sets, and writes explicit identity inverse-bind matrices. Fixes are behavior-preserving except where the source was already broken (extra influences three.js would have dropped anyway). It needs `@gltf-transform/core` (`npm install` covers it).

Check first with [rig-report](rig-report.md) — only normalize when flagged.

## Usage

```bash
node converters/rig-normalize.js <in.glb> [--out out.rig.glb]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.rig.glb` | Output path. |

## What It Fixes

1. **>4 influences → top 4 by weight, renormalized.** three.js drops extras silently; keeping the strongest four preserves the visible deformation.
2. **Weight sums ≠ 1 → renormalized.** Stops the mesh breathing when posed.
3. **`JOINTS_1` / `WEIGHTS_1` merged into the top 4, then stripped.** Dead weight in three.js — gone.
4. **Missing IBM → explicit identity matrices.** This equals the three.js fallback assumption, now visible to every loader instead of implied.
5. **WEIGHTS rewritten as FLOAT.** Exact sums — `UBYTE` rounding would re-break normalization.
6. **Zero-weight verts pinned to their first joint.** They were rigid anyway; now explicitly so.

## Ordering

Run rig-normalize **first**, then [glb-optimize](glb-optimize.md). Quantization leaves `JOINTS`/`WEIGHTS` alone, so optimizing after is safe — but normalizing after quantizing would fight the packed data.

## Examples

```bash
node converters/rig-normalize.js examples-out/bad-rig.glb --out examples-out/good-rig.glb
# Wrote examples-out/good-rig.glb — 1 skinned prim(s): 4 verts clamped to 4, 4 renormalized, 1 2nd-set(s) stripped, 1 IBM added.
# Next: node converters/rig-report.js examples-out/good-rig.glb  (expect OK)
```

## See Also

- [rig-report](rig-report.md) — audit before and after.
- [anim-trim](anim-trim.md) — trim the rigged file's clips next.
