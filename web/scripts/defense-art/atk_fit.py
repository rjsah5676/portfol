"""공격 그림 맞추기 — slice.py 로 자른 공격 그림을 서 있기 그림과 같은 키 · 같은 발 위치로
  python3 atk_fit.py <자른 폴더> <units 폴더> id1 id2 ...
  → units/<id>-atk.webp (160×160). 키는 서 있기 그림의 몸 높이에 맞추고(무기가 칸 밖으로 나가면 조금 줄임),
    가로는 아래 40%(다리 · 몸통) 무게중심을 서 있기 그림과 같은 자리에 둠 → 공격할 때 캐릭터가 제자리에서 휘두름.
"""
import sys, os, numpy as np
from PIL import Image

src_dir, units = sys.argv[1], sys.argv[2]
ids = sys.argv[3:]
S = 160


def stats(im):
    a = np.array(im)[:, :, 3] > 40
    ys, xs = np.nonzero(a)
    top, bot = ys.min(), ys.max()
    h = bot - top + 1
    low = a[bot - int(h * 0.4):bot + 1]
    ly, lx = np.nonzero(low)
    return top, bot, h, lx.mean(), xs.min(), xs.max()


for i in ids:
    idle = Image.open(f'{units}/{i}.webp').convert('RGBA')
    atk = Image.open(f'{src_dir}/{i}.webp').convert('RGBA')
    t0, b0, h0, c0, _, _ = stats(idle)
    a = np.array(atk)[:, :, 3] > 40
    ys, xs = np.nonzero(a)
    crop = atk.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    _, _, h1, c1, _, _ = stats(crop)
    k = h0 / h1
    # 칸 안에 들어오게 (너무 넓으면 줄임, 최대 12%)
    k = max(k * 0.88, min(k, S / crop.width))
    spr = crop.resize((max(1, round(crop.width * k)), max(1, round(crop.height * k))), Image.LANCZOS)
    cx = c1 * k  # 스프라이트 안 다리 중심
    x = round(c0 - cx)
    x = max(0, min(x, S - spr.width)) if spr.width <= S else round((S - spr.width) / 2)
    y = b0 + 1 - spr.height
    cv = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    cv.paste(spr, (x, y), spr)
    cv.save(f'{units}/{i}-atk.webp', quality=92, method=6)
    print(i, f'k={k:.2f}', f'x={x}', f'y={y}', spr.size)
