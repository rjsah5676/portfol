# GPT 픽셀 시트(gptok/bt_{act}_d{d}.png) → 렌더 512 좌표 프레임 + 팀색 마스크 (bk_gpt/)
#  - 칸마다 렌더 실루엣에 맞춰 크기(시트당 하나) · 위치(칸마다) 정렬
#  - 마젠타 · 빨강 = 팀색 자리 → 회색 명암으로 (게임이 팀 색 × 밝기로 칠함), 마스크 흰색
#  - 피부색 시트끼리 맞춤 · 초록 번짐 제거 · d5/d6/d7 = d3/d2/d1 좌우 반전
import os, sys, json, numpy as np
from PIL import Image
from multiprocessing import Pool
SRC, REN, OUT = sys.argv[1:4] if len(sys.argv) > 3 else ('gptok', 'bk_bt100', 'bk_gpt')
os.makedirs(OUT, exist_ok=True)
meta = json.load(open(f'{REN}/meta.json'))
COLS = {4: 4, 6: 3, 8: 4}
def key(im):
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    k = (g - np.maximum(r, b)) / 255
    a = k < 0.28
    im = im.copy(); im[..., 1] = np.where(a & (k > 0.02), np.maximum(r, b), g)  # 초록 번짐
    return im, a
def hsv(rgb):
    mx = rgb.max(-1); mn = rgb.min(-1); d = np.maximum(mx - mn, 1e-6)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return h, (mx - mn) / np.maximum(mx, 1e-6), mx, (mx + mn) / 2
def skinsel(rgb):
    h, s, v, _ = hsv(rgb)
    return (h > 10) & (h < 45) & (s > .2) & (s < .75) & (v > .45)
REF = np.asarray(Image.open(f'{SRC}/bt_run_d2.png').convert('RGB')).astype(np.float32) / 255
_, ra = key(REF * 255); REFSKIN = REF[skinsel(REF) & ra].mean(0)

def place(cell, a, s, dx, dy, S):
    """cell(h,w) → S×S 렌더 좌표: 칸 가로 = S*s, 가운데 + (dx,dy)"""
    ch, cw = a.shape
    w = max(1, int(round(S * s))); h = max(1, int(round(S * s * ch / cw)))
    A = np.asarray(Image.fromarray(a.astype(np.uint8) * 255).resize((w, h), Image.NEAREST)) > 127
    o = np.zeros((S, S), bool)
    x0 = S // 2 - w // 2 + dx; y0 = S // 2 - h // 2 + dy
    xs0, ys0 = max(0, x0), max(0, y0); xs1, ys1 = min(S, x0 + w), min(S, y0 + h)
    if xs1 > xs0 and ys1 > ys0:
        o[ys0:ys1, xs0:xs1] = A[ys0 - y0:ys1 - y0, xs0 - x0:xs1 - x0]
    return o
def iou(a, b): return (a & b).sum() / max(1, (a | b).sum())
def fitcell(a, ren, s, S):
    m = place(None, a, s, 0, 0, S)
    ys, xs = np.where(m); yr, xr = np.where(ren)
    dx0, dy0 = int(round(xr.mean() - xs.mean())), int(round(yr.mean() - ys.mean()))
    best = (-1, 0, 0)
    for dy in range(dy0 - 10, dy0 + 11):
        for dx in range(dx0 - 10, dx0 + 11):
            v = iou(place(None, a, s, dx, dy, S), ren)
            if v > best[0]: best = (v, dx, dy)
    return best

def job(args):
    act, d = args
    n = meta['acts'][act]['n']; cols = COLS[n]; rows = (n + cols - 1) // cols
    im = np.asarray(Image.open(f'{SRC}/bt_{act}_d{d}.png').convert('RGB')).astype(np.float32)
    im, al = key(im)
    H, W = al.shape; cw, ch = W / cols, H / rows
    cells = []
    for i in range(n):
        x0, y0 = int((i % cols) * cw), int((i // cols) * ch)
        cells.append((im[y0:int(y0 + ch), x0:int(x0 + cw)] / 255, al[y0:int(y0 + ch), x0:int(x0 + cw)]))
    S = 128
    rens = [np.asarray(Image.open(f'{REN}/{act}_d{d}_f{i}.png').convert('RGBA').resize((S, S), Image.BOX))[..., 3] > 128 for i in range(n)]
    # 크기: 시트 하나
    sc = []
    for i in (0, n // 2):
        sc.append(max((fitcell(cells[i][1], rens[i], s, S)[0], s) for s in np.arange(0.70, 0.97, 0.03))[1])
    s = float(np.mean(sc))
    # 위치: 칸마다 (128 → 256 다듬기)
    S2 = 256
    out = []
    for i in range(n):
        v, dx, dy = fitcell(cells[i][1], rens[i], s, S)
        ren2 = np.asarray(Image.open(f'{REN}/{act}_d{d}_f{i}.png').convert('RGBA').resize((S2, S2), Image.BOX))[..., 3] > 128
        best = (-1, 0, 0)
        for ddy in range(-2, 3):
            for ddx in range(-2, 3):
                q = iou(place(None, cells[i][1], s, dx * 2 + ddx, dy * 2 + ddy, S2), ren2)
                if q > best[0]: best = (q, dx * 2 + ddx, dy * 2 + ddy)
        out.append(best)
    # 색
    allrgb = np.concatenate([c[0][c[1]] for c in cells])
    sk = skinsel(allrgb)
    skd = REFSKIN - allrgb[sk].mean(0) if sk.sum() > 50 else np.zeros(3)
    res = []
    for i in range(n):
        rgb, a = cells[i]
        rgb = rgb.copy()
        ssel = skinsel(rgb) & a
        rgb[ssel] = np.clip(rgb[ssel] + skd, 0, 1)
        h, sat, v, L = hsv(rgb)
        team = a & (sat > .35) & (v > .18) & (((h > 265) & (h < 345)) | (((h < 18) | (h >= 345)) & (sat > .45)))
        g = np.clip(138 * (L / 0.5) / 255 * 1.0, 0, 1)  # 기준 마젠타(밝기 .5) → 회색 138
        rgb[team] = g[team][:, None]
        # 512 좌표로 (NEAREST — GPT 픽셀 그대로)
        _, dx, dy = out[i]
        S5 = 512; k = S5 / S2
        ch_, cw_ = a.shape
        w = int(round(S5 * s)); hh = int(round(S5 * s * ch_ / cw_))
        rgba = np.dstack([rgb * 255, a * 255]).astype(np.uint8)
        big = Image.fromarray(rgba, 'RGBA').resize((w, hh), Image.NEAREST)
        mk = Image.fromarray(np.dstack([team * 255] * 3 + [a * 255]).astype(np.uint8), 'RGBA').resize((w, hh), Image.NEAREST)
        cv = Image.new('RGBA', (S5, S5)); mv = Image.new('RGBA', (S5, S5))
        x0 = int(S5 // 2 - w // 2 + dx * k); y0 = int(S5 // 2 - hh // 2 + dy * k)
        cv.paste(big, (x0, y0)); mv.paste(mk, (x0, y0))
        res.append((cv, mv))
    for i, (cv, mv) in enumerate(res):
        cv.save(f'{OUT}/{act}_d{d}_f{i}.png'); mv.save(f'{OUT}/{act}_d{d}_f{i}_m.png')
        if d in (1, 2, 3):
            md = 8 - d
            cv.transpose(Image.FLIP_LEFT_RIGHT).save(f'{OUT}/{act}_d{md}_f{i}.png')
            mv.transpose(Image.FLIP_LEFT_RIGHT).save(f'{OUT}/{act}_d{md}_f{i}_m.png')
    return f'{act}_d{d} s={s:.3f} iou=' + ' '.join(f'{o[0]:.2f}' for o in out) + f' skin{np.round(skd*255).astype(int)}'

if __name__ == '__main__':
    jobs = [(a, d) for a in meta['acts'] for d in range(5)]
    with Pool(os.cpu_count()) as p:
        for r in p.imap_unordered(job, jobs): print(r, flush=True)
    json.dump(meta, open(f'{OUT}/meta.json', 'w'))
