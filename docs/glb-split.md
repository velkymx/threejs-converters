# glb-split

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Skinned Splits](#skinned-splits)
- [See Also](#see-also)

## Introduction

glb-split explodes one GLB into many: one file per mesh (`--by mesh`, the default) or one per scene (`--by scene`). Each part is cloned from the source, everything else is detached, and orphans are pruned away. Transforms are kept, so parts stay in world pose and reassemble exactly. It needs the `@gltf-transform` dependencies (`npm install` covers them).

You may reach for it when a find busts tri budgets, when a kit should ship as streamable chunks, or when you want a single prop out of a merged file.

## Usage

```bash
node converters/glb-split.js <in.glb> [--out-dir splits] [--by mesh|scene]
```

Output names combine the input stem, the part index, and a sanitized mesh/scene name, e.g. `kit.mesh2_chair.glb`.

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out-dir` | `splits` | Output directory, created if missing. |
| `--by` | `mesh` | Split granularity: `mesh` or `scene`. |

## Examples

Explode a merged file back into props:

```bash
node converters/glb-split.js ./assets/room.glb --out-dir ./assets/room-parts --by mesh
# Wrote assets/room-parts/room.mesh0_chair.glb (41.0 KB)
# Wrote assets/room-parts/room.mesh1_table.glb (38.4 KB)
# Split ./assets/room.glb → 2 part(s) in ./assets/room-parts/
```

Split a multi-scene file per scene instead:

```bash
node converters/glb-split.js ./assets/level.glb --out-dir ./assets/level-parts --by scene
```

## Skinned Splits

Splitting by mesh keeps joints but can separate a skin from bones it references. The tool prints a warning whenever skins are present, so always re-check skinned parts with [rig-report](rig-report.md) before shipping them.

## See Also

- [glb-merge](glb-merge.md): the inverse, combine parts into one file.
- [budget-gate](budget-gate.md): gate each part against tri/draw budgets.
