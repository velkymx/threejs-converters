#!/usr/bin/env node
// gltf-pack.js — .gltf (+ .bin + loose images) -> single self-contained .glb. Zero deps. Pure Node.
// Why: exporters and pipelines emit split .gltf with sidecar .bin/images; games and loaders want one file.
// How: resolve every external buffer/images URI (relative to the .gltf) + embedded data: URIs into one BIN
//   chunk, rewrite bufferViews to buffer 0 with fresh offsets, keep everything else byte-identical.
// Usage: node converters/gltf-pack.js <in.gltf> [--out out.glb]
// Refusals: missing sidecar files, absolute http(s) URIs (fetch via download.js first), >2GB total.
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`gltf-pack.js — split .gltf + sidecars to one .glb
Usage:
  node converters/gltf-pack.js <in.gltf> [--out out.glb]
Example:
  node converters/gltf-pack.js ./assets/model.gltf --out ./assets/model.glb
Next: node converters/gltf-report.js ./assets/model.glb`);
  process.exit(args.length ? 0 : 1);
}

const o = { in: null, out: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') o.out = args[++i];
  else if (!a.startsWith('--') && !o.in) o.in = a;
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (!o.in) { console.error('Missing input.'); process.exit(1); }
if (!o.in.toLowerCase().endsWith('.gltf')) { console.error('Input must be .gltf (for .glb inputs there is nothing to pack).'); process.exit(1); }
if (!o.out) o.out = o.in.replace(/\.gltf$/i, '.glb');

const base = dirname(resolve(o.in));
const json = JSON.parse(readFileSync(o.in, 'utf8'));
const dataUri = (u) => {
  const m = /^data:.*?;base64,(.*)$/s.exec(u || '');
  return m ? Buffer.from(m[1], 'base64') : null;
};
const loadUri = (u, what) => {
  const emb = dataUri(u);
  if (emb) return emb;
  if (/^https?:\/\//i.test(u || '')) { console.error(`SKIP ${what}: remote URI '${u}' — fetch via download.js next to the .gltf first.`); process.exit(1); }
  const p = resolve(base, u || '');
  if (!existsSync(p)) { console.error(`SKIP ${what}: missing sidecar '${u}' (expected at ${p}).`); process.exit(1); }
  return readFileSync(p);
};

// --- gather buffer bytes: one chunk per buffer, then one chunk per newly-embedded image ---
const bufBytes = (json.buffers || []).map((b, i) => {
  if (b.uri === undefined) { console.error(`Buffer ${i} has no uri in a .gltf file — corrupt.`); process.exit(1); }
  return loadUri(b.uri, `buffer ${i}`);
});
const imgBytes = [];
const imgView = [];
(json.images || []).forEach((img, i) => {
  if (img.bufferView !== undefined || img.uri === undefined) return; // already packed or GLB-style
  imgBytes.push(loadUri(img.uri, `image ${i}`));
  imgView.push(i);
});

// --- lay out new BIN: existing bufferViews in order, then one view per embedded image ---
const parts = [];
const viewOff = new Array((json.bufferViews || []).length).fill(0);
(json.bufferViews || []).forEach((v, i) => {
  const src = bufBytes[v.buffer ?? 0];
  const start = v.byteOffset || 0;
  const end = start + v.byteLength;
  if (end > src.length) { console.error(`bufferView ${i} overruns buffer ${v.buffer ?? 0}.`); process.exit(1); }
  viewOff[i] = parts.reduce((s, p) => s + p.length, 0);
  parts.push(src.subarray(start, end));
});
imgView.forEach((imgIdx, k) => {
  const v = { buffer: 0, byteOffset: parts.reduce((s, p) => s + p.length, 0), byteLength: imgBytes[k].length };
  if (json.images[imgIdx].mimeType === undefined) {
    const n = (json.images[imgIdx].uri || '').toLowerCase();
    json.images[imgIdx].mimeType = n.endsWith('.png') ? 'image/png' : n.endsWith('.jpg') || n.endsWith('.jpeg') ? 'image/jpeg' : n.endsWith('.webp') ? 'image/webp' : undefined;
  }
  json.images[imgIdx].bufferView = json.bufferViews.length;
  delete json.images[imgIdx].uri;
  json.bufferViews.push(v);
  parts.push(imgBytes[k]);
});
(json.bufferViews || []).forEach((v, i) => {
  if (i < viewOff.length) { v.buffer = 0; v.byteOffset = viewOff[i]; }
});
json.buffers = [{ byteLength: parts.reduce((s, p) => s + p.length, 0) }];

const pad = (n) => (4 - (n % 4)) % 4;
let jsonBuf = Buffer.from(JSON.stringify(json));
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad(jsonBuf.length), 0x20)]);
let binBuf = Buffer.concat(parts);
binBuf = Buffer.concat([binBuf, Buffer.alloc(pad(binBuf.length), 0)]);
const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
if (total > 0xffffffff) { console.error('Packed file exceeds 4GB GLB limit.'); process.exit(1); }
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
let off = 12;
out.writeUInt32LE(jsonBuf.length, off); out.writeUInt32LE(0x4E4F534A, off + 4); jsonBuf.copy(out, off + 8); off += 8 + jsonBuf.length;
out.writeUInt32LE(binBuf.length, off); out.writeUInt32LE(0x004E4942, off + 4); binBuf.copy(out, off + 8);
writeFileSync(o.out, out);
const before = (json.buffers[0]?.byteLength ?? 0) + statSync(o.in).size;
console.log(`Packed ${o.in} (+${bufBytes.length} buffer(s), ${imgBytes.length} image(s)) → ${resolve(o.out)} (${(statSync(o.out).size / 1024).toFixed(1)} KB)`);
