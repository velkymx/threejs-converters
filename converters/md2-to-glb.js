#!/usr/bin/env node
// md2-to-glb.js — .md2 (Quake 2 mods, retro FPS art) -> .glb. Single file.
// Why: MD2 stores vertex-animation frames, not a skeleton; games usually want one baked pose.
// How: MD2Loader.parse (base mesh = frame 0 plus morph targets per frame) -> bake --frame N by
//   copying its morph position/normal over the base attributes and dropping the rest -> SCALE_ROOT
//   wrapper (shared meter convention) -> GLTFExporter binary. Own IDP2 magic/version/truncation
//   pre-checks refuse bad files with the cause (the loader only logs and returns nothing).
// Usage: node converters/md2-to-glb.js <in.md2> [--out out.glb] [--frame 0]
//     [--units m] [--scale 1] [--target-max 2] [--color #rrggbb] [--metal 0] [--rough 0.9]
//     [--no-center] [--no-ground]
// Deps: three (npm i three)
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// --- headless shims: GLTFExporter needs FileReader (buffer + image paths), never DOM for geometry ---
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    constructor() { this.result = null; this.onloadend = null; this.onerror = null; }
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(
        (b) => { this.result = b; this.onloadend?.(); },
        (e) => this.onerror?.(e),
      );
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then(
        (b) => { this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`; this.onloadend?.(); },
        (e) => this.onerror?.(e),
      );
    }
  };
}

const UNITS = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 };
const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`md2-to-glb.js — Quake 2 MD2 to three.js GLB (frame N baked static)
Usage:
  node converters/md2-to-glb.js <in.md2> [--out out.glb] [--frame 0]
    [--units m] [--scale 1] [--target-max 2] [--color #rrggbb] [--metal 0] [--rough 0.9]
    [--no-center] [--no-ground]
Example:
  node converters/md2-to-glb.js ./assets/ogro.md2 --out ./assets/ogro.glb --target-max 2 --frame 0
Next: node converters/glb-optimize.js ./assets/ogro.glb`);
  process.exit(args.length ? 0 : 1);
}
function parse(argv) {
  const o = { in: null, out: null, frame: 0, color: [0.75, 0.75, 0.78, 1], metal: 0, rough: 0.9,
    scale: 1, units: null, targetMax: 0, targetHeight: 0, center: true, ground: true };
  const hex = (s) => {
    s = s.replace('#', ''); if (s.length === 3) s = [...s].map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(s)) { console.error(`Bad --color '${s}' (want #rrggbb).`); process.exit(1); }
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255).concat(1);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--frame') o.frame = Number(argv[++i]);
    else if (a === '--color') o.color = hex(argv[++i]);
    else if (a === '--metal') o.metal = Number(argv[++i]);
    else if (a === '--rough') o.rough = Number(argv[++i]);
    else if (a === '--scale') o.scale = Number(argv[++i]);
    else if (a === '--units') o.units = argv[++i];
    else if (a === '--target-max') o.targetMax = Number(argv[++i]);
    else if (a === '--target-height') o.targetHeight = Number(argv[++i]);
    else if (a === '--no-center') o.center = false;
    else if (a === '--no-ground') o.ground = false;
    else if (!a.startsWith('--') && !o.in) o.in = a;
    else { console.error(`Unknown: ${a}`); process.exit(1); }
  }
  if (!o.in) { console.error('Missing input.'); process.exit(1); }
  if (!existsSync(o.in)) { console.error(`No such file: ${o.in}`); process.exit(1); }
  if (o.units && !UNITS[o.units]) { console.error(`Bad --units.`); process.exit(1); }
  if (!(o.scale > 0) || ![o.targetMax, o.targetHeight].every((v) => Number.isFinite(v) && v >= 0)) {
    console.error('Bad --scale/--target-max/--target-height.'); process.exit(1);
  }
  if (!Number.isInteger(o.frame) || o.frame < 0) { console.error('Bad --frame (want frame index >= 0).'); process.exit(1); }
  if (![o.metal, o.rough].every(Number.isFinite)) { console.error('Bad --metal/--rough (want numbers).'); process.exit(1); }
  if (!o.out) o.out = o.in.replace(/\.md2$/i, '.glb');
  return o;
}
const o = parse(args);

const THREE = await import('three');
const { MD2Loader } = await import('three/examples/jsm/loaders/MD2Loader.js');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

const data = readFileSync(o.in);
// why own pre-checks: the loader console.errors and returns undefined on bad input, which would
// surface later as a confusing empty-geometry error — refuse here with the cause instead
if (data.length < 68 || data.readInt32LE(0) !== 844121161) {
  console.error('Not MD2 (bad IDP2 magic). Quake 3 models use md3-to-glb.js instead.');
  process.exit(1);
}
if (data.readInt32LE(4) !== 8) { console.error('Unsupported MD2 version (need 8).'); process.exit(1); }
if (data.readInt32LE(64) !== data.length) { console.error('MD2 truncated (offset_end mismatch).'); process.exit(1); }

let geometry;
try {
  geometry = new MD2Loader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
} catch (e) { console.error(`MD2 parse failed: ${e.message}`); process.exit(1); }
if (!geometry || geometry.attributes.position.count === 0) { console.error('Empty mesh (no geometry).'); process.exit(1); }

const nFrames = geometry.morphAttributes.position?.length ?? 0;
if (o.frame >= Math.max(1, nFrames)) { console.error(`Bad --frame ${o.frame} (file has ${Math.max(1, nFrames)} frame(s)).`); process.exit(1); }
let frameName = 'frame0';
// why bake by copy: the base attributes hold frame 0 expanded per-triangle, and each morph holds
// the same layout for its frame — copying one morph over bakes that pose with zero reindexing
if (o.frame > 0) {
  geometry.attributes.position.array.set(geometry.morphAttributes.position[o.frame].array);
  geometry.attributes.normal.array.set(geometry.morphAttributes.normal[o.frame].array);
  frameName = geometry.animations?.[0]?.name ?? `frame${o.frame}`;
}
geometry.deleteAttribute('uv1');
delete geometry.morphAttributes.position;
delete geometry.morphAttributes.normal;
console.log(`MD2: ${Math.max(1, nFrames)} frame(s) → baked '${frameName}'.`);

const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...o.color.slice(0, 3)), metalness: o.metal, roughness: o.rough });
const mesh = new THREE.Mesh(geometry, mat);
mesh.name = 'md2';
let content = mesh;

// --- normalize: scale wrapper (same convention as fbx-to-glb) ---
content.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(content);
if (box.isEmpty()) { console.error('Empty scene (no geometry).'); process.exit(1); }
const size = new THREE.Vector3(); box.getSize(size);
const ctr = new THREE.Vector3(); box.getCenter(ctr);
let s = (o.units ? UNITS[o.units] : 1) * o.scale;
const dimsM = size.toArray().map((v) => v * s);
if (o.targetMax > 0) s *= o.targetMax / Math.max(...dimsM);
else if (o.targetHeight > 0) s *= o.targetHeight / dimsM[1];
const root = new THREE.Group(); root.name = 'SCALE_ROOT';
root.scale.setScalar(s);
root.position.set(o.center ? -ctr.x * s : 0, o.ground ? -box.min.y * s : (o.center ? -ctr.y * s : 0), o.center ? -ctr.z * s : 0);
root.add(content);
const scene = new THREE.Scene(); scene.add(root);
console.log(`BBox raw: ${size.toArray().map((v) => v.toFixed(3))} → factor x${Number(s.toPrecision(6))}`);

const out = await new Promise((res, rej) => {
  new GLTFExporter().parse(scene, res, (e) => rej(e instanceof Error ? e : new Error(String(e))), { binary: true, animations: [] });
}).catch((e) => { console.error(`Export failed: ${e.message}`); process.exit(1); });
const outBuf = Buffer.isBuffer(out) ? out : Buffer.from(out);
writeFileSync(o.out, outBuf);
console.log(`Wrote ${resolve(o.out)} (${(statSync(o.out).size/1024).toFixed(1)} KB)`);
