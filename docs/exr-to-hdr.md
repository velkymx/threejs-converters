# exr-to-hdr

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [See Also](#see-also)

## Introduction

exr-to-hdr decodes EXR files (VFX plates, Poly Haven, Blender renders) to float RGBE `.hdr` using the headless three.js `EXRLoader`, which is pure JS from uncompressed through DWA/B. Half-float channels promote via `DataUtils.fromHalfFloat`; the result feeds [texture-convert](texture-convert.md) directly. It needs the `three` dependency (`npm install` covers it).

## Usage

```bash
node converters/exr-to-hdr.js <in.exr> [--out out.hdr] [--data-size 1024]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.hdr` | Output path. |
| `--data-size` | `1024` | Cap longest side (bilinear on floats), same convention as the env path. |

## Examples

```bash
node converters/exr-to-hdr.js ./assets/studio.exr --out ./assets/studio.hdr
# EXR: decoded 1024x512 float.
# Wrote ./assets/studio.hdr (1414.7 KB), feeds texture-convert.js
node converters/texture-convert.js ./assets/studio.hdr --out-dir ./tex --snippet
```

## See Also

- [texture-convert](texture-convert.md): the `.hdr` continues here (env snippet included).
- [hdr-to-cubemap](hdr-to-cubemap.md): faces from the result.
