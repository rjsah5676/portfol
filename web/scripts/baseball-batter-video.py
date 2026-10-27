"""
그록 영상(키프레임 사이를 채운 스윙) → 스윙 줄 + 시간표
  python3 scripts/baseball-batter-video.py <영상.mp4> <이름> <임팩트 프레임> <끝 프레임> [첫 키프레임 그림 크기=1024]
- 영상은 첫 키프레임 그림(s1-top: 1024 캔버스, 축발 = (400, 880))을 그대로 늘려 만든 것 → 프레임마다 기준점을 따로 찾지 않고
  모두 같은 배율 · 같은 기준점을 씀 (카메라가 고정이라 이게 제일 안 흔들림)
- 앞발 내림(영상 0 ~ 배트 출발) = 「스트라이드」: 스윙 버튼 전에 공이 날아오는 동안 디딤발을 내딛는 동작 (json stride: [칸, 진행도])
  → 칸을 촘촘히 (3프레임마다) — 예전엔 3칸을 0.05초에 몰아서 타자가 확 앞으로 튀어 보였음
- 스윙 시간표 (json bat: [칸, 시각]): 디딤발 착지 뒤 버튼 → 임팩트(SWING_HIT_T 0.15초) → 끝
    배트 출발 ~ 임팩트 → 0 ~ 0.15초 (다운스윙, 프로 실측 0.14초)
    임팩트 ~ 끝       → 0.15 ~ 0.45초, 배트가 감속하니 처음엔 빠르고 뒤로 갈수록 느리게
- 신발 색은 대기 1칸 신발 색으로
"""
import json, sys, subprocess, tempfile, glob, os
import numpy as np
from PIL import Image
from scipy import ndimage

VID, NAME = sys.argv[1], sys.argv[2]
F_HIT, F_END = int(sys.argv[3]), int(sys.argv[4])
SRC_W = int(sys.argv[5]) if len(sys.argv) > 5 else 1024
GX, GY = 400, 880  # 첫 키프레임 그림의 축발 자리
SWING_HIT_T = 0.15

s = open("scripts/baseball-char-art.py").read()
ns = {"np": np, "Image": Image, "ndimage": ndimage}
exec(s[s.index("def key(path):"):s.index("rgb, al = key(full)")], ns)
L = open("scripts/baseball-batter-load.py").read()
exec(L[L.index("def shoe_mask("):L.index("# 신발 색 맞추기")], ns)

tmp = tempfile.mkdtemp()
subprocess.run(["ffmpeg", "-v", "error", "-i", VID, "-vsync", "0", f"{tmp}/f_%03d.png"], check=True)
fs = sorted(glob.glob(f"{tmp}/f_*.png"))
VW = Image.open(fs[0]).width
k = SRC_W / VW

# 배트 출발 = 임팩트 전 마지막으로 거의 멈춰 있던 프레임 (앞발이 다 내려온 뒤) — 영상마다 달라 넉넉히 임팩트 22프레임 전
F_BAT = max(1, F_HIT - 22)
pre = list(range(0, F_BAT, 3)) + [F_BAT]
bat = list(range(F_BAT + 3, F_HIT, 3)) + [F_HIT]
post = sorted(set([F_HIT + 3, F_HIT + 6, F_HIT + 9] + list(range(F_HIT + 13, F_END, 5)) + [F_END]))
pick = pre + bat + post


# ── 실제 배트 스윙 시간 (배트 무게중심이 움직인 거리로 시간을 매김) ──
# · 디딤발 착지 → 임팩트 0.19~0.20초, 숙련 타자의 배트 속도는 착지 뒤 거의 일정하다가 임팩트 0.1초 전부터
#   급하게 올라 임팩트 순간 최고 (ISBS 일본 프로 타자 200Hz 촬영). 버튼 → 임팩트는 SWING_HIT_T 0.15초
#   (Blast Motion time to contact 0.15초) — 레그킥을 스윙 직전까지 버티는 게임 규칙이라 착지는 버튼 뒤 T_PLANT 에 끝냄
# · 배트 출발 ~ 임팩트: 일정하게 빨라짐(거리 ∝ 시간²) → 임팩트에서 제일 빠름
# · 임팩트 뒤: 임팩트 속도에서 이어서 서서히 멈춤(거리 = 1 - (1-τ)³), 속도가 끊기지 않게 길이를 맞춤
T_PLANT = 0.0


def bat_center(path):
    a = np.asarray(Image.open(path).convert("RGB")).astype(float) / 255
    mx = a.max(-1); mn = a.min(-1); d = np.maximum(mx - mn, 1e-6); sat = d / np.maximum(mx, 1e-6)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    wood = (hue > 18) & (hue < 38) & (sat > 0.25) & (sat < 0.7) & (mx > 0.75)
    lab, n = ndimage.label(wood)
    if not n:
        return None
    sz = ndimage.sum(wood, lab, range(1, n + 1))
    if sz.max() < 300:
        return None
    ys, xs = np.where(lab == int(np.argmax(sz)) + 1)
    return xs.mean(), ys.mean()


cs = {f: bat_center(fs[f]) for f in range(F_BAT, F_END + 1)}
known = [f for f in cs if cs[f] is not None]
xy = np.array([np.interp(range(F_BAT, F_END + 1), known, [cs[f][j] for f in known]) for j in (0, 1)]).T
xy = ndimage.median_filter(xy, size=(5, 1), mode="nearest")
dist = np.r_[0, np.cumsum(np.hypot(*np.diff(xy, axis=0).T))]  # dist[f - F_BAT]


def prog(f, a, b):
    """a~b 구간 진행도: 배트 이동 거리 75% + 프레임 25% (배트가 가려지거나 멈춘 칸이 0초가 되지 않게)"""
    da, db = dist[a - F_BAT], dist[b - F_BAT]
    return 0.75 * (dist[f - F_BAT] - da) / max(db - da, 1e-6) + 0.25 * (f - a) / max(b - a, 1)


S_PRE = dist[F_HIT - F_BAT]
S_POST = dist[F_END - F_BAT] - S_PRE
# 임팩트 속도: 앞 구간 2·S_PRE/구간길이 = 뒤 구간 3·S_POST/T_POST
T_POST = float(np.clip(1.5 * (SWING_HIT_T - T_PLANT) * S_POST / S_PRE, 0.22, 0.42))
print("bat path pre", int(S_PRE), "post", int(S_POST), "T_POST", round(T_POST, 3))


def tmap(f):
    if f <= F_BAT:
        return T_PLANT * f / max(F_BAT, 1)
    if f <= F_HIT:
        return T_PLANT + (SWING_HIT_T - T_PLANT) * prog(f, F_BAT, F_HIT) ** 0.5
    return SWING_HIT_T + T_POST * (1 - (1 - prog(f, F_HIT, F_END)) ** (1 / 3))


idm = json.load(open("src/data/baseball/batter-idle.json"))
c0 = np.asarray(Image.open("public/baseball/sprites/batter-idle.webp").convert("RGBA")).astype(np.float32)[:, :idm["CW"]]
ref_shoe = np.median(c0[..., :3][ns["shoe_mask"](c0)], 0)

ims = []
for f in pick:
    rgb, al = ns["key"](fs[f])
    im = Image.fromarray((np.dstack([rgb, al]) * 255).round().astype(np.uint8), "RGBA")
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    m = ns["shoe_mask"](a)
    if m.sum() > 50:
        a[..., :3][m] = np.clip(a[..., :3][m] * (ref_shoe / np.maximum(np.median(a[..., :3][m], 0), 1)), 0, 255)
    ims.append(Image.fromarray(a.round().astype(np.uint8), "RGBA"))
# 모든 칸 공통 잘라내기 (같은 기준점 유지)
box = None
for im in ims:
    b = im.getbbox()
    box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
x0, y0, x1, y1 = box[0] - 4, box[1] - 4, box[2] + 4, box[3] + 4
CW, CH = x1 - x0, y1 - y0
# WebP 한 변 16383px 제한 → 여러 줄 (한 줄에 cols 칸)
cols = min(len(ims), 16383 // CW)
rows = -(-len(ims) // cols)
strip = Image.new("RGBA", (CW * cols, CH * rows))
for i, im in enumerate(ims):
    strip.alpha_composite(im.crop((x0, y0, x1, y1)), ((i % cols) * CW, (i // cols) * CH))
strip.save(f"public/baseball/sprites/{NAME}.webp", quality=90, method=6)
ts = [tmap(f) for f in pick]
iB = pick.index(F_BAT)
# 스트라이드 진행도: 앞발이 움직인 거리 대신 프레임 비율 (영상이 일정 속도로 내딛음)
stride = [[i, round(pick[i] / F_BAT, 4)] for i in range(iB + 1)]
bat = [[i, round((ts[i] + ts[i + 1]) / 2, 4) if i + 1 < len(ts) else 99] for i in range(iB, len(ts))]
meta = dict(CW=CW, CH=CH, n=len(ims), cols=cols, ax=float(GX - x0), ay=float(GY - y0), stride=stride, bat=bat, frames=pick)
json.dump(meta, open(f"src/data/baseball/{NAME}.json", "w"))
print({k2: v for k2, v in meta.items() if k2 not in ("stride", "bat")}, "\nstride", stride, "\nbat", bat)
