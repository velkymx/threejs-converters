#!/usr/bin/env node
// budget-gate.js — CI PASS/FAIL over model budgets. Zero deps. Pure Node. Exit 1 on breach.
// Why: gltf-report.js advises; this enforces. Run in CI / pre-commit so heavy finds never ship.
// Checks: --max-tris --max-draws --max-mats --max-mb (file) --max-images --min-size --max-size (world max-dim m)
// Usage: node converters/budget-gate.js <model.glb> [--max-tris 100000] [--max-draws 50] [--json]
// Defaults = mobile-ready thresholds from README budgets (tris 100k, draws 50, mats 16, mb 8, images 8).
import { readFileSync, statSync } from 'node:fs';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`budget-gate.js — fail CI when asset busts budget
Usage:
  node converters/budget-gate.js <model.glb> [--max-tris 100000] [--max-draws 50] [--max-mats 16] [--max-mb 8] [--max-images 8] [--min-size 0.01] [--max-size 100] [--json]
Exit 0 PASS, 1 FAIL. Pair with gltf-report.js for the why.`);
  process.exit(args.length ? 0 : 1);
}

const o = { in: null, maxTris: 100_000, maxDraws: 50, maxMats: 16, maxMb: 8, maxImages: 8, minSize: 0, maxSize: 0, json: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--max-tris') o.maxTris = Number(args[++i]);
  else if (a === '--max-draws') o.maxDraws = Number(args[++i]);
  else if (a === '--max-mats') o.maxMats = Number(args[++i]);
  else if (a === '--max-mb') o.maxMb = Number(args[++i]);
  else if (a === '--max-images') o.maxImages = Number(args[++i]);
  else if (a === '--min-size') o.minSize = Number(args[++i]);
  else if (a === '--max-size') o.maxSize = Number(args[++i]);
  else if (a === '--json') o.json = true;
  else if (!a.startsWith('--') && !o.in) o.in = a;
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (!o.in) { console.error('Missing input.'); process.exit(1); }

const bytes = readFileSync(o.in);
let json;
if (o.in.endsWith('.glb')) {
  const len = bytes.readUInt32LE(12);
  json = JSON.parse(bytes.subarray(20, 20 + len).toString('utf8'));
} else json = JSON.parse(bytes.toString('utf8'));

const acc = json.accessors || [];
let tris = 0, draws = 0;
for (const m of json.meshes || []) for (const p of m.primitives || []) {
  draws++;
  if ((p.mode ?? 4) === 4) {
    const idx = p.indices != null ? acc[p.indices] : null;
    tris += Math.floor(((idx ? idx.count : 0) || acc[p.attributes?.POSITION]?.count || 0) / 3);
  }
}
// world max-dim (quantized POSITION min/max skipped: unmeasurable, not failed)
const quatMat = ([x, y, z, w]) => {
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [1 - (yy + zz), xy + wz, xz - wy, 0, xy - wz, 1 - (xx + zz), yz + wx, 0, xz + wy, yz - wx, 1 - (xx + yy), 0, 0, 0, 0, 1];
};
const compose = (n) => {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0], s = n.scale || [1, 1, 1], r = quatMat(n.rotation || [0, 0, 0, 1]);
  return [r[0]*s[0], r[1]*s[0], r[2]*s[0], 0, r[4]*s[1], r[5]*s[1], r[6]*s[1], 0, r[8]*s[2], r[9]*s[2], r[10]*s[2], 0, t[0], t[1], t[2], 1];
};
const mul = (a, b) => { const m = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let k = 0; k < 4; k++) v += a[k*4+r] * b[c*4+k]; m[c*4+r] = v; } return m; };
const nodes = json.nodes || [];
const wmin = [Infinity, Infinity, Infinity], wmax = [-Infinity, -Infinity, -Infinity];
let hasGeo = false;
const walk = (ni, w) => {
  const n = nodes[ni];
  if (!n) return;
  const m = mul(w, compose(n));
  for (const mm of n.mesh != null ? [json.meshes[n.mesh]] : []) {
    if (!mm) continue;
    for (const p of mm.primitives || []) {
      const pa = acc[p.attributes?.POSITION];
      if (!pa?.min || !pa?.max || pa.normalized) continue;
      hasGeo = true;
      for (let i = 0; i < 8; i++) {
        const X = m[0]*(i & 1 ? pa.max[0] : pa.min[0]) + m[4]*(i & 2 ? pa.max[1] : pa.min[1]) + m[8]*(i & 4 ? pa.max[2] : pa.min[2]) + m[12];
        const Y = m[1]*(i & 1 ? pa.max[0] : pa.min[0]) + m[5]*(i & 2 ? pa.max[1] : pa.min[1]) + m[9]*(i & 4 ? pa.max[2] : pa.min[2]) + m[13];
        const Z = m[2]*(i & 1 ? pa.max[0] : pa.min[0]) + m[6]*(i & 2 ? pa.max[1] : pa.min[1]) + m[10]*(i & 4 ? pa.max[2] : pa.min[2]) + m[14];
        if (X < wmin[0]) wmin[0] = X; if (Y < wmin[1]) wmin[1] = Y; if (Z < wmin[2]) wmin[2] = Z;
        if (X > wmax[0]) wmax[0] = X; if (Y > wmax[1]) wmax[1] = Y; if (Z > wmax[2]) wmax[2] = Z;
      }
    }
  }
  for (const c of n.children || []) walk(c, m);
};
const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
(json.scenes?.length ? json.scenes : [{ nodes: nodes.map((_, i) => i) }]).forEach((s) => (s.nodes || []).forEach((r) => walk(r, IDENT)));
const maxDim = hasGeo ? Math.max(...wmax.map((v, i) => v - wmin[i])) : 0;
const mb = statSync(o.in).size / 1048576;
const mats = (json.materials || []).length, images = (json.images || []).length;

const fails = [];
if (tris > o.maxTris) fails.push(`tris ${tris} > ${o.maxTris} (glb-optimize weld+quantize, or split)`);
if (draws > o.maxDraws) fails.push(`draws ${draws} > ${o.maxDraws} (glb-merge --join, or split)`);
if (mats > o.maxMats) fails.push(`materials ${mats} > ${o.maxMats} (material-normalize dedup, glb-optimize palette)`);
if (mb > o.maxMb) fails.push(`file ${mb.toFixed(1)}MB > ${o.maxMb}MB (texture-convert webp, glb-optimize)`);
if (images > o.maxImages) fails.push(`images ${images} > ${o.maxImages} (texture-convert, atlas)`);
if (o.minSize && hasGeo && maxDim < o.minSize) fails.push(`size ${maxDim.toFixed(3)}m < min ${o.minSize}m (glb-optimize --target-max)`);
if (o.maxSize && hasGeo && maxDim > o.maxSize) fails.push(`size ${maxDim.toFixed(1)}m > max ${o.maxSize}m (glb-optimize --units/--target-max)`);
const pass = !fails.length;
if (o.json) console.log(JSON.stringify({ file: o.in, pass, tris, draws, mats, images, mb: +mb.toFixed(2), maxDim: +maxDim.toFixed(4), fails }, null, 2));
else {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${o.in} — tris ${tris} draws ${draws} mats ${mats} imgs ${images} ${mb.toFixed(2)}MB${hasGeo ? ` size ${maxDim.toFixed(2)}m` : ''}`);
  for (const f of fails) console.log(` - ${f}`);
}
process.exit(pass ? 0 : 1);
