# glb-merge

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Mixed Units](#mixed-units)
- [See Also](#see-also)

## Introduction

glb-merge concatenates two or more GLB/GLTF files into a single GLB: one download, one `GLTFLoader` call, fewer draws. Scenes, meshes, materials, and animations from every input are carried over, compatible primitives are fused with `join`, and the result is deduplicated and pruned. It needs the `@gltf-transform` dependencies (`npm install` covers them).

## Usage

```bash
node converters/glb-merge.js <a.glb> <b.glb> [...] [--out merged.glb] [--no-join] [--no-prune]
```

At least two inputs are required.

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | `merged.glb` | Output path. |
| `--no-join` | off | Skip fusing compatible primitives (keeps every draw call). |
| `--no-prune` | off | Skip the dedup + prune pass (larger file, useful for debugging). |

What runs by default: merge every input → `join()` compatible primitives (split by material automatically, so nothing visually changes) → `dedup()` + `prune()` → `unpartition()` so the GLB holds exactly one buffer.

> [!NOTE]
> Skins and skeletons merge as-is. There is no skeleton retargeting, so merging two rigged characters gives you two skeletons in one file, which is correct but rarely what you want. Verify skinned merges with [rig-report](rig-report.md).

## Examples

Combine two props into a room file:

```bash
node converters/glb-merge.js ./assets/chair.glb ./assets/table.glb --out ./assets/room.glb
# Base ./assets/chair.glb
#  + ./assets/table.glb
# Merged: 2 scene(s), 4 mesh(es), 3 mat(s), 0 anim(s)
# Join: now 3 mesh(es)
# Wrote ./assets/room.glb (84.2 KB, inputs 96.0 KB)
# Next: node converters/gltf-report.js ./assets/room.glb
```

## Mixed Units

Scales are kept as-authored: merging a millimeter prop with a meter prop keeps both wrong together. Normalize the inputs first with [glb-optimize](glb-optimize.md) (`--target-max`) when finds came in mixed units, then merge.

## See Also

- [glb-split](glb-split.md): the inverse, explode one GLB into parts.
- [gltf-report](gltf-report.md): confirm draws and size after merging.
- [budget-gate](budget-gate.md): enforce draw/tri budgets on the merge in CI.
