"""
지피티 대기 동작 시트(가로 N칸, 초록 배경) → 게임 프레임 줄 + 색 바꾸기 마스크 + 기준점
  python3 scripts/baseball-batter-idle.py <시트.png> <이름> [기준 그림.webp]
출력: public/baseball/sprites/<이름>.webp · <이름>-mask.png · src/data/baseball/<이름>.json
- 칸 나누기: 세로로 빈 열(투명)이 이어지는 곳
- 크기: 1칸의 헬멧 꼭대기~발바닥 높이를 기준 그림(batter-stance.webp)과 같게, 모든 칸 같은 배율
- 기준점: 칸마다 두 발 바닥 가운데 (발은 고정이라 프레임이 튀지 않게)
- 마스크: R = 헬멧, G = 소매 · 양말 (주황 자리) — batterSprite 가 팀색으로 칠함
"""
import json
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC, NAME = sys.argv[1], sys.argv[2]
REF = sys.argv[3] if len(sys.argv) > 3 else "public/baseball/sprites/batter-stance.webp"

s = open("scripts/baseball-char-art.py").read()
ns = {"np": np, "Image": Image, "ndimage": ndimage}
exec(s[s.index("def key(path):"):s.index("rgb, al = key(full)")], ns)
rgb, al = ns["key"](SRC)


def hsv(c):
    mx = c.max(-1); mn = c.min(-1); d = np.maximum(mx - mn, 1e-6); sat = d / np.maximum(mx, 1e-6)
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return hue, sat, mx


def helmet_top(rgbc, alc):
    """헬멧(머리 쪽 가장 큰 주황 덩어리) 꼭대기 y"""
    hue, sat, mx = hsv(rgbc)
    o = (alc > 0.3) & (sat > 0.6) & (hue > 6) & (hue < 40)
    H = o.shape[0]
    o[int(H * 0.55):] = False
    lab, n = ndimage.label(o)
    if not n:
        return 0
    sz = ndimage.sum(o, lab, range(1, n + 1))
    k = int(np.argmax(sz)) + 1
    return int(np.where(lab == k)[0].min())


def masks(rgbc, alc):
    """주황 자리 (배트는 빼고): 배트 = 맨 위 끝 ~ 장갑(흰색) 가운데 선분 근처의 밝은 나무색"""
    H, W = alc.shape
    hue, sat, mx = hsv(rgbc)
    yy, xx = np.mgrid[0:H, 0:W]
    op = alc > 0.3
    ty = int(np.where(op.any(1))[0].min()); tx = float(np.where(op[ty])[0].mean())
    glove = op & (mx > 0.85) & (sat < 0.18) & (yy < H * 0.45)
    gy, gx = (np.where(glove)[0].mean(), np.where(glove)[1].mean()) if glove.any() else (H * 0.3, W * 0.5)
    p0 = np.array([tx, ty]); p1 = np.array([gx, gy]); v = p1 - p0
    t = np.clip(((xx - p0[0]) * v[0] + (yy - p0[1]) * v[1]) / max(v @ v, 1), 0, 1)
    dist = np.hypot(xx - (p0[0] + t * v[0]), yy - (p0[1] + t * v[1]))
    bw = W * 0.06
    wood = ((dist < bw) & (mx > 0.7) & (hue > 22)) | ((dist < bw * 1.4) & (t < 0.45))
    orange = op & (sat > 0.5) & (hue > 6) & (hue < 40) & (mx > 0.25) & ~wood
    lab, n = ndimage.label(orange)
    if n:
        sz = ndimage.sum(orange, lab, range(1, n + 1))
        orange = np.isin(lab, [i + 1 for i, z in enumerate(sz) if z > 12])
    soft = (alc > 0.2) & (sat > 0.3) & (hue > 4) & (hue < 44) & ~wood
    orange = orange | (ndimage.binary_dilation(orange, iterations=1) & soft)
    # 헬멧 = 머리 높이(장갑 아래쪽 경계보다 위) · 나머지 = 소매 · 양말 (팔뚝 살 그늘은 채도로 거름)
    cut = gy + H * 0.04
    helm = orange & (yy < cut)
    team = orange & (yy >= cut) & (sat > 0.58)
    team = team | (ndimage.binary_dilation(team, iterations=1) & soft & (sat > 0.45) & (yy >= cut))
    ref = float(np.median(mx[orange])) if orange.any() else 0.94
    return helm, team, ref


# 칸 나누기
nz = (al > 0.3).sum(0) > 0
edges = np.diff(np.r_[0, nz.astype(int), 0])
cols = list(zip(np.where(edges == 1)[0], np.where(edges == -1)[0]))
cols = [(a, b) for a, b in cols if b - a > 40]
cells = []
for a, b in cols:
    sub_al = al[:, a:b]
    rows = np.where((sub_al > 0.05).any(1))[0]
    y0, y1 = rows.min(), rows.max() + 1
    c_rgb = rgb[y0:y1, a:b]; c_al = sub_al[y0:y1]
    bot = int(np.where((c_al > 0.5).any(1))[0].max())
    band = (c_al[max(0, bot - 50):bot + 1] > 0.5).any(0)
    fx = np.where(band)[0]
    cells.append(dict(rgb=c_rgb, al=c_al, ax=(fx.min() + fx.max()) / 2, ay=bot, top=helmet_top(c_rgb, c_al)))

# 배율: 1칸 헬멧~발 높이 = 기준 그림 헬멧~발 높이
ref = np.asarray(Image.open(REF).convert("RGBA")).astype(float) / 255
ref_bot = int(np.where((ref[..., 3] > 0.5).any(1))[0].max())
ref_h = ref_bot - helmet_top(ref[..., :3], ref[..., 3])
k = ref_h / (cells[0]["ay"] - cells[0]["top"])
print("cells", len(cells), "scale", round(k, 3), "ref body", ref_h)

# 같은 크기 칸에 기준점 맞춰 담기
sc = []
for c in cells:
    h, w = c["al"].shape
    W2, H2 = max(1, round(w * k)), max(1, round(h * k))
    im = Image.fromarray((np.dstack([c["rgb"], c["al"]]) * 255).round().astype(np.uint8), "RGBA").resize((W2, H2), Image.LANCZOS)
    sc.append((im, c["ax"] * k, c["ay"] * k))
left = max(ax for _, ax, _ in sc) + 4
right = max(im.width - ax for im, ax, _ in sc) + 4
up = max(ay for _, _, ay in sc) + 4
down = max(im.height - ay for im, _, ay in sc) + 4
CW, CH = int(np.ceil(left + right)), int(np.ceil(up + down))
strip = Image.new("RGBA", (CW * len(sc), CH))
mstrip = np.zeros((CH, CW * len(sc), 4), np.uint8)
mstrip[..., 3] = 255
refs = []
for i, (im, ax, ay) in enumerate(sc):
    ox, oy = round(i * CW + left - ax), round(up - ay)
    strip.alpha_composite(im, (ox, oy))
    a = np.asarray(im).astype(float) / 255
    hm, tm, rv = masks(a[..., :3], a[..., 3])
    refs.append(rv)
    mstrip[oy:oy + im.height, ox:ox + im.width, 0] = np.maximum(mstrip[oy:oy + im.height, ox:ox + im.width, 0], hm * 255)
    mstrip[oy:oy + im.height, ox:ox + im.width, 1] = np.maximum(mstrip[oy:oy + im.height, ox:ox + im.width, 1], tm * 255)
strip.save(f"public/baseball/sprites/{NAME}.webp", quality=92, method=6)
Image.fromarray(mstrip, "RGBA").save(f"public/baseball/sprites/{NAME}-mask.png", optimize=True)
meta = dict(CW=CW, CH=CH, n=len(sc), ax=round(left, 1), ay=round(up, 1), ref=round(float(np.median(refs)), 3))
json.dump(meta, open(f"src/data/baseball/{NAME}.json", "w"))
print(meta)
