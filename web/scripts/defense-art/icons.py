"""아이콘 시트 자르기: python3 icons.py sheet.png cols rows id1 id2 ... --out DIR --size 128
격자 칸 경계 근처에서 알파가 가장 적은 줄로 나누고, 칸마다 가장 큰 덩어리 주변만 남겨 정사각으로 가운데 맞춤."""
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage
a = sys.argv[1:]
def opt(k, d): return a[a.index(k)+1] if k in a else d
out = opt('--out', 'out'); size = int(opt('--size', 128))
pos = [x for i, x in enumerate(a) if not x.startswith('--') and (i == 0 or not a[i-1].startswith('--'))]
src, C, R, ids = pos[0], int(pos[1]), int(pos[2]), pos[3:]
A = np.array(Image.open(src).convert('RGBA')); al = (A[:, :, 3] > 24)
H, W = al.shape
def cuts(prof, n, L):
    c = [0]
    for k in range(1, n):
        e = L*k/n; w = L/n*0.3; s = prof[int(e-w):int(e+w)]
        idx = np.nonzero(s == s.min())[0]; c.append(int(e-w)+int(idx[len(idx)//2]))
    return c + [L]
rc = cuts(al.sum(1), R, H); cc = cuts(al.sum(0), C, W)
os.makedirs(out, exist_ok=True); k = 0
for r in range(R):
    for c in range(C):
        if k >= len(ids): break
        sub = A[rc[r]:rc[r+1], cc[c]:cc[c+1]].copy(); m = sub[:, :, 3] > 24
        lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=6))
        if n > 1:
            sizes = ndimage.sum(m, lab, range(1, n+1)); keep = 1+int(np.argmax(sizes))
            big = sizes.max()
            keepset = {i+1 for i, s in enumerate(sizes) if s > big*0.04}
            mask = np.isin(lab, list(keepset)); sub[~mask] = 0
        ys, xs = np.nonzero(sub[:, :, 3] > 24)
        crop = sub[ys.min():ys.max()+1, xs.min():xs.max()+1]
        h, w = crop.shape[:2]; s = max(h, w); pad = int(s*0.04)
        cv = np.zeros((s+2*pad, s+2*pad, 4), np.uint8)
        cv[pad+(s-h)//2:pad+(s-h)//2+h, pad+(s-w)//2:pad+(s-w)//2+w] = crop
        Image.fromarray(cv).resize((size, size), Image.LANCZOS).save(f'{out}/{ids[k]}.webp', quality=88, method=6)
        k += 1
print('ok', k)
