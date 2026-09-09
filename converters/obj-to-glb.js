#!/usr/bin/env node
// obj-to-glb.js — .obj (+optional .mtl color) -> .glb. Zero deps. Pure Node.
// Handles: v / vt / vn / f (n-gon fan triangulation), single/avg material, -Y-up kept as-is.
// Scale (reason: three.js 1 unit = 1 meter; OBJs often cm/mm): --units, --scale, --target-max; default center-XZ + ground-Y.
// Usage:
//   node converters/obj-to-glb.js <in.obj> [--out out.glb] [--color "#ff8844"] [--metal 0] [--rough .9] [--flip-y]
//     [--units mm|cm|m|km|in|ft|yd] [--scale 0.01] [--target-max 2] [--no-center] [--no-ground]
// Limitations: ignores lines/groups per-mesh splits (merges to 1 mesh), takes Kd diffuse as baseColor if .mtl beside .obj.
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const UNITS = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 };

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`obj-to-glb.js — OBJ to three.js GLB
Usage:
  node converters/obj-to-glb.js <in.obj> [--out out.glb] [--color #rrggbb] [--metal 0] [--rough 0.9] [--flip-y]
    [--units cm] [--scale 0.01] [--target-max 2] [--no-center] [--no-ground]
Example:
  node converters/obj-to-glb.js ./assets/chair.obj --out ./assets/chair.glb --units cm --target-max 2
Next: node converters/glb-optimize.js ./assets/chair.glb`);
  process.exit(args.length ? 0 : 1);
}

function parse(argv) {
  const o = { in: null, out: null, color: [1, 1, 1, 1], metal: 0, rough: 0.9, flipY: false,
    scale: 1, units: null, targetMax: 0, center: true, ground: true };
  const hex = (s) => {
    s = s.replace('#', ''); if (s.length === 3) s = [...s].map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255).concat(1);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--color') o.color = hex(argv[++i]);
    else if (a === '--metal') o.metal = Number(argv[++i]);
    else if (a === '--rough') o.rough = Number(argv[++i]);
    else if (a === '--flip-y') o.flipY = true;
    else if (a === '--scale') o.scale = Number(argv[++i]);
    else if (a === '--units') o.units = argv[++i];
    else if (a === '--target-max') o.targetMax = Number(argv[++i]);
    else if (a === '--no-center') o.center = false;
    else if (a === '--no-ground') o.ground = false;
    else if (!a.startsWith('--') && !o.in) o.in = a;
    else { console.error(`Unknown: ${a}`); process.exit(1); }
  }
  if (!o.in) { console.error('Missing input.'); process.exit(1); }
  if (o.units && !UNITS[o.units]) { console.error(`Bad --units (want ${Object.keys(UNITS).join('|')})`); process.exit(1); }
  if (!(o.scale > 0) || (o.targetMax < 0 || !Number.isFinite(o.targetMax))) { console.error('Bad --scale/--target-max.'); process.exit(1); }
  if (!o.out) o.out = o.in.replace(/\.obj$/i, '.glb');
  return o;
}

const o = parse(args);
const src = readFileSync(o.in, 'utf8');
const P = [], T = [], N = [];
const vMap = new Map(); // "vi/ti/ni" -> index
const pos = [], uv = [], nor = [], idx = [];

const pushVert = (key, vi, ti, ni) => {
  if (vMap.has(key)) return vMap.get(key);
  const id = pos.length / 3;
  vMap.set(key, id);
  pos.push(P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]);
  if (T.length && ti >= 0) { const t = o.flipY ? 1 - T[ti * 2 + 1] : T[ti * 2 + 1]; uv.push(T[ti * 2], t); }
  if (N.length && ni >= 0) nor.push(N[ni * 3], N[ni * 3 + 1], N[ni * 3 + 2]);
  return id;
};

// Try .mtl diffuse color if beside obj and no explicit --color flag
let baseColor = o.color;
const mtlRef = (src.match(/^mtllib\s+(.+)$/m) || [])[1]?.trim();
if (mtlRef && process.argv.every((a) => a !== '--color')) {
  const mtlPath = resolve(dirname(resolve(o.in)), mtlRef);
  if (existsSync(mtlPath)) {
    const kd = readFileSync(mtlPath, 'utf8').match(/^Kd\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/m);
    if (kd) { baseColor = [Number(kd[1]), Number(kd[2]), Number(kd[3]), 1]; console.log(`MTL diffuse Kd → baseColor [${baseColor.slice(0, 3)}]`); }
  }
}

for (const line of src.split('\n')) {
  const p = line.trim().split(/\s+/); if (!p[0] || p[0].startsWith('#')) continue;
  if (p[0] === 'v') P.push(...p.slice(1, 4).map(Number));
  else if (p[0] === 'vt') T.push(...p.slice(1, 3).map(Number));
  else if (p[0] === 'vn') N.push(...p.slice(1, 4).map(Number));
  else if (p[0] === 'f') {
    const verts = p.slice(1).map((s) => {
      const [vi, ti, ni] = s.split('/').map((x) => (x === '' || x === undefined ? -1 : Number(x) - 1));
      return pushVert(s, vi, ti, ni);
    });
    for (let k = 1; k < verts.length - 1; k++) idx.push(verts[0], verts[k], verts[k + 1]); // fan triangulate
  }
}

// --- SCALE: uniform factor + recenter (single mesh: local == world, exact) ---
{
  let s = (o.units ? UNITS[o.units] : 1) * o.scale;
  if (pos.length >= 3) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3)
      for (let d = 0; d < 3; d++) { if (pos[i + d] < mn[d]) mn[d] = pos[i + d]; if (pos[i + d] > mx[d]) mx[d] = pos[i + d]; }
    const size = mx.map((v, i) => v - mn[i]);
    if (o.targetMax > 0) {
      const m = Math.max(...size);
      if (m > 0) s *= o.targetMax / (m * s);
      else console.log('Scale: degenerate bbox, skip auto-fit.');
    }
    if (!(s > 0 && Number.isFinite(s))) { console.error(`Bad computed factor ${s}.`); process.exit(1); }
    const tx = o.center ? -(mn[0] + mx[0]) / 2 * s : 0;
    const ty = o.ground ? -mn[1] * s : (o.center ? -(mn[1] + mx[1]) / 2 * s : 0);
    const tz = o.center ? -(mn[2] + mx[2]) / 2 * s : 0;
    if (s !== 1 || tx || ty || tz) {
      for (let i = 0; i < pos.length; i += 3) { pos[i] = pos[i] * s + tx; pos[i + 1] = pos[i + 1] * s + ty; pos[i + 2] = pos[i + 2] * s + tz; }
      // normals: uniform scale preserves direction — untouched (rock solid, no renormalize needed for uniform s>0)
      console.log(`Scale: x${s} offset [${[tx, ty, tz].map((v) => v.toFixed(3))}] (size ${size.map((v) => (v * s).toFixed(3)).join(' x ')}m)`);
    } else console.log('Scale: already normalized, untouched.');
  }
}

// Compute smooth normals if missing
let normalArr = nor.length === pos.length ? [...nor] : new Array(pos.length).fill(0);
if (nor.length !== pos.length) {
  const acc = new Float64Array(pos.length);
  for (let f = 0; f < idx.length; f += 3) {
    const [a, b, c] = [idx[f] * 3, idx[f + 1] * 3, idx[f + 2] * 3];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { acc[v] += nx; acc[v + 1] += ny; acc[v + 2] += nz; }
  }
  for (let i = 0; i < acc.length; i += 3) {
    const l = Math.hypot(acc[i], acc[i + 1], acc[i + 2]) || 1;
    normalArr[i] = acc[i] / l; normalArr[i + 1] = acc[i + 1] / l; normalArr[i + 2] = acc[i + 2] / l;
  }
}

const hasUV = uv.length / 2 === pos.length / 3;
const posArr = new Float32Array(pos), norArr = new Float32Array(normalArr);
const uvArr = hasUV ? new Float32Array(uv) : null;
const idxArr = pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
const idxComp = idxArr instanceof Uint32Array ? 5125 : 5123;

// Pack BIN
const parts = [
  { data: Buffer.from(posArr.buffer), target: 34962 },
  { data: Buffer.from(norArr.buffer), target: 34962 },
  ...(uvArr ? [{ data: Buffer.from(uvArr.buffer), target: 34962 }] : []),
  { data: Buffer.from(idxArr.buffer), target: 34963 },
];
let byteOffset = 0;
const bufferViews = [], accessors = [];
const attrs = { POSITION: 0, NORMAL: 1 };
let ai = 0;
const pushVB = (i, count, type, comp) => {
  bufferViews.push({ buffer: 0, byteOffset, byteLength: parts[i].data.length, target: parts[i].target });
  accessors.push({ bufferView: bufferViews.length - 1, byteOffset: 0, componentType: comp, count, type });
  byteOffset += parts[i].data.length; return ai++;
};
const bounds = (arr, stride) => {
  const min = Array(stride).fill(Infinity), max = Array(stride).fill(-Infinity);
  for (let i = 0; i < arr.length; i++) { const k = i % stride; if (arr[i] < min[k]) min[k] = arr[i]; if (arr[i] > max[k]) max[k] = arr[i]; }
  return { min, max };
};
const pb = bounds(posArr, 3);
const posIdx = pushVB(0, posArr.length / 3, 'VEC3', 5126);
Object.assign(accessors[posIdx], pb);
pushVB(1, norArr.length / 3, 'VEC3', 5126);
if (uvArr) { attrs.TEXCOORD_0 = ai; pushVB(2, uvArr.length / 2, 'VEC2', 5126); }
const idxPart = uvArr ? 3 : 2;
const idxAcc = pushVB(idxPart, idxArr.length, 'SCALAR', idxComp);

const json = {
  asset: { version: '2.0', generator: 'threejs-converters obj-to-glb' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: basename(o.in) }],
  meshes: [{ name: basename(o.in), primitives: [{ attributes: attrs, indices: idxAcc, material: 0 }] }],
  materials: [{ name: 'mat', pbrMetallicRoughness: { baseColorFactor: baseColor, metallicFactor: o.metal, roughnessFactor: o.rough } }],
  buffers: [{ byteLength: byteOffset }], bufferViews, accessors,
};
json.buffers[0].byteLength = byteOffset;
const pad = (n) => (4 - (n % 4)) % 4;
let jsonBuf = Buffer.from(JSON.stringify(json));
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad(jsonBuf.length), 0x20)]);
let binBuf = Buffer.concat(parts.map((p) => p.data));
binBuf = Buffer.concat([binBuf, Buffer.alloc(pad(binBuf.length), 0)]);
const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
let off = 12;
out.writeUInt32LE(jsonBuf.length, off); out.writeUInt32LE(0x4E4F534A, off + 4); jsonBuf.copy(out, off + 8); off += 8 + jsonBuf.length;
out.writeUInt32LE(binBuf.length, off); out.writeUInt32LE(0x004E4942, off + 4); binBuf.copy(out, off + 8);
writeFileSync(o.out, out);
console.log(`Wrote ${resolve(o.out)} (${(statSync(o.out).size / 1024).toFixed(1)} KB) — ${(idxArr.length / 3).toFixed(0)} tris, ${(posArr.length / 3).toFixed(0)} verts${hasUV ? ', +UVs' : ' (no UVs)'}`);
