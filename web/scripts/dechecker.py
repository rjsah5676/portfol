"""그려진 체크무늬(흰·회색) 배경 → 진짜 투명 PNG

  python3 scripts/dechecker.py 시트.png ... [--glow]   → 시트-a.png

원칙: 그림 안쪽은 건드리지 않음 (흰 피부·흰 옷·안경알이 배경색과 같아도).
  1) 바깥과 이어진 밝은 무채색만 배경 — 단, 좁은 틈(윤곽선 끊김)으로는 못 들어가게
     열기 연산으로 굵은 배경만 찾은 뒤 가장자리 몇 픽셀만 되살림
  2) 팔·다리 사이에 갇힌 배경은 '두 가지 밝기 칸이 번갈아 나오는' 체크무늬일 때만
  3) 이펙트 빛이 옅게 덮인 체크무늬도 바깥 배경에 붙어 있고 체크 질감일 때만
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage


def _jump_frac(lum, lab, n, t=12):
    dx = np.zeros_like(lum)
    dy = np.zeros_like(lum)
    dx[:, 1:] = np.where(lab[:, 1:] == lab[:, :-1], np.abs(lum[:, 1:] - lum[:, :-1]), 0)
    dy[1:] = np.where(lab[1:] == lab[:-1], np.abs(lum[1:] - lum[:-1]), 0)
    sz = ndimage.sum(np.ones_like(lum), lab, range(n + 1))
    return ndimage.sum(((dx > t) | (dy > t)).astype(float), lab, range(n + 1)) / np.maximum(sz, 1), sz


def run(src, dst, glow=False):
    a = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    mx, mn = a.max(2), a.min(2)
    lum = a.mean(2)
    bgl = (mx - mn < 18) & (mn > 188)  # 밝은 무채색 (배경 후보)
    # 체크 질감: 주변(11×11)에 회색 칸과 흰 칸이 둘 다 있는 곳 (흰 피부·옷은 한 가지 밝기라 빠짐)
    neutral = bgl & (mx - mn < 9)
    g = ndimage.uniform_filter((neutral & (lum < 236)).astype(np.float32), 11)
    w = ndimage.uniform_filter((neutral & (lum > 243)).astype(np.float32), 11)
    tex = bgl & (g > 0.12) & (w > 0.12)
    # 1) 굵은 배경만 남긴 뒤 테두리에 닿은 것
    core = ndimage.binary_opening(tex, structure=np.ones((5, 5)))
    lab, n = ndimage.label(core)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    # 가장자리 되살리기: 배경 후보 안에서만 3픽셀까지 (틈을 타고 멀리 못 감)
    for _ in range(4):
        bg = ndimage.binary_dilation(bg, np.ones((3, 3))) & bgl
    # 2) 갇힌 체크무늬
    # (여기도 좁은 틈으로 이어진 얼굴·머리까지 한 덩어리로 묶이지 않게 굵은 부분끼리만 묶음)
    rest = bgl & ~bg
    l2, n2 = ndimage.label(ndimage.binary_opening(rest, structure=np.ones((4, 4))))
    if n2:
        jf, sz = _jump_frac(lum, l2, n2)
        # 체크무늬: 회색 칸과 흰 칸이 둘 다 꽤 있고, 아주 무채색 (피부·흰 옷은 살짝 따뜻하거나 한 가지 밝기)
        grey = ndimage.sum((lum < 235).astype(float), l2, range(n2 + 1)) / np.maximum(sz, 1)
        white = ndimage.sum((lum > 243).astype(float), l2, range(n2 + 1)) / np.maximum(sz, 1)
        sat = ndimage.sum(mx - mn, l2, range(n2 + 1)) / np.maximum(sz, 1)
        ok = (sz > 220) & (jf > 0.25) & (grey > 0.2) & (white > 0.2) & (sat < 6)
        ok[0] = False
        add = ok[l2]
        for _ in range(3):
            add = ndimage.binary_dilation(add, np.ones((3, 3))) & rest
        bg |= add
    # 3) 옅은 빛이 덮인 체크무늬 (바깥 배경에 붙어 있을 때만) — --glow 일 때만 (얼굴을 먹을 수 있음)
    soft = (mn > 165) & (mx - mn < 70) & ~bg & glow
    l3, n3 = ndimage.label(soft)
    if n3:
        j3, s3 = _jump_frac(lum, l3, n3, 10)
        touch = np.zeros(n3 + 1, bool)
        ring = ndimage.binary_dilation(bg, np.ones((3, 3))) & soft
        touch[np.unique(l3[ring])] = True
        ok = (s3 > 160) & (j3 > 0.42) & touch
        ok[0] = False
        bg |= ok[l3]
    fg = ~bg
    # 부스러기 지우기
    l4, n4 = ndimage.label(fg, structure=np.ones((3, 3)))
    if n4:
        s4 = ndimage.sum(np.ones_like(lum), l4, range(1, n4 + 1))
        keep = np.zeros(n4 + 1, bool)
        keep[1:] = s4 >= 25
        fg = keep[l4]
    # 바깥 테두리: 밝은 무채색 한 겹은 반투명으로 (흰 번짐 대신 부드러운 가장자리)
    rim = fg & ~ndimage.binary_erosion(fg, np.ones((3, 3)))
    alpha = fg * 255.0
    alpha[rim & bgl] = 90
    out = np.dstack([a, alpha]).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(dst)


if __name__ == "__main__":
    glow = "--glow" in sys.argv
    for f in [a for a in sys.argv[1:] if not a.startswith("--")]:
        run(f, f.replace(".png", "-a.png"), glow)
        print(f)
