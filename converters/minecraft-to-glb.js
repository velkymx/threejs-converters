#!/usr/bin/env node
// minecraft-to-glb.js — Minecraft block/item JSON model -> .glb. Zero deps. Pure Node.
// Why: the biggest modding scene on earth ships models as JSON cubes; Blockbench users and pack
//   makers need them ingame without hand-rebuilding.
// How: parse JSON (+ parent chain via --parent-dir) -> per element, per face quads with verified
//   outward windings and flat normals -> per-face UV table with clockwise texture rotation ->
//   element rotation about its origin -> faces grouped by texture into one primitive per material.
//   0..16 block units become meters (/16), then the shared scale convention applies.
// Usage: node converters/minecraft-to-glb.js <model.json> [--out out.glb] [--parent-dir dir]
//     [--units m] [--scale 1] [--target-max 2] [--no-center] [--no-ground]
// Refusals: invalid JSON, unresolvable parent (flatten in Blockbench or pass --parent-dir),
//   parent cycles, missing elements, bad face/rotation data.
// Note: textures stay references (material names = texture path stems) — convert the PNGs with
//   texture-convert.js and reattach. cullface/shade/ao are runtime concerns, kept as-is.
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const UNITS = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 };
// corner order per face is CCW seen from outside (verified by cross product at author time),
// so triangles (0,1,2)+(0,2,3) face outward with the listed flat normal.
// uv: per-face fractions into the [u1,v1,u2,v2] window. u runs screen-right, v runs
// screen-down in vanilla texture space (v1 = texture top); 'f' picks the corner fraction
// along an axis, '~f' picks 1 minus it. Derived per face from viewer-outside geometry so the
// texture lands upright, not mirrored or flipped.
const FACES = {
  down:  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], u: ['x', 1], v: ['z', 0] },
  up:    { n: [0, 1, 0],  c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], u: ['x', 0], v: ['z', 0] },
  north: { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], u: ['x', 1], v: ['y', 1] },
  south: { n: [0, 0, 1],  c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], u: ['x', 0], v: ['y', 1] },
  west:  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], u: ['z', 0], v: ['y', 1] },
  east:  { n: [1, 0, 0],  c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], u: ['z', 1], v: ['y', 1] },
};
// uv slots above are [u1v2, u2v2, u2v1, u1v1]-style per-corner picks for the full 0..16 face;
// rotation spins corner assignment clockwise as vanilla does
const ORDER = ['down', 'up', 'north', 'south', 'west', 'east'];

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`minecraft-to-glb.js — Minecraft block/item JSON to three.js GLB
Usage:
  node converters/minecraft-to-glb.js <model.json> [--out out.glb] [--parent-dir dir]
    [--units m] [--scale 1] [--target-max 2] [--no-center] [--no-ground]
Example:
  node converters/minecraft-to-glb.js ./pack/models/block/crate.json --out ./assets/crate.glb --parent-dir ./pack/models/block --target-max 1
Next: node converters/texture-convert.js ./pack/textures/block/stone.png --out-dir ./tex`);
  process.exit(args.length ? 0 : 1);
}

function parse(argv) {
  const o = { in: null, out: null, parentDir: null, scale: 1, units: null, targetMax: 0, center: true, ground: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--parent-dir') o.parentDir = argv[++i];
    else if (a === '--scale') o.scale = Number(argv[++i]);
    else if (a === '--units') o.units = argv[++i];
    else if (a === '--target-max') o.targetMax = Number(argv[++i]);
    else if (a === '--no-center') o.center = false;
    else if (a === '--no-ground') o.ground = false;
    else if (!a.startsWith('--') && !o.in) o.in = a;
    else { console.error(`Unknown: ${a}`); process.exit(1); }
  }
  if (!o.in) { console.error('Missing input.'); process.exit(1); }
  if (!existsSync(o.in)) { console.error(`No such file: ${o.in}`); process.exit(1); }
  if (o.units && !UNITS[o.units]) { console.error(`Bad --units (want ${Object.keys(UNITS).join('|')})`); process.exit(1); }
  if (!(o.scale > 0) || o.targetMax < 0 || !Number.isFinite(o.targetMax)) { console.error('Bad --scale/--target-max.'); process.exit(1); }
  if (!o.out) o.out = o.in.replace(/\.json$/i, '.glb');
  return o;
}

const o = parse(args);
const loadJson = (p) => {
  let j;
  try { j = JSON.parse(readFileSync(p, 'utf8')); }
  catch { console.error(`Not valid JSON: ${p}`); process.exit(1); }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) { console.error(`Not a model object: ${p}`); process.exit(1); }
  return j;
};

// --- parent chain: child textures/elements override, vanilla stops at first elements found ---
const chain = [];
{
  let cur = resolve(o.in);
  const seen = new Set();
  for (let d = 0; d < 8; d++) {
    if (seen.has(cur)) { console.error(`Parent cycle at ${cur}.`); process.exit(1); }
    seen.add(cur);
    const j = loadJson(cur);
    chain.unshift(j);
    if (!j.parent) break;
    const base = o.parentDir ? resolve(o.parentDir) : dirname(cur);
    cur = join(base, `${j.parent}.json`);
    if (!existsSync(cur)) {
      console.error(`Unresolvable parent '${j.parent}' (want ${cur}). Flatten in Blockbench or pass --parent-dir.`);
      process.exit(1);
    }
    if (d === 7) { console.error('Parent chain too deep (>8).'); process.exit(1); }
  }
}
const textures = Object.assign({}, ...chain.map((j) => j.textures || {}));
const holder = [...chain].reverse().find((j) => Array.isArray(j.elements));
if (!holder) { console.error('No elements in model or parents (nothing to convert).'); process.exit(1); }
if (chain.length > 1) console.log(`Parents: resolved ${chain.length - 1} level(s).`);
const elements = holder.elements;

const num = (v, what) => { if (!Number.isFinite(v)) { console.error(`Bad number for ${what}.`); process.exit(1); } return v; };
// faces grouped by material so each texture becomes one primitive (fewer draws)
const buckets = new Map();
const matOf = (ref) => {
  if (typeof ref !== 'string' || !ref.startsWith('#')) return 'mc-missing';
  const t = textures[ref.slice(1)];
  if (!t) { console.log(`Warn: texture var '${ref}' undefined — faces fall back to 'mc-missing'.`); return 'mc-missing'; }
  return basename(String(t)).replace(/\.[a-z0-9]+$/i, '') || 'mc-missing';
};
const bucket = (m) => {
  if (!buckets.has(m)) buckets.set(m, { pos: [], nor: [], uv: [], idx: [], n: 0 });
  return buckets.get(m);
};

for (const [ei, el] of elements.entries()) {
  if (!el || typeof el !== 'object') { console.error(`Element ${ei} is not an object.`); process.exit(1); }
  const from = el.from, to = el.to;
  if (!Array.isArray(from) || !Array.isArray(to) || from.length !== 3 || to.length !== 3) {
    console.error(`Element ${ei} needs from/to [x,y,z] triples.`);
    process.exit(1);
  }
  from.forEach((v, i) => num(v, `element ${ei} from[${i}]`));
  to.forEach((v, i) => num(v, `element ${ei} to[${i}]`));
  // element rotation about origin on one axis (vanilla rescale skipped: sub-pixel volume fit,
  // irrelevant at game scale — noted, not guessed)
  let rot = null;
  if (el.rotation) {
    const { origin, axis, angle } = el.rotation;
    if (!Array.isArray(origin) || origin.length !== 3 || !['x', 'y', 'z'].includes(axis) || !Number.isFinite(angle)) {
      console.error(`Element ${ei} has bad rotation (want origin triple, axis x|y|z, angle degrees).`);
      process.exit(1);
    }
    const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    rot = { origin, axis, c, s };
  }
  const spin = (p, n) => {
    if (!rot) return [p, n];
    const rel = [p[0] - rot.origin[0], p[1] - rot.origin[1], p[2] - rot.origin[2]];
    const R = (v) => {
      const [x, y, z] = v;
      if (rot.axis === 'x') return [x, y * rot.c - z * rot.s, y * rot.s + z * rot.c];
      if (rot.axis === 'y') return [x * rot.c + z * rot.s, y, -x * rot.s + z * rot.c];
      return [x * rot.c - y * rot.s, x * rot.s + y * rot.c, z];
    };
    const rp = R(rel), rn = R(n);
    return [[rp[0] + rot.origin[0], rp[1] + rot.origin[1], rp[2] + rot.origin[2]], rn];
  };
  if (!el.faces || typeof el.faces !== 'object') { console.error(`Element ${ei} has no faces.`); process.exit(1); }
  for (const dir of ORDER) {
    const f = el.faces[dir];
    if (!f) continue;
    const uvs = Array.isArray(f.uv) && f.uv.length === 4 ? f.uv : [0, 0, 16, 16];
    uvs.forEach((v, i) => num(v, `element ${ei} ${dir} uv[${i}]`));
    const trot = f.rotation ?? 0;
    if (![0, 90, 180, 270].includes(trot)) { console.error(`Element ${ei} ${dir}: bad uv rotation (want 0|90|180|270).`); process.exit(1); }
    // corner uv picks for this face, spun clockwise by texture rotation
    const [u1, v1, u2, v2] = uvs;
    const k = trot / 90;
    const b = bucket(matOf(f.texture));
    const frac = { x: (p) => p.x, y: (p) => p.y, z: (p) => p.z };
    const pick = ([axis, flip], p) => { const f = frac[axis](p); return flip ? 1 - f : f; };
    const F = FACES[dir];
    const corners = F.c.map(([fx, fy, fz]) => [
      from[0] + (to[0] - from[0]) * fx,
      from[1] + (to[1] - from[1]) * fy,
      from[2] + (to[2] - from[2]) * fz,
    ]);
    const cornerFrac = F.c.map(([fx, fy, fz]) => ({ x: fx, y: fy, z: fz }));
    const start = b.n;
    corners.forEach((cp, ci) => {
      const [rp] = spin(cp, F.n);
      // why /16 here: block units are 1/16 m by definition — meters before shared flags apply
      b.pos.push(rp[0] / 16, rp[1] / 16, rp[2] / 16);
      const [, rn] = spin([0, 0, 0], F.n);
      const rl = Math.hypot(...rn) || 1;
      b.nor.push(rn[0] / rl, rn[1] / rl, rn[2] / rl);
      // why v-flip: MC v runs down the texture, three.js v runs up
      const src = cornerFrac[(ci - k + 4) % 4];
      const uu = u1 + (u2 - u1) * pick(F.u, src);
      const vv = v1 + (v2 - v1) * pick(F.v, src);
      b.uv.push(uu / 16, 1 - vv / 16);
    });
    b.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
    b.n += 4;
  }
}
if (![...buckets.values()].some((b) => b.idx.length)) { console.error('Model yielded no faces.'); process.exit(1); }

// --- SCALE (shared convention) ---
let sc = (o.units ? UNITS[o.units] : 1) * o.scale;
{
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const b of buckets.values()) for (let i = 0; i < b.pos.length; i += 3)
    for (let d = 0; d < 3; d++) { if (b.pos[i + d] < mn[d]) mn[d] = b.pos[i + d]; if (b.pos[i + d] > mx[d]) mx[d] = b.pos[i + d]; }
  const size = mx.map((v, i) => v - mn[i]);
  if (o.targetMax > 0) {
    const m = Math.max(...size);
    if (m > 0) sc *= o.targetMax / (m * sc);
    else console.log('Scale: degenerate bbox, skip auto-fit.');
  }
  const tx = o.center ? -(mn[0] + mx[0]) / 2 * sc : 0;
  const ty = o.ground ? -mn[1] * sc : (o.center ? -(mn[1] + mx[1]) / 2 * sc : 0);
  const tz = o.center ? -(mn[2] + mx[2]) / 2 * sc : 0;
  for (const b of buckets.values()) for (let i = 0; i < b.pos.length; i += 3) {
    b.pos[i] = b.pos[i] * sc + tx; b.pos[i + 1] = b.pos[i + 1] * sc + ty; b.pos[i + 2] = b.pos[i + 2] * sc + tz;
  }
  console.log(`Scale: x${sc} offset [${[tx, ty, tz].map((v) => v.toFixed(3))}] (size ${size.map((v) => (v * sc).toFixed(3)).join(' x ')}m)`);
}

// --- pack GLB: one primitive per texture bucket ---
const parts = [], bufferViews = [], accessors = [];
let byteOffset = 0, ai = 0;
const pushVB = (data, count, type, comp, target) => {
  bufferViews.push({ buffer: 0, byteOffset, byteLength: data.length, target });
  accessors.push({ bufferView: bufferViews.length - 1, byteOffset: 0, componentType: comp, count, type });
  parts.push(data);
  byteOffset += data.length; return ai++;
};
const bounds = (arr, stride) => {
  const min = Array(stride).fill(Infinity), max = Array(stride).fill(-Infinity);
  for (let i = 0; i < arr.length; i++) { const k = i % stride; if (arr[i] < min[k]) min[k] = arr[i]; if (arr[i] > max[k]) max[k] = arr[i]; }
  return { min, max };
};
const materials = [], gprims = [];
for (const [name, b] of buckets) {
  const posArr = new Float32Array(b.pos), norArr = new Float32Array(b.nor), uvArr = new Float32Array(b.uv);
  const idxArr = b.pos.length / 3 > 65535 ? new Uint32Array(b.idx) : new Uint16Array(b.idx);
  const pi = pushVB(Buffer.from(posArr.buffer), posArr.length / 3, 'VEC3', 5126, 34962);
  Object.assign(accessors[pi], bounds(posArr, 3));
  const ni = pushVB(Buffer.from(norArr.buffer), norArr.length / 3, 'VEC3', 5126, 34962);
  const ti = pushVB(Buffer.from(uvArr.buffer), uvArr.length / 2, 'VEC2', 5126, 34962);
  const ii = pushVB(Buffer.from(idxArr.buffer), idxArr.length, 'SCALAR', idxArr instanceof Uint32Array ? 5125 : 5123, 34963);
  materials.push({ name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 } });
  gprims.push({ attributes: { POSITION: pi, NORMAL: ni, TEXCOORD_0: ti }, indices: ii, material: materials.length - 1 });
  console.log(` material '${name}': ${(b.idx.length / 3).toFixed(0)} tris`);
}
const json = {
  asset: { version: '2.0', generator: 'threejs-converters minecraft-to-glb' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: basename(o.in) }],
  meshes: [{ name: basename(o.in), primitives: gprims }],
  materials,
  buffers: [{ byteLength: byteOffset }], bufferViews, accessors,
};
const pad = (n) => (4 - (n % 4)) % 4;
let jsonBuf = Buffer.from(JSON.stringify(json));
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad(jsonBuf.length), 0x20)]);
let binBuf = Buffer.concat(parts);
binBuf = Buffer.concat([binBuf, Buffer.alloc(pad(binBuf.length), 0)]);
const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
let off = 12;
out.writeUInt32LE(jsonBuf.length, off); out.writeUInt32LE(0x4E4F534A, off + 4); jsonBuf.copy(out, off + 8); off += 8 + jsonBuf.length;
out.writeUInt32LE(binBuf.length, off); out.writeUInt32LE(0x004E4942, off + 4); binBuf.copy(out, off + 8);
writeFileSync(o.out, out);
const tris = [...buckets.values()].reduce((s, b) => s + b.idx.length / 3, 0);
console.log(`Wrote ${resolve(o.out)} (${(statSync(o.out).size / 1024).toFixed(1)} KB) — ${tris} tris, ${materials.length} material(s)`);
