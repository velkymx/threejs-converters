# material-cost

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Ranks](#ranks)
- [See Also](#see-also)

## Introduction

material-cost audits PBR feature cost for mobile GPUs with zero dependencies. MeshPhysical features multiply shader cost silently: a model cheap on desktop can tank a phone. Every cost driver gets named per material so you can strip what the art does not need. Advisory only, exit 0 either way.

## Usage

```bash
node converters/material-cost.js <model.glb> [--json]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--json` | off | Machine-readable verdict plus per-material reasons. |

## Examples

```bash
node converters/material-cost.js ./assets/helmet.glb
# Cost ./assets/helmet.glb: 1 material(s) → MODERATE
#  MODERATE Material_MR — 5 textures (sampler pressure)
# Fix: drop unneeded lobes in a DCC, or split costly parts to desktop-only variants.
```

## Ranks

CHEAP is plain PBR. MODERATE covers extra shading lobes (clearcoat, sheen, iridescence, anisotropy, custom specular, BLEND, double-sided, 4+ textures). EXPENSIVE is transmission and volume, which cost whole extra passes. Ranks are relative triage, not measured milliseconds. Cost cuts change the look and stay a human call; this tool never rewrites.

## See Also

- [material-normalize](material-normalize.md): the rewrites that are safe to automate.
- [budget-gate](budget-gate.md): enforce counts in CI alongside cost.
