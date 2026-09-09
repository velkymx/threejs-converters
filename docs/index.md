# threejs-converters

- [Introduction](#introduction)
- [Requirements](#requirements)
- [Conventions](#conventions)
- [Budgets](#budgets)
- [Pipelines](#pipelines)
    - [Static Prop](#static-prop)
    - [3D Print Find](#3d-print-find)
    - [Mixamo / FBX Character](#mixamo--fbx-character)
    - [Texture Set](#texture-set)
    - [Mods (Quake, Voxel, Minecraft)](#mods-quake-voxel-minecraft)
    - [Level / Ship-Ready Character](#level--ship-ready-character)
- [Tool Map](#tool-map)
- [Examples](#examples)

## Introduction

threejs-converters is a set of single-file Node scripts that turn internet finds (OBJ, STL, FBX, TGA, HDR, Quake mods, Minecraft models, voxel art, and more) into game-ready three.js assets. Each script in `converters/` is standalone: you may run any of them with plain `node`, no build step, no framework:

```bash
node converters/<tool>.js --help
```

Every tool follows the same contract: `--help` prints usage and exits, errors explain the fix (usually naming the next tool to run), and outputs default toward three.js conventions: 1 unit = 1 meter, Y-up, centered and grounded models, typed textures.

## Requirements

You may install everything with npm. Node 20 or newer is required:

```bash
npm install
```

Dependencies are `sharp`, `@gltf-transform/core`, `@gltf-transform/functions`, and `three`. Several tools are zero-dependency and run with plain Node — the tool map below marks each one.

## Conventions

three.js expects **1 unit = 1 meter**, Y-up, sRGB color maps, linear data maps, and no more than 4 bone influences per vertex. Internet finds honor none of this, so every model converter in this project defaults toward that target:

- Models are centered on XZ and rested on Y (`min.y = 0`) unless you pass `--no-center` / `--no-ground`.
- Scale flags are shared across the model converters: `--units mm|cm|m|km|in|ft|yd`, `--scale FACTOR`, `--target-max M`, `--target-height M`. (Packers, reporters, and the gate have their own flags.)
- Typical values: Mixamo finds want `--units cm --target-height 1.7`, print finds want `--units mm`, generic props want `--target-max 2`.

> [!NOTE]
> Scale bugs are the most common way a find breaks ingame (wrong units wreck cameras, physics, and shadows at the same time). When in doubt, run [gltf-report](gltf-report.md) first; it flags HUGE, TINY, OFF-ORIGIN, and FLOATING models and tells you the exact fix flags.

## Budgets

Rules of thumb the reporting tools enforce:

- **Models:** under 100k tris and 50 draws is mobile-ready, under 300k is mobile-ok, over 1M is desktop-only.
- **Textures:** VRAM is roughly width × height × 4 bytes; totals over 512MB get flagged.

## Pipelines

### Static Prop

```bash
node converters/download.js https://example.com/chair.obj https://example.com/chair.mtl --out-dir ./assets
node converters/obj-to-glb.js ./assets/chair.obj --units cm --target-max 2
node converters/gltf-report.js ./assets/chair.glb
node converters/glb-optimize.js ./assets/chair.glb --out ./assets/chair.opt.glb --target-max 2
```

### 3D Print Find

STL files live in a millimeter world, so `--units mm` is the default:

```bash
node converters/stl-to-glb.js ./assets/bracket.stl --target-max 0.3
node converters/glb-optimize.js ./assets/bracket.glb --target-max 0.3
```

### Mixamo / FBX Character

```bash
node converters/download.js https://example.com/mixamo.fbx --out-dir ./assets
node converters/fbx-to-glb.js ./assets/mixamo.fbx --units cm --target-height 1.7
node converters/rig-report.js ./assets/mixamo.glb
node converters/rig-normalize.js ./assets/mixamo.glb   # only if rig-report flags it
node converters/glb-optimize.js ./assets/mixamo.rig.glb
```

### Texture Set

```bash
node converters/texture-convert.js albedo.png normal_DX.png rough.png orm.png \
  --out-dir ./assets/tex --flip-y --snippet
```

### Mods (Quake, Voxel, Minecraft)

```bash
node converters/pk3-to-dir.js ./assets/pak0.pk3 --out-dir ./assets/pak0
node converters/md3-to-glb.js ./assets/pak0/models/arena.md3 --out ./assets/arena.glb --target-max 4
node converters/vox-to-glb.js ./assets/sword.vox --out ./assets/sword.glb --target-max 1
node converters/md2-to-glb.js ./assets/ogro.md2 --out ./assets/ogro.glb --target-max 2
node converters/minecraft-to-glb.js ./pack/models/block/crate.json --out ./assets/crate.glb --parent-dir ./pack/models/block --target-max 1
```

### Level / Ship-Ready Character

```bash
node converters/material-normalize.js ./assets/find.glb --out ./assets/find.mat.glb
node converters/glb-merge.js ./assets/a.glb ./assets/b.glb --out ./assets/level.glb
node converters/anim-trim.js ./assets/mixamo.glb --clip samba --trim 0:2 --fps 30 --out ./assets/loop.glb
node converters/collision-proxy.js ./assets/prop.glb --out ./assets/prop.proxy.glb --snippet
node converters/budget-gate.js ./assets/level.glb   # CI: exits 1 on breach
```

> [!TIP]
> Complex textured rigs convert most reliably through Blender: File → Export → glTF 2.0 (`.glb`), +Y Up, Apply Modifiers, UVs + Normals on. Then continue with `glb-optimize` as usual. `.blend` files cannot be read in pure Node, and FBX textures cannot survive headless conversion.

## Tool Map

| Tool | Deps | Purpose |
| ---- | ---- | ------- |
| [download](download.md) | none | Fetch URLs to disk. |
| [obj-to-glb](obj-to-glb.md) | none | OBJ (+MTL diffuse) → GLB. |
| [stl-to-glb](stl-to-glb.md) | none | Binary + ASCII STL → GLB. |
| [ply-to-glb](ply-to-glb.md) | none | ASCII + binary PLY scans → GLB. |
| [dae-to-glb](dae-to-glb.md) | three | COLLADA → GLB, best-effort. |
| [3ds-to-glb](3ds-to-glb.md) | three | Legacy 3DS geometry → GLB. |
| [gltf-pack](gltf-pack.md) | none | Split .gltf + sidecars → one GLB. |
| [pk3-to-dir](pk3-to-dir.md) | none | Quake 3 PK3/ZIP → directory tree. |
| [md3-to-glb](md3-to-glb.md) | none | Quake 3 MD3 frames → GLB. |
| [vox-to-glb](vox-to-glb.md) | three | MagicaVoxel VOX → GLB. |
| [md2-to-glb](md2-to-glb.md) | three | Quake 2 MD2 frames → GLB. |
| [minecraft-to-glb](minecraft-to-glb.md) | none | Minecraft block JSON → GLB. |
| [fbx-to-glb](fbx-to-glb.md) | three | FBX → GLB, best-effort. |
| [glb-merge](glb-merge.md) | gltf-transform | N GLBs → one GLB. |
| [glb-split](glb-split.md) | gltf-transform | One GLB → N GLBs. |
| [anim-trim](anim-trim.md) | gltf-transform | List, cut, and thin animations. |
| [collision-proxy](collision-proxy.md) | none | AABB physics boxes + snippet. |
| [glb-optimize](glb-optimize.md) | gltf-transform, sharp | Scale-normalize + shrink. |
| [material-normalize](material-normalize.md) | gltf-transform | Sane PBR materials. |
| [texture-convert](texture-convert.md) | sharp | Any raster in → game texture. |
| [gltf-report](gltf-report.md) | none | Budget + world-scale verdict. |
| [rig-report](rig-report.md) | none | Skeleton audit. |
| [rig-normalize](rig-normalize.md) | gltf-transform | Skeleton fixes. |
| [budget-gate](budget-gate.md) | none | CI PASS/FAIL over budgets. |

## Examples

You may run every converter end to end with the demo script. Outputs land in `examples-out/`:

```bash
bash examples/run-all.sh
```

Network access is only needed for the download step. The Mixamo FBX is reused from `assets/`.
