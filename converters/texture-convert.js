#!/usr/bin/env node
// texture-convert.js — ANY texture in -> game texture out. Single file. Batch OK.
// Ingest (reason: finds ship as TGA/BMP/HDR/SVG/anything; magic-sniffed, not extension-trusted):
//   sharp-native: png jpg webp avif tiff gif svg (first frame / rasterized)
//   built-in decoders (zero-dep, in this file): TGA 24/32-bit raw+RLE, BMP 24/32-bit uncompressed, HDR/RGBE flat+RLE
//   refused with reason: DDS/KTX (GPU-block formats need native transcoders — toktx/Blender path),
//     EXR (needs OpenEXR — Blender path), RLE-compressed BMP, 16-bit TGA, old-RLE HDR
// Optimize: cap longest side (color --size 2048 / data+env --data-size 1024), aspect kept.
//   auto type: albedo/diffuse→color sRGB · normal/nrm/dx→linear q≥90 never-jpg · rough/metal/ao/orm→linear
//   hdri/env/panorama→env (linear, equirect snippet) · HDR stays float .hdr unless --tonemap
// Safety: alpha+jpg refused · jpeg normal warns · --flip-y DX→GL normals · VRAM budget · --snippet loader lines
// Usage:
//   node converters/texture-convert.js <in...> [--out-dir dir] [--size 2048] [--data-size 1024]
//     [--format webp|avif|png|jpg] [--quality N] [--type color|normal|data|env] [--linear]
//     [--flip-y] [--lossless] [--tonemap 1.0] [--snippet]
// Deps: sharp (npm i sharp).
import { readFileSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import sharp from 'sharp';

// ---------- format sniff (magic bytes) ----------
function sniff(b) {
  if (b.length > 10 && b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b.length > 2 && b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (b.length > 12 && b.toString('ascii', 4, 8) === 'ftyp') return 'avif';
  if (b.length > 6 && b.toString('ascii', 0, 6).startsWith('GIF')) return 'gif';
  if (b.length > 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00))) return 'tiff';
  if (b.length > 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (b.length > 4 && b.toString('ascii', 0, 4) === 'DDS ') return 'dds';
  if (b.length > 12 && b[0] === 0xab && b.toString('ascii', 1, 7) === 'KTX ') return 'ktx';
  if (b.length > 4 && b[0] === 0x76 && b[1] === 0x2f && b[2] === 0x6f && b[3] === 0x19) return 'exr';
  const head = b.subarray(0, 64).toString('ascii');
  if (head.startsWith('#?RADIANCE') || head.startsWith('#?RGBE')) return 'hdr';
  const txt = b.subarray(0, 512).toString('utf8').trimStart();
  if (txt.startsWith('<svg') || txt.startsWith('<?xml')) return 'svg';
  if (b.length > 26 && b.subarray(b.length - 26, b.length - 8).toString('ascii') === 'TRUEVISION-XFILE') return 'tga';
  return 'tga?'; // TGA has no header magic: last-resort attempt (validated during parse)
}
const REFUSE = {
  dds: 'DDS is GPU-block data: needs native transcoder (toktx) or Blender → export PNG.',
  ktx: 'KTX already GPU-packed: use as-is with KTX2Loader, or Blender → export PNG.',
  exr: 'EXR needs OpenEXR: Blender Image Editor → save as PNG/HDR, or ship .hdr instead.',
};

// ---------- TGA decoder (type 2 raw + type 10 RLE, 24/32-bit) ----------
function decodeTGA(b) {
  if (b.length < 18) throw new Error('truncated header');
  const idLen = b[0], cmap = b[1], type = b[2];
  const w = b.readUInt16LE(12), h = b.readUInt16LE(14), px = b[16], desc = b[17];
  if (cmap !== 0) throw new Error('colormapped TGA unsupported (truecolor only)');
  if (type !== 2 && type !== 10) throw new Error(`TGA type ${type} unsupported (uncompressed/RLE truecolor only)`);
  if (px !== 24 && px !== 32) throw new Error(`TGA ${px}-bit unsupported (24/32-bit only)`);
  if (!w || !h || w > 16384 || h > 16384) throw new Error('TGA dimensions insane');
  const ch = px / 8;
  let p = 18 + idLen;
  const n = w * h, pxBuf = Buffer.alloc(n * ch);
  const put = (i, v) => { pxBuf[i*ch] = v[2]; pxBuf[i*ch+1] = v[1]; pxBuf[i*ch+2] = v[0]; if (ch === 4) pxBuf[i*ch+3] = v[3] ?? 255; }; // BGR→RGB
  const get = () => { if (p + ch > b.length) throw new Error('TGA truncated pixels'); const v = [b[p], b[p+1], b[p+2], ch === 4 ? b[p+3] : 255]; p += ch; return v; };
  if (type === 2) { for (let i = 0; i < n; i++) put(i, get()); }
  else { let i = 0; while (i < n) { const hd = b[p++]; if (p > b.length) throw new Error('TGA truncated RLE'); if (hd & 0x80) { const v = get(), c = (hd & 0x7f) + 1; for (let k = 0; k < c; k++) put(i++, v); } else { const c = (hd & 0x7f) + 1; for (let k = 0; k < c; k++) put(i++, get()); } } }
  const topLeft = !!(desc & 0x20);
  const out = Buffer.alloc(n * ch);
  for (let y = 0; y < h; y++) { const src = topLeft ? y : h - 1 - y; pxBuf.copy(out, y * w * ch, src * w * ch, (src + 1) * w * ch); }
  return { data: out, w, h, channels: ch };
}

// ---------- BMP decoder (uncompressed 24/32-bit) ----------
function decodeBMP(b) {
  if (b.length < 54) throw new Error('truncated header');
  const off = b.readUInt32LE(10), dib = b.readUInt32LE(14);
  if (dib !== 40 && dib !== 12) throw new Error(`BMP DIB ${dib} unsupported`);
  const w = dib === 40 ? b.readInt32LE(18) : b.readUInt16LE(18);
  const hRaw = dib === 40 ? b.readInt32LE(22) : b.readUInt16LE(20);
  const planes = dib === 40 ? b.readUInt16LE(26) : b.readUInt16LE(22);
  const bpp = dib === 40 ? b.readUInt16LE(28) : b.readUInt16LE(24);
  const comp = dib === 40 ? b.readUInt32LE(30) : 0;
  if (planes !== 1) throw new Error('BMP planes != 1');
  if (comp !== 0) throw new Error('RLE-compressed BMP unsupported (save uncompressed)');
  if (bpp !== 24 && bpp !== 32) throw new Error(`BMP ${bpp}-bit unsupported (24/32-bit only)`);
  const h = Math.abs(hRaw), flip = hRaw > 0; // bottom-up storage
  const ch = bpp / 8, stride = ((bpp * w + 31) >> 5) << 2;
  if (off + stride * h > b.length + 1) throw new Error('BMP truncated pixels');
  const out = Buffer.alloc(w * h * ch);
  for (let y = 0; y < h; y++) {
    const srcY = flip ? h - 1 - y : y, sp = off + srcY * stride;
    for (let x = 0; x < w; x++) { const dp = (y * w + x) * ch; out[dp] = b[sp+x*ch+2]; out[dp+1] = b[sp+x*ch+1]; out[dp+2] = b[sp+x*ch]; if (ch === 4) out[dp+3] = b[sp+x*ch+3]; }
  }
  return { data: out, w, h, channels: ch };
}

// ---------- HDR/RGBE decoder + writer + float resize ----------
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
      const plane = new Uint8Array(w * 4); // R...R G...G B...B E...E
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

// float RGB helpers: bilinear resize, Reinhard tonemap, RGBE encode
function resizeFloat(src, w, h, cap) {
  const s = Math.min(1, cap / Math.max(w, h));
  if (s === 1) return { rgb: src, w, h };
  const nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s)), out = new Float32Array(nw * nh * 3);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const gx = (x + 0.5) / s - 0.5, gy = (y + 0.5) / s - 0.5;
    const x0 = Math.max(0, Math.min(w - 2, Math.floor(gx))), y0 = Math.max(0, Math.min(h - 2, Math.floor(gy)));
    const fx = Math.max(0, Math.min(1, gx - x0)), fy = Math.max(0, Math.min(1, gy - y0));
    for (let c = 0; c < 3; c++) {
      const a = src[(y0*w+x0)*3+c], d = src[(y0*w+x0+1)*3+c], e2 = src[((y0+1)*w+x0)*3+c], f = src[((y0+1)*w+x0+1)*3+c];
      out[(y*nw+x)*3+c] = a*(1-fx)*(1-fy) + d*fx*(1-fy) + e2*(1-fx)*fy + f*fx*fy;
    }
  }
  return { rgb: out, w: nw, h: nh };
}
function tonemapToU8(rgb, exposure) {
  const out = Buffer.alloc((rgb.length / 3) * 4);
  for (let i = 0; i < rgb.length / 3; i++) for (let c = 0; c < 3; c++) {
    const x = rgb[i*3+c] * exposure, t = x / (1 + x); // Reinhard (highlight-safe) + gamma
    out[i*4+c] = Math.max(0, Math.min(255, Math.round(255 * t ** (1 / 2.2))));
  }
  for (let i = 0; i < rgb.length / 3; i++) out[i*4+3] = 255;
  return out;
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
function toRGBE(rgb, i, out) {
  const r = rgb[i*3], g = rgb[i*3+1], bl = rgb[i*3+2], mx = Math.max(r, g, bl);
  if (mx < 1e-32) { out[0] = out[1] = out[2] = out[3] = 0; return; }
  const e = Math.ceil(Math.log2(mx)), m = 2 ** e;
  out[0] = Math.min(255, Math.round((r / m) * 256)); out[1] = Math.min(255, Math.round((g / m) * 256));
  out[2] = Math.min(255, Math.round((bl / m) * 256)); out[3] = e + 128;
}

// ---------- main ----------
const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`texture-convert.js — ANY texture in, game texture out (batch OK)
Usage:
  node converters/texture-convert.js <in...> [--out-dir dir] [--out out.webp] [--size 2048] [--data-size 1024]
    [--format webp|avif|png|jpg] [--quality N] [--type color|normal|data|env] [--linear]
    [--flip-y] [--lossless] [--tonemap 1.0] [--snippet]
Ingest: png jpg webp avif tiff gif svg + built-in TGA/BMP/HDR decoders (magic-sniffed).
  DDS/KTX/EXR refused w/ path. HDR stays float .hdr (env-ready) unless --tonemap exposure→LDR.
Example:
  node converters/texture-convert.js albedo.tga normal_DX.bmp rough.png studio.hdr --out-dir ./tex --flip-y --snippet`);
  process.exit(args.length ? 0 : 1);
}
function parse(argv) {
  const o = { ins: [], out: null, outDir: null, size: 2048, dataSize: 1024, format: null,
    quality: null, type: null, linear: false, flipY: false, lossless: false, tonemap: 0, snippet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--out-dir') o.outDir = argv[++i];
    else if (a === '--size') o.size = Number(argv[++i]);
    else if (a === '--data-size') o.dataSize = Number(argv[++i]);
    else if (a === '--format') o.format = argv[++i].replace('.', '');
    else if (a === '--quality') o.quality = Number(argv[++i]);
    else if (a === '--type') o.type = argv[++i];
    else if (a === '--linear') o.linear = true;
    else if (a === '--flip-y') o.flipY = true;
    else if (a === '--lossless') o.lossless = true;
    else if (a === '--tonemap') o.tonemap = Number(argv[++i]);
    else if (a === '--snippet') o.snippet = true;
    else if (!a.startsWith('--')) o.ins.push(a);
    else { console.error(`Unknown: ${a}`); process.exit(1); }
  }
  if (!o.ins.length) { console.error('Missing input.'); process.exit(1); }
  for (const f of o.ins) if (!existsSync(f)) { console.error(`${basename(f)}: SKIP no such file.`); process.exitCode = 1; }
  o.ins = o.ins.filter((f) => existsSync(f));
  if (!o.ins.length) process.exit(1);
  if (o.out && (o.ins.length > 1 || o.outDir)) { console.error('--out only for single input without --out-dir.'); process.exit(1); }
  if (o.type && !['color', 'normal', 'data', 'env'].includes(o.type)) { console.error('Bad --type.'); process.exit(1); }
  for (const k of ['size', 'dataSize']) if (!Number.isFinite(o[k]) || o[k] <= 0) { console.error(`Bad --${k}.`); process.exit(1); }
  if (o.quality != null && (!Number.isFinite(o.quality) || o.quality < 1 || o.quality > 100)) { console.error('Bad --quality (want 1..100).'); process.exit(1); }
  if (o.tonemap < 0 || !Number.isFinite(o.tonemap)) { console.error('Bad --tonemap.'); process.exit(1); }
  return o;
}
const stem = (f) => basename(f, extname(f)).replace(/[@.]?(1024|2048|4096|1k|2k|4k|8k)$/i, '');
const detect = (f) => {
  const s = stem(f);
  if (/(^|[_.\- ])(normal|norm|nrm|nor|bump|dx|directx|gl|opengl)([_.\- ]|$)/i.test(s)) return 'normal';
  if (/(^|[_.\- ])(rough|metal|ao|occlusion|height|displace|opacity|gloss|smooth|mask|orm|arm)([_.\- ]|$)/i.test(s)) return 'data';
  if (/(^|[_.\- ])(hdri|hdr|env|environment|panorama|sky|background|studio)([_.\- ]|$)/i.test(s)) return 'env';
  return 'color';
};
const isPOT = (n) => (n & (n - 1)) === 0;

const o = parse(args);
if (o.outDir) mkdirSync(resolve(o.outDir), { recursive: true });
let totalVram = 0;
const snips = [];
const usedNames = new Set(); // same-stem inputs (a/albedo.png + b/albedo.png) must never overwrite
function uniqueOut(want) {
  if (!usedNames.has(want)) { usedNames.add(want); return want; }
  const dot = want.lastIndexOf('.');
  let i = 2;
  while (usedNames.has(`${want.slice(0, dot)}-${i}${want.slice(dot)}`)) i++;
  const n = `${want.slice(0, dot)}-${i}${want.slice(dot)}`;
  usedNames.add(n);
  console.log(`${basename(want)}: name taken → ${basename(n)} (no overwrite).`);
  return n;
}

// ingest anything → {sharpPipe} LDR branch, or {hdr} float branch
async function ingest(input) {
  const buf = readFileSync(input);
  const fmt = sniff(buf);
  if (REFUSE[fmt]) throw new Error(`${fmt.toUpperCase()}: ${REFUSE[fmt]}`);
  if (fmt === 'hdr') return { kind: 'hdr', ...decodeHDR(buf), srcFormat: 'hdr' };
  if (fmt === 'tga' || fmt === 'tga?') {
    try { const d = decodeTGA(buf); return { kind: 'raw', raw: sharp(d.data, { raw: { width: d.w, height: d.h, channels: d.channels } }), srcFormat: 'tga', w0: d.w, h0: d.h, alpha: d.channels === 4 }; }
    catch (e) { if (fmt === 'tga?') throw new Error(`unknown format (${e.message})`); throw new Error(`TGA: ${e.message}`); }
  }
  if (fmt === 'bmp') {
    try { const d = decodeBMP(buf); return { kind: 'raw', raw: sharp(d.data, { raw: { width: d.w, height: d.h, channels: d.channels } }), srcFormat: 'bmp', w0: d.w, h0: d.h, alpha: d.channels === 4 }; }
    catch (e) { throw new Error(`BMP: ${e.message}`); }
  }
  const pipe = sharp(buf); // png jpg webp avif tiff gif svg + future sharp formats
  const meta = await pipe.metadata().catch((e) => { throw new Error(`unreadable (${e.message.slice(0, 80)})`); });
  return { kind: 'raw', raw: pipe, srcFormat: meta.format || fmt, w0: meta.width, h0: meta.height, alpha: !!meta.hasAlpha };
}

for (const input of o.ins) {
  // why: sharp buffers whole image + intermediates; a 100MB+ find OOMs small CI runners
  if (statSync(input).size > 100 * 1048576) {
    console.error(`${basename(input)}: SKIP file too large (>100MB) — downscale upstream first.`);
    process.exitCode = 1; continue;
  }
  let ing;
  try { ing = await ingest(input); }
  catch (e) { console.error(`${basename(input)}: SKIP ${e.message}`); process.exitCode = 1; continue; }
  const before = statSync(input).size;
  const kind = o.type ?? (o.linear ? 'data' : detect(input));
  const base = stem(input);

  // ---- HDR float branch: keep .hdr (env-ready) or tonemap to LDR ----
  if (ing.kind === 'hdr' && !o.tonemap) {
    const cap = o.dataSize; // float HDR is linear data (env use), never sRGB cap
    const { rgb, w, h } = resizeFloat(ing.rgb, ing.w, ing.h, cap);
    if (Math.max(ing.w, ing.h) > cap) console.log(`${basename(input)} [env/float]: ${ing.w}x${ing.h} → ${w}x${h} (reason: env VRAM/latency).`);
    const dest = resolve(o.out ?? uniqueOut(o.outDir ? join(o.outDir, `${base}.${cap}.linear.hdr`) : `${base}.${cap}.linear.hdr`));
    const { writeFileSync: wfs } = await import('node:fs');
    wfs(dest, encodeHDR(rgb, w, h));
    const after = statSync(dest).size, vram = w * h * 12;
    totalVram += vram;
    console.log(`${basename(input)} [env/float]: → ${dest} ${w}x${h} ${(after/1024).toFixed(1)}KB (was ${(before/1024).toFixed(1)}KB) VRAM ~${(vram/1048576).toFixed(1)}MB`);
    snips.push(`tex = await loadHDR('${basename(dest)}'); tex.mapping = EquirectangularReflectionMapping; // RGBELoader, NoColorSpace`);
    continue;
  }
  // ---- LDR branch (tonemapped HDR joins here as 8-bit raw) ----
  let pipe, w0, h0, alpha;
  if (ing.kind === 'hdr') {
    const { rgb, w, h } = resizeFloat(ing.rgb, ing.w, ing.h, kind === 'color' ? o.size : o.dataSize);
    const u8 = tonemapToU8(rgb, o.tonemap);
    pipe = sharp(u8, { raw: { width: w, height: h, channels: 4 } }).removeAlpha();
    console.log(`${basename(input)}: tonemapped x${o.tonemap} → LDR ${w}x${h}.`);
    w0 = w; h0 = h; alpha = false;
  } else { pipe = ing.raw; w0 = ing.w0; h0 = ing.h0; alpha = ing.alpha; }
  if (ing.srcFormat && ing.srcFormat !== 'hdr' && !['png', 'jpg', 'jpeg', 'webp', 'avif'].includes(ing.srcFormat))
    console.log(`${basename(input)}: ingested ${ing.srcFormat} → converting.`);
  if (!w0 || !h0) { console.error(`${basename(input)}: SKIP zero-size.`); process.exitCode = 1; continue; }

  const isColor = kind === 'color';
  const cap = isColor ? o.size : o.dataSize;
  let fmt = o.format ?? 'webp';
  let q = o.quality ?? (kind === 'normal' ? 95 : isColor ? 82 : 90);
  const tag = `${basename(input)} [${kind}${o.type ? '' : '~auto'}]`;
  if (kind === 'normal') {
    if (fmt === 'jpg' || fmt === 'jpeg') { console.log(`${tag}: normal→jpg refused. Use webp.`); fmt = 'webp'; }
    if (q < 90 && o.quality == null) q = 90;
    if ((ing.srcFormat === 'jpg' || ing.srcFormat === 'jpeg') && o.quality == null) console.log(`${tag}: WARN jpeg-sourced normal. Prefer PNG source.`);
  }
  if (o.lossless && (fmt === 'webp' || fmt === 'png')) q = 100;
  if ((fmt === 'jpg' || fmt === 'jpeg') && alpha && ing.kind !== 'hdr') { console.log(`${tag}: alpha+jpg refused. Use webp.`); fmt = 'webp'; }

  pipe = pipe.rotate();
  if (Math.max(w0, h0) > cap) { pipe = pipe.resize(cap, cap, { fit: 'inside', withoutEnlargement: true }); console.log(`${tag}: ${w0}x${h0} → fit ${cap}px (aspect kept).`); }
  if (kind === 'normal' && o.flipY) pipe = pipe.flip();
  if (fmt === 'webp') pipe = pipe.webp({ quality: q, effort: 6, lossless: o.lossless || undefined });
  else if (fmt === 'avif') pipe = pipe.avif({ quality: q, effort: 4 });
  else if (fmt === 'png') pipe = pipe.png({ compressionLevel: 9 });
  else if (fmt === 'jpg' || fmt === 'jpeg') pipe = pipe.jpeg({ quality: q, mozjpeg: true });
  else { console.error(`Bad format: ${fmt}`); process.exit(1); }

  const outName = uniqueOut(`${base}.${cap}.${isColor ? 'srgb' : 'linear'}.${fmt === 'jpeg' ? 'jpg' : fmt}`);
  const dest = resolve(o.out ?? (o.outDir ? join(o.outDir, outName) : outName));
  await pipe.toFile(dest);
  const info = await sharp(dest).metadata();
  const after = statSync(dest).size, vram = info.width * info.height * (info.channels ?? 4);
  totalVram += vram;
  console.log(`${tag}: → ${dest} ${info.width}x${info.height} ${isPOT(info.width) && isPOT(info.height) ? 'POT' : 'NPOT ok (WebGL2)'} q${q} ${(after/1024).toFixed(1)}KB (was ${(before/1024).toFixed(1)}KB) VRAM ~${(vram/1048576).toFixed(1)}MB`);
  const cs = isColor ? 'SRGBColorSpace' : 'NoColorSpace';
  snips.push(kind === 'env'
    ? `tex = await load('${outName}'); tex.colorSpace = ${cs}; tex.mapping = EquirectangularReflectionMapping;`
    : `tex = await load('${outName}'); tex.colorSpace = ${cs};${kind === 'normal' ? ' // tangent Y+ OpenGL' : ''}`);
}
console.log(`Total VRAM ~${(totalVram / 1048576).toFixed(1)}MB across ${o.ins.length} input(s)${totalVram > 512 * 1048576 ? ' — WARN >512MB, lower --size/--data-size.' : ''}`);
if (o.snippet) {
  console.log('--- three.js snippet ---');
  console.log(`import { TextureLoader } from 'three';\nimport { RGBELoader } from 'three/addons/loaders/RGBELoader.js';`);
  console.log(`const loader = new TextureLoader();\nconst load = (u) => loader.loadAsync(u);\nconst loadHDR = (u) => new RGBELoader().loadAsync(u);`);
  for (const s of snips) console.log(s);
}
