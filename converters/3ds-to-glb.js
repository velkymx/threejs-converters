#!/usr/bin/env node
// 3ds-to-glb.js — .3ds (legacy 3ds Max finds) -> .glb. Single file. BEST-EFFORT.
// Why best-effort: 3DS is chunked legacy; this uses three.js headless TDSLoader. Geometry converts.
//   No rigs/anims survive in practice; textures do NOT (no canvas in Node) → stripped, reattach via texture-convert.js.
// Blender path (rock solid for textured scenes): File → Import .3ds → Export glTF 2.0 (.glb),
//   +Y Up, Apply Modifiers, UVs + Normals checked → then glb-optimize.js.
// Usage:
//   node converters/3ds-to-glb.js <in.3ds> [--out out.glb] [--units cm] [--scale 1] [--target-max 2]
//     [--z-up] [--keep-textures] [--no-center] [--no-ground]
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
  console.log(`3ds-to-glb.js — legacy 3DS to three.js GLB (best-effort geometry; textures stripped headless)
Usage:
  node converters/3ds-to-glb.js <in.3ds> [--out out.glb] [--units cm] [--target-max 2] [--z-up]
Example:
  node converters/download.js https://…/model.3ds --out-dir ./assets
  node converters/3ds-to-glb.js ./assets/model.3ds --out ./assets/model.glb --target-max 2
  node converters/gltf-report.js ./assets/model.glb
Units: Max-era 3DS files are usually inches or cm — check gltf-report output, then set --units.`);
  process.exit(args.length ? 0 : 1);
}
function parse(argv) {
  const o = { in: null, out: null, scale: 1, units: null, targetMax: 0, targetHeight: 0,
    zUp: false, keepTex: false, center: true, ground: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--scale') o.scale = Number(argv[++i]);
    else if (a === '--units') o.units = argv[++i];
    else if (a === '--target-max') o.targetMax = Number(argv[++i]);
    else if (a === '--target-height') o.targetHeight = Number(argv[++i]);
    else if (a === '--z-up') o.zUp = true;
    else if (a === '--keep-textures') o.keepTex = true;
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
  if (!o.out) o.out = o.in.replace(/\.3ds$/i, '.glb');
  return o;
}
const o = parse(args);

const THREE = await import('three');
const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

let group;
try {
  const data = readFileSync(o.in);
  if (data.length < 6 || data.readUInt16LE(0) !== 0x4d4d) { console.error('Not a 3DS file (bad magic).'); process.exit(1); }
  if (data.readUInt32LE(2) > data.length) { console.error('3DS truncated (declared size exceeds file).'); process.exit(1); }
  group = new TDSLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), resolve(o.in));
} catch (e) { console.error(`3DS parse failed: ${e.message}\nFallback: Blender → Import .3ds → Export glTF (.glb) → glb-optimize.js`); process.exit(1); }
let content = group;
if (!content || content.children.length === 0) { console.error('Empty scene (no geometry).\nFallback: Blender → Import .3ds → Export glTF (.glb).'); process.exit(1); }

// --- strip texture maps (no canvas headless); keep colors/factors ---
let stripped = 0;
if (!o.keepTex) {
  content.traverse((n) => {
    const mats = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
    for (const m of mats) for (const k of Object.keys(m)) {
      if (m[k]?.isTexture) { m[k] = null; stripped++; }
    }
  });
  if (stripped) console.log(`Stripped ${stripped} texture map(s) (no canvas in Node). Reattach via texture-convert.js outputs.`);
} else console.log('Keep-textures: will likely fail headless (canvas). If so, rerun without flag or use Blender path.');

// --- normalize: optional Z-up fix (Max is Z-up!), then scale wrapper (same convention as fbx-to-glb) ---
if (o.zUp) {
  const rz = new THREE.Group(); rz.name = 'ZUP_FIX'; rz.rotation.x = -Math.PI / 2; rz.add(content); content = rz;
  console.log('Z-up → Y-up (-90° X).');
}
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

const nMesh = [];
scene.traverse((n) => { if (n.isMesh) nMesh.push(n); });
console.log(`Scene: ${nMesh.length} mesh(es). (3DS rigs/anims do not survive — geometry only.)`);

const out = await new Promise((res, rej) => {
  new GLTFExporter().parse(scene, res, (e) => rej(e instanceof Error ? e : new Error(String(e))), { binary: true, animations: [] });
}).catch((e) => { console.error(`Export failed: ${e.message}\nFallback: Blender → Import .3ds → Export glTF (.glb).`); process.exit(1); });
const outBuf = Buffer.isBuffer(out) ? out : Buffer.from(out);
writeFileSync(o.out, outBuf);
console.log(`Wrote ${resolve(o.out)} (${(statSync(o.out).size/1024).toFixed(1)} KB)`);
