# threejs-converters

One file per converter. Node only. Internet finds → ingame-ready three.js assets.

Each script in `converters/` is standalone: `node converters/<tool>.js --help`.

Full guides live in [`docs/`](docs/index.md) — one page per tool, Laravel-style.

## Install

```bash
npm install
```

Requires Node ≥ 20. Deps: `sharp`, `@gltf-transform/core`, `@gltf-transform/functions`, `three`.
Zero-dep tools (`download`, `gltf-report`, `rig-report`, `obj-to-glb`, `stl-to-glb`) run with plain Node.

## Convention

three.js expects **1 unit = 1 meter**, Y-up, sRGB color maps, linear data maps, ≤4 bone influences.
Every converter defaults toward that: models get centered (XZ) + grounded (Y), textures get capped + typed.

## Pipelines

**Static prop (OBJ/STL/GLB find):**
```bash
node converters/download.js https://example.com/chair.obj https://example.com/chair.mtl --out-dir ./assets
node converters/obj-to-glb.js ./assets/chair.obj --units cm --target-max 2
node converters/gltf-report.js ./assets/chair.glb
node converters/glb-optimize.js ./assets/chair.glb --out ./assets/chair.opt.glb --target-max 2
```

**Print find (STL, millimeter world):**
```bash
node converters/stl-to-glb.js ./assets/bracket.stl --target-max 0.3   # --units mm is default
node converters/glb-optimize.js ./assets/bracket.glb --target-max 0.3
```

**Mixamo / FBX character:**
```bash
node converters/download.js https://…/mixamo.fbx --out-dir ./assets
node converters/fbx-to-glb.js ./assets/mixamo.fbx --units cm --target-height 1.7
node converters/rig-report.js ./assets/mixamo.glb
node converters/rig-normalize.js ./assets/mixamo.glb                   # only if rig-report flags
node converters/glb-optimize.js ./assets/mixamo.rig.glb
```

**Texture set:**
```bash
node converters/texture-convert.js albedo.png normal_DX.png rough.png orm.png \
  --out-dir ./assets/tex --flip-y --snippet
```

**Level / ship-ready character:**
```bash
node converters/material-normalize.js ./assets/find.glb --out ./assets/find.mat.glb
node converters/glb-merge.js ./assets/a.glb ./assets/b.glb --out ./assets/level.glb
node converters/anim-trim.js ./assets/mixamo.glb --clip samba --trim 0:2 --fps 30 --out ./assets/loop.glb
node converters/collision-proxy.js ./assets/prop.glb --out ./assets/prop.proxy.glb --snippet
node converters/budget-gate.js ./assets/level.glb   # CI: exit 1 on breach
```

**Blender path** (textured / complex rigs — most rock-solid route):
File → Export → glTF 2.0 (`.glb`), +Y Up, Apply Modifiers, UVs + Normals on.
Then `glb-optimize.js` + `gltf-report.js` as usual. (`.blend` files can't be read in pure Node; FBX textures can't survive headless conversion — export GLB from Blender instead.)

## Tools

| Tool | Deps | What |
| ---- | ---- | ---- |
| `download.js` | none | Fetch URLs to disk. Follows redirects, skips existing unless `--force`. `--out` / `--out-dir` / `--timeout`. |
| `gltf-report.js` | none | Budget check: verts, tris, draws, materials, images + **world bbox** (full node chain) with scale warnings (HUGE/TINY/OFF-ORIGIN/FLOATING). `--json`. |
| `glb-optimize.js` | gltf-transform, sharp | Scale-normalize (world bbox → uniform root wrapper, exact under any hierarchy/rotation) → dedup, instance, palette, prune, resample, sparse, weld, quantize → webp textures. See scale flags below. `--no-compress` `--quant N` `--no-quantize` `--no-scale`. |
| `texture-convert.js` | sharp | ANY raster in → game texture. Magic-sniffed ingest: png jpg webp avif tiff gif svg + built-in TGA/BMP/HDR decoders. DDS/KTX/EXR refused with path. Auto-detects color/normal/data/env from filename (`--type`/`--linear` override). Normal maps: never JPEG, q≥90, `--flip-y` for DirectX→OpenGL. HDR stays float `.hdr` (env-ready, resized) unless `--tonemap` to LDR. Alpha+JPEG refused. Same-stem outputs auto-suffixed (no overwrite). VRAM estimate + `--snippet` loader lines. `--size` (color, 2048) `--data-size` (1024). KTX2 intentionally out (needs `toktx` binary, not pure Node). |
| `obj-to-glb.js` | none | OBJ (+MTL diffuse) → GLB. Fan triangulation, computed normals if missing. Scale flags. |
| `stl-to-glb.js` | none | Binary + ASCII STL → GLB. `--units mm` default. Flat shading kept; `--smooth` averages normals. Degenerate facets dropped + counted. |
| `fbx-to-glb.js` | three | **Best-effort.** Geometry + rig + anims via headless three.js loaders. Textures stripped (no canvas in Node) unless `--keep-textures`. `--z-up` for Z-up authored files. Falls back to Blender path with clear errors. |
| `rig-report.js` | none | Skeleton audit: >4 influences (three.js vec4 limit — silent breakage), weight sums ≠ 1, missing IBM, detached joints, bad joint scale. Needs `.glb` for influence decode. `--json`. |
| `rig-normalize.js` | gltf-transform | Top-4 clamp + renormalize, strip JOINTS_1/WEIGHTS_1, explicit identity IBM (= three.js fallback, made visible). Run **before** `glb-optimize`. |
| `glb-merge.js` | gltf-transform | N GLBs → one. `mergeDocuments` + `join` (fewer draws) + dedup/prune. Mixed units? Normalize inputs first. |
| `glb-split.js` | gltf-transform | One GLB → N (`--by mesh` default, or `--by scene`). Clone per part + prune orphans. Skinned splits need `rig-report` re-check. |
| `anim-trim.js` | gltf-transform | List clips (no flags) → `--clip NAME` keep match → `--trim S:E` cut window to t=0 → `--fps N` thin LINEAR keys. STEP/CUBICSPLINE never thinned. |
| `collision-proxy.js` | none | World-pose AABB per mesh + scene box → tiny `.proxy.glb` + rapier/cannon `--snippet`. `--type hull` refused with Blender path (no pure-Node hull). |
| `material-normalize.js` | gltf-transform | spec/gloss → metal/rough, unlit → lit, doubleside off (unless `--keep-double`), BLEND→OPAQUE when alpha=1, clamp factors, dedup identical materials. |
| `budget-gate.js` | none | CI PASS/FAIL (exit 1): `--max-tris 100000` `--max-draws 50` `--max-mats 16` `--max-mb 8` `--max-images 8` `--min-size`/`--max-size`. Each fail prints the fix tool. |

## Scale flags (model converters)

`--units mm|cm|m|km|in|ft|yd` · `--scale FACTOR` · `--target-max M` · `--target-height M`
(center-XZ + ground-Y by default; `--no-center` `--no-ground` keep offsets.)

Typical: Mixamo `--units cm --target-height 1.7` · prints `--units mm` · generic find `--target-max 2`.

## Budgets

Models: <100k tris + <50 draws mobile-ready · <300k mobile-ok · >1M desktop-only.
Textures: VRAM ≈ W×H×4 bytes; total >512MB flagged. Quantized GLBs report scale via pre-quantize file.

## Examples

Run them all: `bash examples/run-all.sh` (outputs to `examples-out/`). Outputs below trimmed to key lines.

**1. download — fetch finds to disk** (redirects followed, skips existing unless `--force`):
```bash
node converters/download.js https://example.com/chair.obj https://example.com/chair.mtl --out-dir ./assets
# GET https://example.com/chair.obj
#  -> assets/chair.obj
# Saved 48.2 KB
```

**2. obj-to-glb — OBJ find to grounded, meter-scale GLB:**
```bash
node converters/obj-to-glb.js assets/cube.obj --out examples-out/cube.glb
# Scale: x1 offset [0.000,1.000,0.000] (size 2.000 x 2.000 x 0.000m)
# Wrote examples-out/cube.glb (1.2 KB) — 2 tris, 4 verts, +UVs
```

**3. stl-to-glb — print find (millimeter world) to GLB:**
```bash
node converters/stl-to-glb.js assets/cube-mm.stl --out examples-out/stl-cube.glb --target-max 0.2
# STL binary: 4 facets.
# Scale: x0.001 (--units mm) offset [-0.100,0.000,-0.100] size 0.200 x 0.200 x 0.200m
# Wrote examples-out/stl-cube.glb (1.2 KB) — 4 tris, 8 verts (flat, no UVs)
```

**4. fbx-to-glb — Mixamo FBX to 1.7 m character (best-effort: geometry+rig+anims, textures stripped headless):**
```bash
node converters/fbx-to-glb.js assets/Samba.fbx --out examples-out/samba.glb --units cm --target-height 1.7
# BBox raw: 194.685,180.473,36.427 → factor x0.00941967
# Scene: 2 mesh(es), 119 bone(s), 2 animation(s).
# Wrote examples-out/samba.glb (9721.5 KB)
```

**5. rig-report / rig-normalize — audit, fix, re-check** (hostile fixture: `node examples/make-bad-rig.mjs`):
```bash
node converters/rig-report.js examples-out/bad-rig.glb
# Rig: 1 skin(s), 4 skinned verts, max 6 influences, 0 animation(s)
#  skin0: 6 joints, depth 0, IBM MISSING, detached 1
# Rig:
#   - 4 verts with >4 influences (max 6): three.js drops extras → fix: rig-normalize.js
#   - Weight sums off-1 (min 1.400, max 1.400): mesh breathes when posed → rig-normalize renormalizes.
#   - Skin 0: 1/6 joints outside scene graph (limbs freeze) → reparent under scene root.
#   - Skin 0: no inverseBindMatrices → rig-normalize writes explicit identity IBM.

node converters/rig-normalize.js examples-out/bad-rig.glb --out examples-out/good-rig.glb
# Wrote examples-out/good-rig.glb — 1 skinned prim(s): 4 verts clamped to 4, 4 renormalized, 1 2nd-set(s) stripped, 1 IBM added.

node converters/rig-report.js examples-out/samba.glb   # real Mixamo rig
# Rig: 2 skin(s), 165960 skinned verts, max 4 influences, 2 animation(s)
# Rig: OK for three.js.
```

**6. glb-optimize — scale-normalize + shrink** (run rig-normalize first on skinned files):
```bash
node converters/glb-optimize.js examples-out/cube.glb --out examples-out/cube.opt.glb --target-max 2 --no-compress
# BBox raw: min [-1.000,0.000,0.000] max [1.000,2.000,0.000] size [2.000,2.000,0.000]
# Scale: already normalized (factor 1, offset 0). No wrapper.
# Wrote examples-out/cube.opt.glb (1.1 KB) — 7.3% smaller
```

**7. gltf-report — budget + world-scale verdict:**
```bash
node converters/gltf-report.js examples-out/samba.glb
# verts 165960 | tris 55320 | meshes 2 | nodes 123 | draws 2
# world 1.834 x 1.700 x 0.343m (max 1.834m) center [-0.00,0.85,0.00] min.y 0.000
# Scale: OK (sane meter range, near origin).
# Verdict: MOBILE-READY — good for games.
```

**8. texture-convert — set: albedo + DirectX normal + roughness, with loader snippet:**
```bash
node converters/texture-convert.js assets/albedo.png assets/normal_dx.png assets/rough.png --out-dir tex --flip-y --snippet
# albedo.png [color~auto]: 3000x1500 → fit 2048px (aspect kept).
# albedo.png [color~auto]: → tex/albedo.2048.srgb.webp 2048x1024 POT q82 3.7KB (was 61.1KB) VRAM ~6.0MB
# normal_dx.png [normal~auto]: 3000x1500 → fit 1024px (aspect kept).
# normal_dx.png [normal~auto]: → tex/normal_dx.1024.linear.webp 1024x512 POT q95 1.0KB VRAM ~1.5MB
# rough.png [data~auto]: → tex/rough.1024.linear.webp 500x500 NPOT ok (WebGL2) q90 0.6KB VRAM ~1.0MB
# Total VRAM ~8.5MB across 3 input(s)
# --- three.js snippet ---
# tex = await load('albedo.2048.srgb.webp'); tex.colorSpace = SRGBColorSpace;
# tex = await load('normal_dx.1024.linear.webp'); tex.colorSpace = NoColorSpace; // tangent Y+ OpenGL
# tex = await load('rough.1024.linear.webp'); tex.colorSpace = NoColorSpace;
```

**9. texture-convert — odd formats in, refusal with path:**
```bash
node converters/texture-convert.js assets/fixture_u.tga assets/fixture_albedo.bmp assets/fixture_studio.hdr assets/fixture.dds --out-dir tex
# fixture_u.tga: ingested tga → converting.
# fixture_u.tga [color~auto]: → tex/fixture_u.2048.srgb.webp 4x2 POT q82
# fixture_albedo.bmp: ingested bmp → converting.
# fixture_studio.hdr [env/float]: → tex/fixture_studio.1024.linear.hdr 4x2
# fixture.dds: SKIP DDS: DDS is GPU-block data: needs native transcoder (toktx) or Blender → export PNG.
```
