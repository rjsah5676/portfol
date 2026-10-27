"""
야구 인연 캐릭터 그림 넣기 (초록 #00FF00 배경 → 투명)
  python3 scripts/baseball-char-art.py <id> <전신.png> <프로필.png> <대표색 #rrggbb> [얼굴 가운데 x 비율]
출력: public/baseball/char/<id>.webp (전신, 투명, 여백 잘라냄) · <id>-face.webp (얼굴, 대표색 어두운 배경)
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

cid, full, prof, col = sys.argv[1:5]
# 얼굴 가운데 x (프로필 너비 비율, 생략하면 자동)
fx = float(sys.argv[5]) if len(sys.argv) > 5 else None
OUT = "public/baseball/char/"

def key(path):
    a = np.asarray(Image.open(path).convert("RGB")).astype(float) / 255
    H, W, _ = a.shape
    # 배경색 = 네 귀퉁이 평균
    bgc = np.concatenate([a[:24, :24], a[:24, -24:], a[-24:, :24], a[-24:, -24:]]).reshape(-1, 3).mean(0)
    gbg = bgc[1] - max(bgc[0], bgc[2])
    gs = a[..., 1] - np.maximum(a[..., 0], a[..., 2])
    al = np.clip((1 - gs / gbg - 0.1) / 0.85, 0, 1)
    # 반투명(김 · 빛 · 시스루) = 배경색 빼고 원래 색 되살리기
    rgb = np.clip((a - (1 - al[..., None]) * bgc) / np.maximum(al[..., None], 1e-3), 0, 1)
    # 남은 초록 번짐 빼기
    rgb[..., 1] = np.minimum(rgb[..., 1], np.maximum(rgb[..., 0], rgb[..., 2]) + 0.01)
    # 떠 있는 작은 점 지우기
    m = al > 0.5
    lab, n = ndimage.label(m)
    if n:
        s = ndimage.sum(m, lab, range(1, n + 1))
        keep = np.isin(lab, [i + 1 for i, v in enumerate(s) if v > 200])
        al = al * ndimage.binary_dilation(keep, iterations=3)
    return rgb, al

rgb, al = key(full)
ys, xs = np.where(al > 0.05)
pad = 12
y0, y1 = max(0, ys.min() - pad), min(al.shape[0], ys.max() + pad)
x0, x1 = max(0, xs.min() - pad), min(al.shape[1], xs.max() + pad)
im = Image.fromarray((np.dstack([rgb, al])[y0:y1, x0:x1] * 255).round().astype(np.uint8), "RGBA")
im.save(OUT + cid + ".webp", quality=92, method=6)
print("full", im.size)

rgb, al = key(prof)
H, W = al.shape
# 얼굴 위주로 (320:352 비율, 위쪽 기준)
cw = int(W * 0.66); ch = int(cw * 352 / 320)
cx = int(fx * W) if fx is not None else int(np.where(al[: H // 2] > 0.5)[1].mean())
x0 = int(np.clip(cx - cw / 2, 0, W - cw)); y0 = 0
crop_rgb = rgb[y0:y0 + ch, x0:x0 + cw]; crop_al = al[y0:y0 + ch, x0:x0 + cw]
c = np.array([int(col[i:i + 2], 16) for i in (1, 3, 5)]) / 255
yy, xx = np.mgrid[0:crop_al.shape[0], 0:crop_al.shape[1]]
d = np.sqrt(((xx - crop_al.shape[1] * 0.5) / crop_al.shape[1]) ** 2 + ((yy - crop_al.shape[0] * 0.35) / crop_al.shape[0]) ** 2)
bg = c[None, None, :] * np.clip(0.55 - d * 0.6, 0.12, 0.55)[..., None] + 0.04
out = crop_rgb * crop_al[..., None] + bg * (1 - crop_al[..., None])
face = Image.fromarray((np.clip(out, 0, 1) * 255).round().astype(np.uint8)).resize((480, 528), Image.LANCZOS)
face.save(OUT + cid + "-face.webp", quality=90, method=6)
print("face", face.size)
