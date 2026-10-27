"""
GPT 통짜 타자 그림 → 색 바꿀 자리 마스크 (팀색 헬멧 · 팀색 소매/양말)
  python3 scripts/baseball-recolor-mask.py <그림.webp> <마스크.png> [미리보기.png]
마스크 PNG: R = 헬멧, G = 팀색(소매 · 양말), 값 = 그 자리 정도(0~255). 게임에서 이 자리만 색을 바꿔 칠함
원래 주황 기준 (헬멧 · 소매 · 양말이 주황인 그림)
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, out = sys.argv[1], sys.argv[2]
prev = sys.argv[3] if len(sys.argv) > 3 else None
a = np.asarray(Image.open(src).convert("RGBA")).astype(float) / 255
rgb, al = a[..., :3], a[..., 3]
H, W = al.shape
mx = rgb.max(2); mn = rgb.min(2); d = np.maximum(mx - mn, 1e-6); sat = d / np.maximum(mx, 1e-6)
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
orange = (al > 0.2) & (sat > 0.5) & (hue > 6) & (hue < 40) & (mx > 0.25)
# 배트: 가장 긴 비스듬한 막대 — 배트 선분 근처의 밝은 나무색 / 선분 위쪽 끝(헬멧 위)은 전부
yy, xx = np.mgrid[0:H, 0:W]
p0 = np.array([42.0, 8.0]); p1 = np.array([128.0, 205.0])
v = p1 - p0
t = np.clip(((xx - p0[0]) * v[0] + (yy - p0[1]) * v[1]) / (v @ v), 0, 1)
dist = np.hypot(xx - (p0[0] + t * v[0]), yy - (p0[1] + t * v[1]))
wood = ((dist < 16) & (mx > 0.7) & (hue > 22)) | ((dist < 24) & (yy < 125))
orange &= ~wood
# 작은 조각 지우기 · 살짝 넓혀서 테두리 반투명까지
lab, n = ndimage.label(orange)
if n:
    sz = ndimage.sum(orange, lab, range(1, n + 1))
    orange = np.isin(lab, [i + 1 for i, s in enumerate(sz) if s > 25])
# 테두리 반쯤 주황인 픽셀까지 (1px 넓히되 주황 기운 있는 것만)
soft = (al > 0.2) & (sat > 0.3) & (hue > 4) & (hue < 44) & ~wood
orange = orange | (ndimage.binary_dilation(orange, iterations=1) & soft)
helm = orange & (yy < 228)
# 팔뚝 살색 그늘(주황 비슷)은 빼기 — 유니폼 주황은 채도가 훨씬 높음
team = orange & (yy >= 228) & (sat > 0.66)
team = team | (ndimage.binary_dilation(team, iterations=1) & soft & (sat > 0.45))
m = np.zeros((H, W, 4), np.uint8)
m[..., 0] = helm * 255
m[..., 1] = team * 255
m[..., 3] = 255
Image.fromarray(m, "RGBA").save(out)
print("helm", int(helm.sum()), "team", int(team.sum()), "ref", round(float(np.median(mx[orange])), 3))
if prev:
    def recol(ch, ct):
        o = rgb.copy()
        ref = np.median(mx[orange])
        for mm, c in ((helm, ch), (team, ct)):
            c = np.array(c) / 255
            k = (mx / ref)[..., None]
            col = np.clip(c * k, 0, 1) + np.clip(k - 1, 0, 1) * 0.6
            o[mm] = np.clip(col[mm], 0, 1)
        im = Image.fromarray((np.dstack([o, al]) * 255).astype(np.uint8), "RGBA")
        bg = Image.new("RGBA", im.size, (70, 110, 70, 255)); bg.alpha_composite(im); return bg.convert("RGB")
    vs = [((235, 120, 40), (235, 120, 40)), ((30, 45, 110), (40, 80, 190)), ((180, 30, 40), (200, 40, 50)), ((30, 30, 35), (40, 150, 80)), ((250, 200, 40), (120, 60, 170))]
    gimg = Image.new("RGB", (W * 5 + 40, H))
    for i, (ch, ct) in enumerate(vs):
        gimg.paste(recol(ch, ct), (i * (W + 10), 0))
    gimg.save(prev)
