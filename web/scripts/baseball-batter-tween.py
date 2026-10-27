"""
스프라이트 줄 사이에 중간 장 채우기 (광류로 이웃한 두 장을 서로 쪽으로 당겨 섞음)
  python3 scripts/baseball-batter-tween.py <이름> <칸별 사이 장 수, 예: 2,1>
  → public/baseball/sprites/<이름>.webp · -mask.png · src/data/baseball/<이름>.json 을 덮어씀
- 윤곽(알파)은 가까운 한 장 것만 써서 겹친 잔상이 안 생기게, 색은 둘 다 있는 곳만 섞음
- 출력 자리에서 거꾸로 찾아가기(a는 p - t·흐름) → 움직인 끝(배트 끝 등)에 옛 자리가 남지 않음
"""
import json, sys
import cv2
import numpy as np
from PIL import Image

NAME, GAPS = sys.argv[1], [int(k) for k in sys.argv[2].split(",")]
SP = f"public/baseball/sprites/{NAME}"
meta = json.load(open(f"src/data/baseball/{NAME}.json")); CW, CH = meta["CW"], meta["CH"]
im = np.asarray(Image.open(f"{SP}.webp").convert("RGBA")).astype(np.float32)
mk = np.asarray(Image.open(f"{SP}-mask.png").convert("RGBA")).astype(np.float32)
n = meta["n"]
cells = [im[:, i * CW:(i + 1) * CW] for i in range(n)]
mcs = [mk[:, i * CW:(i + 1) * CW] for i in range(n)]
assert len(GAPS) == n - 1, "사이 장 수는 칸 수 - 1 개"


def feat(c):
    a = c[..., 3] / 255
    return np.clip(c[..., :3].mean(-1) * a + (1 - a) * 40, 0, 255).astype(np.uint8)


def flow(a, b):
    f = cv2.calcOpticalFlowFarneback(feat(a), feat(b), None, 0.5, 5, 21, 5, 7, 1.5, 0)
    return np.dstack([cv2.GaussianBlur(f[..., k], (0, 0), 3) for k in range(2)])


yy, xx = np.mgrid[0:CH, 0:CW].astype(np.float32)
rm = lambda c, f, t: cv2.remap(c, xx + f[..., 0] * t, yy + f[..., 1] * t, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)

outs = [(cells[0], mcs[0])]
for i, g in enumerate(GAPS):
    a, b = cells[i], cells[i + 1]
    fab, fba = flow(a, b), flow(b, a)
    for k in range(1, g + 1):
        t = k / (g + 1)
        wa, wb = rm(a, -fab, t), rm(b, -fba, 1 - t)
        near = wa if t < 0.5 else wb
        both = (wa[..., 3:4] > 200) & (wb[..., 3:4] > 200)
        o = np.where(both, wa * (1 - t) + wb * t, near); o[..., 3] = near[..., 3]
        mm = rm(mcs[i], -fab, t) if t < 0.5 else rm(mcs[i + 1], -fba, 1 - t); mm[..., 3] = 255
        outs.append((o, mm))
    outs.append((b, mcs[i + 1]))
Image.fromarray(np.hstack([o for o, _ in outs]).clip(0, 255).round().astype(np.uint8), "RGBA").save(f"{SP}.webp", quality=92, method=6)
Image.fromarray(np.hstack([m for _, m in outs]).clip(0, 255).round().astype(np.uint8), "RGBA").save(f"{SP}-mask.png", optimize=True)
meta["n"] = len(outs)
json.dump(meta, open(f"src/data/baseball/{NAME}.json", "w"))
print(meta)
