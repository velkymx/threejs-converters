# font-to-glb

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Glyphs](#glyphs)
- [See Also](#see-also)

## Introduction

font-to-glb extrudes a text string into a 3D GLB: titles, labels, signs. The real helvetiker typeface from the three.js repo ships under `assets/fonts/`, so nothing downloads at runtime. Lines stack downward, one mesh total, SCALE_ROOT wrapper as usual. It needs the `three` dependency (`npm install` covers it).

## Usage

```bash
node converters/font-to-glb.js --text "Hi" [--out hi.glb] [--font other.typeface.json]
  [--size 100] [--depth 20] [--target-max 1] [--no-center] [--no-ground]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--text` | required | String to extrude. Empty refuses. `\n` stacks lines at 1.35x size. |
| `--out` | `text.glb` | Output path. |
| `--font` | bundled helvetiker | Any `.typeface.json` (FontLoader format). |
| `--size` | `100` | Cap height scale in font units. |
| `--depth` | `20` | Extrusion depth in font units. |
| `--target-max` | off | Auto-fit the longest bbox side to M meters. |
| `--target-height` | off | Auto-fit the bbox Y height to M meters. |
| `--no-center` / `--no-ground` | off | Keep original offsets. |

## Examples

```bash
node converters/font-to-glb.js --text "OPEN" --out ./assets/open.glb --target-max 2
# Text: 1 line(s), "OPEN".
# BBox raw: 289.000,106.900,20.000 → factor x0.00692042
# Wrote ./assets/open.glb (83.7 KB)
```

## Glyphs

Missing codepoints warn by name and render as tofu boxes instead of failing the run. Bring a fuller `--font` for CJK or emoji.

## See Also

- [svg-to-glb](svg-to-glb.md): extruded vector logos instead.
- [glb-optimize](glb-optimize.md): shrink the result as usual.
