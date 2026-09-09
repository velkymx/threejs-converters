#!/usr/bin/env node
// hdr-to-cubemap.js — equirect panorama (HDR float or LDR) -> 6 cube faces. Single file.
// Why: skyboxes, per-face LOD, and pipelines that need cube faces instead of equirects.
// How: decode to float RGB (built-in RGBE decoder for .hdr, sharp raw for LDR) -> one shared
//   bilinear remap over OpenGL cube faces with three.js equirect sampling (u = atan2(z,x)/2pi +
//   1/2, v = asin(y)/pi + 1/2) -> sharp PNG/JPG per face.
// Usage: node converters/hdr-to-cubemap.js <panorama.hdr|png|jpg> [--out-dir cube] [--size 256]
//     [--format png|jpg]
// Deps: sharp (npm i sharp).
import { readFileSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`hdr-to-cubemap.js — equirect panorama to cube faces (px nx py ny pz nz)
Usage:
  node converters/hdr-to-cubemap.js <panorama.hdr|png|jpg> [--out-dir cube] [--size 256]
    [--format png|jpg]
Example:
  node converters/hdr-to-cubemap.js ./assets/studio.hdr --out-dir ./assets/sky --size 512`);
  process.exit(args.length ? 0 : 1);
}

const o = { in: null, outDir: null, size: 256, format: 'png' };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out-dir') o.outDir = args[++i];
  else if (a === '--size') o.size = Number(args[++i]);
  else if (a === '--format') o.format = args[++i].replace('.', '');
  else if (!a.startsWith('--') && !o.in) o.in = a;
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (!o.in) { console.error('Missing input.'); process.exit(1); }
if (!existsSync(o.in)) { console.error(`No such file: ${o.in}`); process.exit(1); }
if (!Number.isInteger(o.size) || o.size < 8 || o.size > 4096) { console.error('Bad --size (want 8..4096).'); process.exit(1); }
if (!['png', 'jpg', 'jpeg'].includes(o.format)) { console.error('Bad --format (want png|jpg).'); process.exit(1); }
if (statSync(o.in).size > 100 * 1048576) { console.error('File too large (>100MB) — downscale upstream first.'); process.exit(1); }
if (!o.outDir) o.outDir = o.in.replace(/\.[a-z0-9]+$/i, '') + '-cube';

// --- RGBE decode (duplicated from texture-convert.js: one-file convention, no shared lib) ---
function decodeHDR(b) {
  const txt = b.toString('ascii', 0, Math.min(b.length, 4096));
  const headEnd = txt.indexOf('\n\n');
  if (headEnd < 0) throw new Error('HDR header broken');
  let p = headEnd + 2;
  const resLine = b.toString('ascii', p, Math.min(b.length, p + 64)).split('\n')[0];
  const m = resLine.match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
  if (!m) throw new Error('HDR orientation unsupported (need -Y +X)');
  const h = +m[1], w = +m[2];
  if (!w || !h || w > 16384 || h > 16384) throw new Error('HDR dimensions insane');
  p += resLine.length + 1;
  const rgb = new Float32Array(w * h * 3);
  const cvt = (r, g, bl, e) => e === 0 ? [0, 0, 0] : [r, g, bl].map((v) => (v / 255) * 2 ** (e - 128));
  if (w < 8 || w > 0x7fff) { // flat pixels
    for (let i = 0; i < w * h; i++) { if (p + 4 > b.length) throw new Error('HDR truncated'); const [R, G, B] = cvt(b[p], b[p+1], b[p+2], b[p+3]); rgb.set([R, G, B], i * 3); p += 4; }
  } else for (let y = 0; y < h; y++) { // scanlines: new-RLE planes or flat fallback
    if (p + 4 <= b.length && b[p] === 2 && b[p+1] === 2 && b[p+2] === (w >> 8) && b[p+3] === (w & 255)) {
      p += 4;
      const plane = new Uint8Array(w * 4);
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          if (p + 1 > b.length) throw new Error('HDR truncated RLE');
          const n = b[p++];
          if (n > 128) { if (p >= b.length) throw new Error('HDR truncated RLE'); const v = b[p++]; for (let k = 0, c2 = n - 128; k < c2; k++) plane[c*w + x++] = v; }
          else { for (let k = 0; k < n; k++) { if (p >= b.length) throw new Error('HDR truncated RLE'); plane[c*w + x++] = b[p++]; } }
        }
      }
      for (let x = 0; x < w; x++) {
        const [R, G, B] = cvt(plane[x], plane[w + x], plane[2*w + x], plane[3*w + x]);
        rgb.set([R, G, B], (y * w + x) * 3);
      }
    } else for (let x = 0; x < w; x++) { // flat fallback within scanline run
      if (p + 4 > b.length) throw new Error('HDR truncated');
      if (b[p] === 1 && b[p+1] === 1 && b[p+2] === 1) throw new Error('old-RLE HDR unsupported (resave modern)');
      const [R, G, B] = cvt(b[p], b[p+1], b[p+2], b[p+3]); rgb.set([R, G, B], (y*w+x) * 3); p += 4;
    }
  }
  return { rgb, w, h };
}

let src, W, H, hdr = false;
{
  const buf = readFileSync(o.in);
  const head = buf.subarray(0, 64).toString('ascii');
  if (head.startsWith('#?RADIANCE') || head.startsWith('#?RGBE')) {
    hdr = true;
    try {
      const d = decodeHDR(buf);
      src = d.rgb; W = d.w; H = d.h;
    } catch (e) { console.error(`${basename(o.in)}: SKIP HDR ${e.message}`); process.exit(1); }
    console.log(`${basename(o.in)}: decoded float HDR ${W}x${H}.`);
  } else {
    try {
      const meta = await sharp(buf).metadata();
      if (!meta.width || !meta.height) throw new Error('zero size');
      const raw = await sharp(buf).removeAlpha().raw().toBuffer();
      src = new Float32Array(meta.width * meta.height * 3);
      for (let i = 0; i < src.length; i++) src[i] = raw[i] / 255;
      W = meta.width; H = meta.height;
    } catch (e) { console.error(`${basename(o.in)}: SKIP unreadable (${String(e.message || e).slice(0, 80)})`); process.exit(1); }
  }
}

// OpenGL cube convention (three.js CubeTexture order), three.js equirect sampling.
// why these exact forms: any other handedness mirrors the sky; the quadrant test pins them
const FACES = {
  px: (s, t) => [1, t, -s],
  nx: (s, t) => [-1, t, s],
  py: (s, t) => [s, 1, t],
  ny: (s, t) => [s, -1, -t],
  pz: (s, t) => [s, t, 1],
  nz: (s, t) => [-s, t, -1],
};
const sample = (u, v) => { // bilinear, clamp-to-edge
  // why (1-v): three.js textures flipY by default, so v=1 is memory row 0 (top as authored)
  const gx = Math.min(W - 1.001, Math.max(0, u * W - 0.5)), gy = Math.min(H - 1.001, Math.max(0, (1 - v) * H - 0.5));
  const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = src[(y0 * W + x0) * 3 + c], b2 = src[(y0 * W + x0 + 1) * 3 + c];
    const d = src[((y0 + 1) * W + x0) * 3 + c], e2 = src[((y0 + 1) * W + x0 + 1) * 3 + c];
    out[c] = a * (1 - fx) * (1 - fy) + b2 * fx * (1 - fy) + d * (1 - fx) * fy + e2 * fx * fy;
  }
  return out;
};
const ext = o.format === 'jpeg' ? 'jpg' : o.format;
mkdirSync(resolve(o.outDir), { recursive: true });
for (const [name, dir] of Object.entries(FACES)) {
  const px = Buffer.alloc(o.size * o.size * 3);
  for (let y = 0; y < o.size; y++) for (let x = 0; x < o.size; x++) {
    const s = (2 * x + 1) / o.size - 1, t = (2 * y + 1) / o.size - 1;
    const [dx, dy, dz] = dir(s, t);
    const l = Math.hypot(dx, dy, dz);
    const u = Math.atan2(dz / l, dx / l) / (2 * Math.PI) + 0.5;
    const v = Math.asin(Math.max(-1, Math.min(1, dy / l))) / Math.PI + 0.5;
    const [r, g, bl] = sample(u, v);
    // why clamp+gamma here: LDR faces are display-ready; HDR range would clip anyway,
    // so tonemap mildly (Reinhard) instead of hard-clipping highlights
    const tone = hdr
      ? [r, g, bl].map((c) => { const x = c / (1 + c); return Math.round(255 * x ** (1 / 2.2)); })
      : [r, g, bl].map((c) => Math.max(0, Math.min(255, Math.round(c * 255))));
    px.set(tone, (y * o.size + x) * 3);
  }
  let pipe = sharp(px, { raw: { width: o.size, height: o.size, channels: 3 } });
  pipe = ext === 'jpg' ? pipe.jpeg({ quality: 90 }) : pipe.png();
  await pipe.toFile(resolve(o.outDir, `${name}.${ext}`));
}
console.log(`Wrote 6 faces ${o.size}px ${ext} → ${resolve(o.outDir)}/`);
