"""
그록 영상 구간 → 줄 (대기 · 레그킥) — 카메라 고정이라 모든 칸 같은 배율 · 같은 기준점
  python3 scripts/baseball-batter-clip.py <영상.mp4> <이름> <시작:끝:간격[,시작:끝:간격 …]> [--tail 키프레임.png] [--dt 초] [--mask] [--cols N]
- 영상은 1024 캔버스(축발 = (400, 880)) 키프레임을 늘려 만든 것 → 1024/영상폭 으로 되돌림
- --tail: 끝에 키프레임 그림(1024 캔버스)을 그대로 한 칸 더 (레그킥 끝 = 스윙 시작 그림과 똑같이 이어지게)
- --dt: 칸마다 같은 시간으로 도는 시간표 seq 를 json 에 씀 (대기 반복)
- --mask: 빈 색 바꾸기 마스크도 같이 (대기 줄은 마스크 파일을 읽음)
- --q: webp 품질 (기본 90)
- --cols: 한 줄에 칸 N개씩 여러 줄로 (webp 가로 16383px 한계) — json 에 cols
- 신발 색은 대기 1칸 신발 색으로 (대기 줄 자신을 만들 땐 첫 칸 기준)
"""
import json, sys, subprocess, tempfile, glob
import numpy as np
from PIL import Image
from scipy import ndimage

args = sys.argv[1:]
VID, NAME, RNG = args[0], args[1], args[2]
opt = {args[i]: (args[i + 1] if i + 1 < len(args) and not args[i + 1].startswith("--") else True) for i in range(3, len(args)) if args[i].startswith("--")}
GX, GY = 400, 880
RANGES = [tuple(int(x) for x in r.split(":")) for r in RNG.split(",")]

s = open("scripts/baseball-char-art.py").read()
ns = {"np": np, "Image": Image, "ndimage": ndimage}
exec(s[s.index("def key(path):"):s.index("rgb, al = key(full)")], ns)
L = open("scripts/baseball-batter-load.py").read()
exec(L[L.index("def shoe_mask("):L.index("# 신발 색 맞추기")], ns)

tmp = tempfile.mkdtemp()
subprocess.run(["ffmpeg", "-v", "error", "-i", VID, "-vsync", "0", f"{tmp}/f_%03d.png"], check=True)
fs = sorted(glob.glob(f"{tmp}/f_*.png"))
k = 1024 / Image.open(fs[0]).width
srcs = [(fs[i], k) for a0, a1, st in RANGES for i in range(a0, min(a1, len(fs) - 1) + 1, st)]
if isinstance(opt.get("--tail"), str):
    srcs.append((opt["--tail"], 1.0))


def load(path, kk):
    rgb, al = ns["key"](path)
    im = Image.fromarray((np.dstack([rgb, al]) * 255).round().astype(np.uint8), "RGBA")
    if kk != 1:
        im = im.resize((round(im.width * kk), round(im.height * kk)), Image.LANCZOS)
    return np.asarray(im).astype(np.float32)


arrs = [load(p, kk) for p, kk in srcs]
if NAME == "batter-idle":
    ref = arrs[0]
else:
    idm = json.load(open("src/data/baseball/batter-idle.json"))
    ref = np.asarray(Image.open("public/baseball/sprites/batter-idle.webp").convert("RGBA")).astype(np.float32)[:, :idm["CW"]]
ref_shoe = np.median(ref[..., :3][ns["shoe_mask"](ref)], 0)
ims = []
for a in arrs:
    m = ns["shoe_mask"](a)
    if m.sum() > 50:
        a[..., :3][m] = np.clip(a[..., :3][m] * (ref_shoe / np.maximum(np.median(a[..., :3][m], 0), 1)), 0, 255)
    ims.append(Image.fromarray(a.round().astype(np.uint8), "RGBA"))
W = max(im.width for im in ims); H = max(im.height for im in ims)
box = None
for im in ims:
    b = im.getbbox()
    box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
x0, y0, x1, y1 = box[0] - 4, box[1] - 4, box[2] + 4, box[3] + 4
CW, CH = x1 - x0, y1 - y0
COLS = int(opt.get("--cols", len(ims)))
ROWS = (len(ims) + COLS - 1) // COLS
strip = Image.new("RGBA", (CW * COLS, CH * ROWS))
for i, im in enumerate(ims):
    c = Image.new("RGBA", (W, H)); c.alpha_composite(im)
    strip.alpha_composite(c.crop((x0, y0, x1, y1)), ((i % COLS) * CW, (i // COLS) * CH))
strip.save(f"public/baseball/sprites/{NAME}.webp", quality=int(opt.get("--q", 90)), method=6)
meta = dict(CW=CW, CH=CH, n=len(ims), cols=COLS, ax=float(GX - x0), ay=float(GY - y0))
if "--dt" in opt:
    dt = float(opt["--dt"])
    meta["seq"] = [[i, round(dt * (i + 1), 4)] for i in range(len(ims))]
if "--mask" in opt:
    meta["ref"] = 0.96
    mk = np.zeros((8, 8, 4), np.uint8); mk[..., 3] = 255  # 색 바꾸기는 꺼둔 상태라 자리만
    Image.fromarray(mk, "RGBA").save(f"public/baseball/sprites/{NAME}-mask.png", optimize=True)
json.dump(meta, open(f"src/data/baseball/{NAME}.json", "w"))
print({k2: v for k2, v in meta.items() if k2 != "seq"}, "strip", strip.size)
