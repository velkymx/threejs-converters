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

say "3b. ply / dae / 3ds / pack — more finds in"
node converters/ply-to-glb.js assets/tri.ply --out examples-out/tri-ply.glb
node converters/dae-to-glb.js assets/tri.dae --out examples-out/tri-dae.glb --target-max 2 2>&1 | grep -v "GLTFExporter: Use"
node converters/3ds-to-glb.js assets/tri.3ds --out examples-out/tri-3ds.glb --units mm --target-max 0.2 2>&1 | grep -v "GLTFExporter: Use"
mkdir -p examples-out/pack && node --input-type=module -e "
import { NodeIO } from '@gltf-transform/core';
await new NodeIO().write('examples-out/pack/cube.gltf', await new NodeIO().read('examples-out/cube.glb'));"
node converters/gltf-pack.js examples-out/pack/cube.gltf --out examples-out/packed.glb

say "3c. mods in — pk3 / md3 / vox / md2 / minecraft"
node examples/make-mod-fixtures.mjs
node --input-type=module -e "
import { writeFileSync, readFileSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';
const data = readFileSync('assets/cube.obj');
const body = deflateRawSync(data);
const name = Buffer.from('models/cube.obj', 'utf8');
const lh = Buffer.alloc(30);
lh.write('PK\x03\x04', 0, 'binary'); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(data) >>> 0, 14);
lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
const cd = Buffer.alloc(46);
cd.write('PK\x01\x02', 0, 'binary'); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc32(data) >>> 0, 16);
cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28);
cd.writeUInt32LE(0, 42);
const cdStart = 30 + name.length + body.length;
const end = Buffer.alloc(22);
end.write('PK\x05\x06', 0, 'binary'); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdStart, 16);
writeFileSync('examples-out/test.pk3', Buffer.concat([lh, name, body, cd, name, end]));"
node converters/pk3-to-dir.js examples-out/test.pk3 --out-dir examples-out/pak
node converters/md3-to-glb.js assets/test.md3 --out examples-out/md3.glb
node converters/vox-to-glb.js assets/test.vox --out examples-out/vox.glb --target-max 1 2>&1 | grep -v "GLTFExporter: Use"
node converters/md2-to-glb.js assets/test.md2 --out examples-out/md2.glb 2>&1 | grep -v "GLTFExporter: Use"
node converters/minecraft-to-glb.js assets/crate.json --out examples-out/crate.glb
node converters/3mf-to-glb.js assets/test.3mf --out examples-out/model.3mf.glb --target-max 1
node converters/exr-to-hdr.js assets/test.exr --out examples-out/red.hdr
node converters/texture-convert.js examples-out/red.hdr --out-dir examples-out/tex || true

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

say "15. deliver — usdz / draco / lod + cost audit"
node converters/usdz-export.js examples-out/cube.glb --out examples-out/cube.usdz
node converters/draco-compress.js examples-out/cube.opt.glb --out examples-out/cube.drc.glb
node converters/lod-generate.js examples-out/samba-loop.glb --out examples-out/samba-lod.glb --levels 0.5 || true
node converters/material-cost.js examples-out/cube.mat.glb || true

say "16. textures — atlas / cubemap + vector / text in"
node converters/texture-atlas.js assets/albedo.png assets/normal_dx.png --out examples-out/atlas.png --snippet || true
node converters/hdr-to-cubemap.js assets/fixture_studio.hdr --out-dir examples-out/sky --size 64 || true
printf '%s' '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect x="10" y="10" width="30" height="40" fill="#ff0000"/><circle cx="70" cy="30" r="20" fill="#0000ff"/></svg>' > examples-out/logo.svg
node converters/svg-to-glb.js examples-out/logo.svg --out examples-out/logo.glb --target-max 1 || true
node converters/font-to-glb.js --text "Hi" --out examples-out/hi.glb --target-max 1 || true

echo ""
echo "Done. Outputs in examples-out/."
