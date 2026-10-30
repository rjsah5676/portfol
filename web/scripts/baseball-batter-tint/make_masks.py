"""
타자 그림 팀색 마스크 만들기 — 주황 유니폼(헬멧 · 소매 · 양말) 자리를 찾아 batter-{이름}-tint.webp 로 저장 (원래 크기 · 무손실).
  R = 헬멧 명암 · G = 팀(소매 · 양말) 명암 · B = 0 / A = 그 자리 비중 (가장자리는 부드럽게)
  명암 = 밝기 / 기준 밝기 (주황 기본 = 1)
게임은 칸마다: 원래 그림 → 마스크 명암 × 팀색을 그 비중만큼 덮어 칠함 (src/lib/baseball/batterSprite.ts)
헬멧 = 칸마다 주황 덩어리 중 그림 위쪽 30% 안에 무게중심이 있는 것.

python3 scripts/baseball-batter-tint/make_masks.py   (public/baseball/sprites 에 씀)
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), "../..")
SPR = os.path.join(ROOT, "public/baseball/sprites")
DATA = os.path.join(ROOT, "src/data/baseball")
REF = 0.96  # 주황 유니폼 기본 밝기 (max 채널)

def hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    h = np.zeros_like(mx)
    dd = np.maximum(d, 1e-6)
    h = np.where(mx == r, ((g - b) / dd) % 6, h)
    h = np.where(mx == g, (b - r) / dd + 2, h)
    h = np.where(mx == b, (r - g) / dd + 4, h)
    h = np.where(d == 0, 0, h) * 60
    return h, s, mx

def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def make(name):
    meta = json.load(open(os.path.join(DATA, f"batter-{name}.json")))
    im = Image.open(os.path.join(SPR, f"batter-{name}.webp")).convert("RGBA")
    a = np.asarray(im).astype(np.float32) / 255
    h, s, v = hsv(a[..., :3])
    alpha = a[..., 3]
    # 주황 유니폼 픽셀만 (픽셀 단위로 엄격하게 — 피부 · 흰 옷 · 외곽선으로 번지지 않게)
    hr = np.where(h > 300, h - 360, h)  # 빨강 쪽(소매 줄무늬 · 그늘)은 음수로 이어서
    hw = ss(-14, -6, hr) * (1 - ss(33, 38, hr))
    w = hw * ss(0.58, 0.72, s) * ss(0.08, 0.16, v) * (alpha > 0.5)
    # 양말 · 소매 안의 밝은 주름 줄 (노란 기 · 채도 조금 낮음): 유니폼으로 둘러싸인 가는 틈만
    inner = ndimage.binary_closing(w > 0.5, iterations=2) & ~(w > 0.5)
    stripe = inner & (h > 8) & (h < 50) & (s > 0.42) & (v > 0.55)
    w = np.where(stripe, np.maximum(w, 0.9), w)
    # 방망이 그늘 쪽: 밝은 나무색(채도 중간) 큰 덩어리 바로 옆의 얇은 주황 띠는 뺌
    wood = (h > 18) & (h < 48) & (s > 0.2) & (s < 0.6) & (v > 0.72) & (alpha > 0.5)
    wl, wn = ndimage.label(wood)
    if wn:
        sz = ndimage.sum(wood, wl, range(1, wn + 1))
        wood = np.isin(wl, [i + 1 for i in range(wn) if sz[i] >= 150])
    # 방망이: 밝은 나무 덩어리의 축을 따라 막대 모양 띠 (나무 폭의 2.2배 · 양끝 조금 더) 안은 칠하지 않음
    #   (그늘진 쪽 나무가 주황 유니폼과 색이 겹쳐서 픽셀 색으로는 못 가름)
    batband = np.zeros_like(w, dtype=bool)
    wl, wn = ndimage.label(wood)
    for sl, i in zip(ndimage.find_objects(wl), range(1, wn + 1)):
        yy, xx = np.where(wl[sl] == i)
        if len(yy) < 150:
            continue
        yy = yy + sl[0].start
        xx = xx + sl[1].start
        P = np.vstack([xx, yy]).astype(np.float64)
        mu = P.mean(axis=1, keepdims=True)
        ev, evec = np.linalg.eigh(np.cov(P))
        if ev[0] <= 0 or np.sqrt(ev[1] / ev[0]) < 2.5:
            continue  # 막대 모양 아님 (헬멧 하이라이트 등)
        ax = evec[:, 1]
        nrm = np.array([-ax[1], ax[0]])
        al = ax @ (P - mu)
        pe = nrm @ (P - mu)
        half = np.percentile(np.abs(pe), 92) * 1.9 + 2
        a0, a1 = al.min() - 12, al.max() + 12
        y0b, y1b = max(0, int(yy.min() - 60)), min(w.shape[0], int(yy.max() + 60))
        x0b, x1b = max(0, int(xx.min() - 60)), min(w.shape[1], int(xx.max() + 60))
        gy, gx = np.mgrid[y0b:y1b, x0b:x1b]
        dx, dy = gx - mu[0, 0], gy - mu[1, 0]
        A = dx * ax[0] + dy * ax[1]
        N = dx * nrm[0] + dy * nrm[1] - np.median(pe)
        batband[y0b:y1b, x0b:x1b] |= (np.abs(N) < half) & (A > a0) & (A < a1)
    # 띠 안에서도 진한 유니폼(채도 0.9+, 헬멧 · 소매)은 남기고 덜 진한 나무 그늘 · 나무 바로 옆만 지움
    near_wood3 = ndimage.distance_transform_edt(~wood) <= 1.5
    w = np.where(batband & ((s < 0.84) | near_wood3), 0, w)
    # 어깨 줄무늬 (흰 상의 위 연한 주황 가는 줄): 작은 덩어리 · 소매에 붙어 있는 것만 (피부는 큰 덩어리라 빠짐)
    pale = (hw > 0.5) & (s > 0.26) & (s < 0.62) & (v > 0.6) & (alpha > 0.5) & (w < 0.5) & ~batband
    pl, pn = ndimage.label(pale)
    if pn:
        nearteam = ndimage.binary_dilation(w > 0.5, iterations=3)
        sz = ndimage.sum(pale, pl, range(1, pn + 1))
        touch = ndimage.maximum(nearteam, pl, range(1, pn + 1))
        keep = [i + 1 for i in range(pn) if sz[i] < 90 and touch[i]]
        w = np.where(np.isin(pl, keep), np.maximum(w, 0.85), w)
    shade = np.clip(v / REF, 0, 1)
    helm = np.zeros_like(w)
    CW, CH, cols, n = meta["CW"], meta["CH"], meta.get("cols", meta["n"]), meta["n"]
    for c in range(n):
        x0, y0 = (c % cols) * CW, (c // cols) * CH
        cw = w[y0:y0 + CH, x0:x0 + CW]
        ca = alpha[y0:y0 + CH, x0:x0 + CW]
        ys = np.where(ca.max(axis=1) > 0.5)[0]
        if not len(ys):
            continue
        top, bot = ys[0], ys[-1]
        # 가는 연결(헬멧-소매-방망이 맞닿음)을 끊으려고 깎아서 덩어리 나누고, 나눈 번호를 원래 모양으로 다시 넓힘
        core = ndimage.binary_erosion(cw > 0.35, iterations=2)
        lab, k = ndimage.label(core)
        if not k:
            continue
        _, (iy, ix) = ndimage.distance_transform_edt(lab == 0, return_indices=True)
        near = lab[iy, ix]
        # 방망이 = 길쭉한 덩어리 (주성분 비 3.5+ · 짧은 축이 가늘다) → 마스크에서 뺌 (진한 나무 그늘이 주황과 색이 겹침)
        bat = []
        for i in range(1, k + 1):
            yy, xx = np.where(lab == i)
            if len(yy) < 60:
                if yy.mean() < top + (bot - top) * 0.5:
                    bat.append(i)  # 위쪽 자잘한 조각 (방망이 그늘 점) 도 뺌
                continue
            ev = np.sort(np.linalg.eigvalsh(np.cov(np.vstack([xx, yy]))))
            # 방망이는 그림 위쪽 절반 안 (다리 든 자세의 가는 양말이 걸리지 않게)
            if ev[0] > 0 and np.sqrt(ev[1] / ev[0]) > 3.5 and np.sqrt(ev[0]) < 6 and np.sqrt(ev[1]) > 18 and yy.mean() < top + (bot - top) * 0.5:
                bat.append(i)
        if bat:
            kill = np.isin(near, bat) & (cw > 0.02)
            # 방망이 줄 위 나머지 조각(끝 · 그늘)도: 가장 긴 길쭉한 덩어리의 축을 늘린 띠 안 · 유니폼보다 어두운 곳
            longs = [i for i in bat if (lab == i).sum() >= 60]
            if longs:
                bi = max(longs, key=lambda i: (lab == i).sum())
                yy, xx = np.where(lab == bi)
                mxy = np.array([xx.mean(), yy.mean()])
                ev, evec = np.linalg.eigh(np.cov(np.vstack([xx, yy])))
                ax = evec[:, 1]
                L = np.sqrt(ev[1]) * 2.6
                gy, gx = np.mgrid[0:CH, 0:CW]
                dx, dy = gx - mxy[0], gy - mxy[1]
                along = dx * ax[0] + dy * ax[1]
                perp = np.abs(-dx * ax[1] + dy * ax[0])
                band = (perp < 8) & (np.abs(along) < L) & (gy < top + (bot - top) * 0.4)
                kill |= band & (v[y0:y0 + CH, x0:x0 + CW] < 0.92) & (cw > 0.02)
            w[y0:y0 + CH, x0:x0 + CW][kill] = 0
            cw = w[y0:y0 + CH, x0:x0 + CW]
            for i in bat:
                core[lab == i] = False
            lab, k = ndimage.label(core)
            if not k:
                continue
            _, (iy, ix) = ndimage.distance_transform_edt(lab == 0, return_indices=True)
            near = lab[iy, ix]
        sizes = ndimage.sum(core, lab, range(1, k + 1))
        cys = ndimage.center_of_mass(core, lab, range(1, k + 1))
        big = [i + 1 for i in range(k) if sizes[i] >= max(40, sizes.max() * 0.2)]
        # 헬멧 = 큰 덩어리 중 무게중심이 가장 위 (그림 위쪽 45% 안)
        hid = min(big, key=lambda i: cys[i - 1][0])
        if cys[hid - 1][0] > top + (bot - top) * 0.45:
            continue
        hy = np.where(lab == hid)[0]
        dist = ndimage.distance_transform_edt(lab != hid)
        # 헬멧 옆 덩어리(방망이에 가려 나뉜 뒤쪽 · 그늘)도 헬멧: 30px 안 · 무게중심이 헬멧 높이 안
        ids = {hid}
        for i in range(1, k + 1):
            if i == hid:
                continue
            if dist[lab == i].min() < 30 and hy.min() - 5 <= cys[i - 1][0] <= hy.max():
                ids.add(i)
        m = (cw > 0.02) & np.isin(near, list(ids))
        helm[y0:y0 + CH, x0:x0 + CW][m] = cw[m]
        # 헬멧 무게중심보다 위에 있는 나머지 덩어리 = 방망이 끝 (유니폼은 늘 헬멧 아래)
        hcy = cys[hid - 1][0]
        for i in range(1, k + 1):
            if i not in ids and cys[i - 1][0] < hcy:
                kill2 = (near == i) & (cw > 0.02)
                w[y0:y0 + CH, x0:x0 + CW][kill2] = 0
    team = np.where(helm > 0, 0, w)
    g = (shade * 255).astype(np.uint8)
    wt = np.clip(team + helm, 0, 1)
    out = np.dstack([np.where(helm > 0, g, 0), np.where(helm > 0, 0, g), np.zeros_like(g), (wt * 255).astype(np.uint8)])
    out[out[..., 3] == 0, :3] = 0
    img = Image.fromarray(out.astype(np.uint8), "RGBA")
    img.save(os.path.join(SPR, f"batter-{name}-tint.webp"), lossless=True, method=6)
    print(name, im.size, "팀", int((team > 0.5).sum()), "헬멧", int((helm > 0.5).sum()))

for nm in sys.argv[1:] or ["idle", "load", "swing", "walkin"]:
    make(nm)
