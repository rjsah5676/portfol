"""
타석 배경 배치도 (지피티에 첨부할 구도 가이드) — 게임 원근(view.ts CAM)과 똑같이 그림
  python3 scripts/baseball-stadium/guide.py <out.png> [F Dc camH Y0]
1536×1024 (3:2, 지피티 크기) — 가운데 1536×864 가 게임 화면(1024×576 의 1.5배), 위아래 80px 는 잘라낼 여유
"""
import math
import sys
from PIL import Image, ImageDraw

OUT = sys.argv[1]
F, Dc, camH, Y0 = (float(v) for v in sys.argv[2:6]) if len(sys.argv) > 5 else (1230, 5.0, 0.95, 280)
K, OY = 1.5, 80
W, H = 1536, 1024


def P(x, y, z):
    s = F / (z + Dc)
    return ((512 + x * s) * K, (Y0 - (y - camH) * s) * K + OY)


im = Image.new("RGB", (W, H), (150, 200, 255))
d = ImageDraw.Draw(im)
GRASS, DIRT, LINE, FENCE, STAND = (60, 160, 70), (190, 140, 90), (255, 255, 255), (30, 50, 90), (110, 110, 130)


def poly(pts, col, n=40):
    d.polygon([P(*p) for p in pts], fill=col)


def ground_poly(fn, col, n=120):
    d.polygon([P(*fn(i / n)) for i in range(n + 1)], fill=col)


fence = lambda phi: 98 + 20 * math.cos(max(-45, min(45, phi)) * 2 * math.pi / 180)
# 관중석 · 펜스
stand_top = P(0, 16, 140)[1]
d.rectangle([0, stand_top, W, P(0, 3.2, 118)[1]], fill=STAND)
pts = []
for i in range(0, 181):
    phi = -90 + i
    r = fence(phi) if abs(phi) <= 45 else 98 / math.cos(math.radians(abs(phi) - 45)) if abs(phi) < 80 else 300
    pts.append((math.sin(math.radians(phi)) * r, math.cos(math.radians(phi)) * r))
# 펜스 벽 (높이 3.2)
for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
    if z0 < 1 or z1 < 1:
        continue
    d.polygon([P(x0, 0, z0), P(x1, 0, z1), P(x1, 3.2, z1), P(x0, 3.2, z0)], fill=FENCE)
# 잔디 (펜스 안쪽 전부)
d.polygon([P(x, 0, max(z, 0.5)) for x, z in pts if z > -50] + [P(60, 0, -4.9), P(-60, 0, -4.9)], fill=GRASS)
# 내야 흙: 마운드 중심 반지름 29m 호 + 베이스 라인 안쪽 잔디
mz = 18.44
arc = [(math.sin(t) * 29, mz + math.cos(t) * 29) for t in [math.radians(a) for a in range(-75, 76, 2)]]
d.polygon([P(0, 0, -2)] + [P(x, 0, z) for x, z in [(-26, 4)] + arc + [(26, 4)]], fill=DIRT)
b = 27.43 / math.sqrt(2)
d.polygon([P(0, 0, 1.5), P(b - 1.6, 0, b), P(0, 0, 2 * b - 1.6), P(-(b - 1.6), 0, b)], fill=GRASS)
# 마운드 (반지름 2.74) · 투수판
d.polygon([P(math.cos(t) * 2.74, 0, mz + math.sin(t) * 2.74) for t in [i * math.pi / 30 for i in range(60)]], fill=DIRT)
d.polygon([P(-0.31, 0.25, mz - 0.08), P(0.31, 0.25, mz - 0.08), P(0.31, 0.25, mz + 0.08), P(-0.31, 0.25, mz + 0.08)], fill=LINE)
# 홈 흙 원 (반지름 3.96)
d.polygon([P(math.cos(t) * 3.96, 0, 0.2 + math.sin(t) * 3.96) for t in [i * math.pi / 40 for i in range(80)] if 0.2 + math.sin(t) * 3.96 > -4.6], fill=DIRT)
# 파울 라인
for s in (1, -1):
    d.line([P(s * 1.9, 0, 1.9), P(s * 69, 0, 69)], fill=LINE, width=4)
# 베이스
for x, z in [(b, b), (-b, b), (0, 2 * b)]:
    d.polygon([P(x - 0.2, 0, z), P(x, 0, z + 0.2), P(x + 0.2, 0, z), P(x, 0, z - 0.2)], fill=LINE)
# 홈플레이트 (점이 z=0, 앞면 z=0.43)
d.polygon([P(-0.215, 0, 0.43), P(0.215, 0, 0.43), P(0.215, 0, 0.215), P(0, 0, 0), P(-0.215, 0, 0.215)], fill=LINE)
# 타석 (가로 1.22 · 세로 1.83, 플레이트에서 0.15 떨어짐)
for s in (1, -1):
    x0, x1 = s * 0.365, s * 1.585
    z0, z1 = -0.7, 1.13
    for a, bb in [((x0, z0), (x0, z1)), ((x1, z0), (x1, z1)), ((x0, z1), (x1, z1)), ((x0, z0), (x1, z0))]:
        d.line([P(a[0], 0, a[1]), P(bb[0], 0, bb[1])], fill=LINE, width=5)
im.save(OUT)
for name, p in [("plate_front", P(0, 0, 0.43)), ("plate_point", P(0, 0, 0)), ("mound", P(0, 0, mz)), ("rubber", P(0, 0.25, mz)), ("box_L_center", P(-0.975, 0, 0.215)), ("fence_cf", P(0, 0, 118)), ("fence_top", P(0, 3.2, 118))]:
    print(name, [round(v) for v in p], "game", [round(p[0] / K), round((p[1] - OY) / K)])
