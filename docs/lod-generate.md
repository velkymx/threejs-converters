# lod-generate

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Skinning](#skinning)
- [See Also](#see-also)

## Introduction

lod-generate builds an LOD chain (`.lod1.glb`, `.lod2.glb`, ...) from one GLB using meshoptimizer simplification as pure wasm in Node. No native toolchain. Every level derives fresh from the source, so ratios compose predictably. The input itself stays untouched as LOD0. It needs `@gltf-transform` plus `meshoptimizer` (`npm install` covers both).

## Usage

```bash
node converters/lod-generate.js <in.glb> [--out lod.glb] [--levels 0.5,0.25]
  [--error 0.001] [--lock-border]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.lod.glb` stem | Stem for `<stem>.lodN.glb` outputs. |
| `--levels` | `0.5,0.25` | Tri fractions, strictly decreasing, each in (0,1). |
| `--error` | `0.001` | Deviation bound in model units. |
| `--lock-border` | off | Keep tile edges stitched. Slower; use for chunked terrain. |

## Examples

```bash
node converters/lod-generate.js ./assets/tree.glb --out ./assets/tree.lod.glb --levels 0.5,0.25
# Source: 55320 tris.
# LOD1 (ratio 0.5): 27660 tris → ./assets/tree.lod1.glb (812.4 KB)
# LOD2 (ratio 0.25): 14624 tris → ./assets/tree.lod2.glb (433.1 KB)
```

Swap levels in three.js with `THREE.LOD` at your own distances.

## Skinning

Allowed: simplification remaps every attribute stream (joints and weights included) together, so influence data stays per-vertex consistent. Re-check skinned output with [rig-report](rig-report.md) anyway.

## See Also

- [glb-optimize](glb-optimize.md): clean geometry first (dedup runs per level regardless).
- [budget-gate](budget-gate.md): gate each level against tri budgets.
- [rig-report](rig-report.md): re-check skinned LODs.
