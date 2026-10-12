"""스프라이트 시트 자르기
  python3 slice.py sheet.png 4,4 id1 id2 ... --out DIR [--size 160] [--foot 0.04] [--fill 0.9]
행마다 캐릭터 수(layout)를 주면, 알파가 가장 적은 가로/세로 줄을 경계로 칸을 나눔(캐릭터끼리 닿아 있어도 됨).
칸 안에서 가장 큰 덩어리 + 가까운 조각만 남겨 정사각 size×size 로 (발은 아래 foot 비율 · 가로 가운데).
"""
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage

args = sys.argv[1:]
def opt(k, d):
    return args[args.index(k) + 1] if k in args else d
out = opt('--out', 'out'); size = int(opt('--size', 160)); foot = float(opt('--foot', 0.04)); fill = float(opt('--fill', 0.9))
pos = []
skip = False
for a in args:
    if skip: skip = False; continue
    if a.startswith('--'): skip = True; continue
    pos.append(a)
src, layout, ids = pos[0], [int(x) for x in pos[1].split(',')], pos[2:]
N = sum(layout); assert len(ids) == N, (len(ids), N)
A = np.array(Image.open(src).convert('RGBA'))
alpha = (A[:, :, 3] > 24).astype(np.int32)
H, W = alpha.shape; R = len(layout)

def cut(profile, n, lo, hi):
    """profile 에서 n 등분 경계 근처의 최소 지점들"""
    L = hi - lo; cuts = [lo]
    for k in range(1, n):
        e = lo + L * k / n; w = L / n * 0.35
        a, b = int(e - w), int(e + w)
        seg = profile[a:b]
        # 최소값 구간의 가운데
        mn = seg.min(); idxs = np.nonzero(seg == mn)[0]
        cuts.append(a + int(idxs[len(idxs) // 2]))
    cuts.append(hi)
    return cuts

rcuts = cut(alpha.sum(1), R, 0, H)
os.makedirs(out, exist_ok=True)
tiles = []; i = 0
for r, c in enumerate(layout):
    y0, y1 = rcuts[r], rcuts[r + 1]
    band = alpha[y0:y1]
    xs = np.nonzero(band.sum(0))[0]
    # 가운데 정렬된 줄(캐릭터 수가 적은 줄)은 실제 내용 범위 안에서 나눔
    lo, hi = (xs.min(), xs.max() + 1) if c < max(layout) else (0, W)
    ccuts = cut(band.sum(0), c, lo, hi)
    for j in range(c):
        x0, x1 = ccuts[j], ccuts[j + 1]
        cell = A[y0:y1, x0:x1].copy()
        soft = cell[:, :, 3] > 8
        m = cell[:, :, 3] > 110
        # 옆 칸 캐릭터에서 넘어온 조각(칸 좌우 끝에 닿은 작은 덩어리) 지우기
        l0, n0 = ndimage.label(m)
        if n0:
            a0 = ndimage.sum(m, l0, range(1, n0 + 1))
            sl = ndimage.find_objects(l0)
            for k0, s0 in enumerate(sl):
                if s0 and (s0[1].start <= 1 or s0[1].stop >= m.shape[1] - 1) and a0[k0] < a0.max() * 0.2:
                    m[l0 == k0 + 1] = False
        lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=2))
        if n == 0:
            raise SystemExit(f'empty cell {ids[i]}')
        areas = ndimage.sum(m, lab, range(1, n + 1))
        big = int(np.argmax(areas)) + 1
        # 큰 덩어리 + 면적이 그 3% 이상인 덩어리 (오라 · 무기 조각)
        def edge(k):
            ys, xs = np.nonzero(lab == k)
            return xs.min() <= 1 or xs.max() >= lab.shape[1] - 2
        keep = [k + 1 for k, a in enumerate(areas) if k + 1 == big or (a >= areas.max() * 0.03 and not edge(k + 1))]
        km = ndimage.binary_dilation(np.isin(lab, keep) & m, iterations=5) & soft
        cell[:, :, 3] = np.where(km, cell[:, :, 3], 0)
        yy, xx = np.nonzero(km)
        spr = Image.fromarray(cell[yy.min():yy.max() + 1, xx.min():xx.max() + 1])
        k = min((size * fill) / spr.height, (size * 0.98) / spr.width)
        spr = spr.resize((max(1, round(spr.width * k)), max(1, round(spr.height * k))), Image.LANCZOS)
        cv = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        cv.paste(spr, ((size - spr.width) // 2, size - round(size * foot) - spr.height), spr)
        cv.save(f'{out}/{ids[i]}.webp', quality=92, method=6)
        tiles.append(cv)
        print(ids[i], f'cell {x1-x0}x{y1-y0}', f'sprite {xx.max()-xx.min()+1}x{yy.max()-yy.min()+1}')
        i += 1
cols = max(layout)
pv = Image.new('RGBA', (cols * size, R * size), (60, 50, 90, 255))
i = 0
for r, c in enumerate(layout):
    for j in range(c):
        pv.paste(tiles[i], (j * size, r * size), tiles[i]); i += 1
pv.save(f'{out}/_preview_{os.path.splitext(os.path.basename(src))[0]}.png')
