# rig-report

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [What It Audits](#what-it-audits)
- [Examples](#examples)
- [See Also](#see-also)

## Introduction

rig-report audits whether a skeleton will survive three.js. Rig bugs break silently: extra influences are dropped with no error, bad weight sums make meshes breathe, detached joints freeze limbs at the origin. This tool names each problem and points at the fix. It is zero-dependency and runs with plain Node.

> [!NOTE]
> Full influence decoding needs the `.glb` BIN chunk. For `.gltf` with external `.bin` files you get JSON-only checks plus a note to save as `.glb` for the full audit.

## Usage

```bash
node converters/rig-report.js <model.glb> [--json]
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--json` | off | Machine-readable audit (skins, joints, verts, influences, warnings). |

## What It Audits

| Check | Why it breaks ingame |
| ----- | -------------------- |
| >4 influences / vertex | three.js skin indices are `vec4`. Extras are silently ignored, deformation goes wrong. |
| Weight sums ≠ 1 | Mesh inflates/deflates when posed |
| `JOINTS_1` / `WEIGHTS_1` second set | Ignored by three.js. Dead weight. |
| Missing `inverseBindMatrices` | three.js assumes identity bind; only correct if authored that way |
| Detached joints (outside scene graph) | No `matrixWorld` updates. Limbs freeze. |
| Zero / non-uniform joint scale | Skewed or collapsed skin |
| Zero-weight verts | Rigid at bind pose (usually loose parts; info only) |

A file with no skins reports `No skins: static mesh`. Informational, since rigid animations still play.

## Examples

A hostile fixture (generate it with `node examples/make-bad-rig.mjs`):

```bash
node converters/rig-report.js examples-out/bad-rig.glb
# Rig: 1 skin(s), 4 skinned verts, max 6 influences, 0 animation(s)
#  skin0: 6 joints, depth 0, IBM MISSING, detached 1
# Rig:
#   - 4 verts with >4 influences (max 6): three.js drops extras → fix: rig-normalize.js
#   - Weight sums off-1 (min 1.400, max 1.400): mesh breathes when posed → rig-normalize renormalizes.
#   - Skin 0: 1/6 joints outside scene graph (limbs freeze) → reparent under scene root.
#   - Skin 0: no inverseBindMatrices → rig-normalize writes explicit identity IBM.
```

A healthy Mixamo rig:

```bash
node converters/rig-report.js ./assets/samba.glb
# Rig: 2 skin(s), 165960 skinned verts, max 4 influences, 2 animation(s)
# Rig: OK for three.js.
```

## See Also

- [rig-normalize](rig-normalize.md): fix everything flagged above.
- [fbx-to-glb](fbx-to-glb.md): always audit right after converting an FBX.
