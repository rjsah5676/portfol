"""
그록 영상(키프레임 사이를 채운 스윙) → 스윙 줄 + 시간표
  python3 scripts/baseball-batter-video.py <영상.mp4> <이름> <임팩트 프레임> <끝 프레임> [첫 키프레임 그림 크기=1024]
- 영상은 첫 키프레임 그림(s1-top: 1024 캔버스, 축발 = (400, 880))을 그대로 늘려 만든 것 → 프레임마다 기준점을 따로 찾지 않고
  모두 같은 배율 · 같은 기준점을 씀 (카메라가 고정이라 이게 제일 안 흔들림)
- 시간표: 버튼 → 임팩트(SWING_HIT_T 0.15초)
    앞발 내림(영상 0 ~ 배트 출발)  → 0 ~ 0.04초 (실제론 스윙 결정 전에 끝나는 동작이라 짧게)
    배트 출발 ~ 임팩트              → 0.04 ~ 0.15초 (다운스윙, 프로 실측 0.14초)
    임팩트 ~ 끝                     → 0.15 ~ 0.45초, 배트가 감속하니 처음엔 빠르고 뒤로 갈수록 느리게
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
pre = [0, F_BAT // 2, F_BAT]
bat = list(range(F_BAT + 3, F_HIT, 3)) + [F_HIT]
post = sorted(set([F_HIT + 3, F_HIT + 6, F_HIT + 9] + list(range(F_HIT + 13, F_END, 5)) + [F_END]))
pick = pre + bat + post


def tmap(f):
    if f <= F_BAT:
        return 0.04 * f / max(F_BAT, 1)
    if f <= F_HIT:
        return 0.04 + (SWING_HIT_T - 0.04) * (f - F_BAT) / (F_HIT - F_BAT)
    u = (f - F_HIT) / (F_END - F_HIT)
    return SWING_HIT_T + 0.3 * u ** 1.4


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
strip = Image.new("RGBA", (CW * len(ims), CH))
for i, im in enumerate(ims):
    strip.alpha_composite(im.crop((x0, y0, x1, y1)), (i * CW, 0))
strip.save(f"public/baseball/sprites/{NAME}.webp", quality=90, method=6)
ts = [tmap(f) for f in pick]
seq = [[i, round((ts[i] + ts[i + 1]) / 2, 4) if i + 1 < len(ts) else 99] for i in range(len(ts))]
meta = dict(CW=CW, CH=CH, n=len(ims), ax=float(GX - x0), ay=float(GY - y0), seq=seq, frames=pick)
json.dump(meta, open(f"src/data/baseball/{NAME}.json", "w"))
print({k2: v for k2, v in meta.items() if k2 not in ("seq",)}, "\nseq", seq)
