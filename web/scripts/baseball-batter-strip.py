"""
따로 뽑은 그림 여러 장 → 한 줄 (배율은 장마다 직접 줌, 기준점 = 축발)
  python3 scripts/baseball-batter-strip.py <이름> <그림[@배율]> ...
- 사이 장을 "앞뒤 두 장 첨부 → 딱 중간" 으로 뽑으면 지피티가 첨부한 캔버스 크기를 늘려서 줌 (1024 → 1254 등)
  → 배율 = 첨부한 캔버스 / 받은 캔버스 로 넣으면 크기가 맞음
- 기준점: 맨 아래 30px 안 불투명 범위 가운데 (= 축발, 스윙 내내 가장 아래 있는 발)
- 신발 색은 대기 1칸 신발 색으로
"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

NAME, SRCS = sys.argv[1], sys.argv[2:]
s = open("scripts/baseball-char-art.py").read()
ns = {"np": np, "Image": Image, "ndimage": ndimage}
exec(s[s.index("def key(path):"):s.index("rgb, al = key(full)")], ns)
L = open("scripts/baseball-batter-load.py").read()
exec(L[L.index("def shoe_mask("):L.index("# 신발 색 맞추기")], ns)
shoe_mask = ns["shoe_mask"]


def anchor(al):
    bot = int(np.where((al > 0.5).any(1))[0].max())
    xs = np.where((al[max(0, bot - 30):bot + 1] > 0.5).any(0))[0]
    return (xs.min() + xs.max()) / 2, bot


idm = json.load(open("src/data/baseball/batter-idle.json"))
c0 = np.asarray(Image.open("public/baseball/sprites/batter-idle.webp").convert("RGBA")).astype(np.float32)[:, :idm["CW"]]
ref_shoe = np.median(c0[..., :3][shoe_mask(c0)], 0)
frames = []
for spec in SRCS:
    path, _, sc = spec.partition("@")
    k = float(sc) if sc else 1.0
    rgb, al = ns["key"](path)
    ys, xs = np.where(al > 0.05)
    rgb, al = rgb[ys.min():ys.max() + 1, xs.min():xs.max() + 1], al[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    ax, ay = anchor(al)
    im = Image.fromarray((np.dstack([rgb, al]) * 255).round().astype(np.uint8), "RGBA")
    if k != 1:
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    arr = np.asarray(im).astype(np.float32)
    m = shoe_mask(arr)
    if m.sum() > 50:
        arr[..., :3][m] = np.clip(arr[..., :3][m] * (ref_shoe / np.maximum(np.median(arr[..., :3][m], 0), 1)), 0, 255)
    frames.append((Image.fromarray(arr.round().astype(np.uint8), "RGBA"), ax * k, ay * k))
left = max(ax for _, ax, _ in frames) + 4
right = max(im.width - ax for im, ax, _ in frames) + 4
up = max(ay for _, _, ay in frames) + 4
down = max(im.height - ay for im, _, ay in frames) + 4
CW, CH = int(np.ceil(left + right)), int(np.ceil(up + down))
strip = Image.new("RGBA", (CW * len(frames), CH))
for i, (im, ax, ay) in enumerate(frames):
    strip.alpha_composite(im, (round(i * CW + left - ax), round(up - ay)))
strip.save(f"public/baseball/sprites/{NAME}.webp", quality=92, method=6)
meta = dict(CW=CW, CH=CH, n=len(frames), ax=round(float(left), 1), ay=round(float(up), 1))
json.dump(meta, open(f"src/data/baseball/{NAME}.json", "w"))
print(meta)
