"""
그록 투구 영상(세트 → 다리 들기 → 내딛기 → 공 놓기 → 팔로스루) → 투수 줄 + 시간표
  python3 scripts/baseball-pitcher-video.py <영상.mp4> <이름> <시작:최고점:착지:놓기:끝> [간격=2]
- 영상은 1024 캔버스 키프레임(축발 = 투수판 = (512, 880), 세트 그림 = pitcher-set.webp × 520/506 × 1.1)을 늘린 것
  → 모든 칸 같은 배율 · 같은 기준점 (카메라 고정)
- 공 놓은 뒤 화면에 남는 공(흰 동그라미)은 지움 — 게임이 놓는 순간부터 공을 따로 그림
- 칸은 캔버스의 CELL 배율로 줄여 담음 (게임에서 투수 키 ≈ 115px 라 크게 둘 필요 없음)
- 시간표 (게임 와인드업 시계, 공 놓기 = PITCH_RELEASE_T 0.74초):
    시작 → 다리 최고점 0.30초 → 디딤발 착지 0.60초 → 공 놓기 0.74초 (착지 → 놓기 0.14초 = 프로 실측 범위)
    놓기 → 팔로스루 끝 0.35초, 처음엔 빠르고 점점 느리게
"""
import json, sys, subprocess, tempfile, glob
import numpy as np
from PIL import Image
from scipy import ndimage

VID, NAME, EV = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(":")]
STEP = int(sys.argv[4]) if len(sys.argv) > 4 else 2
F0, F_BAL, F_FC, F_REL, F_END = EV
GX, GY = 512, 880
CELL = 0.4
T_BAL, T_FC, T_REL, T_FOLLOW = 0.30, 0.60, 0.74, 0.35

s = open("scripts/baseball-char-art.py").read()
ns = {"np": np, "Image": Image, "ndimage": ndimage}
exec(s[s.index("def key(path):"):s.index("rgb, al = key(full)")], ns)

tmp = tempfile.mkdtemp()
subprocess.run(["ffmpeg", "-v", "error", "-i", VID, "-vsync", "0", f"{tmp}/f_%03d.png"], check=True)
fs = sorted(glob.glob(f"{tmp}/f_*.png"))
VW = Image.open(fs[0]).width
k = 1024 / VW


def ball_blobs(path):
    """작은 흰 동그라미(공) 자리 — 유니폼 흰 부분은 크기 · 모양으로 거름"""
    a = np.asarray(Image.open(path).convert("RGB")).astype(int)
    mx, mn = a.max(-1), a.min(-1)
    wh = (mn > 200) & (mx - mn < 40)
    lab, n = ndimage.label(wh)
    out = np.zeros(wh.shape, bool)
    for j, sl in enumerate(ndimage.find_objects(lab)):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        z = (lab[sl] == j + 1).sum()
        if 60 < z < 900 and 10 <= w <= 40 and 10 <= h <= 40 and max(w, h) / min(w, h) < 1.6 and sl[0].start < a.shape[0] * 0.47:
            out |= lab == j + 1
    return out


def tmap(f):
    if f <= F0:
        return 0.0
    if f <= F_BAL:
        return T_BAL * (f - F0) / (F_BAL - F0)
    if f <= F_FC:
        return T_BAL + (T_FC - T_BAL) * (f - F_BAL) / (F_FC - F_BAL)
    if f <= F_REL:
        return T_FC + (T_REL - T_FC) * (f - F_FC) / (F_REL - F_FC)
    u = (f - F_REL) / (F_END - F_REL)
    return T_REL + T_FOLLOW * (1 - (1 - u) ** 0.5)


pick = sorted(set(list(range(F0, F_REL, STEP)) + [F_REL] + list(range(F_REL + STEP, F_END, STEP)) + [F_END]))
hand = None
ims = []
for f in pick:
    rgb, al = ns["key"](fs[f])
    if f >= F_REL:
        bm = ball_blobs(fs[f])
        if bm.any():
            if hand is None:
                ys, xs = np.where(bm)
                hand = (float(xs.mean() * k - GX), float(ys.mean() * k - GY))
            al = np.where(ndimage.binary_dilation(bm, iterations=4), 0, al)
        # 공 테두리 · 그림자 부스러기 (몸에서 떨어진 작은 조각) 지움
        lab, n = ndimage.label(al > 0.1)
        if n > 1:
            sz = ndimage.sum(al > 0.1, lab, range(1, n + 1))
            al = np.where(np.isin(lab, [j + 1 for j, z in enumerate(sz) if z < 200]), 0, al)
    im = Image.fromarray((np.dstack([rgb, al]) * 255).round().astype(np.uint8), "RGBA")
    ims.append(im.resize((round(im.width * k * CELL), round(im.height * k * CELL)), Image.LANCZOS))
box = None
for im in ims:
    b = im.getbbox()
    box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
x0, y0, x1, y1 = box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2
CW, CH = x1 - x0, y1 - y0
strip = Image.new("RGBA", (CW * len(ims), CH))
for i, im in enumerate(ims):
    strip.alpha_composite(im.crop((x0, y0, x1, y1)), (i * CW, 0))
strip.save(f"public/baseball/sprites/{NAME}.webp", quality=88, method=6)
ts = [tmap(f) for f in pick]
seq = [[i, round(float(ts[i] + ts[i + 1]) / 2, 4) if i + 1 < len(ts) else 99] for i in range(len(ts))]
meta = dict(CW=CW, CH=CH, n=len(ims), ax=round(GX * CELL - x0, 1), ay=round(GY * CELL - y0, 1), cell=CELL,
            hand=[round(hand[0], 1), round(hand[1], 1)] if hand else None, seq=seq, frames=pick)
json.dump(meta, open(f"src/data/baseball/{NAME}.json", "w"))
print({k2: v for k2, v in meta.items() if k2 != "seq"}, "\nseq", seq)
