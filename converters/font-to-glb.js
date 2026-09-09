#!/usr/bin/env node
// font-to-glb.js — text string -> extruded 3D .glb. Single file.
// Why: 3D titles, labels, and signs without shipping a DCC or font pipeline; the bundled
//   helvetiker typeface (real three.js asset, assets/fonts/) means zero downloads.
// How: FontLoader.parse on the typeface JSON -> TextGeometry per line, stacked downward ->
//   one mesh, SCALE_ROOT wrapper (shared meter convention) -> GLTFExporter binary.
// Usage: node converters/font-to-glb.js --text "Hi" [--out hi.glb] [--font other.typeface.json]
//     [--size 100] [--depth 20] [--target-max 1] [--no-center] [--no-ground]
// Deps: three (npm i three)
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLED_FONT = resolve(HERE, '../assets/fonts/helvetiker_regular.typeface.json');

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`font-to-glb.js — text to extruded three.js GLB (bundled helvetiker)
Usage:
  node converters/font-to-glb.js --text "Hi" [--out hi.glb] [--font other.typeface.json]
    [--size 100] [--depth 20] [--target-max 1] [--no-center] [--no-ground]
  --size/--depth are font units; --target-max fits the result to meters as usual.
  Newlines stack lines downward at 1.35x size.
Example:
  node converters/font-to-glb.js --text "OPEN" --out ./assets/open.glb --target-max 2
Next: node converters/glb-optimize.js ./assets/open.glb`);
  process.exit(args.length ? 0 : 1);
}

const o = { text: null, out: null, font: BUNDLED_FONT, size: 100, depth: 20,
  scale: 1, units: null, targetMax: 0, targetHeight: 0, center: true, ground: true };
const UNITS = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--text') o.text = args[++i];
  else if (a === '--out') o.out = args[++i];
  else if (a === '--font') o.font = args[++i];
  else if (a === '--size') o.size = Number(args[++i]);
  else if (a === '--depth') o.depth = Number(args[++i]);
  else if (a === '--scale') o.scale = Number(args[++i]);
    else if (a === '--units') o.units = args[++i];
  else if (a === '--target-max') o.targetMax = Number(args[++i]);
  else if (a === '--target-height') o.targetHeight = Number(args[++i]);
  else if (a === '--no-center') o.center = false;
  else if (a === '--no-ground') o.ground = false;
  else if (!a.startsWith('--') && !o.text) o.text = a;
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (!o.text) { console.error('Missing --text (empty string refuses: nothing to extrude).'); process.exit(1); }
if (!existsSync(o.font)) { console.error(`No such font: ${o.font}`); process.exit(1); }
if (o.units && !UNITS[o.units]) { console.error(`Bad --units (want ${Object.keys(UNITS).join('|')}).`); process.exit(1); }
if (!(o.scale > 0) || ![o.targetMax, o.targetHeight].every((v) => Number.isFinite(v) && v >= 0)) {
  console.error('Bad --scale/--target-max/--target-height.'); process.exit(1);
}
if (!Number.isFinite(o.size) || o.size <= 0) { console.error('Bad --size (want positive).'); process.exit(1); }
if (!Number.isFinite(o.depth) || o.depth <= 0) { console.error('Bad --depth (want positive).'); process.exit(1); }
if (!o.out) o.out = 'text.glb';

const THREE = await import('three');
const { FontLoader } = await import('three/examples/jsm/loaders/FontLoader.js');
const { TextGeometry } = await import('three/examples/jsm/geometries/TextGeometry.js');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
// FileReader shim: GLTFExporter needs it (buffer path), never DOM for geometry
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

let fontJson;
try { fontJson = JSON.parse(readFileSync(o.font, 'utf8')); }
catch { console.error(`Font is not valid JSON: ${o.font}`); process.exit(1); }
let font;
try { font = new FontLoader().parse(fontJson); }
catch (e) { console.error(`Font parse failed: ${e.message}`); process.exit(1); }

const lines = o.text.split('\n').map((l) => l.replace(/\s+$/, ''));
if (!lines.some((l) => l.length)) { console.error('Missing --text (blank lines only: nothing to extrude).'); process.exit(1); }
// why warn here, not fail: tofu boxes render fine and the user sees exactly which codepoint
// is missing instead of guessing from an empty mesh
const missing = [...new Set(o.text.replace(/\s/g, '').split(''))].filter((ch) => !font.data.glyphs[ch]);
if (missing.length) console.log(`Warn: ${missing.length} glyph(s) missing from font, render as tofu: ${missing.join(' ')}`);

const content = new THREE.Group();
const lineH = o.size * 1.35; // why 1.35: cap height + descender gap approximates real leading
lines.forEach((line, li) => {
  if (!line) return;
  const geo = new TextGeometry(line, {
    font, size: o.size, depth: o.depth, curveSegments: 8, bevelEnabled: false,
  });
  geo.translate(0, -li * lineH, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 0.9 }));
  mesh.name = `line${li}`;
  content.add(mesh);
});

// --- normalize: scale wrapper (same convention as fbx-to-glb) ---
content.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(content);
if (box.isEmpty()) { console.error('Empty text (no geometry).'); process.exit(1); }
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
console.log(`Text: ${lines.filter(Boolean).length} line(s), "${o.text.slice(0, 24)}${o.text.length > 24 ? '…' : ''}".`);
console.log(`BBox raw: ${size.toArray().map((v) => v.toFixed(3))} → factor x${Number(s.toPrecision(6))}`);

const out = await new Promise((res, rej) => {
  new GLTFExporter().parse(scene, res, (e) => rej(e instanceof Error ? e : new Error(String(e))), { binary: true, animations: [] });
}).catch((e) => { console.error(`Export failed: ${e.message}`); process.exit(1); });
const outBuf = Buffer.isBuffer(out) ? out : Buffer.from(out);
writeFileSync(o.out, outBuf);
console.log(`Wrote ${resolve(o.out)} (${(statSync(o.out).size/1024).toFixed(1)} KB)`);
