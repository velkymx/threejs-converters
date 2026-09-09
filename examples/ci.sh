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

echo "--- 0. --help smoke (all 19 tools exit 0) ---"
for t in download obj-to-glb stl-to-glb ply-to-glb dae-to-glb 3ds-to-glb gltf-pack fbx-to-glb glb-merge glb-split anim-trim \
  collision-proxy glb-optimize material-normalize texture-convert pk3-to-dir md3-to-glb \
  gltf-report rig-report rig-normalize budget-gate; do
  node "converters/$t.js" --help >/dev/null || fail "$t --help"
done
pass "all --help"

echo "--- 1. ingest: obj / stl / fbx / ply / dae / 3ds / pack ---"
node converters/obj-to-glb.js assets/cube.obj --out "$OUT/cube.glb" >/dev/null
expect_file "$OUT/cube.glb"
node converters/stl-to-glb.js assets/cube-mm.stl --out "$OUT/stl-cube.glb" --target-max 0.2 >/dev/null
expect_file "$OUT/stl-cube.glb"
node converters/fbx-to-glb.js "assets/Samba%20Dancing.fbx" --out "$OUT/samba.glb" --units cm --target-height 1.7 >/dev/null 2>&1
expect_file "$OUT/samba.glb"
node converters/ply-to-glb.js assets/tri.ply --out "$OUT/tri-ply.glb" >/dev/null
expect_file "$OUT/tri-ply.glb"
node converters/dae-to-glb.js assets/tri.dae --out "$OUT/tri-dae.glb" --target-max 2 >/dev/null 2>&1
expect_file "$OUT/tri-dae.glb"
node converters/3ds-to-glb.js assets/tri.3ds --out "$OUT/tri-3ds.glb" --units mm --target-max 0.2 >/dev/null 2>&1
expect_file "$OUT/tri-3ds.glb"
node converters/gltf-report.js "$OUT/tri-ply.glb" | grep -q "tris 1" || fail "ply tri count"
node converters/gltf-report.js "$OUT/tri-dae.glb" | grep -q "tris 1" || fail "dae tri count"
node converters/gltf-report.js "$OUT/tri-3ds.glb" | grep -q "tris 2" || fail "3ds tri count"
pass "ply + dae + 3ds tri counts"
mkdir -p "$OUT/pack"
node --input-type=module -e "
import { NodeIO } from '@gltf-transform/core';
await new NodeIO().write('$OUT/pack/cube.gltf', await new NodeIO().read('$OUT/cube.glb'));
" || fail "split .gltf fixture"
node converters/gltf-pack.js "$OUT/pack/cube.gltf" --out "$OUT/packed.glb" >/dev/null
expect_file "$OUT/packed.glb"
node converters/gltf-report.js "$OUT/packed.glb" | grep -q "tris 2" || fail "packed tri count"
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
expect_file "$OUT/cube.opt.glb"
node converters/gltf-report.js "$OUT/cube.opt.glb" | grep -q "MOBILE-READY" || fail "cube.opt verdict"
node converters/gltf-report.js "$OUT/cube.glb" --json | grep -q '"ok": true' || fail "cube scale"
pass "report verdict + scale"

echo "--- 4. textures: set converts, DDS refuses nonzero ---"
node converters/texture-convert.js assets/albedo.png assets/normal_dx.png assets/rough.png --out-dir "$OUT/tex" --flip-y >/dev/null
[ "$(find "$OUT/tex" -name '*.webp' | wc -l | tr -d ' ')" = "3" ] || fail "texture set count"
pass "texture set (3 webp)"
if node converters/texture-convert.js assets/fixture_u.tga assets/fixture.dds --out-dir "$OUT/tex" >/dev/null 2>&1; then
  fail "DDS refusal should exit nonzero"
fi
pass "DDS refusal exits nonzero"

echo "--- 5. scene tools ---"
node converters/material-normalize.js "$OUT/cube.glb" --out "$OUT/cube.mat.glb" >/dev/null
expect_file "$OUT/cube.mat.glb"
node converters/glb-merge.js "$OUT/cube.glb" "$OUT/stl-cube.glb" --out "$OUT/merged.glb" >/dev/null
expect_file "$OUT/merged.glb"
node converters/glb-split.js "$OUT/merged.glb" --out-dir "$OUT/split" --by mesh >/dev/null
[ "$(find "$OUT/split" -name '*.glb' | wc -l | tr -d ' ')" = "2" ] || fail "split part count"
pass "merge + split roundtrip"
node converters/anim-trim.js "$OUT/samba.glb" >/dev/null || fail "anim list"
node converters/anim-trim.js "$OUT/samba.glb" --clip mixamo --trim 0:2 --fps 30 --out "$OUT/samba-loop.glb" >/dev/null
expect_file "$OUT/samba-loop.glb"
node converters/collision-proxy.js "$OUT/cube.glb" --out "$OUT/cube.proxy.glb" >/dev/null
expect_file "$OUT/cube.proxy.glb"

echo "--- 6. budget-gate: pass must pass, breach must fail ---"
node converters/budget-gate.js "$OUT/cube.opt.glb" >/dev/null || fail "gate should PASS cube.opt"
pass "gate PASS"
if node converters/budget-gate.js "$OUT/samba.glb" --max-mb 4 >/dev/null 2>&1; then
  fail "gate should FAIL samba --max-mb 4"
fi
pass "gate FAIL on breach"

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
refuse "obj rejects GLB" node converters/obj-to-glb.js "$OUT/cube.glb" --out "$OUT/x.glb"
refuse "obj rejects STL binary" node converters/obj-to-glb.js assets/cube-mm.stl --out "$OUT/x.glb"
refuse "stl rejects GLB" node converters/stl-to-glb.js "$OUT/cube.glb" --out "$OUT/x.glb"
refuse "ply rejects GLB" node converters/ply-to-glb.js "$OUT/cube.glb" --out "$OUT/x.glb"
refuse "dae rejects FBX binary" node converters/dae-to-glb.js "assets/Samba%20Dancing.fbx" --out "$OUT/x.glb"
refuse "3ds rejects OBJ" node converters/3ds-to-glb.js assets/cube.obj --out "$OUT/x.glb"
refuse "fbx rejects OBJ" node converters/fbx-to-glb.js assets/cube.obj --out "$OUT/x.glb"
refuse "merge rejects OBJ" node converters/glb-merge.js assets/cube.obj "$OUT/cube.glb" --out "$OUT/x.glb"
refuse "split rejects OBJ" node converters/glb-split.js assets/cube.obj --out-dir "$OUT/xsplit"
refuse_msg "anim rejects fake GLB" "magic" node converters/anim-trim.js "$OUT/fake.glb" --clip x
refuse_msg "proxy rejects fake GLB" "valid .glb" node converters/collision-proxy.js "$OUT/fake.glb"
refuse_msg "optimize rejects fake GLB" "magic" node converters/glb-optimize.js "$OUT/fake.glb" --out "$OUT/x.glb" --no-compress
refuse_msg "material rejects fake GLB" "magic" node converters/material-normalize.js "$OUT/fake.glb" --out "$OUT/x.glb"
refuse_msg "report rejects fake GLB" "magic" node converters/gltf-report.js "$OUT/fake.glb"
refuse_msg "gate rejects fake GLB" "magic" node converters/budget-gate.js "$OUT/fake.glb"
refuse_msg "rig-report rejects fake GLB" "magic" node converters/rig-report.js "$OUT/fake.glb"
refuse_msg "rig-normalize rejects fake GLB" "magic" node converters/rig-normalize.js "$OUT/fake.glb"
refuse "pack rejects v1" node converters/gltf-pack.js "$OUT/v1.gltf" --out "$OUT/x.glb"
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
if node converters/pk3-to-dir.js assets/cube.obj --out-dir "$OUT/xpk3" >/dev/null 2>&1; then
  fail "pk3 should refuse non-zip"
fi
pass "pk3 refuses non-zip"

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
expect_file "$OUT/md3.glb"
node converters/gltf-report.js "$OUT/md3.glb" | grep -q "tris 1" || fail "md3 tri count"
node converters/gltf-report.js "$OUT/md3.glb" | grep -q "1.000 x 1.000" || fail "md3 /64 scale"
pass "md3 converts at spec scale"
if node converters/md3-to-glb.js assets/cube.obj --out "$OUT/x.glb" >/dev/null 2>&1; then
  fail "md3 should refuse non-MD3"
fi
pass "md3 refuses non-MD3"

echo ""
echo "ALL CI CHECKS PASSED"
