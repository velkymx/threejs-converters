# texture-atlas

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [UV Contract](#uv-contract)
- [See Also](#see-also)

## Introduction

texture-atlas packs N images into one atlas PNG plus an offsets JSON. One bind and one material beats N draws with N textures, and atlases compress better. Cells are uniform (cell = largest input side) so every tile stays addressable by index. It needs `sharp` (`npm install` covers it).

## Usage

```bash
node converters/texture-atlas.js <a.png> <b.png> [...] [--out atlas.png] [--json atlas.json]
  [--padding 2] [--cols 0] [--snippet]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | `atlas.png` | Atlas path. |
| `--json` | out stem + `.json` | Offsets path. |
| `--padding` | `2` | Gutter pixels, 0..64. Mipmapped use wants 2+. |
| `--cols` | `0` | Columns, or 0 for ceil(sqrt(n)). |
| `--snippet` | off | Print three.js repeat/offset lines per tile. |

## Examples

```bash
node converters/texture-atlas.js ./tex/*.png --out ./tex/atlas.png --snippet
# Wrote ./tex/atlas.png (4102x4102, 19213.4 KB) + ./tex/atlas.json — 3 tile(s)
# --- three.js snippet ---
# const atlas = await load('atlas.png'); atlas.colorSpace = SRGBColorSpace;
# const t_Default_albedo_jpg = atlas.clone(); t.repeat.set(0.499, 0.499); t.offset.set(0.0005, 0.5002); t.needsUpdate = true; // Default_albedo.jpg
```

## UV Contract

JSON tiles carry pixel rects plus three.js UVs: `u = x/W`, `v = 1-(y+h)/H`, `ru = w/W`, `rv = h/H` (v-flipped for GL). Tiles sit top-left in their cells. Atlases over 4096px warn, since older mobile GPUs cap there.

## See Also

- [texture-convert](texture-convert.md): shrink inputs first (smaller cells, smaller atlas).
- [material-normalize](material-normalize.md): one material for the atlas.
