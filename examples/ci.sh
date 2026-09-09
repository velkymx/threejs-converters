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

echo "--- 0. --help smoke (all 15 tools exit 0) ---"
for t in download obj-to-glb stl-to-glb fbx-to-glb glb-merge glb-split anim-trim \
  collision-proxy glb-optimize material-normalize texture-convert \
  gltf-report rig-report rig-normalize budget-gate; do
  node "converters/$t.js" --help >/dev/null || fail "$t --help"
done
pass "all --help"

echo "--- 1. ingest: obj / stl / fbx ---"
node converters/obj-to-glb.js assets/cube.obj --out "$OUT/cube.glb" >/dev/null
expect_file "$OUT/cube.glb"
node converters/stl-to-glb.js assets/cube-mm.stl --out "$OUT/stl-cube.glb" --target-max 0.2 >/dev/null
expect_file "$OUT/stl-cube.glb"
node converters/fbx-to-glb.js "assets/Samba%20Dancing.fbx" --out "$OUT/samba.glb" --units cm --target-height 1.7 >/dev/null 2>&1
expect_file "$OUT/samba.glb"

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

echo ""
echo "ALL CI CHECKS PASSED"
