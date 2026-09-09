#!/usr/bin/env node
// pk3-to-dir.js — .pk3/.zip (Quake 3 mods, map packs, model zips) -> directory tree. Zero deps. Pure Node.
// Why: Q3 mods ship as renamed zips; everything downstream (md3-to-glb, textures) needs loose files first.
// How: scan tail for End-of-central-directory -> walk central directory with DataView -> inflate
//   method-8 entries via node:zlib, copy method-0 entries. Rejects zip-bombs via --max-mb cap on total
//   uncompressed bytes, plus '..' traversal, absolute paths, encrypted and descriptor entries.
// Usage: node converters/pk3-to-dir.js <in.pk3|in.zip> [--out-dir dir] [--list] [--max-mb 512]
// Refusals: non-ZIP magic, multi-disk archives, unsupported methods (deflate64+), data descriptors.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`pk3-to-dir.js — Quake 3 PK3 / ZIP to directory
Usage:
  node converters/pk3-to-dir.js <in.pk3|in.zip> [--out-dir dir] [--list] [--max-mb 512]
  --list prints the archive tree without extracting.
Example:
  node converters/pk3-to-dir.js ./assets/pak0.pk3 --out-dir ./assets/pak0
Next: node converters/md3-to-glb.js ./assets/pak0/models/arena.glb`);
  process.exit(args.length ? 0 : 1);
}

const o = { in: null, outDir: null, list: false, maxMb: 512 };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out-dir') o.outDir = args[++i];
  else if (a === '--list') o.list = true;
  else if (a === '--max-mb') o.maxMb = Number(args[++i]);
  else if (!a.startsWith('--') && !o.in) o.in = a;
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (!o.in) { console.error('Missing input.'); process.exit(1); }
if (!existsSync(o.in)) { console.error(`No such file: ${o.in}`); process.exit(1); }
if (!Number.isFinite(o.maxMb) || o.maxMb <= 0) { console.error('Bad --max-mb (want positive MB).'); process.exit(1); }
if (!o.outDir) o.outDir = o.in.replace(/\.(pk3|zip)$/i, '');

const buf = readFileSync(o.in);
// why scan tail: EOCD sits at the very end but a variable-length comment precedes it,
// so search the last 64KB+22 (max comment 65535 + EOCD 22) instead of assuming offset 0
if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) {
  console.error('Not a ZIP/PK3 file (bad magic). Quake PAK/WAD files need other tools.');
  process.exit(1);
}
const tailStart = Math.max(0, buf.length - 65557);
let eocd = -1;
for (let i = buf.length - 22; i >= tailStart; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) { console.error('ZIP has no End-of-central-directory (truncated).'); process.exit(1); }
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const le16 = (p) => dv.getUint16(p, true);
const le32 = (p) => dv.getUint32(p, true);
if (le16(eocd + 4) !== 0 || le16(eocd + 6) !== 0) {
  console.error('Multi-disk ZIP unsupported — rezip as single disk.');
  process.exit(1);
}
const count = le16(eocd + 8), cdSize = le32(eocd + 12), cdOff = le32(eocd + 16);
if (cdOff + cdSize > buf.length) { console.error('ZIP central directory overruns file (truncated).'); process.exit(1); }

const cap = o.maxMb * 1048576;
let totalUncomp = 0, files = 0, dirs = 0, skipped = 0;
let p = cdOff;
for (let i = 0; i < count; i++) {
  if (le32(p) !== 0x02014b50) { console.error(`Central directory corrupt at entry ${i}.`); process.exit(1); }
  const method = le16(p + 10), flags = le16(p + 8);
  const compSize = le32(p + 20), uncompSize = le32(p + 24);
  const nameLen = le16(p + 28), extraLen = le16(p + 30), comLen = le16(p + 32);
  const lhOff = le32(p + 42);
  const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
  p += 46 + nameLen + extraLen + comLen;
  // why strict names: archives are untrusted input; '..' or '/abs' would write outside --out-dir
  if (name.includes('..') || name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name)) {
    console.error(`SKIP unsafe path '${name}' (traversal).`);
    skipped++; continue;
  }
  if (flags & 0x1) { console.error(`SKIP encrypted entry '${name}' (no password support).`); skipped++; continue; }
  if (flags & 0x8) { console.error(`SKIP '${name}' (data descriptors unsupported — rezip plain).`); skipped++; continue; }
  if (name.endsWith('/')) { dirs++; if (!o.list) mkdirSync(join(o.outDir, name), { recursive: true }); continue; }
  if (method !== 0 && method !== 8) { console.error(`SKIP '${name}' (method ${method} unsupported — store/deflate only).`); skipped++; continue; }
  totalUncomp += uncompSize;
  if (totalUncomp > cap) { console.error(`Archive exceeds --max-mb ${o.maxMb} uncompressed (zip-bomb guard).`); process.exit(1); }
  // why re-read sizes from local header: central directory may disagree; local header is authoritative for bytes
  if (le32(lhOff) !== 0x04034b50) { console.error(`Local header missing for '${name}' (truncated).`); process.exit(1); }
  const lName = le16(lhOff + 26), lExtra = le16(lhOff + 28);
  const dataOff = lhOff + 30 + lName + lExtra;
  if (dataOff + compSize > buf.length) { console.error(`Entry '${name}' overruns file (truncated).`); process.exit(1); }
  const comp = buf.subarray(dataOff, dataOff + compSize);
  const dest = join(o.outDir, name);
  console.log(` ${method === 8 ? 'inflate' : 'store  '} ${uncompSize.toString().padStart(9)} ${name}`);
  if (o.list) { files++; continue; }
  const raw = method === 8 ? inflateRawSync(comp) : Buffer.from(comp);
  if (raw.length !== uncompSize) { console.error(`Size mismatch in '${name}' (corrupt).`); process.exit(1); }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, raw);
  files++;
}
console.log(`${o.list ? 'Listed' : 'Wrote'} ${files} file(s), ${dirs} dir(s)${skipped ? `, skipped ${skipped}` : ''}${o.list ? '' : ` → ${resolve(o.outDir)}`}`);
// why nonzero on empty: an archive yielding zero files is either hostile or useless —
// never let it pass silently in a pipeline
if (files === 0) { console.error('Nothing extracted.'); process.exit(1); }
