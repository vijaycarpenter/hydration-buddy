import glob
import numpy as np
from PIL import Image
w = []
for f in sorted(glob.glob('cut/c_*.png')):
    a = np.asarray(Image.open(f))[..., 3]
    feet = a[400:440] > 128
    xs = np.nonzero(feet.any(axis=0))[0]
    w.append(xs.max() - xs.min() if len(xs) else 0)
w = np.array(w, float)
print('feet spread per frame:', w.astype(int).tolist())
x = w - w.mean()
ac = [float((x[:-k] * x[k:]).mean()) for k in range(3, 30)]
k = int(np.argmax(ac)) + 3
print('spread period (frames):', k, '=> one step every', k * 0.1, 's')
a0 = np.asarray(Image.open('cut/c_000.png'))[..., 3] > 128
ys = np.nonzero(a0.any(axis=1))[0]
print('figure height px:', ys.max() - ys.min(), 'max spread px:', int(w.max()))
