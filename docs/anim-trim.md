# anim-trim

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Thinning Rules](#thinning-rules)
- [three.js Playback](#threejs-playback)
- [See Also](#see-also)

## Introduction

anim-trim cuts animation bloat out of GLB files. Store and Mixamo finds routinely ship 18-second clips at high key rates when the game needs a 2-second loop at 30 fps. With no flags the tool only lists clips. Start there, then keep what you need with `--clip`, cut a time window with `--trim`, and thin keyframes with `--fps`. It needs the `@gltf-transform` dependencies (`npm install` covers them).

## Usage

```bash
node converters/anim-trim.js <in.glb> [--clip NAME] [--trim S:E] [--fps N] [--out out.glb]
```

Run it bare to list clips without writing any file:

```bash
node converters/anim-trim.js ./assets/mixamo.glb
# Clips in ./assets/mixamo.glb:
#  - "mixamo.com" dur 18.20s keys 29084 paths translation,rotation
#  - "Take 001" dur 0.00s keys 0 paths
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--clip` | off | Keep only animations whose name contains this substring (case-insensitive). Drops the rest. |
| `--trim` | off | Keep the time window `S:E` in seconds (e.g. `0:2.5`). Times shift so the window starts at `t=0`. |
| `--fps` | off | Thin LINEAR keyframes down to roughly N fps. See thinning rules. |
| `--out` | same name, `.anim.glb` | Output path. |

If the trim window removes every keyframe, the tool exits 1 instead of writing an empty animation. A window matching no keys at all also exits 1. Widen the window in either case.

## Examples

Carve a 2-second loop out of a Mixamo clip:

```bash
node converters/anim-trim.js ./assets/mixamo.glb --clip "samba" --trim 0:2 --fps 30 --out ./assets/samba-loop.glb
# Clip: kept 1 animation(s) matching "samba"
# Trim: cut 25847 key(s), thinned 0 key(s)
# Wrote ./assets/samba-loop.glb (9203.6 KB)
#  - "mixamo.com" now 2.00s keys 3237
```

## Thinning Rules

`--fps` only touches what it can thin safely:

- The source rate is estimated from the median key interval per sampler. Samplers already at or below the target are left alone.
- `STEP` samplers are never thinned. Dropping held keys would pop the motion.
- `CUBICSPLINE` samplers are never thinned. Keys carry in/out tangents in triplets, so decimation corrupts the curves.
- First and last keys of every sampler are always kept, so loops still meet at the ends.

## three.js Playback

Trimmed clips start at `t=0`, so you may hand them straight to an `AnimationMixer` with looping enabled:

```js
const clip = glb.animations[0];
const action = mixer.clipAction(clip);
action.setLoop(THREE.LoopRepeat, Infinity);
action.play();
```

## See Also

- [fbx-to-glb](fbx-to-glb.md): convert the FBX before trimming its clips.
- [gltf-report](gltf-report.md): confirm animation counts after trimming.
