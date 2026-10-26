import glob, os, sys
from PIL import Image
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
box = (262, 8, 498, 450)  # union bbox of the figure + margin
frames = [Image.open(f).crop(box) for f in sorted(glob.glob('cut/c_*.png'))]
frames[0].save(f'{out}/drip-walk.webp', save_all=True, append_images=frames[1:], duration=100, loop=0,
               quality=82, alpha_quality=90, method=6)
frames[32].save(f'{out}/drip-stand.webp', quality=88, alpha_quality=95, method=6)
print('frame size', frames[0].size)
