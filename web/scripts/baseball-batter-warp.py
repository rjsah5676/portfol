"""
대기 동작을 그림 한 장으로 부드럽게: 지피티 시트에서 고른 열쇠 칸들의 '모양 변화'만 광류로 뽑고,
기준 칸(첫 열쇠) 그림 하나를 그 변화대로 휘어 N장을 만든다 → 디테일이 매 장 다시 그려지지 않아 꿈틀거림·헬멧 늘어남이 없음
  python3 scripts/baseball-batter-warp.py <원본 시트.webp> <원본.json> <이름> <열쇠 칸들 예: 0,3,6> [장수=16]
"""
import json, math, sys
import cv2
import numpy as np
from PIL import Image

SRC, META, NAME, KEYS = sys.argv[1], sys.argv[2], sys.argv[3], [int(k) for k in sys.argv[4].split(",")]
N = int(sys.argv[5]) if len(sys.argv) > 5 else 16
m = json.load(open(META)); CW, CH = m["CW"], m["CH"]
sheet = np.asarray(Image.open(SRC).convert("RGBA")).astype(np.float32)
msk = np.asarray(Image.open(SRC.replace(".webp", "-mask.png")).convert("RGBA")).astype(np.float32)
cell = lambda a, i: a[:, i * CW:(i + 1) * CW].copy()


def feat(c):
    a = c[..., 3] / 255
    return np.clip(c[..., :3].mean(-1) * a + (1 - a) * 40, 0, 255).astype(np.uint8)


def flow(to, frm):
    """to 칸의 각 점이 frm 칸 어디서 왔는지 (to 격자 위)"""
    f = cv2.calcOpticalFlowFarneback(feat(to), feat(frm), None, 0.5, 5, 31, 6, 7, 1.5, 0)
    # 부드럽게 → 몸 전체가 한 덩어리로 휘게 (헬멧이 늘었다 줄었다 하지 않게)
    return np.dstack([cv2.GaussianBlur(f[..., k], (0, 0), 7) for k in range(2)])


base, bmask = cell(sheet, KEYS[0]), cell(msk, KEYS[0])
F = [np.zeros((CH, CW, 2), np.float32)] + [flow(cell(sheet, k), base) for k in KEYS[1:]]
yy, xx = np.mgrid[0:CH, 0:CW].astype(np.float32)


def at(u):
    """열쇠들을 매끄럽게 잇는 곡선 위 변형 (열쇠 3개면 가운데를 지나는 2차 곡선)"""
    if len(F) == 3:
        C = 2 * F[1] - 0.5 * F[2]
        return 2 * u * (1 - u) * C + u * u * F[2]
    s = u * (len(F) - 1); i = min(int(s), len(F) - 2); w = s - i
    return F[i] * (1 - w) + F[i + 1] * w


def warp(img, f):
    pre = img.copy(); pre[..., :3] *= pre[..., 3:4] / 255
    o = cv2.remap(pre, xx + f[..., 0], yy + f[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    o[..., :3] /= np.maximum(o[..., 3:4] / 255, 1e-3)
    return o


strip = np.zeros((CH, CW * N, 4), np.float32); mstrip = np.zeros_like(strip)
for j in range(N):
    u = 0.5 - 0.5 * math.cos(2 * math.pi * j / N)  # 0 → 1 → 0 천천히 들어갔다 나옴
    f = at(u)
    strip[:, j * CW:(j + 1) * CW] = warp(base, f)
    mm = cv2.remap(bmask, xx + f[..., 0], yy + f[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    mm[..., 3] = 255
    mstrip[:, j * CW:(j + 1) * CW] = mm
Image.fromarray(strip.clip(0, 255).round().astype(np.uint8), "RGBA").save(f"public/baseball/sprites/{NAME}.webp", quality=92, method=6)
Image.fromarray(mstrip.clip(0, 255).round().astype(np.uint8), "RGBA").save(f"public/baseball/sprites/{NAME}-mask.png", optimize=True)
meta = dict(m, n=N)
json.dump(meta, open(f"src/data/baseball/{NAME}.json", "w"))
print(meta)
