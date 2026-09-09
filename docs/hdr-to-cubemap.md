# hdr-to-cubemap

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Orientation](#orientation)
- [See Also](#see-also)

## Introduction

hdr-to-cubemap converts an equirectangular panorama (float HDR or LDR) into six cube faces (`px nx py ny pz nz`) for skyboxes and pipelines that need faces instead of equirects. Both branches decode to float RGB first, then share one bilinear remap, so HDR range survives until the final encode. It needs `sharp` (`npm install` covers it).

## Usage

```bash
node converters/hdr-to-cubemap.js <panorama.hdr|png|jpg> [--out-dir cube] [--size 256]
  [--format png|jpg]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out-dir` | input name + `-cube` | Faces land here, created if missing. |
| `--size` | `256` | Face pixels, 8..4096. |
| `--format` | `png` | Face encoding: `png\|jpg`. |

## Examples

```bash
node converters/hdr-to-cubemap.js ./assets/studio.hdr --out-dir ./assets/sky --size 512
# studio.hdr: decoded float HDR 1024x512.
# Wrote 6 faces 512px png → ./assets/sky/
```

## Orientation

OpenGL cube convention in three.js order, sampled with the three.js equirect formula (`u = atan2(z,x)/2pi + 1/2`, `v = asin(y)/pi + 1/2`, flipY-aware). HDR pixels tonemap mildly (Reinhard) instead of hard-clipping; LDR pixels pass through clamped.

## See Also

- [texture-convert](texture-convert.md): HDR ingest details and env snippets.
