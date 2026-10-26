# Cuts the walking boy out of GIF frames whose "transparent" checkerboard was baked into the pixels.
# usage: cutout.py stack.npy outdir
import sys, os
import numpy as np
from PIL import Image

stack = np.load(sys.argv[1])            # (N,H,W,3) float32
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
N, H, W, _ = stack.shape
gray = stack.mean(axis=3)
sat = stack.max(axis=3) - stack.min(axis=3)

# 1) background plate: per-pixel median over frames where the pixel looks like checker
cand = (sat < 9) & (gray > 222)
cnt = cand.sum(axis=0)
masked = np.where(cand, gray, np.nan)
plate = np.nanmedian(masked, axis=0)
known = cnt >= 5
P = 19  # measured repeat period of the checker pattern (px)
for _ in range(12):  # fill pixels that are (almost) never background from period-shifted neighbours
    if known.all():
        break
    vals = np.full((8, H, W), np.nan)
    k = 0
    for dy, dx in ((0, P), (0, -P), (P, 0), (-P, 0), (0, 2 * P), (0, -2 * P), (2 * P, 0), (-2 * P, 0)):
        sh = np.roll(np.where(known, plate, np.nan), (-dy, -dx), axis=(0, 1))
        vals[k] = sh
        k += 1
    fill = np.nanmedian(vals, axis=0)
    upd = ~known & ~np.isnan(fill)
    plate[upd] = fill[upd]
    known |= upd
plate = np.nan_to_num(plate, nan=240.0)

def reconstruct(seed, mask):
    """Geodesic reconstruction: grow `seed` within `mask` (flood fill without scipy)."""
    cur = seed & mask
    while True:
        nxt = cur.copy()
        nxt[1:, :] |= cur[:-1, :]; nxt[:-1, :] |= cur[1:, :]
        nxt[:, 1:] |= cur[:, :-1]; nxt[:, :-1] |= cur[:, 1:]
        nxt &= mask
        if (nxt == cur).all():
            return cur
        cur = nxt

def dilate(m, r=1):
    for _ in range(r):
        n = m.copy()
        n[1:, :] |= m[:-1, :]; n[:-1, :] |= m[1:, :]
        n[:, 1:] |= m[:, :-1]; n[:, :-1] |= m[:, 1:]
        m = n
    return m

border = np.zeros((H, W), bool)
border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
bboxes = []
for i in range(N):
    img = stack[i]
    g = gray[i]
    diff = np.abs(g - plate)
    bgc = (sat[i] < 12) & (diff < 11)
    # the soft floor shadow (neutral, a little darker than the checker) counts as background
    bgc |= (sat[i] < 10) & (g < plate) & (plate - g < 40) & (np.arange(H)[:, None] > H * 0.86)
    bg = reconstruct(border, bgc)
    # enclosed holes (e.g. between the legs): background if they contain strict matches to the
    # dark checker squares; white shoes are brighter than those squares so they stay foreground
    enclosed = bgc & ~bg
    evidence = enclosed & (plate < 238) & (diff < 6)
    bg |= reconstruct(evidence, enclosed)
    fg = ~bg
    # drop specks (watermark strokes): keep only fg reachable from the largest blob's core
    core = fg.copy()
    for _ in range(3):  # erode
        e = core.copy()
        e[1:, :] &= core[:-1, :]; e[:-1, :] &= core[1:, :]
        e[:, 1:] &= core[:, :-1]; e[:, :-1] &= core[:, 1:]
        core = e
    ys, xs = np.nonzero(core)
    cy, cx = int(np.median(ys)), int(np.median(xs))
    seed = np.zeros_like(core); seed[cy, cx] = True
    body = reconstruct(seed, dilate(reconstruct(seed, core), 3)) & fg
    # soft alpha in a 2px band around the outline
    band = dilate(body, 2) & ~reconstruct(seed, core)
    a = body.astype(np.float32)
    soft = np.clip(diff / 28.0, 0, 1)
    a[band] = np.maximum(np.where(body[band], 0.35, 0), soft[band]) * dilate(body, 1)[band]
    # colour decontamination: remove the checker contribution at partially transparent pixels
    pl = plate[..., None]
    col = np.where(a[..., None] > 0.02, (img - (1 - a[..., None]) * pl) / np.maximum(a[..., None], 0.02), img)
    col = np.clip(col, 0, 255)
    rgba = np.dstack([col, a * 255]).astype(np.uint8)
    ys, xs = np.nonzero(a > 0.05)
    bboxes.append((xs.min(), ys.min(), xs.max(), ys.max()))
    Image.fromarray(rgba, 'RGBA').save(f'{out}/c_{i:03d}.png')
b = np.array(bboxes)
print('bbox union x', b[:, 0].min(), b[:, 2].max(), 'y', b[:, 1].min(), b[:, 3].max())
