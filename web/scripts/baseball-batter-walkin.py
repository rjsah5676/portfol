"""
그록 영상 (타석에 걸어 들어오기: 걷기 → 배트 들기 → 대기 자세) → 줄 + 시간표
  python3 scripts/baseball-batter-walkin.py <영상.mp4> [간격=3] [배율=0.7] [배속=2.6]
- 영상은 「대기 1칸을 1024 캔버스에 키 900px · 바닥 979」로 놓은 마지막 키프레임에서 만든 것 (카메라 고정)
  → 캔버스 = 영상 × 1024/영상폭, 대기 칸 좌표 = (캔버스 − PASTE) / S + BB0  (대기 칸과 같은 단위 · 같은 기준점)
- 배율: 대기 칸보다 작게 저장 (걷는 동안 칸이 넓어서) — batterSprite 가 그만큼 키워 그림
- 배속: 영상 시간 / 배속 = 게임 시간 (json seq [칸, 끝 시각])
- 신발 색은 대기 1칸 신발 색으로
"""
import json, sys, subprocess, tempfile, glob
import numpy as np
from PIL import Image
from scipy import ndimage

VID = sys.argv[1]
STEP = int(sys.argv[2]) if len(sys.argv) > 2 else 3
OUT = float(sys.argv[3]) if len(sys.argv) > 3 else 0.7
SPEED = float(sys.argv[4]) if len(sys.argv) > 4 else 2.6
NAME = "batter-walkin"

s = open("scripts/baseball-char-art.py").read()
ns = {"np": np, "Image": Image, "ndimage": ndimage}
exec(s[s.index("def key(path):"):s.index("rgb, al = key(full)")], ns)
L = open("scripts/baseball-batter-load.py").read()
exec(L[L.index("def shoe_mask("):L.index("# 신발 색 맞추기")], ns)

idm = json.load(open("src/data/baseball/batter-idle.json"))
ref = np.asarray(Image.open("public/baseball/sprites/batter-idle.webp").convert("RGBA")).astype(np.float32)[: idm["CH"], : idm["CW"]]
# 키프레임 만들 때 대기 1칸을 어떻게 놓았나 (walkin last_keyframe.png)
cell = Image.fromarray(ref.round().astype(np.uint8), "RGBA")
BB = cell.getchannel("A").getbbox()
S = 900 / (BB[3] - BB[1])
PASTE = ((1024 - round((BB[2] - BB[0]) * S)) // 2, 1024 - 900 - 40)
ref_shoe = np.median(ref[..., :3][ns["shoe_mask"](ref)], 0)

tmp = tempfile.mkdtemp()
subprocess.run(["ffmpeg", "-v", "error", "-i", VID, "-vsync", "0", f"{tmp}/f_%03d.png"], check=True)
fs = sorted(glob.glob(f"{tmp}/f_*.png"))
VW = Image.open(fs[0]).width
idx = list(range(0, len(fs), STEP))
if idx[-1] != len(fs) - 1:
    idx.append(len(fs) - 1)

# 영상 1px → 저장 칸 몇 px · 영상 원점이 저장 좌표 어디로
k = (1024 / VW) / S * OUT
ox = (-PASTE[0] / S + BB[0]) * OUT
oy = (-PASTE[1] / S + BB[1]) * OUT

ims = []
for i in idx:
    rgb, al = ns["key"](fs[i])
    a = (np.dstack([rgb, al]) * 255).astype(np.float32)
    m = ns["shoe_mask"](a)
    if m.sum() > 50:
        a[..., :3][m] = np.clip(a[..., :3][m] * (ref_shoe / np.maximum(np.median(a[..., :3][m], 0), 1)), 0, 255)
    im = Image.fromarray(a.round().astype(np.uint8), "RGBA").resize((round(VW * k), round(VW * k)), Image.LANCZOS)
    ims.append(im)
# 전체 칸 = 모든 칸 그림을 다 덮는 상자 (기준점 고정)
box = None
for im in ims:
    b = im.getbbox()
    box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
x0, y0, x1, y1 = box[0] - 3, box[1] - 3, box[2] + 3, box[3] + 3
CW, CH = x1 - x0, y1 - y0
COLS = 12
ROWS = (len(ims) + COLS - 1) // COLS
strip = Image.new("RGBA", (CW * COLS, CH * ROWS))
for j, im in enumerate(ims):
    strip.alpha_composite(im.crop((x0, y0, x1, y1)), ((j % COLS) * CW, (j // COLS) * CH))
strip.save(f"public/baseball/sprites/{NAME}.webp", quality=88, method=6)
# 기준점 = 대기 칸 기준점 (ax, ay) 을 저장 좌표로
# resize 한 그림의 원점(0,0) = 영상 (0,0) = 칸좌표 (-PASTE/S + BB0) → 칸좌표 c 는 그림 (c × OUT − (원점 칸좌표 × OUT))
ax = idm["ax"] * OUT - ox - x0
ay = idm["ay"] * OUT - oy - y0
seq = [[j, round((idx[j + 1] if j + 1 < len(idx) else idx[j] + STEP) / 24 / SPEED, 4)] for j in range(len(idx))]
meta = dict(CW=CW, CH=CH, n=len(ims), cols=COLS, ax=round(ax, 1), ay=round(ay, 1), scale=OUT, seq=seq)
json.dump(meta, open(f"src/data/baseball/{NAME}.json", "w"))
print({k2: v for k2, v in meta.items() if k2 != "seq"}, "strip", strip.size, "len", seq[-1][1])
