import sys, glob
import numpy as np
from PIL import Image
files = sorted(glob.glob(sys.argv[1] + '/f_*.png'))
stack = np.stack([np.asarray(Image.open(f).convert('RGB')).astype(np.float32) for f in files])  # (N,H,W,3)
np.save(sys.argv[2], stack)
gray = stack.mean(axis=3)
std = gray.std(axis=0)
med = np.median(gray, axis=0)
reliable = std < 2.0
print('frames', stack.shape, 'reliable fraction', round(float(reliable.mean()), 3))
ys, xs = np.where(~reliable)
print('unreliable bbox x', xs.min(), xs.max(), 'y', ys.min(), ys.max())
# integer-shift periodicity of the reliable median image
def score(dx, dy):
    a = med[max(0,-dy):450-max(0,dy), max(0,-dx):800-max(0,dx)]
    b = med[max(0,dy):450-max(0,-dy) if dy>0 else 450, max(0,dx):800-max(0,-dx) if dx>0 else 800]
    ra = reliable[max(0,-dy):450-max(0,dy), max(0,-dx):800-max(0,dx)]
    rb = reliable[max(0,dy):, max(0,dx):][:a.shape[0], :a.shape[1]]
    b = b[:a.shape[0], :a.shape[1]]
    m = ra & rb
    return float(np.abs(a - b)[m].mean())
xs_scores = sorted((round(score(dx, 0), 2), dx) for dx in range(10, 200))[:6]
ys_scores = sorted((round(score(0, dy), 2), dy) for dy in range(10, 200))[:6]
print('best x shifts', xs_scores)
print('best y shifts', ys_scores)
