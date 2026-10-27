"""
스윙 줄 만들기: 한 시트에서 뽑은 스윙 칸들(1칸 = 레그킥 최고점) → 레그킥 최고점과 같은 배율 · 같은 기준점(축발)
  python3 scripts/baseball-batter-swing.py <이름> <시트.png>
- 칸 나누기: 배트가 옆 칸과 세로로 겹칠 수 있어서 빈 열 대신 덩어리(연결 성분) 5개를 x 순서로
- 배율: 시트 전체가 한 배율 — 1칸(최고점) 몸 키(헬멧 꼭대기 → 땅)를 레그킥 줄 마지막 칸 몸 키에 맞춤
- 기준점: 칸마다 맨 아래 30px 안 불투명 범위 가운데 (= 축발, 스윙 내내 가장 아래 있는 발)
- 신발 색은 대기 1칸 신발 색으로 (레그킥 줄과 같은 방식)
"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

NAME, SRC = sys.argv[1], sys.argv[2]
NCELL = int(sys.argv[3]) if len(sys.argv) > 3 else 5
s = open("scripts/baseball-char-art.py").read()
ns = {"np": np, "Image": Image, "ndimage": ndimage}
exec(s[s.index("def key(path):"):s.index("rgb, al = key(full)")], ns)
L = open("scripts/baseball-batter-load.py").read()
exec(L[L.index("def helmet_top("):L.index("idm = json.load")], ns)
exec(L[L.index("def shoe_mask("):L.index("# 신발 색 맞추기")], ns)
helmet_top, shoe_mask = ns["helmet_top"], ns["shoe_mask"]


def anchor(al):
    bot = int(np.where((al > 0.5).any(1))[0].max())
    xs = np.where((al[max(0, bot - 30):bot + 1] > 0.5).any(0))[0]
    return (xs.min() + xs.max()) / 2, bot


rgb, al = ns["key"](SRC)
m = ndimage.binary_dilation(al > 0.3, iterations=2)
lab, n = ndimage.label(m)
sz = ndimage.sum(m, lab, range(1, n + 1))
big = sorted([int(i) + 1 for i in np.argsort(sz)[::-1][:NCELL]], key=lambda k: np.where(lab == k)[1].mean())
cells = []
for k in big:
    mk = lab == k
    ys, xs = np.where(mk)
    sl = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
    cells.append((rgb[sl], (al * mk)[sl]))

# 레그킥 줄 마지막 칸(최고점) 몸 키
lm = json.load(open("src/data/baseball/batter-load.json"))
lk = np.asarray(Image.open("public/baseball/sprites/batter-load.webp").convert("RGBA")).astype(np.float32) / 255
top = lk[:, (lm["n"] - 1) * lm["CW"]:lm["n"] * lm["CW"]]
ref_body = anchor(top[..., 3])[1] - helmet_top(top[..., :3], top[..., 3])
r0, a0 = cells[0]
k = ref_body / (anchor(a0)[1] - helmet_top(r0, a0))
print("scale", round(k, 3))

idm = json.load(open("src/data/baseball/batter-idle.json"))
idle = np.asarray(Image.open("public/baseball/sprites/batter-idle.webp").convert("RGBA")).astype(np.float32)
c0 = idle[:, :idm["CW"]]
ref_shoe = np.median(c0[..., :3][shoe_mask(c0)], 0)

frames = []
for r, a in cells[1:]:  # 1칸(최고점)은 레그킥 줄 것을 그대로 쓰므로 뺌
    ax, ay = anchor(a)
    im = Image.fromarray((np.dstack([r, a]) * 255).round().astype(np.uint8), "RGBA")
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    arr = np.asarray(im).astype(np.float32)
    sm = shoe_mask(arr)
    if sm.sum() > 50:
        arr[..., :3][sm] = np.clip(arr[..., :3][sm] * (ref_shoe / np.maximum(np.median(arr[..., :3][sm], 0), 1)), 0, 255)
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
