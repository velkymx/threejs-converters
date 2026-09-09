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
    - [Deliver (Web, Mobile, AR)](#deliver-web-mobile-ar)
- [Tool Map](#tool-map)
- [Known Limits](#known-limits)
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

Dependencies are `sharp`, `@gltf-transform/core`, `@gltf-transform/functions`, and `three`. Twelve tools are zero-dependency and run with plain Node (the tool map below marks each one).

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

### Deliver (Web, Mobile, AR)

```bash
node converters/draco-compress.js ./assets/chair.opt.glb --out ./assets/chair.drc.glb
node converters/lod-generate.js ./assets/tree.glb --out ./assets/tree.lod.glb --levels 0.5,0.25
node converters/usdz-export.js ./assets/chair.opt.glb --out ./assets/chair.usdz
node converters/material-cost.js ./assets/helmet.glb
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
| [texture-atlas](texture-atlas.md) | sharp | N images → one atlas + UV offsets. |
| [hdr-to-cubemap](hdr-to-cubemap.md) | sharp | Equirect panorama → 6 cube faces. |
| [svg-to-glb](svg-to-glb.md) | three | SVG paths → extruded GLB. |
| [font-to-glb](font-to-glb.md) | three | Text string → extruded GLB. |
| [3mf-to-glb](3mf-to-glb.md) | three | 3D manufacturing 3MF → GLB. |
| [exr-to-hdr](exr-to-hdr.md) | three | EXR float → RGBE HDR. |
| [usdz-export](usdz-export.md) | three | GLB → Apple AR Quick Look USDZ. |
| [draco-compress](draco-compress.md) | gltf-transform, draco3dgltf | Draco mesh compression. |
| [lod-generate](lod-generate.md) | gltf-transform, meshoptimizer | LOD chain via simplify. |
| [material-cost](material-cost.md) | none | PBR feature cost audit. |
| [gltf-report](gltf-report.md) | none | Budget + world-scale verdict. |
| [rig-report](rig-report.md) | none | Skeleton audit. |
| [rig-normalize](rig-normalize.md) | gltf-transform | Skeleton fixes. |
| [budget-gate](budget-gate.md) | none | CI PASS/FAIL over budgets. |

## Known Limits

Every tool refuses what it cannot do instead of writing a corrupt file. The load-bearing limits, all verified:

| Tool | Limit |
| ---- | ----- |
| [download](download.md) | Needs network. Skips existing files unless `--force`. |
| [obj-to-glb](obj-to-glb.md) | One mesh, one material. MTL diffuse color only; MTL textures never embedded. |
| [stl-to-glb](stl-to-glb.md) | Never has UVs. Flat shading unless `--smooth`. |
| [ply-to-glb](ply-to-glb.md) | Needs faces; point clouds and splats refused. Exotic list elements refused. |
| [dae-to-glb](dae-to-glb.md) | Best-effort. Textures stripped headless. Exotic COLLADA extensions fall back to the Blender path. |
| [3ds-to-glb](3ds-to-glb.md) | Geometry only. No rigs, no anims, textures stripped. |
| [gltf-pack](gltf-pack.md) | glTF 2.x only. Remote URIs refused. 4 GB cap. |
| [fbx-to-glb](fbx-to-glb.md) | Textures stripped headless. Complex rigs go through Blender. |
| [svg-to-glb](svg-to-glb.md) | Filled shapes only; strokes skip. Gradients and filters are loader best-effort. |
| [font-to-glb](font-to-glb.md) | Bundled helvetiker covers Latin; missing glyphs render as tofu with a warning. One material total. |
| [3mf-to-glb](3mf-to-glb.md) | Geometry focus; textures stripped. Beam-lattice extensions best-effort. |
| [exr-to-hdr](exr-to-hdr.md) | Decodes to RGBE `.hdr`; chain into texture-convert for game textures. 100 MB cap. |
| [pk3-to-dir](pk3-to-dir.md) | Stored/deflate entries only. Encrypted, descriptor, and multi-disk archives refused. Traversal paths skipped. Empty output exits 1. |
| [md3-to-glb](md3-to-glb.md) | One frame per export. Tags skipped. `.shader` scripts never parsed. |
| [vox-to-glb](vox-to-glb.md) | Versions 150/200 only. Node-less files mesh directly without transforms. |
| [md2-to-glb](md2-to-glb.md) | Static poses only; morph clips dropped. Skins ignored entirely. |
| [minecraft-to-glb](minecraft-to-glb.md) | Textures stay references (convert PNGs separately). Cullface, shade, AO, display, rescale, groups, and non-cubes ignored. |
| [usdz-export](usdz-export.md) | three | GLB → Apple AR Quick Look USDZ. Texture maps stripped (no headless canvas raster). |
| [draco-compress](draco-compress.md) | Lossy through quantization. Runtime needs DRACOLoader. |
| [glb-merge](glb-merge.md) | No skeleton retargeting. Mixed input units stay mixed. |
| [glb-split](glb-split.md) | Skinned splits need a rig-report re-check. |
| [anim-trim](anim-trim.md) | STEP and CUBICSPLINE samplers never thinned. Empty windows exit 1. |
| [collision-proxy](collision-proxy.md) | AABB boxes only, no hulls. Boxes are world-pose; re-fit rotating bodies at runtime. |
| [glb-optimize](glb-optimize.md) | Pass `--no-quantize` for viewers without the extension, `--no-compress` to skip textures. |
| [material-normalize](material-normalize.md) | Only behavior-safe rewrites. Look-changing cuts (clearcoat, transmission) stay human calls. |
| [texture-convert](texture-convert.md) | DDS/KTX refused (EXR goes through exr-to-hdr). Files over 100 MB refused. No KTX2 output. |
| [texture-atlas](texture-atlas.md) | Uniform cells (largest input side). Atlases over 4096px warn. |
| [hdr-to-cubemap](hdr-to-cubemap.md) | HDR tonemaps mildly (Reinhard); LDR clamps. |
| [gltf-report](gltf-report.md) | Quantized positions unreadable statically; report the pre-quantize file. Min/max-less prims count as partial. |
| [rig-report](rig-report.md) | Full influence decode needs the `.glb` BIN chunk. Advisory only. |
| [rig-normalize](rig-normalize.md) | Detached joints are NOT fixed; reparent under the scene root manually. Run before optimize. |
| [budget-gate](budget-gate.md) | Thresholds are policy, not physics. Size checks skip quantized positions. |
| [material-cost](material-cost.md) | Relative ranks for triage, not measured milliseconds. Advisory, exit 0. |
| [lod-generate](lod-generate.md) | Swap distances are the game's call. Re-check skinned output with rig-report. |

## Examples

You may run every converter end to end with the demo script. Outputs land in `examples-out/`:

```bash
bash examples/run-all.sh
```

Network access is only needed for the download step. The Mixamo FBX is reused from `assets/`.
