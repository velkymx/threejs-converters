#!/bin/bash
# CI: strict end-to-end regression. Any failure exits nonzero. No network needed.
# Run: bash examples/ci.sh  (or: npm test)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=test-out/ci
rm -rf "$OUT"
mkdir -p "$OUT/tex" "$OUT/split"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }
expect_file() { [ -s "$1" ] || fail "missing output: $1"; pass "$1"; }
expect_glb() { # expect_glb <file> — magic + version + JSON parse + mesh present, not just bytes
  [ -s "$1" ] || fail "missing output: $1"
  node -e "
const fs = require('fs');
const b = fs.readFileSync('$1');
if (b.length < 20 || b.readUInt32LE(0) !== 0x46546C67 || b.readUInt32LE(4) !== 2) throw new Error('bad GLB magic/version');
const len = b.readUInt32LE(12);
const j = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
if (j.asset?.version !== '2.0') throw new Error('bad asset version');
if (!j.meshes?.length) throw new Error('no meshes');
" || fail "invalid GLB: $1"
  pass "$1"
}

echo "--- 0. --help smoke (all 24 tools exit 0) ---"
for t in download obj-to-glb stl-to-glb ply-to-glb dae-to-glb 3ds-to-glb gltf-pack fbx-to-glb glb-merge glb-split anim-trim \
  collision-proxy glb-optimize material-normalize texture-convert pk3-to-dir md3-to-glb vox-to-glb md2-to-glb minecraft-to-glb \
  gltf-report rig-report rig-normalize budget-gate; do
  node "converters/$t.js" --help >/dev/null || fail "$t --help"
done
pass "all --help"

echo "--- 1. ingest: obj / stl / fbx / ply / dae / 3ds / pack ---"
node converters/obj-to-glb.js assets/cube.obj --out "$OUT/cube.glb" >/dev/null
expect_glb "$OUT/cube.glb"
node converters/stl-to-glb.js assets/cube-mm.stl --out "$OUT/stl-cube.glb" --target-max 0.2 >/dev/null
expect_glb "$OUT/stl-cube.glb"
node converters/fbx-to-glb.js "assets/Samba%20Dancing.fbx" --out "$OUT/samba.glb" --units cm --target-height 1.7 >/dev/null 2>&1
expect_glb "$OUT/samba.glb"
node converters/ply-to-glb.js assets/tri.ply --out "$OUT/tri-ply.glb" >/dev/null
expect_glb "$OUT/tri-ply.glb"
node converters/dae-to-glb.js assets/tri.dae --out "$OUT/tri-dae.glb" --target-max 2 >/dev/null 2>&1
expect_glb "$OUT/tri-dae.glb"
node converters/3ds-to-glb.js assets/tri.3ds --out "$OUT/tri-3ds.glb" --units mm --target-max 0.2 >/dev/null 2>&1
expect_glb "$OUT/tri-3ds.glb"
node converters/gltf-report.js "$OUT/tri-ply.glb" | grep -q "tris 1 |" || fail "ply tri count"
node converters/gltf-report.js "$OUT/tri-dae.glb" | grep -q "tris 1 |" || fail "dae tri count"
node converters/gltf-report.js "$OUT/tri-3ds.glb" | grep -q "tris 2 |" || fail "3ds tri count"
pass "ply + dae + 3ds tri counts"
mkdir -p "$OUT/pack"
node --input-type=module -e "
import { NodeIO } from '@gltf-transform/core';
await new NodeIO().write('$OUT/pack/cube.gltf', await new NodeIO().read('$OUT/cube.glb'));
" || fail "split .gltf fixture"
node converters/gltf-pack.js "$OUT/pack/cube.gltf" --out "$OUT/packed.glb" >/dev/null
expect_glb "$OUT/packed.glb"
node converters/gltf-report.js "$OUT/packed.glb" | grep -q "tris 2 |" || fail "packed tri count"
node converters/gltf-report.js "$OUT/packed.glb" | grep -q "verts 4 |" || fail "packed vert count"
SRC_W="$(node converters/gltf-report.js "$OUT/cube.glb" | grep '^ world')"
PACK_W="$(node converters/gltf-report.js "$OUT/packed.glb" | grep '^ world')"
[ "$SRC_W" = "$PACK_W" ] || fail "packed bbox differs: $PACK_W vs $SRC_W"
pass "gltf-pack roundtrip"

echo "--- 2. rig: hostile must flag, normalized must pass ---"
node examples/make-bad-rig.mjs "$OUT/bad-rig.glb" >/dev/null
node converters/rig-report.js "$OUT/bad-rig.glb" | grep -q "drops extras" || fail "bad rig not flagged"
pass "hostile rig flagged"
node converters/rig-normalize.js "$OUT/bad-rig.glb" --out "$OUT/good-rig.glb" >/dev/null
REP="$(node converters/rig-report.js "$OUT/good-rig.glb")"
echo "$REP" | grep -q "max 4 influences" || fail "influences not clamped to 4"
echo "$REP" | grep -q "IBM yes" || fail "IBM not added"
echo "$REP" | grep -q "drops extras" && fail "over-4 influences remain"
echo "$REP" | grep -q "off-1" && fail "weight sums still off"
pass "normalized rig fixed (detached-joint warn remains by design)"
node converters/rig-report.js "$OUT/samba.glb" | grep -q "OK for three.js" || fail "samba rig not OK"
pass "samba rig OK"

echo "--- 3. optimize + report ---"
node converters/glb-optimize.js "$OUT/cube.glb" --out "$OUT/cube.opt.glb" --target-max 2 --no-compress >/dev/null
expect_glb "$OUT/cube.opt.glb"
node converters/gltf-report.js "$OUT/cube.opt.glb" | grep -q "MOBILE-READY" || fail "cube.opt verdict"
node converters/gltf-report.js "$OUT/cube.glb" --json | grep -q '"ok": true' || fail "cube scale"
pass "report verdict + scale"

echo "--- 4. textures: set converts, DDS refuses nonzero ---"
node converters/texture-convert.js assets/albedo.png assets/normal_dx.png assets/rough.png --out-dir "$OUT/tex" --flip-y >/dev/null
[ "$(find "$OUT/tex" -name '*.webp' | wc -l | tr -d ' ')" = "3" ] || fail "texture set count"
for w in "$OUT"/tex/*.webp; do
  node -e "
const b = require('fs').readFileSync('$w');
if (b.length < 12 || b.subarray(0, 4).toString() !== 'RIFF' || b.subarray(8, 12).toString() !== 'WEBP') throw new Error('not webp');
" || fail "bad webp output: $w"
done
pass "texture set (3 valid webp)"
node converters/texture-convert.js assets/fixture_u.tga assets/fixture.dds --out-dir "$OUT/tex" >"$OUT/dds.log" 2>&1 && fail "DDS refusal should exit nonzero"
grep -q "SKIP" "$OUT/dds.log" || fail "DDS refusal hid cause"
pass "DDS refusal exits nonzero with cause"

echo "--- 5. scene tools ---"
node converters/material-normalize.js "$OUT/cube.glb" --out "$OUT/cube.mat.glb" >/dev/null
expect_glb "$OUT/cube.mat.glb"
node converters/glb-merge.js "$OUT/cube.glb" "$OUT/stl-cube.glb" --out "$OUT/merged.glb" >/dev/null
expect_glb "$OUT/merged.glb"
node converters/glb-split.js "$OUT/merged.glb" --out-dir "$OUT/split" --by mesh >/dev/null
[ "$(find "$OUT/split" -name '*.glb' | wc -l | tr -d ' ')" = "2" ] || fail "split part count"
for p in "$OUT"/split/*.glb; do
  expect_glb "$p"
  node converters/gltf-report.js "$p" | grep -q "meshes 1 |" || fail "split part not single-mesh: $p"
done
pass "merge + split roundtrip"
node converters/anim-trim.js "$OUT/samba.glb" | grep -q "mixamo.com" || fail "anim list missing clip"
node converters/anim-trim.js "$OUT/samba.glb" --clip mixamo --trim 0:2 --fps 30 --out "$OUT/samba-loop.glb" >/dev/null
expect_glb "$OUT/samba-loop.glb"
node converters/anim-trim.js "$OUT/samba-loop.glb" | grep -q "dur 2.00s" || fail "trimmed loop not 2s"
node converters/collision-proxy.js "$OUT/cube.glb" --out "$OUT/cube.proxy.glb" >/dev/null
expect_glb "$OUT/cube.proxy.glb"
PRX_W="$(node converters/gltf-report.js "$OUT/cube.proxy.glb" | grep '^ world')"
[ "$SRC_W" = "$PRX_W" ] || fail "proxy bbox differs: $PRX_W vs $SRC_W"
pass "proxy bbox matches source"

echo "--- 6. budget-gate: pass must pass, breach must fail ---"
node converters/budget-gate.js "$OUT/cube.opt.glb" >/dev/null || fail "gate should PASS cube.opt"
pass "gate PASS"
node converters/budget-gate.js "$OUT/samba.glb" --max-mb 4 >"$OUT/refuse.log" 2>&1 && fail "gate should FAIL samba --max-mb 4"
grep -q "> 4MB" "$OUT/refuse.log" || fail "gate FAIL hid breach"
pass "gate FAIL on breach with reason"

echo "--- 7. README docs links resolve ---"
node -e "
const fs = require('fs');
const src = fs.readFileSync('README.md', 'utf8');
const urls = [...src.matchAll(/\(https:\/\/github\.com\/velkymx\/threejs-converters\/blob\/main\/docs\/([a-z0-9-]+\.md)\)/g)];
if (!urls.length) { console.error('no doc links'); process.exit(1); }
for (const m of urls) {
  if (!fs.existsSync('docs/' + m[1])) { console.error('missing docs/' + m[1]); process.exit(1); }
}
console.log(urls.length + ' doc links resolve');
" || fail "docs links"
pass "docs links"

echo "--- 8. mime refusals: wrong magic exits nonzero with path ---"
printf 'GLB-WANNABE!' > "$OUT/fake.glb"
printf '{"asset":{"version":"1.0"}}' > "$OUT/v1.gltf"
truncate -s 101M "$OUT/huge.bin" 2>/dev/null || dd if=/dev/zero of="$OUT/huge.bin" bs=1M count=101 2>/dev/null
cp "$OUT/huge.bin" "$OUT/huge.png"
refuse() { # refuse <desc> <cmd...> — must exit nonzero
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then fail "$desc accepted bad input"; fi
  pass "$desc refused"
}
refuse_msg() { # refuse_msg <desc> <pattern> <cmd...> — nonzero plus message names cause
  local desc="$1" pat="$2"; shift 2
  "$@" >"$OUT/refuse.log" 2>&1 && fail "$desc accepted bad input"
  grep -q "$pat" "$OUT/refuse.log" || fail "$desc hid cause (want /$pat/)"
  pass "$desc refused with cause"
}
refuse_msg "obj rejects GLB" "already converted" node converters/obj-to-glb.js "$OUT/cube.glb" --out "$OUT/x.glb"
refuse_msg "obj rejects STL binary" "binary content" node converters/obj-to-glb.js assets/cube-mm.stl --out "$OUT/x.glb"
refuse_msg "stl rejects GLB" "already converted" node converters/stl-to-glb.js "$OUT/cube.glb" --out "$OUT/x.glb"
refuse_msg "ply rejects GLB" "already converted" node converters/ply-to-glb.js "$OUT/cube.glb" --out "$OUT/x.glb"
refuse_msg "dae rejects FBX binary" "binary content" node converters/dae-to-glb.js "assets/Samba%20Dancing.fbx" --out "$OUT/x.glb"
refuse_msg "3ds rejects OBJ" "bad magic" node converters/3ds-to-glb.js assets/cube.obj --out "$OUT/x.glb"
refuse_msg "fbx rejects OBJ" "Kaydara" node converters/fbx-to-glb.js assets/cube.obj --out "$OUT/x.glb"
refuse_msg "merge rejects OBJ" "corrupt or unsupported" node converters/glb-merge.js assets/cube.obj "$OUT/cube.glb" --out "$OUT/x.glb"
refuse_msg "split rejects OBJ" "corrupt or unsupported" node converters/glb-split.js assets/cube.obj --out-dir "$OUT/xsplit"
refuse_msg "anim rejects fake GLB" "magic" node converters/anim-trim.js "$OUT/fake.glb" --clip x
refuse_msg "proxy rejects fake GLB" "valid .glb" node converters/collision-proxy.js "$OUT/fake.glb"
refuse_msg "optimize rejects fake GLB" "magic" node converters/glb-optimize.js "$OUT/fake.glb" --out "$OUT/x.glb" --no-compress
refuse_msg "material rejects fake GLB" "magic" node converters/material-normalize.js "$OUT/fake.glb" --out "$OUT/x.glb"
refuse_msg "report rejects fake GLB" "magic" node converters/gltf-report.js "$OUT/fake.glb"
refuse_msg "gate rejects fake GLB" "magic" node converters/budget-gate.js "$OUT/fake.glb"
refuse_msg "rig-report rejects fake GLB" "magic" node converters/rig-report.js "$OUT/fake.glb"
refuse_msg "rig-normalize rejects fake GLB" "magic" node converters/rig-normalize.js "$OUT/fake.glb"
refuse_msg "pack rejects v1" "need 2.x" node converters/gltf-pack.js "$OUT/v1.gltf" --out "$OUT/x.glb"
refuse_msg "texture rejects huge file" "too large" node converters/texture-convert.js "$OUT/huge.png" --out-dir "$OUT/tex"

echo "--- 9. pk3: zip extracts byte-identical ---"
node --input-type=module -e "
import { writeFileSync, readFileSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';
// why: committed binary fixtures are opaque; generating a real deflated+stored zip here
// proves the reader against genuine buffers every run
const files = [
  { name: 'models/cube.obj', data: readFileSync('assets/cube.obj'), method: 8 },
  { name: 'models/cube.skin', data: Buffer.from('cube,models/cube.tga\n', 'ascii'), method: 0 },
];
const chunks = [], central = [];
let off = 0;
const dosTime = 0x645c, dosDate = 0x4a21; // fixed stamp keeps fixture deterministic
for (const f of files) {
  const body = f.method === 8 ? deflateRawSync(f.data) : f.data;
  const name = Buffer.from(f.name, 'utf8');
  const lh = Buffer.alloc(30);
  lh.write('PK\x03\x04', 0, 'binary'); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
  lh.writeUInt16LE(f.method, 8); lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
  lh.writeUInt32LE(crc32(f.data) >>> 0, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(f.data.length, 22);
  lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
  chunks.push(lh, name, body);
  const cd = Buffer.alloc(46);
  cd.write('PK\x01\x02', 0, 'binary'); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
  cd.writeUInt16LE(f.method, 10); cd.writeUInt16LE(dosTime, 12); cd.writeUInt16LE(dosDate, 14);
  cd.writeUInt32LE(crc32(f.data) >>> 0, 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(f.data.length, 24);
  cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(off, 42);
  central.push(cd, name);
  off += lh.length + name.length + body.length;
}
const cdStart = off;
for (const c of central) { chunks.push(c); off += c.length; }
const end = Buffer.alloc(22);
end.write('PK\x05\x06', 0, 'binary'); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(off - cdStart, 12); end.writeUInt32LE(cdStart, 16);
chunks.push(end);
writeFileSync('$OUT/test.pk3', Buffer.concat(chunks));
console.log('pk3 fixture ok');
" || fail "pk3 fixture"
node converters/pk3-to-dir.js "$OUT/test.pk3" --out-dir "$OUT/pk3" >/dev/null
cmp -s assets/cube.obj "$OUT/pk3/models/cube.obj" || fail "pk3 obj not byte-identical"
[ -s "$OUT/pk3/models/cube.skin" ] || fail "pk3 skin missing"
pass "pk3 extracts byte-identical"
node converters/pk3-to-dir.js assets/cube.obj --out-dir "$OUT/xpk3" >"$OUT/refuse.log" 2>&1 && fail "pk3 should refuse non-zip"
grep -q "bad magic" "$OUT/refuse.log" || fail "pk3 refusal hid cause"
pass "pk3 refuses non-zip with cause"

echo "--- 10. md3: binary model converts, frame picked, skin named ---"
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
// why: minimal real MD3 (1 frame, 1 surface, 1 tri) proves the reader against genuine bytes;
// verts at 64 units = 1.0m after the spec /64 scale
const enc = (s, n) => { const b = Buffer.alloc(n); b.write(s, 0, 'ascii'); return b; };
const head = Buffer.alloc(108);
head.write('IDP3', 0, 'ascii'); head.writeInt32LE(15, 4);
enc('test', 0).copy(head, 8);
head.writeInt32LE(1, 76); head.writeInt32LE(0, 80); head.writeInt32LE(1, 84); head.writeInt32LE(0, 88);
head.writeInt32LE(108, 92); head.writeInt32LE(108, 96); head.writeInt32LE(164, 100);
const frame = Buffer.alloc(56); // bounds/origin/radius zeros, name first-frame
enc('first', 16).copy(frame, 40);
const sh = Buffer.alloc(108);
sh.write('IDP3', 0, 'ascii'); enc('body', 64).copy(sh, 8);
sh.writeInt32LE(1, 72); sh.writeInt32LE(1, 76); sh.writeInt32LE(3, 80); sh.writeInt32LE(1, 84);
sh.writeInt32LE(108, 88); sh.writeInt32LE(120, 92); sh.writeInt32LE(188, 96); sh.writeInt32LE(212, 100);
const tris = Buffer.alloc(12); tris.writeInt32LE(0, 0); tris.writeInt32LE(1, 4); tris.writeInt32LE(2, 8);
const shader = Buffer.concat([enc('models/armor.tga', 64), Buffer.alloc(4)]);
const st = Buffer.alloc(24);
st.writeFloatLE(0, 0); st.writeFloatLE(0, 4); st.writeFloatLE(1, 8); st.writeFloatLE(0, 12); st.writeFloatLE(0, 16); st.writeFloatLE(1, 20);
const xyz = Buffer.alloc(24);
const V = [[0,0,0],[64,0,0],[0,64,0]];
V.forEach((v, i) => { xyz.writeInt16LE(v[0], i*8); xyz.writeInt16LE(v[1], i*8+2); xyz.writeInt16LE(v[2], i*8+4); xyz.writeUInt16LE(0, i*8+6); });
const surfEnd = 108 + 12 + 68 + 24 + 24;
const parts = [head, frame, sh, tris, shader, st, xyz];
head.writeInt32LE(108 + 56 + surfEnd, 104);
writeFileSync('$OUT/test.md3', Buffer.concat(parts));
writeFileSync('$OUT/test.skin', 'body,models/armor.tga\n');
console.log('md3 fixture ok');
" || fail "md3 fixture"
node converters/md3-to-glb.js "$OUT/test.md3" --out "$OUT/md3.glb" >/dev/null
expect_glb "$OUT/md3.glb"
node converters/gltf-report.js "$OUT/md3.glb" | grep -q "tris 1 |" || fail "md3 tri count"
node converters/gltf-report.js "$OUT/md3.glb" | grep -q "1.000 x 1.000" || fail "md3 /64 scale"
node --input-type=module -e "
import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read('$OUT/md3.glb');
const names = doc.getRoot().listMaterials().map(m => m.getName());
if (!names.includes('armor')) throw new Error('skin material missing: ' + names.join(','));
" || fail "md3 skin material name"
pass "md3 converts at spec scale"
node converters/md3-to-glb.js assets/cube.obj --out "$OUT/x.glb" >"$OUT/refuse.log" 2>&1 && fail "md3 should refuse non-MD3"
grep -q "bad IDP3 magic" "$OUT/refuse.log" || fail "md3 refusal hid cause"
pass "md3 refuses non-MD3 with cause"

echo "--- 11. vox: voxel model converts ---"
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
// why: minimal real VOX (MAIN > SIZE 2x2x2 + XYZI 2 voxels) proves parse + greedy mesh;
// color indices are 1-based into the palette
const chunk = (id, content, kids) => {
  const h = Buffer.alloc(12);
  h.write(id, 0, 'ascii'); h.writeInt32LE(content.length, 4); h.writeInt32LE(kids.reduce((s, k) => s + k.length, 0), 8);
  return Buffer.concat([h, content, ...kids]);
};
const size = Buffer.alloc(12); size.writeInt32LE(2, 0); size.writeInt32LE(2, 4); size.writeInt32LE(2, 8);
const xyzi = Buffer.alloc(4 + 8);
xyzi.writeInt32LE(2, 0);
xyzi.writeUInt8(0, 4); xyzi.writeUInt8(0, 5); xyzi.writeUInt8(0, 6); xyzi.writeUInt8(1, 7);
xyzi.writeUInt8(1, 8); xyzi.writeUInt8(1, 9); xyzi.writeUInt8(1, 10); xyzi.writeUInt8(2, 11);
// scene graph: nTRN(0) -> nGRP(1) -> nSHP(2) -> model 0 (what MagicaVoxel writes)
const dict0 = Buffer.alloc(4);
const ntrn = Buffer.concat([(()=>{const b=Buffer.alloc(4);b.writeUInt32LE(0,0);return b;})(), dict0,
  (()=>{const b=Buffer.alloc(4);b.writeUInt32LE(1,0);return b;})(),
  (()=>{const b=Buffer.alloc(4);b.writeInt32LE(-1,0);return b;})(),
  (()=>{const b=Buffer.alloc(4);b.writeInt32LE(0,0);return b;})(),
  (()=>{const b=Buffer.alloc(4);b.writeUInt32LE(1,0);return b;})(), dict0]);
const ngrp = Buffer.concat([(()=>{const b=Buffer.alloc(4);b.writeUInt32LE(1,0);return b;})(), dict0,
  (()=>{const b=Buffer.alloc(4);b.writeUInt32LE(1,0);return b;})(),
  (()=>{const b=Buffer.alloc(4);b.writeUInt32LE(2,0);return b;})()]);
const nshp = Buffer.concat([(()=>{const b=Buffer.alloc(4);b.writeUInt32LE(2,0);return b;})(), dict0,
  (()=>{const b=Buffer.alloc(4);b.writeUInt32LE(1,0);return b;})(),
  (()=>{const b=Buffer.alloc(4);b.writeUInt32LE(0,0);return b;})(), dict0]);
const head = Buffer.alloc(8); head.write('VOX ', 0, 'ascii'); head.writeInt32LE(150, 4);
writeFileSync('$OUT/test.vox', Buffer.concat([head, chunk('MAIN', Buffer.alloc(0), [chunk('SIZE', size, []), chunk('XYZI', xyzi, []), chunk('nTRN', ntrn, []), chunk('nGRP', ngrp, []), chunk('nSHP', nshp, [])])]));
console.log('vox fixture ok');
" || fail "vox fixture"
node converters/vox-to-glb.js "$OUT/test.vox" --out "$OUT/vox.glb" --target-max 1 >/dev/null 2>&1
expect_glb "$OUT/vox.glb"
node converters/gltf-report.js "$OUT/vox.glb" | grep -q "1.000 x 1.000 x 1.000" || fail "vox bbox"
node converters/gltf-report.js "$OUT/vox.glb" | grep -q "tris 24 |" || fail "vox tri count"
pass "vox converts"
node converters/vox-to-glb.js assets/cube.obj --out "$OUT/x.glb" >"$OUT/refuse.log" 2>&1 && fail "vox should refuse non-VOX"
grep -q "bad magic" "$OUT/refuse.log" || fail "vox refusal hid cause"
pass "vox refuses non-VOX with cause"

echo "--- 12. md2: frame picked, baked to static mesh ---"
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
// why: minimal real MD2 (2 frames, 1 tri) proves parse + frame bake; uint8 verts need
// scale/translation (here 0.5) so frame0 spans 1m and frame1 spans y 1..2m
const head = Buffer.alloc(68);
head.writeInt32LE(844121161, 0); head.writeInt32LE(8, 4);
head.writeInt32LE(64, 8); head.writeInt32LE(64, 12); head.writeInt32LE(52, 16);
head.writeInt32LE(0, 20); head.writeInt32LE(3, 24); head.writeInt32LE(3, 28);
head.writeInt32LE(1, 32); head.writeInt32LE(0, 36); head.writeInt32LE(2, 40);
head.writeInt32LE(196, 44); head.writeInt32LE(68, 48); head.writeInt32LE(80, 52);
head.writeInt32LE(92, 56); head.writeInt32LE(196, 60); head.writeInt32LE(196, 64);
const st = Buffer.alloc(12);
st.writeInt16LE(0, 0); st.writeInt16LE(0, 2); st.writeInt16LE(64, 4); st.writeInt16LE(0, 6); st.writeInt16LE(0, 8); st.writeInt16LE(64, 10);
const tri = Buffer.alloc(12);
tri.writeUInt16LE(0, 0); tri.writeUInt16LE(1, 2); tri.writeUInt16LE(2, 4);
tri.writeUInt16LE(0, 6); tri.writeUInt16LE(1, 8); tri.writeUInt16LE(2, 10);
const frame = (name, verts) => {
  const f = Buffer.alloc(52);
  f.writeFloatLE(0.5, 0); f.writeFloatLE(0.5, 4); f.writeFloatLE(0.5, 8);
  f.writeFloatLE(0, 12); f.writeFloatLE(0, 16); f.writeFloatLE(0, 20);
  f.write(name, 24, 'ascii');
  verts.forEach((v, i) => { f.writeUInt8(v[0], 40+i*4); f.writeUInt8(v[1], 40+i*4+1); f.writeUInt8(v[2], 40+i*4+2); f.writeUInt8(0, 40+i*4+3); });
  return f;
};
// stored z becomes emitted y (loader Y-ups) — frame1 floats 1m up, caught by --no-ground
writeFileSync('$OUT/test.md2', Buffer.concat([head, st, tri, frame('frame0', [[0,0,0],[2,0,0],[0,2,0]]), frame('frame1', [[0,0,2],[2,0,2],[0,2,2]])]));
console.log('md2 fixture ok');
" || fail "md2 fixture"
node converters/md2-to-glb.js "$OUT/test.md2" --out "$OUT/md2.glb" >/dev/null 2>&1
expect_glb "$OUT/md2.glb"
node converters/gltf-report.js "$OUT/md2.glb" | grep -q "1.000 x 0.000 x 1.000" || fail "md2 frame0 size"
node converters/md2-to-glb.js "$OUT/test.md2" --frame 1 --no-ground --no-center --out "$OUT/md2f1.glb" >/dev/null 2>&1
node converters/gltf-report.js "$OUT/md2f1.glb" | grep -q "min.y 1.000" || fail "md2 frame1 pose"
pass "md2 bakes picked frame"
node converters/md2-to-glb.js "$OUT/test.md2" --frame 9 --out "$OUT/x.glb" >"$OUT/refuse.log" 2>&1 && fail "md2 should refuse bad frame"
grep -q "Bad --frame 9" "$OUT/refuse.log" || fail "md2 refusal hid cause"
pass "md2 refuses bad frame with cause"

echo "--- 13. minecraft: blockmodel cubes convert, parent resolves, uvs exact ---"
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
// why: real blockmodel JSON (full cube + rotated element + texture vars) proves faces,
// rotation, and uv mapping; the child proves --parent-dir chaining
const faces = {};
for (const d of ['down','up','north','south','west','east'])
  faces[d] = { uv: [0, 0, 16, 16], texture: '#side' };
const model = {
  textures: { side: 'block/stone', top: 'block/stone_top' },
  elements: [
    { from: [0, 0, 0], to: [16, 16, 16], faces },
    { from: [4, 0, 4], to: [12, 8, 12],
      rotation: { origin: [8, 0, 8], axis: 'y', angle: 45 },
      faces: { up: { uv: [0, 0, 8, 8], texture: '#top' } } },
  ],
};
writeFileSync('$OUT/crate.json', JSON.stringify(model));
writeFileSync('$OUT/crate_child.json', JSON.stringify({ parent: 'crate', textures: { side: 'block/oak' } }));
console.log('mc fixture ok');
" || fail "mc fixture"
node converters/minecraft-to-glb.js "$OUT/crate.json" --out "$OUT/mc.glb" >/dev/null
expect_glb "$OUT/mc.glb"
node converters/gltf-report.js "$OUT/mc.glb" | grep -q "tris 14 |" || fail "mc tri count (12+2)"
node converters/gltf-report.js "$OUT/mc.glb" | grep -q "1.000 x 1.000 x 1.000" || fail "mc meter scale"
node --input-type=module -e "
import { NodeIO } from '@gltf-transform/core';
// why: exact uv assert on the box north face (3rd face in, verts 8..11) pins the
// orientation table against regressions: A(u1,v2) B(u2,v2) C(u2,v1) D(u1,v1), v-flipped
const doc = await new NodeIO().read('$OUT/mc.glb');
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const uv = [...prim.getAttribute('TEXCOORD_0').getArray()].slice(16, 24);
const want = [0, 0, 1, 0, 1, 1, 0, 1];
if (!uv.every((v, i) => Math.abs(v - want[i]) < 1e-6)) throw new Error('north uvs ' + uv.join(','));
const n = [...prim.getAttribute('NORMAL').getArray()].slice(24, 27);
if (n.join(',') !== '0,0,-1') throw new Error('north normal ' + n.join(','));
console.log('mc uvs exact');
" || fail "mc north uvs"
node converters/minecraft-to-glb.js "$OUT/crate_child.json" --parent-dir "$OUT" --out "$OUT/mc-child.glb" >/dev/null
expect_glb "$OUT/mc-child.glb"
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
writeFileSync('$OUT/orphan.json', JSON.stringify({ parent: 'does-not-exist' }));
" || fail "mc orphan fixture"
node converters/minecraft-to-glb.js "$OUT/orphan.json" --parent-dir "$OUT/empty-parents" --out "$OUT/x.glb" >"$OUT/refuse.log" 2>&1 && fail "mc should refuse unresolvable parent"
grep -q "Unresolvable parent" "$OUT/refuse.log" || fail "mc refusal hid cause"
pass "mc refuses orphan with cause"
pass "mc converts, parents, uvs"

echo ""
echo "ALL CI CHECKS PASSED"
