#!/usr/bin/env node
// exr-to-hdr.js — .exr (VFX, Poly Haven, Blender renders) -> float .hdr. Single file.
// Why: EXR is the VFX interchange format but three.js tooling here speaks RGBE; this bridges
//   them so EXR finds join the texture pipeline instead of refusing.
// How: three.js EXRLoader.parse headless (pure JS incl. bundled fflate; NO_COMPRESSION through
//   DWA/B all decode) -> half/float RGBA to float RGB -> RGBE encode with new-RLE scanlines.
// Usage: node converters/exr-to-hdr.js <in.exr> [--out out.hdr] [--data-size 1024]
// Deps: three (npm i three).
import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`exr-to-hdr.js — EXR to float RGBE HDR (feeds texture-convert)
Usage:
  node converters/exr-to-hdr.js <in.exr> [--out out.hdr] [--data-size 1024]
Example:
  node converters/exr-to-hdr.js ./assets/studio.exr --out ./assets/studio.hdr
  node converters/texture-convert.js ./assets/studio.hdr --out-dir ./tex --snippet`);
  process.exit(args.length ? 0 : 1);
}

const o = { in: null, out: null, dataSize: 1024 };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') o.out = args[++i];
  else if (a === '--data-size') o.dataSize = Number(args[++i]);
  else if (!a.startsWith('--') && !o.in) o.in = a;
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (!o.in) { console.error('Missing input.'); process.exit(1); }
if (!existsSync(o.in)) { console.error(`No such file: ${o.in}`); process.exit(1); }
if (!Number.isFinite(o.dataSize) || o.dataSize <= 0) { console.error('Bad --data-size.'); process.exit(1); }
if (statSync(o.in).size > 100 * 1048576) { console.error('File too large (>100MB) — downscale upstream first.'); process.exit(1); }
if (!o.out) o.out = o.in.replace(/\.exr$/i, '.hdr');

const THREE = await import('three');
const { EXRLoader } = await import('three/examples/jsm/loaders/EXRLoader.js');
const { fromHalfFloat } = await import('three/src/extras/DataUtils.js').catch(() => ({}));

const buf = readFileSync(o.in);
if (buf.length < 4 || buf[0] !== 0x76 || buf[1] !== 0x2f || buf[2] !== 0x31 || buf[3] !== 0x01) {
  console.error('Not EXR (bad magic). HDR RGBE files go straight to texture-convert.js.');
  process.exit(1);
}

let tex;
try {
  tex = new EXRLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
} catch (e) { console.error(`EXR parse failed: ${e.message}`); process.exit(1); }
const W = tex.width, H = tex.height;
if (!W || !H || !tex.data) { console.error('EXR yielded no pixels.'); process.exit(1); }
// why branch here: the loader returns Uint16 halves by default but Uint8 RGBA when asked;
// halves need float promotion, bytes just normalize
let rgb;
if (tex.data instanceof Uint16Array) {
  if (typeof fromHalfFloat !== 'function') { console.error('Half-float EXR needs three DataUtils.fromHalfFloat (upgrade three).'); process.exit(1); }
  rgb = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = fromHalfFloat(tex.data[i * 4]);
    rgb[i * 3 + 1] = fromHalfFloat(tex.data[i * 4 + 1]);
    rgb[i * 3 + 2] = fromHalfFloat(tex.data[i * 4 + 2]);
  }
} else {
  rgb = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = tex.data[i * 4] / 255;
    rgb[i * 3 + 1] = tex.data[i * 4 + 1] / 255;
    rgb[i * 3 + 2] = tex.data[i * 4 + 2] / 255;
  }
}
console.log(`EXR: decoded ${W}x${H} float.`);

// --- RGBE encode (duplicated from texture-convert.js: one-file convention, no shared lib) ---
function toRGBE(rgb, i, out) {
  const r = rgb[i*3], g = rgb[i*3+1], bl = rgb[i*3+2], mx = Math.max(r, g, bl);
  if (!(mx > 1e-32)) { out[0] = out[1] = out[2] = out[3] = 0; return; }
  const e = Math.ceil(Math.log2(mx)), m = 2 ** e;
  out[0] = Math.min(255, Math.round((r / m) * 256)); out[1] = Math.min(255, Math.round((g / m) * 256));
  out[2] = Math.min(255, Math.round((bl / m) * 256)); out[3] = e + 128;
}
function encodeHDR(rgb, w, h) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'ascii');
  const parts = [head];
  const px = Buffer.alloc(4);
  for (let y = 0; y < h; y++) {
    if (w < 8) {
      for (let x = 0; x < w; x++) { toRGBE(rgb, y*w+x, px); parts.push(Buffer.from(px)); }
      continue;
    }
    const planes = [Buffer.alloc(w), Buffer.alloc(w), Buffer.alloc(w), Buffer.alloc(w)];
    for (let x = 0; x < w; x++) { toRGBE(rgb, y*w+x, px); for (let c = 0; c < 4; c++) planes[c][x] = px[c]; }
    parts.push(Buffer.from([2, 2, w >> 8, w & 255]));
    for (const pl of planes) { // RLE: runs ≥4, literals ≤128
      let i = 0;
      const enc = [];
      while (i < w) {
        let run = 1;
        while (i + run < w && run < 127 && pl[i+run] === pl[i]) run++;
        if (run >= 4) { enc.push(128 + run, pl[i]); i += run; }
        else { let lit = 1; while (i + lit < w && lit < 128) { let r2 = 1; while (i+lit+r2 < w && r2 < 127 && pl[i+lit+r2] === pl[i+lit]) r2++; if (r2 >= 4) break; lit++; } enc.push(lit); for (let k = 0; k < lit; k++) enc.push(pl[i++]); }
      }
      parts.push(Buffer.from(enc));
    }
  }
  return Buffer.concat(parts);
}

// cap longest side like texture-convert's env path (bilinear on floats)
let rw = W, rh = H, out = rgb;
if (Math.max(W, H) > o.dataSize) {
  const s = o.dataSize / Math.max(W, H);
  rw = Math.max(1, Math.round(W * s)); rh = Math.max(1, Math.round(H * s));
  out = new Float32Array(rw * rh * 3);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const gx = (x + 0.5) / s - 0.5, gy = (y + 0.5) / s - 0.5;
    const x0 = Math.max(0, Math.min(W - 2, Math.floor(gx))), y0 = Math.max(0, Math.min(H - 2, Math.floor(gy)));
    const fx = Math.max(0, Math.min(1, gx - x0)), fy = Math.max(0, Math.min(1, gy - y0));
    for (let c = 0; c < 3; c++) {
      const a = rgb[(y0*W+x0)*3+c], d = rgb[(y0*W+x0+1)*3+c], e2 = rgb[((y0+1)*W+x0)*3+c], f = rgb[((y0+1)*W+x0+1)*3+c];
      out[(y*rw+x)*3+c] = a*(1-fx)*(1-fy) + d*fx*(1-fy) + e2*(1-fx)*fy + f*fx*fy;
    }
  }
  console.log(`Resized ${W}x${H} → ${rw}x${rh} (env cap).`);
}
mkdirSync(dirname(resolve(o.out)) || '.', { recursive: true });
writeFileSync(o.out, encodeHDR(out, rw, rh));
console.log(`Wrote ${resolve(o.out)} (${(statSync(o.out).size / 1024).toFixed(1)} KB) — feeds texture-convert.js`);
