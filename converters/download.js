#!/usr/bin/env node
// download.js — URL -> local file. Zero deps. Pure Node.
// Usage:
//   node converters/download.js <url> [--out ./assets/file.glb] [--timeout 30000]
//   node converters/download.js <url1> <url2> --out-dir ./assets
import { createWriteStream, mkdirSync, existsSync, statSync } from 'node:fs';
import { get } from 'node:https';
import { get as httpGet } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { basename, dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`download.js — fetch online assets to disk
Usage:
  node converters/download.js <url...> [--out file] [--out-dir dir] [--timeout ms] [--force]

Examples:
  node converters/download.js https://example.com/model.glb --out-dir ./assets
  node converters/download.js https://a.com/a.obj https://a.com/a.mtl --out-dir ./assets
Notes:
  Single file. Zero deps. Follows up to 5 redirects. Skips existing unless --force.`);
  process.exit(args.length === 0 ? 1 : 0);
}

function parseArgs(argv) {
  const urls = [];
  let out = null, outDir = 'assets', timeout = 30000, force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out = argv[++i];
    else if (a === '--out-dir') outDir = argv[++i];
    else if (a === '--timeout') timeout = Number(argv[++i]);
    else if (a === '--force') force = true;
    else if (!a.startsWith('--')) urls.push(a);
    else { console.error(`Unknown flag: ${a}`); process.exit(1); }
  }
  return { urls, out, outDir, timeout, force };
}

function fetchToFile(url, dest, timeout, redirects = 5) {
  return new Promise((resolveP, reject) => {
    const getter = url.startsWith('https:') ? get : httpGet;
    const req = getter(url, { headers: { 'User-Agent': 'threejs-converters/0.1' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirects <= 0) return reject(new Error('Too many redirects'));
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return fetchToFile(next, dest, timeout, redirects - 1).then(resolveP, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const total = Number(res.headers['content-length'] || 0);
      let done = 0;
      res.on('data', (c) => {
        done += c.length;
        if (total) process.stderr.write(`\r${basename(dest)} ${(done / 1024).toFixed(0)} / ${(total / 1024).toFixed(0)} KB`);
      });
      pipeline(res, createWriteStream(dest)).then(() => {
        process.stderr.write('\n');
        resolveP(dest);
      }, reject);
    });
    req.setTimeout(timeout, () => req.destroy(new Error(`Timeout after ${timeout}ms: ${url}`)));
    req.on('error', reject);
  });
}

const { urls, out, outDir, timeout, force } = parseArgs(args);
if (urls.length === 0) { console.error('No URLs given.'); process.exit(1); }
  if (out && urls.length > 1) { console.error('--out only valid for single URL. Use --out-dir.'); process.exit(1); }
  if (!Number.isFinite(timeout) || timeout <= 0) { console.error('Bad --timeout (want positive ms).'); process.exit(1); }

for (const url of urls) {
  let dest;
  try { dest = out ?? join(outDir, basename(new URL(url).pathname) || 'asset.bin'); }
  catch { console.error(`Bad URL: ${url}`); process.exitCode = 1; continue; }
  dest = resolve(dest);
  try { mkdirSync(dirname(dest), { recursive: true }); }
  catch { console.error(`Cannot write to ${dest} (bad path).`); process.exitCode = 1; continue; }
  if (existsSync(dest) && !force) {
    console.log(`Skip exists (${(statSync(dest).size / 1024).toFixed(1)} KB): ${dest}  (use --force)`);
    continue;
  }
  console.log(`GET ${url}\n -> ${dest}`);
  try {
    await fetchToFile(url, dest, timeout);
    console.log(`Saved ${(statSync(dest).size / 1024).toFixed(1)} KB`);
  } catch (e) { console.error(`FAIL ${url}: ${e.message}`); process.exitCode = 1; }
}
