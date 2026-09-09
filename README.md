# threejs-converters

[![CI](https://github.com/velkymx/threejs-converters/actions/workflows/ci.yml/badge.svg)](https://github.com/velkymx/threejs-converters/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node >= 20](https://img.shields.io/badge/Node-%3E%3D20-blue.svg)](package.json)

One-file Node converters: OBJ, STL, PLY, DAE, 3DS, MD3, MD2, VOX, FBX, SVG, text, 3MF to GLB, glTF pack, Minecraft JSON, PK3 unzip, EXR/HDR/cubemap/atlas textures, Draco, LODs, USDZ export, rig + cost audits. Internet finds become ingame-ready three.js assets.

## The three-minute pitch

**The problem.** You found a perfect chair on a free-model site. It is in centimeters. Its textures are a BMP and a TGA. The Mixamo dancer you downloaded has 29,000 animation keys for an 18-second clip and a rig that silently breaks in three.js. Getting any of this ingame means an afternoon of Blender, guesswork, and scale bugs that wreck your camera, physics, and shadows all at once.

**The fix.** Each script in `converters/` does one conversion, standalone, with plain `node`: no build step, no app to learn. They all default toward what three.js expects (1 unit = 1 meter, Y-up, centered and grounded, sRGB colors, ≤4 bone influences), and every error message names the next tool to run:

```bash
npm install
node converters/obj-to-glb.js ./assets/chair.obj --units cm --target-max 2
node converters/gltf-report.js ./assets/chair.glb
# Verdict: MOBILE-READY — good for games.
```

**The proof.** `bash examples/run-all.sh` runs all 34 converters end to end, and `npm test` asserts every one of them in CI on Node 20 and 22. If a find busts a budget, `budget-gate` fails the build with the exact fix.

```text
find (OBJ/STL/FBX/TGA/anything) → convert → audit → optimize → gate → game
```

## Contents

- [Overview](#overview)
- [Features](#features)
- [Quick-start](#quick-start)
- [Install](#install)
- [Tools](#tools)
- [Budgets](#budgets)
- [Non-goals](#non-goals)
- [Comparison](#comparison)
- [Compatibility](#compatibility)
- [Getting help](#getting-help)
- [Contributing](#contributing)
- [Credits](#credits)
- [License](#license)

## Overview

threejs-converters turns free 3D finds (Sketchfab, Mixamo, Thingiverse, Printables, texture sites, Quake mods, Minecraft packs) into assets a three.js game can load directly: meter-scale GLBs, capped WebP textures with loader snippets, trimmed animation loops, physics proxy boxes, and CI gates that keep heavy files from shipping.

It exists because the last mile between "downloaded a model" and "renders correctly ingame" is dozens of small, fiddly, silent failures: wrong units, dropped bone influences, linear-vs-sRGB mixups, 9 MB animation clips. Each one deserves a script that either fixes it or says exactly how. It is made by [velkymx](https://github.com/velkymx), built on three.js, glTF-Transform, and sharp.

## Features

- **34 single-file converters**: meshes, mods, vectors, text, textures, and delivery in, game assets out. One file each, `node converters/<tool>.js --help` to start.
- **three.js-first defaults**: meter scale, centered + grounded, sRGB colors, top-4 bone influences, WebP textures with `colorSpace` snippets.
- **Honest errors**: proprietary-format limits (FBX textures, KTX2, hulls) refuse with a working path, never a corrupt file.
- **Zero-dep core**: download, reports, ingest converters, pack, proxy, and gate run on plain Node.
- **Tested like a pipeline**: `npm test` runs every tool against fixtures and asserts outputs, exit codes, and budgets.

## Quick-start

Shortest path from find to verdict:

```bash
npm install
node converters/obj-to-glb.js assets/cube.obj --out quick.glb
node converters/gltf-report.js quick.glb
```

## Install

```bash
npm install
```

Requires Node ≥ 20. Deps: `sharp`, `@gltf-transform/core`, `@gltf-transform/functions`, `three`.
Zero-dep tools (`download`, `gltf-report`, `rig-report`, `obj-to-glb`, `stl-to-glb`, `ply-to-glb`, `gltf-pack`, `pk3-to-dir`, `md3-to-glb`, `minecraft-to-glb`, `collision-proxy`, `budget-gate`) run with plain Node.

Model converters share scale flags (`--units` `--scale` `--target-max` `--target-height`, center-XZ + ground-Y by default). See any tool's `--help` or its docs page.

## Tools

Full guides live in [`docs/`](docs/index.md), one page per tool:

- Ingest: [download](https://github.com/velkymx/threejs-converters/blob/main/docs/download.md) · [obj-to-glb](https://github.com/velkymx/threejs-converters/blob/main/docs/obj-to-glb.md) · [stl-to-glb](https://github.com/velkymx/threejs-converters/blob/main/docs/stl-to-glb.md) · [ply-to-glb](https://github.com/velkymx/threejs-converters/blob/main/docs/ply-to-glb.md) · [dae-to-glb](https://github.com/velkymx/threejs-converters/blob/main/docs/dae-to-glb.md) · [3ds-to-glb](https://github.com/velkymx/threejs-converters/blob/main/docs/3ds-to-glb.md) · [gltf-pack](https://github.com/velkymx/threejs-converters/blob/main/docs/gltf-pack.md) · [fbx-to-glb](https://github.com/velkymx/threejs-converters/blob/main/docs/fbx-to-glb.md) · [svg-to-glb](https://github.com/velkymx/threejs-converters/blob/main/docs/svg-to-glb.md) · [font-to-glb](https://github.com/velkymx/threejs-converters/blob/main/docs/font-to-glb.md) · [3mf-to-glb](https://github.com/velkymx/threejs-converters/blob/main/docs/3mf-to-glb.md): finds to meter-scale GLBs.
- Mods: [pk3-to-dir](https://github.com/velkymx/threejs-converters/blob/main/docs/pk3-to-dir.md) · [md3-to-glb](https://github.com/velkymx/threejs-converters/blob/main/docs/md3-to-glb.md) · [vox-to-glb](https://github.com/velkymx/threejs-converters/blob/main/docs/vox-to-glb.md) · [md2-to-glb](https://github.com/velkymx/threejs-converters/blob/main/docs/md2-to-glb.md) · [minecraft-to-glb](https://github.com/velkymx/threejs-converters/blob/main/docs/minecraft-to-glb.md): mod formats to GLBs.
- Scene: [glb-merge](https://github.com/velkymx/threejs-converters/blob/main/docs/glb-merge.md) · [glb-split](https://github.com/velkymx/threejs-converters/blob/main/docs/glb-split.md) · [anim-trim](https://github.com/velkymx/threejs-converters/blob/main/docs/anim-trim.md) · [collision-proxy](https://github.com/velkymx/threejs-converters/blob/main/docs/collision-proxy.md): assemble levels, cut loops, physics boxes.
- Polish: [glb-optimize](https://github.com/velkymx/threejs-converters/blob/main/docs/glb-optimize.md) · [material-normalize](https://github.com/velkymx/threejs-converters/blob/main/docs/material-normalize.md) · [texture-convert](https://github.com/velkymx/threejs-converters/blob/main/docs/texture-convert.md) · [texture-atlas](https://github.com/velkymx/threejs-converters/blob/main/docs/texture-atlas.md) · [hdr-to-cubemap](https://github.com/velkymx/threejs-converters/blob/main/docs/hdr-to-cubemap.md) · [exr-to-hdr](https://github.com/velkymx/threejs-converters/blob/main/docs/exr-to-hdr.md): shrink, sane PBR, game textures.
- Gate: [gltf-report](https://github.com/velkymx/threejs-converters/blob/main/docs/gltf-report.md) · [rig-report](https://github.com/velkymx/threejs-converters/blob/main/docs/rig-report.md) · [rig-normalize](https://github.com/velkymx/threejs-converters/blob/main/docs/rig-normalize.md) · [budget-gate](https://github.com/velkymx/threejs-converters/blob/main/docs/budget-gate.md) · [material-cost](https://github.com/velkymx/threejs-converters/blob/main/docs/material-cost.md): audit, fix, enforce.
- Deliver: [usdz-export](https://github.com/velkymx/threejs-converters/blob/main/docs/usdz-export.md) · [draco-compress](https://github.com/velkymx/threejs-converters/blob/main/docs/draco-compress.md) · [lod-generate](https://github.com/velkymx/threejs-converters/blob/main/docs/lod-generate.md): AR, bandwidth, distance.

## Budgets

Models: <100k tris + <50 draws mobile-ready · <300k mobile-ok · >1M desktop-only.
Textures: VRAM is about W×H×4 bytes; total >512MB flagged.

## Non-goals

- **Not a DCC.** No mesh authoring, sculpting, UV unwrapping, or weight painting. Use Blender, then convert here.
- **Not a renderer.** No screenshots, thumbnails, or previews; nothing here needs a GPU or canvas.
- **Not a game engine.** No loaders, mixers, or physics bodies. Output plus copy-paste snippets, wired up in your three.js app.
- **Not a GPU-texture pipeline.** No KTX2/Basis output (`toktx` is a native binary, not pure Node). WebP is the target.
- **Not FBX-full-fidelity.** Proprietary format, headless loaders: geometry + rig + anims yes, textures no.

## Comparison

| | threejs-converters | Blender glTF export | glTF-Transform CLI | FBX2glTF / obj2gltf |
| --- | --- | --- | --- | --- |
| Scope | Find → game asset (convert + audit + gate) | Authoring + export | Optimize + inspect GLB | Single-format conversion |
| three.js scale defaults | Yes (meters, centered, grounded) | Manual | Manual flags | Manual |
| Rig audit for three.js limits | Yes (`rig-report`) | No | No | No |
| Honest headless limits | Yes (refuse + path) | N/A (has UI) | N/A | Silent drops |
| Deps | Node only | Blender install | Node | Native binaries |
| CI budget gate | Yes (`budget-gate`) | No | No | No |

Use Blender for authoring and this project for everything after export. They compose; they don't compete.

## Compatibility

| | Supported |
| --- | --- |
| Node | 20, 22 (CI-tested; `engines: >=20`) |
| three.js | ^0.185 (loaders, exporters, snippets) |
| glTF-Transform | core + functions ^4.2 |
| sharp | ^0.34 |
| Outputs | `.glb` (GLTFLoader-ready), `.webp`/`.png`/`.jpg`/`.avif`, `.hdr` |

## Getting help

- Bug or bad conversion? [Open an issue](https://github.com/velkymx/threejs-converters/issues) with the find's source, the command you ran, and full output.
- Usage question? Check [`docs/`](https://github.com/velkymx/threejs-converters/blob/main/docs/index.md) first, then ask in issues.

## Contributing

Contributions welcome. Small, sharp tools only:

1. One file per converter in `converters/`, runnable as `node converters/<tool>.js --help`.
2. Follow the contract: shared scale flags on model tools, fix-naming errors, `--json` on reporters, exit 1 on failure.
3. Add the tool to `examples/run-all.sh`, `examples/ci.sh` (strict assertions), the Tools list above, and `docs/<tool>.md`.
4. Run `npm test` green before pushing.

## Credits

Built by [velkymx](https://github.com/velkymx) on [three.js](https://threejs.org), [glTF-Transform](https://gltf-transform.dev), and [sharp](https://sharp.pixelplumbing.com). Test fixtures include a Mixamo character (via Adobe Mixamo) and print-format samples.

## License

[MIT](LICENSE). Do anything, keep the notice.
