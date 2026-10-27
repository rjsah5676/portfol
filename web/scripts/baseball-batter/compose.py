"""
렌더 패스 → 층 atlas
  python3 scripts/baseball-batter/compose.py <렌더 폴더> <out.png> [미리보기.png]
층 순서: fixed(외곽선 · 신발 · 머리카락 · 장갑 · 하이라이트) / team / helm / skin / pants / dark / bat
색 층은 명암(회색)만 — 게임에서 팀색 · 피부 · 배트색을 곱해서 칠함
"""
import json
import sys
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
PREV = sys.argv[3] if len(sys.argv) > 3 else None
meta = json.load(open(f"{SRC}/meta.json"))
SS = meta["SS"]
N = len(meta["frames"])
TINT = {1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6}  # 재질 id → 층
FIXED = {10, 11, 12, 13, 14, 15, 16}


def load(i, p):
    # 모델은 「+x = 플레이트」 왼손 좌표로 만들어서, 오른손 좌표(three.js)로 그리면 거울상 → 좌우 뒤집어 바로잡음
    return np.asarray(Image.open(f"{SRC}/{i:02d}.{p}.png").convert("RGBA"))[:, ::-1].astype(np.float32) / 255


def fx(x):
    return meta["W"] - x


def down(a):
    h, w = a.shape[:2]
    return a.reshape(h // SS, SS, w // SS, SS, *a.shape[2:]).mean((1, 3))


frames = []
for i in range(N):
    idp = load(i, "id")
    ids = np.where(idp[..., 3] > 0.5, np.round(idp[..., 0] * 255 / 10), 0).astype(int)
    shade = load(i, "shade")[..., 0]
    spec = load(i, "spec")[..., 0]
    col = load(i, "col")[..., :3]
    L = []
    # 고정층: 색 + 하이라이트(헬멧 · 신발 · 배트 반짝)
    fm = np.isin(ids, list(FIXED)).astype(np.float32)
    a = down(fm)
    rgb = down(col * fm[..., None]) / np.maximum(a[..., None], 1e-6)
    hl = np.clip((spec - 0.18) * 1.1, 0, 0.7) * np.isin(ids, [2, 6, 11]).astype(np.float32)
    hla = down(hl)
    rgb = rgb * (1 - hla[..., None]) * (a[..., None] > 0) + hla[..., None] * 1.0
    a = np.maximum(a, hla)
    L.append(np.dstack([rgb, a]))
    for mid in range(1, 7):
        m = (ids == mid).astype(np.float32)
        a = down(m)
        g = down(shade * m) / np.maximum(a, 1e-6)
        L.append(np.dstack([g, g, g, a]))
    frames.append(np.stack(L))

allm = np.zeros(frames[0].shape[1:3], bool)
for f in frames:
    allm |= f[..., 3].max(0) > 0.02
ys, xs = np.nonzero(allm)
y0, y1, x0, x1 = ys.min() - 2, ys.max() + 3, xs.min() - 2, xs.max() + 3
CW, CH = int(x1 - x0), int(y1 - y0)
atlas = np.zeros((7 * CH, CW * N, 4), np.float32)
out = []
for i, (f, fm) in enumerate(zip(frames, meta["frames"])):
    for li in range(7):
        atlas[li * CH:(li + 1) * CH, i * CW:(i + 1) * CW] = f[li, y0:y1, x0:x1]
    o = fm["origin"]
    rec = dict(name=fm["name"], ax=round(fx(o[0]) - x0, 1), ay=round(o[1] - y0, 1), tip=[round(fx(fm["tip"][0]) - x0, 1), round(fm["tip"][1] - y0, 1)])
    if fm["back"] > 0.45:
        rec["num"] = [round(fx(fm["num"][0]) - x0, 1), round(fm["num"][1] - y0, 1), round(-(fm["numUp"][0] - fm["num"][0]), 1), round(fm["numUp"][1] - fm["num"][1], 1)]
    out.append(rec)
Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(OUT, optimize=True)
print(json.dumps(dict(CW=CW, CH=CH, frames=out), ensure_ascii=False))

if PREV:
    cols = {1: (232, 112, 44), 2: (30, 40, 70), 3: (240, 196, 160), 4: (244, 244, 248), 5: (40, 38, 52), 6: (210, 158, 90)}
    tiles = []
    for i in range(N):
        acc = np.zeros((CH, CW, 4), np.float32)
        for li in range(1, 7):
            lay = atlas[li * CH:(li + 1) * CH, i * CW:(i + 1) * CW]
            c = np.array(cols[li]) / 255
            a = lay[..., 3:4]
            acc[..., :3] = acc[..., :3] * (1 - a) + lay[..., :3] * c * a
            acc[..., 3:4] = acc[..., 3:4] + a * (1 - acc[..., 3:4])
        f = atlas[:CH, i * CW:(i + 1) * CW]
        a = f[..., 3:4]
        acc[..., :3] = acc[..., :3] * (1 - a) + f[..., :3] * a
        acc[..., 3:4] = acc[..., 3:4] + a * (1 - acc[..., 3:4])
        tiles.append(acc)
    cols_n = 7
    rows = (N + cols_n - 1) // cols_n
    g = np.zeros((rows * CH, cols_n * CW, 3), np.float32)
    g[:] = (0.25, 0.4, 0.28)
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols_n)
        a = t[..., 3:4]
        g[r * CH:(r + 1) * CH, c * CW:(c + 1) * CW] = g[r * CH:(r + 1) * CH, c * CW:(c + 1) * CW] * (1 - a) + t[..., :3] * a
    Image.fromarray((g * 255).astype(np.uint8)).save(PREV)
