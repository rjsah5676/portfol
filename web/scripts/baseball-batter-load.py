"""
레그킥(로드) 줄 만들기: 따로 뽑은 그림 여러 장 → 대기 줄과 같은 배율 · 같은 기준점(축발 = 가까운 발 바닥 가운데)
  python3 scripts/baseball-batter-load.py <이름> <그림[:x0,y0,x1,y1]> ...
- 첫 칸은 대기 줄(batter-idle) 1칸을 그대로 씀 → 대기 → 레그킥이 튀지 않게
- 배율: 헬멧 폭을 대기 1칸 헬멧 폭에 맞춤 (몸이 펴지거나 굽어도 헬멧 크기는 같아야 하니까)
- 기준점: 맨 아래 50px 안의 불투명 범위 가운데 (= 땅 딛은 가까운 발)
"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

NAME, SRCS = sys.argv[1], sys.argv[2:]
s = open("scripts/baseball-char-art.py").read()
ns = {"np": np, "Image": Image, "ndimage": ndimage}
exec(s[s.index("def key(path):"):s.index("rgb, al = key(full)")], ns)


def helmet_w(rgb, al):
    mx = rgb.max(-1); mn = rgb.min(-1); sat = (mx - mn) / np.maximum(mx, 1e-6)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    o = (al > 0.5) & (sat > 0.55) & (r > g) & (g > b) & (r > 0.5)
    rows = np.where((al > 0.5).any(1))[0]
    o[rows.min() + int((rows.max() - rows.min()) * 0.4):] = False
    lab, n = ndimage.label(o); sz = ndimage.sum(o, lab, range(1, n + 1)); k = int(np.argmax(sz)) + 1
    xs = np.where(lab == k)[1]
    return float(np.percentile(xs, 98) - np.percentile(xs, 2))


def anchor(al):
    bot = int(np.where((al > 0.5).any(1))[0].max())
    xs = np.where((al[max(0, bot - 50):bot + 1] > 0.5).any(0))[0]
    return (xs.min() + xs.max()) / 2, bot


idm = json.load(open("src/data/baseball/batter-idle.json"))
idle = np.asarray(Image.open("public/baseball/sprites/batter-idle.webp").convert("RGBA")).astype(np.float32) / 255
c0 = idle[:, :idm["CW"]]
ref_w = helmet_w(c0[..., :3], c0[..., 3])
frames = [(Image.fromarray((c0 * 255).round().astype(np.uint8), "RGBA"), idm["ax"], idm["ay"])]
for spec in SRCS:
    path, _, box = spec.partition(":")
    rgb, al = ns["key"](path)
    if box:
        x0, y0, x1, y1 = map(int, box.split(","))
        rgb, al = rgb[y0:y1, x0:x1], al[y0:y1, x0:x1]
    ys, xs = np.where(al > 0.05)
    rgb, al = rgb[ys.min():ys.max() + 1, xs.min():xs.max() + 1], al[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    k = ref_w / helmet_w(rgb, al)
    ax, ay = anchor(al)
    im = Image.fromarray((np.dstack([rgb, al]) * 255).round().astype(np.uint8), "RGBA")
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    print(path.split("/")[-1], "scale", round(k, 3))
    frames.append((im, ax * k, ay * k))
left = max(ax for _, ax, _ in frames) + 4
right = max(im.width - ax for im, ax, _ in frames) + 4
up = max(ay for _, _, ay in frames) + 4
down = max(im.height - ay for im, _, ay in frames) + 4
CW, CH = int(np.ceil(left + right)), int(np.ceil(up + down))
strip = Image.new("RGBA", (CW * len(frames), CH))
for i, (im, ax, ay) in enumerate(frames):
    strip.alpha_composite(im, (round(i * CW + left - ax), round(up - ay)))
strip.save(f"public/baseball/sprites/{NAME}.webp", quality=92, method=6)
mk = np.zeros((CH, CW * len(frames), 4), np.uint8); mk[..., 3] = 255
Image.fromarray(mk, "RGBA").save(f"public/baseball/sprites/{NAME}-mask.png", optimize=True)
meta = dict(CW=CW, CH=CH, n=len(frames), ax=round(float(left), 1), ay=round(float(up), 1))
json.dump(meta, open(f"src/data/baseball/{NAME}.json", "w"))
print(meta)
