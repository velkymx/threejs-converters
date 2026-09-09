#!/usr/bin/env node
// collision-proxy.js — .glb -> invisible physics boxes .glb + three.js snippet. Zero deps. Pure Node.
// Why: render meshes are heavy/concave; physics (rapier/cannon) wants cheap convex AABBs. Author once,
//   keep proxy beside visual, toggle visibility off.
// What: reads POSITION min/max per mesh (world transforms applied) → emits one box/mesh + one scene box.
//   --type hull refused on purpose (true convex hull needs native code; use Blender: Mesh → Convex Hull → export).
// Usage: node converters/collision-proxy.js <in.glb> [--out proxy.glb] [--type box] [--snippet]
// Boxes are axis-aligned in world pose (matches three.js Box3.setFromObject). Rotating bodies: re-fit at runtime.
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`collision-proxy.js — AABB physics proxies for three.js
Usage:
  node converters/collision-proxy.js <in.glb> [--out proxy.glb] [--type box] [--snippet]
  --type box only (default). --type hull exits with the Blender path (no pure-Node hull).
Example:
  node converters/collision-proxy.js ./assets/chair.glb --out ./assets/chair.proxy.glb --snippet`);
  process.exit(args.length ? 0 : 1);
}

const o = { in: null, out: null, type: 'box', snippet: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') o.out = args[++i];
  else if (a === '--type') o.type = args[++i];
  else if (a === '--snippet') o.snippet = true;
  else if (!a.startsWith('--') && !o.in) o.in = a;
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (!o.in) { console.error('Missing input.'); process.exit(1); }
if (o.type !== 'box') {
  console.error(`SKIP --type ${o.type}: true convex hull needs native code (quickhull wasm) or Blender.\nPath: Blender → select mesh → Mesh > Convex Hull → export proxy .glb → use beside visual.`);
  process.exit(1);
}
if (!o.out) o.out = o.in.replace(/\.glb$/i, '.proxy.glb');

const bytes = readFileSync(o.in);
const jsonLen = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8'));
const { accessors: acc = [], meshes = [], nodes = [] } = json;

// world matrices (same minimal chain as gltf-report.js)
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
const xf = (m, x, y, z) => [m[0]*x + m[4]*y + m[8]*z + m[12], m[1]*x + m[5]*y + m[9]*z + m[13], m[2]*x + m[6]*y + m[10]*z + m[14]];
const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

const boxes = []; // {name, min, max}
const meshBox = (mi, w) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  let ok = false;
  for (const p of meshes[mi]?.primitives || []) {
    const pa = acc[p.attributes?.POSITION];
    if (!pa?.min || !pa?.max || pa.normalized) continue;
    ok = true;
    for (let i = 0; i < 8; i++) {
      const [X, Y, Z] = xf(w, i & 1 ? pa.max[0] : pa.min[0], i & 2 ? pa.max[1] : pa.min[1], i & 4 ? pa.max[2] : pa.min[2]);
      if (X < mn[0]) mn[0] = X; if (Y < mn[1]) mn[1] = Y; if (Z < mn[2]) mn[2] = Z;
      if (X > mx[0]) mx[0] = X; if (Y > mx[1]) mx[1] = Y; if (Z > mx[2]) mx[2] = Z;
    }
  }
  return ok ? { mn, mx } : null;
};
const walk = (ni, w) => {
  const n = nodes[ni];
  if (!n) return;
  const m = mul(w, compose(n));
  if (n.mesh != null) {
    const b = meshBox(n.mesh, m);
    if (b) boxes.push({ name: meshes[n.mesh]?.name || `mesh${n.mesh}`, min: b.mn, max: b.mx });
  }
  for (const c of n.children || []) walk(c, m);
};
(json.scenes?.length ? json.scenes : [{ nodes: nodes.map((_, i) => i) }]).forEach((s) => (s.nodes || []).forEach((r) => walk(r, IDENT)));
if (!boxes.length) { console.error('No measurable geometry (missing POSITION min/max?).'); process.exit(1); }

// one box mesh per entry + combined scene box
const all = boxes.reduce((a, b) => ({ min: a.min.map((v, i) => Math.min(v, b.min[i])), max: a.max.map((v, i) => Math.max(v, b.max[i])) }),
  { min: [...boxes[0].min], max: [...boxes[0].max] });
boxes.push({ name: 'SCENE', min: all.min, max: all.max });

// --- minimal GLB writer: unit-box corners scaled per instance via node scale/translation ---
const pos = [], idx = [];
const C = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const F = [[0,1,2,0,2,3],[4,6,5,4,7,6],[0,4,5,0,5,1],[2,6,7,2,7,3],[0,3,7,0,7,4],[1,5,6,1,6,2]];
for (let v = 0; v < 8; v++) pos.push(...C[v]);
for (const f of F) idx.push(...f);
const posArr = new Float32Array(pos), idxArr = new Uint16Array(idx);
const bmin = [0, 0, 0], bmax = [1, 1, 1];
const binBuf = Buffer.concat([Buffer.from(posArr.buffer), Buffer.from(idxArr.buffer)]);
const bvs = [
  { buffer: 0, byteOffset: 0, byteLength: posArr.byteLength, target: 34962 },
  { buffer: 0, byteOffset: posArr.byteLength, byteLength: idxArr.byteLength, target: 34963 },
];
const accs = [
  { bufferView: 0, byteOffset: 0, componentType: 5126, count: 8, type: 'VEC3', min: bmin, max: bmax },
  { bufferView: 1, byteOffset: 0, componentType: 5123, count: 36, type: 'SCALAR' },
];
const gNodes = boxes.map((b) => {
  const size = b.max.map((v, i) => Math.max(v - b.min[i], 1e-6));
  return { name: `proxy_${b.name}`, mesh: 0, scale: size, translation: [...b.min] };
});
const gJson = {
  asset: { version: '2.0', generator: 'threejs-converters collision-proxy' },
  scene: 0, scenes: [{ nodes: gNodes.map((_, i) => i) }], nodes: gNodes,
  meshes: [{ name: 'proxy_box', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
  materials: [{ name: 'proxy', pbrMetallicRoughness: { baseColorFactor: [1, 0.2, 0.2, 1], metallicFactor: 0, roughnessFactor: 1 } }],
  buffers: [{ byteLength: binBuf.length }], bufferViews: bvs, accessors: accs,
};
const pad = (n) => (4 - (n % 4)) % 4;
let jBuf = Buffer.from(JSON.stringify(gJson));
jBuf = Buffer.concat([jBuf, Buffer.alloc(pad(jBuf.length), 0x20)]);
let bBuf = Buffer.concat([binBuf, Buffer.alloc(pad(binBuf.length), 0)]);
const total = 12 + 8 + jBuf.length + 8 + bBuf.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
let off = 12;
out.writeUInt32LE(jBuf.length, off); out.writeUInt32LE(0x4E4F534A, off + 4); jBuf.copy(out, off + 8); off += 8 + jBuf.length;
out.writeUInt32LE(bBuf.length, off); out.writeUInt32LE(0x004E4942, off + 4); bBuf.copy(out, off + 8);
writeFileSync(o.out, out);
console.log(`Boxes in ${o.in}:`);
for (const b of boxes) console.log(` - ${b.name}: size ${b.max.map((v, i) => (v - b.min[i]).toFixed(3)).join(' x ')}m`);
console.log(`Wrote ${o.out} (${(statSync(o.out).size / 1024).toFixed(1)} KB) — ${boxes.length} proxies`);
if (o.snippet) {
  console.log('--- three.js snippet ---');
  console.log(`const proxy = await loader.load('${o.out.split('/').pop()}'); proxy.visible = false; scene.add(proxy);`);
  console.log('// rapier: proxy.updateWorldMatrix(true,true); for each child: size = new Vector3().setFromMatrixScale(child.matrixWorld), pos = child.getWorldPosition() → cuboid(size.x/2,size.y/2,size.z/2) at pos');
}
