# texture-convert

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Auto-Detection](#auto-detection)
- [Ingest Formats](#ingest-formats)
- [Safety Rules](#safety-rules)
- [Examples](#examples)
- [See Also](#see-also)

## Introduction

texture-convert turns any raster find into capped, typed, correctly-encoded game textures. It magic-sniffs inputs (never trusts extensions), auto-detects color vs. normal vs. data from filenames, resizes to budget, encodes to WebP/AVIF/PNG/JPG, and prints three.js loader lines with `--snippet`. It needs `sharp` (`npm install` covers it), plus built-in zero-dependency decoders for TGA, BMP, and HDR.

Outputs are named `{stem}.{cap}.{srgb|linear}.{ext}` so type and size stay visible, e.g. `albedo.2048.srgb.webp`. Same-stem inputs never overwrite each other. Collisions get a `-2` suffix.

## Usage

```bash
node converters/texture-convert.js <in...> [--out-dir dir] [--size 2048] [--data-size 1024]
  [--format webp|avif|png|jpg] [--quality N] [--type color|normal|data|env] [--linear]
  [--flip-y] [--lossless] [--tonemap 1.0] [--snippet]
```

Batch as many inputs as you like. `--out` (exact path) is only valid for a single input without `--out-dir`.

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | none | Exact output path (single input only). |
| `--out-dir` | none | Output directory, created if missing. |
| `--size` | `2048` | Max side for color textures. Aspect is always kept. |
| `--data-size` | `1024` | Max side for normal/data/env textures. |
| `--format` | `webp` | Output encoding: `webp\|avif\|png\|jpg`. |
| `--quality` | auto (1..100) | Override quality. Defaults: normal 95, color 82, data 90. |
| `--type` | auto | Force `color\|normal\|data\|env` for every input. |
| `--linear` | off | Treat unflagged inputs as data (linear) instead of color. |
| `--flip-y` | off | Flip vertically. Converts DirectX normals to OpenGL. |
| `--lossless` | off | Lossless WebP/PNG (quality 100). |
| `--tonemap` | off | Exposure for tonemapping HDR to LDR. Without it, HDR stays float `.hdr`. |
| `--snippet` | off | Print three.js loader lines with correct `colorSpace` per file. |

## Auto-Detection

Filenames decide the type unless `--type` or `--linear` overrides:

| Hint words | Type | Encoding |
| ---------- | ---- | -------- |
| `albedo`, `diffuse`, … (default) | color | sRGB, capped by `--size` |
| `normal`, `norm`, `nrm`, `dx`, `directx`, `gl`, `bump` | normal | linear, q ≥ 90, never JPEG |
| `rough`, `metal`, `ao`, `occlusion`, `height`, `orm`, `arm`, `mask`, … | data | linear, capped by `--data-size` |
| `hdri`, `hdr`, `env`, `panorama`, `sky`, `studio`, … | env | linear equirect, HDR stays float |

## Ingest Formats

- **sharp-native:** png, jpg, webp, avif, tiff, gif (first frame), svg (rasterized).
- **Built-in decoders:** TGA 24/32-bit raw + RLE, BMP 24/32-bit uncompressed, HDR/RGBE flat + RLE.
- **Refused with a path forward:** DDS and KTX (GPU-block data; needs `toktx` or Blender → PNG), EXR (needs OpenEXR; Blender → PNG/HDR). RLE-compressed BMP, 16-bit TGA, and old-RLE HDR are likewise refused with the reason printed.

> [!NOTE]
> KTX2 output is intentionally out of scope: it needs the `toktx` binary, which is not pure Node. Ship WebP — `GLTFLoader` reads it built-in.

## Safety Rules

- **Alpha + JPEG is refused** (JPEG has no alpha channel). Falls back to WebP.
- **Normals are never JPEG**. Lossy chroma destroys tangent data. Requesting `--format jpg` for a normal map prints the refusal and uses WebP.
- **JPEG-sourced normals warn**. Prefer a PNG source when you can.
- **HDR stays float `.hdr`** (env-ready, resized to `--data-size`) unless `--tonemap` converts it to LDR.
- **Files over 100MB are refused** before decoding. Downscale upstream first.
- Every run ends with a **total VRAM estimate** (~W×H×4 per texture); totals over 512MB warn.

## Examples

Full set with a DirectX normal map and loader snippet:

```bash
node converters/texture-convert.js albedo.png normal_dx.png rough.png --out-dir tex --flip-y --snippet
# albedo.png [color~auto]: 3000x1500 → fit 2048px (aspect kept).
# albedo.png [color~auto]: → tex/albedo.2048.srgb.webp 2048x1024 POT q82 3.7KB (was 61.1KB) VRAM ~6.0MB
# normal_dx.png [normal~auto]: 3000x1500 → fit 1024px (aspect kept).
# normal_dx.png [normal~auto]: → tex/normal_dx.1024.linear.webp 1024x512 POT q95 1.0KB VRAM ~1.5MB
# rough.png [data~auto]: → tex/rough.1024.linear.webp 500x500 NPOT ok (WebGL2) q90 0.6KB VRAM ~1.0MB
# Total VRAM ~8.5MB across 3 input(s)
# --- three.js snippet ---
# tex = await load('albedo.2048.srgb.webp'); tex.colorSpace = SRGBColorSpace;
# tex = await load('normal_dx.1024.linear.webp'); tex.colorSpace = NoColorSpace; // tangent Y+ OpenGL
# tex = await load('rough.1024.linear.webp'); tex.colorSpace = NoColorSpace;
```

Odd formats in, refusal with a path:

```bash
node converters/texture-convert.js fixture_u.tga fixture_albedo.bmp fixture_studio.hdr fixture.dds --out-dir tex
# fixture_u.tga: ingested tga → converting.
# fixture_u.tga [color~auto]: → tex/fixture_u.2048.srgb.webp 4x2 POT q82
# fixture_albedo.bmp: ingested bmp → converting.
# fixture_studio.hdr [env/float]: → tex/fixture_studio.1024.linear.hdr 4x2
# fixture.dds: SKIP DDS: DDS is GPU-block data: needs native transcoder (toktx) or Blender → export PNG.
```

## See Also

- [glb-optimize](glb-optimize.md): its texture stage uses the same WebP defaults.
- [budget-gate](budget-gate.md): gate total file weight in CI.
