# budget-gate

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [CI Wiring](#ci-wiring)
- [See Also](#see-also)

## Introduction

budget-gate enforces model budgets where [gltf-report](gltf-report.md) only advises. It checks tris, draws, materials, images, file weight, and world size against limits, prints `PASS` or `FAIL` with the fix tool for every breach, and exits 1 on failure. That makes it suitable for CI pipelines and pre-commit hooks. Heavy finds never ship. It is zero-dependency and runs with plain Node.

Defaults equal the mobile-ready thresholds from the project budgets: 100k tris, 50 draws, 16 materials, 8 MB, 8 images.

## Usage

```bash
node converters/budget-gate.js <model.glb> [--max-tris 100000] [--max-draws 50] [--max-mats 16]
  [--max-mb 8] [--max-images 8] [--min-size 0.01] [--max-size 100] [--json]
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--max-tris` | `100000` | Fail above this triangle count. |
| `--max-draws` | `50` | Fail above this draw-call (primitive) count. |
| `--max-mats` | `16` | Fail above this material count. |
| `--max-mb` | `8` | Fail above this file size in megabytes. |
| `--max-images` | `8` | Fail above this embedded image count. |
| `--min-size` | off | Fail if the world max-dimension is smaller (catches unit mixups). |
| `--max-size` | off | Fail if the world max-dimension is larger. |
| `--json` | off | Machine-readable result (`pass`, counts, `fails` list). |

World size uses the same full-transform bbox math as `gltf-report`. Quantized positions are unmeasurable statically, so they never fail the size checks. Gate the pre-quantize file when scale matters.

## Examples

```bash
node converters/budget-gate.js ./assets/chair.opt.glb
# PASS ./assets/chair.opt.glb, tris 2400 draws 2 mats 1 imgs 0 0.04MB size 2.00m
```

A breach names the fix for each line:

```bash
node converters/budget-gate.js ./assets/samba.glb --max-mb 4
# FAIL ./assets/samba.glb, tris 55320 draws 2 mats 2 imgs 0 9.49MB size 1.83m
#  - file 9.5MB > 4MB (texture-convert webp, glb-optimize)
```

## CI Wiring

Gate the files your game actually loads: optimized outputs and split parts, not raw finds:

```bash
node converters/budget-gate.js ./assets/level.glb --max-tris 300000 --max-draws 100 || exit 1
```

> [!TIP]
> Pair per-part gates with [glb-split](glb-split.md): chunk an oversized kit first, then gate each chunk. Small passing parts beat one failing whole.

## See Also

- [gltf-report](gltf-report.md): the human-readable diagnosis behind a FAIL.
- [glb-optimize](glb-optimize.md): the fix for most breaches.
