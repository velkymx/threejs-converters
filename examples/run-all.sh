#!/bin/bash
# Demo: every converter once, end to end. Run from repo root: bash examples/run-all.sh
# Needs: npm install. Network only for the download step (tiny file; FBX reused from assets/).
set -u
cd "$(dirname "$0")/.."
mkdir -p examples-out/tex

say() { echo ""; echo "=== $1 ==="; }

say "1. download — fetch a find to disk"
node converters/download.js https://raw.githubusercontent.com/mrdoob/three.js/dev/package.json --out examples-out/three-package.json || echo "(offline: skipped)"

say "2. obj-to-glb — OBJ find to GLB"
node converters/obj-to-glb.js assets/cube.obj --out examples-out/cube.glb

say "3. stl-to-glb — print find (mm world) to GLB"
node converters/stl-to-glb.js assets/cube-mm.stl --out examples-out/stl-cube.glb --target-max 0.2

say "4. fbx-to-glb — Mixamo FBX to GLB (best-effort)"
node converters/fbx-to-glb.js "assets/Samba%20Dancing.fbx" --out examples-out/samba.glb --units cm --target-height 1.7 2>&1 | grep -v "GLTFExporter: Use"

say "5a. rig-report — hostile rig (fixture with 6 influences, bad sums, no IBM, detached joint)"
node examples/make-bad-rig.mjs examples-out/bad-rig.glb
node converters/rig-report.js examples-out/bad-rig.glb || true

say "5b. rig-normalize — fix it, re-check"
node converters/rig-normalize.js examples-out/bad-rig.glb --out examples-out/good-rig.glb
node converters/rig-report.js examples-out/good-rig.glb || true

say "5c. rig-report — real Mixamo rig (expect OK)"
node converters/rig-report.js examples-out/samba.glb || true

say "6. glb-optimize — scale + shrink"
node converters/glb-optimize.js examples-out/cube.glb --out examples-out/cube.opt.glb --target-max 2 --no-compress

say "7. gltf-report — budget + scale verdict"
node converters/gltf-report.js examples-out/cube.opt.glb || true
node converters/gltf-report.js examples-out/samba.glb || true

say "8. texture-convert — full set (albedo + DX normal + roughness) with snippet"
node converters/texture-convert.js assets/albedo.png assets/normal_dx.png assets/rough.png --out-dir examples-out/tex --flip-y --snippet

say "9. texture-convert — odd formats (TGA/BMP/HDR refuse DDS)"
node converters/texture-convert.js assets/fixture_u.tga assets/fixture_albedo.bmp assets/fixture_studio.hdr assets/fixture.dds --out-dir examples-out/tex || true

say "10. material-normalize — sane PBR"
node converters/material-normalize.js examples-out/cube.glb --out examples-out/cube.mat.glb

say "11. glb-merge + glb-split — combine props, explode again"
node converters/glb-merge.js examples-out/cube.glb examples-out/stl-cube.glb --out examples-out/merged.glb
node converters/glb-split.js examples-out/merged.glb --out-dir examples-out/split --by mesh

say "12. anim-trim — list clips, cut loop"
node converters/anim-trim.js examples-out/samba.glb || true
node converters/anim-trim.js examples-out/samba.glb --clip mixamo --trim 0:2 --fps 30 --out examples-out/samba-loop.glb

say "13. collision-proxy — physics boxes + snippet"
node converters/collision-proxy.js examples-out/cube.glb --out examples-out/cube.proxy.glb --snippet

say "14. budget-gate — CI PASS/FAIL"
node converters/budget-gate.js examples-out/cube.opt.glb || true
node converters/budget-gate.js examples-out/samba.glb --max-mb 4 || true

echo ""
echo "Done. Outputs in examples-out/."
