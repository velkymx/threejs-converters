# material-normalize

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [What It Fixes](#what-it-fixes)
- [Examples](#examples)
- [See Also](#see-also)

## Introduction

material-normalize forces every material in a GLB into sane lit PBR metal/rough form for three.js. Finds arrive with unlit extensions, legacy specular-gloss models, double-sided everything, stray BLEND modes, and out-of-range factors. Each one renders wrong or slow with no error. This tool fixes all of it in one pass and merges duplicate materials. It needs the `@gltf-transform` dependencies (`npm install` covers them).

Run it before [glb-optimize](glb-optimize.md) so the optimizer works on clean materials.

## Usage

```bash
node converters/material-normalize.js <in.glb> [--out out.glb] [--keep-double]
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.mat.glb` | Output path. |
| `--keep-double` | off | Keep `doubleSided` where authored. By default everything becomes front-side. |

## What It Fixes

1. **Spec/gloss → metal/rough** via the `metalRough` transform (no-op if already PBR).
2. **Unlit → lit**: drops `KHR_materials_unlit`, keeping the base color. Unlit finds render flat under scene lighting; lit is what games want.
3. **Double-sided → front-side**, unless `--keep-double`. Blanket double-siding costs overdraw and invites shadow acne.
4. **BLEND → OPAQUE** when base-color alpha is 1 and no base-color texture is present. Stray transparency modes break sorting for zero benefit.
5. **Clamps** metallic, roughness, and emissive factors into range.
6. **Dedups** materials with identical factors and textures, rewiring primitives to the survivor.

## Examples

```bash
node converters/material-normalize.js ./assets/find.glb --out ./assets/find.mat.glb
# metalRough: KHR_materials_pbrSpecularGlossiness not found on document.
# Materials: 4 → 2 (2 duplicates merged)
# Fixes: 1 unlit→lit, 3 double→front, 1 blend→opaque, 2 factor(s) clamped
# Wrote ./assets/find.mat.glb (88.0 KB)
```

Already clean? The counts read zero and the file passes through unchanged. Safe to run blindly in a pipeline.

## See Also

- [glb-optimize](glb-optimize.md): run next, as usual.
- [gltf-report](gltf-report.md): confirm material counts dropped.
