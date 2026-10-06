#!/usr/bin/env python3
"""
AI로 뽑은 격투 스프라이트 시트(단색 배경, 줄마다 동작 여러 개 섞여 있는 그림)를
게임 시트 형식(public/fight/<id>.webp + .json)으로 바꿔 준다.

  python3 scripts/import-fight-sheet.py <원본.png> <캐릭터id> [--wm x0,y0,x1,y1] [--split y]

  - 캐릭터id 가 PRESETS 에 있으면 그 배치(잘라낼 상자·칸·줄·프레임 골라 쓰기)를 씀 (kai, igna — 캐릭터 설정화 한 장)
  - 없으면 표준 배치: 12줄 = STD_ORDER 순서 동작 한 줄씩, 줄 안의 프레임 전부
    (docs/fight-art-guide.md 의 프롬프트로 뽑은 시트)
  - 몸 키를 재서 게임 키(BODY_H px)에 맞게 scale 자동 계산

하는 일
  1. 배경색(가장 흔한 색) 키 아웃 → 부드러운 알파, 테두리 배경색 번짐 제거
  2. 워터마크 영역 지우기 (WATERMARKS)
  3. 빈 가로띠로 줄, 빈 세로띠로 프레임 나누기 (SPLITS 로 붙은 줄 강제 분리)
  4. 프레임마다 발끝(몸 픽셀 맨 아래)·머리 중심을 기준점으로 맞춰 같은 칸에 재배치
  5. ANIMS 설정대로 (원본 줄, 프레임 번호) 를 동작별 줄로 다시 묶어 저장

원본 레이아웃이 바뀌면 ANIMS / MOVES 만 고치면 된다.
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

# 이 거리 이하로 떨어진 조각은 같은 프레임으로 합침 (물방울 등)
MERGE_GAP = 10
# 게임 속 몸 키(px) — 피격 박스 높이와 맞춤
BODY_H = 62

# 카이 (맨손 격투) — (줄, 칸)
KAI_ANIMS = {
    "idle": dict(src=[(0, 0), (0, 1), (0, 2), (0, 3)], fps=6, loop=True),
    "walk": dict(src=[(2, 1), (2, 2), (2, 3), (2, 4)], fps=10, loop=True),
    "jump": dict(src=[(0, 6)], fps=1, loop=False),
    "light": dict(src=[(1, 1), (1, 2), (1, 3), (1, 4)], fps=20, loop=False),
    "heavy": dict(src=[(1, 4), (1, 5), (1, 6)], fps=14, loop=False),
    "air": dict(src=[(2, 6)], fps=1, loop=False),
    "air2": dict(src=[(3, 3)], fps=1, loop=False),
    "cast": dict(src=[(0, 6), (3, 3), (3, 3)], fps=12, loop=False),
    "super": dict(src=[(4, 0), (4, 1), (4, 1), (4, 1), (4, 3)], fps=10, loop=False),
    "hit": dict(src=[(2, 5)], fps=1, loop=False),
    "block": dict(src=[(2, 5)], fps=1, loop=False),
    "dash": dict(src=[(0, 6), (3, 3)], fps=12, loop=False),
    "win": dict(src=[(1, 0), (1, 1)], fps=3, loop=True),
}
KAI_MOVES = {
    "L": {"anim": "light", "from": 0, "impact": 2, "to": 3},
    "H": {"anim": "heavy", "from": 0, "impact": 1, "to": 2},
    "J": {"anim": "air", "from": 0, "impact": 0, "to": 0},
    "K": {"anim": "air2", "from": 0, "impact": 0, "to": 0},
    "S": {"anim": "cast", "from": 0, "impact": 1, "to": 2},
    "X": {"anim": "super", "from": 0, "impact": 1, "to": 4},
}
# 약 4단·발차기 2단 동작별 그림 (anim, from, impact, to)
KAI_CHAIN = {
    "L": [
        {"anim": "light", "from": 0, "impact": 1, "to": 1},
        {"anim": "light", "from": 1, "impact": 2, "to": 3},
        {"anim": "light", "from": 3, "impact": 1, "to": 0},
        {"anim": "dash", "from": 0, "impact": 1, "to": 1},
    ],
    "H": [
        {"anim": "heavy", "from": 0, "impact": 1, "to": 2},
        {"anim": "air", "from": 0, "impact": 0, "to": 0},
    ],
}
# 이그나 (불꽃)
IGNA_ANIMS = {
    "idle": dict(src=[(0, i) for i in range(6)], fps=7, loop=True),
    "walk": dict(src=[(1, i) for i in range(5)], fps=10, loop=True),
    "jump": dict(src=[(1, 6)], fps=1, loop=False),
    "light": dict(src=[(1, 4), (1, 5), (0, 6)], fps=16, loop=False),
    "heavy": dict(src=[(2, 2), (3, 0), (3, 3)], fps=12, loop=False),
    "air": dict(src=[(3, 2)], fps=1, loop=False),
    "air2": dict(src=[(3, 0)], fps=1, loop=False),
    "cast": dict(src=[(4, 2), (3, 1), (4, 3)], fps=12, loop=False),
    "super": dict(src=[(5, 0), (5, 1), (0, 6)], fps=10, loop=False),
    # 필살기 불기둥 이펙트 (render.ts 가 상대 발밑에 크게 그림)
    "pillar": dict(src=[(5, 4), (5, 2)], fps=12, loop=True),
    "hit": dict(src=[(2, 1)], fps=1, loop=False),
    "block": dict(src=[(2, 0)], fps=1, loop=False),
    "dash": dict(src=[(2, 3), (2, 4)], fps=12, loop=False),
    "win": dict(src=[(5, 3)], fps=1, loop=True),
}
IGNA_MOVES = {
    "L": {"anim": "light", "from": 0, "impact": 1, "to": 2},
    "H": {"anim": "heavy", "from": 0, "impact": 1, "to": 2},
    "J": {"anim": "air", "from": 0, "impact": 0, "to": 0},
    "K": {"anim": "air2", "from": 0, "impact": 0, "to": 0},
    "S": {"anim": "cast", "from": 0, "impact": 1, "to": 2},
    "X": {"anim": "super", "from": 0, "impact": 1, "to": 2},
}
IGNA_CHAIN = {
    "L": [
        {"anim": "light", "from": 0, "impact": 1, "to": 1},
        {"anim": "light", "from": 1, "impact": 2, "to": 2},
        {"anim": "cast", "from": 0, "impact": 0, "to": 0},
        {"anim": "heavy", "from": 0, "impact": 2, "to": 2},
    ],
    "H": [
        {"anim": "heavy", "from": 0, "impact": 1, "to": 1},
        {"anim": "air2", "from": 0, "impact": 0, "to": 0},
    ],
}
# 소영 (채찍 선생님) — 두 번째 설정화
SOYOUNG_ANIMS = {
    "idle": dict(src=[(0, 0), (0, 1), (1, 0), (1, 1)], fps=5, loop=True),
    "walk": dict(src=[(1, 2), (1, 3), (2, 2), (2, 3)], fps=8, loop=True),
    "jump": dict(src=[(4, 2)], fps=1, loop=False),
    "light": dict(src=[(0, 2), (0, 3), (1, 6)], fps=16, loop=False),
    "heavy": dict(src=[(1, 4), (1, 5), (2, 4)], fps=12, loop=False),
    "air": dict(src=[(2, 5)], fps=1, loop=False),
    "air2": dict(src=[(3, 0)], fps=1, loop=False),
    "cast": dict(src=[(2, 1), (2, 4), (2, 5)], fps=12, loop=False),
    "super": dict(src=[(3, 3), (3, 4), (3, 5), (4, 5)], fps=10, loop=False),
    "hit": dict(src=[(4, 1)], fps=1, loop=False),
    "block": dict(src=[(3, 1)], fps=1, loop=False),
    "dash": dict(src=[(0, 5)], fps=1, loop=False),
    "win": dict(src=[(0, 2), (0, 0)], fps=2, loop=True),
}
SOYOUNG_MOVES = {
    "L": {"anim": "light", "from": 0, "impact": 1, "to": 2},
    "H": {"anim": "heavy", "from": 0, "impact": 1, "to": 2},
    "J": {"anim": "air", "from": 0, "impact": 0, "to": 0},
    "K": {"anim": "air2", "from": 0, "impact": 0, "to": 0},
    "S": {"anim": "cast", "from": 0, "impact": 1, "to": 2},
    "X": {"anim": "super", "from": 0, "impact": 1, "to": 3},
}
SOYOUNG_CHAIN = {
    "L": [
        {"anim": "light", "from": 0, "impact": 1, "to": 1},
        {"anim": "light", "from": 1, "impact": 2, "to": 2},
        {"anim": "cast", "from": 0, "impact": 0, "to": 0},
        {"anim": "heavy", "from": 1, "impact": 2, "to": 2},
    ],
    "H": [
        {"anim": "heavy", "from": 0, "impact": 1, "to": 1},
        {"anim": "cast", "from": 1, "impact": 2, "to": 2},
    ],
}
# 릴리 (우산·물)
LILY_ANIMS = {
    "idle": dict(src=[(0, 0), (0, 1), (0, 2), (0, 3)], fps=6, loop=True),
    "walk": dict(src=[(1, 0), (1, 1), (1, 2), (1, 3)], fps=9, loop=True),
    "jump": dict(src=[(2, 0)], fps=1, loop=False),
    "light": dict(src=[(0, 5), (0, 6), (1, 5)], fps=16, loop=False),
    "heavy": dict(src=[(2, 3), (1, 6), (1, 5)], fps=12, loop=False),
    "air": dict(src=[(0, 4)], fps=1, loop=False),
    "air2": dict(src=[(3, 4)], fps=1, loop=False),
    "cast": dict(src=[(3, 0), (3, 1), (3, 2)], fps=12, loop=False),
    "super": dict(src=[(4, 0), (4, 1), (4, 2), (4, 3)], fps=10, loop=False),
    "hit": dict(src=[(2, 1)], fps=1, loop=False),
    "block": dict(src=[(4, 0)], fps=1, loop=False),
    "dash": dict(src=[(3, 4)], fps=1, loop=False),
    "win": dict(src=[(2, 2), (0, 3)], fps=3, loop=True),
}
LILY_MOVES = {
    "L": {"anim": "light", "from": 0, "impact": 1, "to": 2},
    "H": {"anim": "heavy", "from": 0, "impact": 1, "to": 2},
    "J": {"anim": "air", "from": 0, "impact": 0, "to": 0},
    "K": {"anim": "air2", "from": 0, "impact": 0, "to": 0},
    "S": {"anim": "cast", "from": 0, "impact": 1, "to": 2},
    "X": {"anim": "super", "from": 0, "impact": 1, "to": 3},
}
LILY_CHAIN = {
    "L": [
        {"anim": "light", "from": 0, "impact": 0, "to": 0},
        {"anim": "light", "from": 1, "impact": 1, "to": 1},
        {"anim": "light", "from": 2, "impact": 2, "to": 2},
        {"anim": "heavy", "from": 1, "impact": 1, "to": 2},
    ],
    "H": [
        {"anim": "heavy", "from": 0, "impact": 1, "to": 1},
        {"anim": "air2", "from": 0, "impact": 0, "to": 0},
    ],
}
# 쓰러짐은 서 있는 그림을 눕혀서 (render.ts)
FALLBACK_STATES = {
    "idle": {"anim": "idle"},
    "walk": {"anim": "walk"},
    "jump": {"anim": "jump", "frame": 0},
    "hit": {"anim": "hit"},
    "block": {"anim": "block", "frame": 0},
    "down": {"anim": "hit", "frame": 0},
    "ko": {"anim": "hit", "frame": 0},
    "win": {"anim": "win"},
    "dash": {"anim": "dash"},
}

# 이펙트 픽셀 (발끝·머리 위치 잴 때 빼는 것)
FX = {
    "cyan": lambda r, g, b: (b > 150) & (b - r > 45),
    # 흰 바람·충격파 — 밝고 채도 낮음 (피부보다 파랑이 높음)
    "white": lambda r, g, b: (b > 175) & (r > 175) & (g > 175) & (b >= r - 8),
    # 불꽃 — 밝은 주황·노랑
    "fire": lambda r, g, b: (r > 200) & (g > 80) & (b < 120) & (r - b > 110),
    # 분홍 채찍 궤적
    "pink": lambda r, g, b: (r > 170) & (b > 110) & (g < 120) & (r - g > 90),
}
PRESETS = {
    # 캐릭터 설정화 한 장(1536×1024)의 SPRITE SHEET 상자 — 칸을 직접 지정
    "kai": dict(
        crop=(306, 349, 737, 738),
        fx="white",
        keepDark=True,
        holes=False,
        grid=[(4, 80, 7), (83, 155, 7), (162, 232, 7), (233, 306, 4), (307, 384, 4)],
        anims=KAI_ANIMS,
        moves=KAI_MOVES,
        chain=KAI_CHAIN,
    ),
    "igna": dict(
        crop=(1066, 349, 1507, 783),
        fx="fire",
        grid=[
            (3, 77, 7),
            (79, 150, 7),
            (151, 218, [(2, 58), (62, 118), (124, 186), (190, 274), (278, 362), (366, 440)]),
            (219, 283, [(0, 92), (96, 206), (210, 330), (334, 440)]),
            (284, 352, [(0, 92), (96, 206), (210, 316), (320, 440)]),
            (353, 433, [(0, 92), (96, 192), (194, 270), (272, 352), (354, 440)]),
        ],
        anims=IGNA_ANIMS,
        moves=IGNA_MOVES,
        chain=IGNA_CHAIN,
    ),
    # 두 번째 설정화(1536×1024): 소영·릴리 — src 를 그 그림으로 줘야 함
    "soyoung": dict(
        crop=(312, 332, 744, 744),
        fx="pink",
        keepDark=True,
        bigHoles=True,
        grid=[
            (8, 80, 7),
            (88, 164, 7),
            (168, 242, 7),
            (246, 334, [(10, 72), (78, 120), (126, 184), (185, 240), (250, 334), (340, 431)]),
            (336, 412, [(6, 70), (72, 118), (122, 177), (178, 234), (236, 302), (304, 431)]),
        ],
        anims=SOYOUNG_ANIMS,
        moves=SOYOUNG_MOVES,
        chain=SOYOUNG_CHAIN,
    ),
    "lily": dict(
        crop=(1080, 330, 1512, 742),
        fx="cyan",
        # 우산까지 포함한 키라 조금 작게 (유치원생)
        bodyH=56,
        grid=[
            (4, 71, 7),
            (72, 141, 7),
            (142, 221, [(14, 70), (72, 134), (136, 200), (202, 284), (288, 431)]),
            (222, 300, 5),
            (301, 411, 4),
        ],
        anims=LILY_ANIMS,
        moves=LILY_MOVES,
        chain=LILY_CHAIN,
    ),
}

# 표준 배치: 줄 순서 = 동작 (fps, 반복)
STD_ORDER = [
    ("idle", 6, True),
    ("walk", 10, True),
    ("jump", 8, False),
    ("light", 18, False),
    ("heavy", 14, False),
    ("air", 12, False),
    ("cast", 12, False),
    ("super", 12, False),
    ("hit", 12, False),
    ("block", 1, False),
    ("down", 12, False),
    ("win", 6, True),
]
# 기술 → 동작, 맞는 순간은 그 줄 프레임 수의 이 비율 지점
STD_MOVES = {"L": ("light", 0.5), "H": ("heavy", 0.5), "J": ("air", 0.5), "S": ("cast", 0.6), "X": ("super", 0.6)}
STATES = {
    "idle": {"anim": "idle"},
    "walk": {"anim": "walk"},
    "jump": {"anim": "jump", "frame": 1},
    "hit": {"anim": "hit"},
    "block": {"anim": "block", "frame": 0},
    "down": {"anim": "down"},
    "ko": {"anim": "down"},
    "win": {"anim": "win"},
}


def bands(a, gap):
    out, s, e = [], None, 0
    for i, v in enumerate(a):
        if v:
            if s is None:
                s = i
            e = i
        elif s is not None and i - e > gap:
            out.append([s, e])
            s = None
    if s is not None:
        out.append([s, e])
    return out


def split_cols(m, cols):
    """칸 개수만 주면, 균등 간격 근처에서 그림이 가장 적은 세로줄을 찾아 자름"""
    if not isinstance(cols, int):
        return cols
    n, W = cols, m.shape[1]
    proj = np.convolve(m.sum(0).astype(float), np.ones(5) / 5, mode="same")
    w = W / n
    cuts = [0]
    for k in range(1, n):
        e = k * w
        lo, hi = int(e - 0.4 * w), int(e + 0.4 * w)
        win = proj[lo:hi]
        best = np.flatnonzero(win == win.min())
        cuts.append(lo + int(best[np.argmin(np.abs(best + lo - e))]))
    cuts.append(W)
    return [(cuts[i] + (1 if i else 0), cuts[i + 1] - 1) for i in range(n)]


def main(src: str, cid: str, wm: list, splits: list):
    preset = PRESETS.get(cid)
    rgba = Image.open(src).convert("RGB")
    if preset and preset.get("crop"):
        rgba = rgba.crop(preset["crop"])
    im = np.asarray(rgba).astype(np.float32)
    H, W, _ = im.shape
    q = (im // 4).astype(int).reshape(-1, 3)
    vals, cnt = np.unique(q, axis=0, return_counts=True)
    key = (q == vals[cnt.argmax()]).all(1).reshape(H, W)
    bg = im[key].mean(0)
    dist = np.abs(im - bg).sum(2)
    # 배경 = 배경색에 가까운 픽셀 중 테두리와 이어진 덩어리 (+ 갇힌 틈 중 거의 배경색인 것).
    # 남색 블레이저처럼 배경과 비슷한 옷이 투명해지지 않게, 색만으로 지우지 않는다.
    near = dist < (preset or {}).get("near", 34)
    if (preset or {}).get("keepDark"):
        # 배경보다 어두운 픽셀(검은 옷·머리·외곽선)은 배경으로 안 봄
        lum = im.mean(2)
        near &= lum >= bg.mean() - 10
    lab, n = ndimage.label(near)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    sizes = ndimage.sum(np.ones_like(dist), lab, range(n + 1))
    means = ndimage.mean(dist, lab, range(n + 1))
    isbg = np.zeros(n + 1, bool)
    for i in range(1, n + 1):
        isbg[i] = i in edge or ((preset or {}).get("holes", True) and sizes[i] >= 12 and means[i] < 14)
    hard = isbg[lab]
    if (preset or {}).get("bigHoles"):
        # 채찍 고리 안쪽처럼 갇힌 큰 배경 덩어리도 배경 (어두운 머리카락은 거리가 멀어 안 걸림)
        lab2, n2 = ndimage.label(dist < 34)
        if n2:
            sz2 = ndimage.sum(np.ones_like(dist), lab2, range(n2 + 1))
            big = sz2 >= 150
            big[0] = False
            hard |= big[lab2]
    # 경계 1px만 부드럽게
    alpha = np.where(hard, 0.0, 1.0)
    rim = hard & ndimage.binary_dilation(~hard)
    alpha[rim] = np.clip((dist[rim] - 10) / 30, 0, 0.8)
    if preset:
        wm = wm or preset.get("wm", [])
        splits = splits or preset.get("splits", [])
    for x0, y0, x1, y1 in wm:
        alpha[y0:y1, x0:x1] = 0
    a3 = np.maximum(alpha, 1e-3)[..., None]
    rgb = np.clip((im - (1 - a3) * bg) / a3, 0, 255)
    mask = alpha > 0.35
    if (preset or {}).get("keepDark"):
        # 머리카락 하이라이트처럼 배경색과 비슷해 뚫린 구멍을 메움 (원래 색으로)
        filled = ndimage.binary_fill_holes(ndimage.binary_closing(mask, np.ones((3, 3)), iterations=2))
        restore = filled & ~mask
        # 작은 구멍(머리 하이라이트 등)만 메움 — 다리 사이 같은 큰 틈은 배경 그대로
        lb, nb = ndimage.label(restore)
        if nb:
            sz = ndimage.sum(np.ones_like(dist), lb, range(1, nb + 1))
            small = np.zeros(nb + 1, bool)
            md = ndimage.mean(dist, lb, range(1, nb + 1))
            # 진짜 배경 틈은 배경색과 거의 같음(거리 작음), 머리 하이라이트는 조금 다름
            small[1:] = (sz <= 30) | (md >= 16)
            restore = small[lb]
        alpha[restore] = 1
        rgb[restore] = im[restore]
        mask |= restore
    # 테두리 정리: 바깥 가장자리 중 배경색에 가까운 픽셀(번진 배경·격자 잔상)을 두 겹까지 벗겨 냄,
    # 남은 픽셀은 반투명 없이 딱 떨어지게 (도트 그림)
    for _ in range(2):
        rim = mask & ~ndimage.binary_erosion(mask, np.ones((3, 3)))
        bad = rim & (dist < 60)
        mask &= ~bad
    alpha = np.where(mask, 1.0, 0.0)
    rgb = np.where(mask[..., None], im, 0)

    # 몸 픽셀: 하늘색 이펙트(파랑 강하고 밝음) 제외
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    fx = FX.get((preset or {}).get("fx", "cyan"))(r, g, b)
    body = mask & ~fx

    grid = (preset or {}).get("grid")
    rows = [] if grid else bands(mask.any(1), 3)
    for sy in splits:
        for i, (a, z) in enumerate(rows):
            if a < sy < z:
                rows[i:i + 1] = [[a, sy - 1], [sy, z]]
                break
    frames = []
    for a, z in rows:
        cols = bands(mask[a:z + 1].any(0), MERGE_GAP)
        fr = []
        for c0, c1 in cols:
            m = mask[a:z + 1, c0:c1 + 1]
            # 납작한 바닥 그림자 조각은 버림
            lb, k = ndimage.label(m)
            for sl_i, sl in enumerate(ndimage.find_objects(lb), 1):
                if sl[0].stop - sl[0].start <= 10 and sl[1].stop - sl[1].start > 14:
                    seg = lb == sl_i
                    m[seg] = False
                    alpha[a:z + 1, c0:c1 + 1][seg] = 0
            mask[a:z + 1, c0:c1 + 1] = m
            ys = np.where(m.any(1))[0]
            fr.append((c0, a + ys[0], c1, a + ys[-1]))
        frames.append(fr)
        print(f"줄 {len(frames) - 1}: y{a}-{z} 프레임 {len(fr)}")
    if grid:
        # 칸을 직접 정한 시트: 줄 (y0, y1, 칸) — 칸은 개수(균등) 또는 [(x0, x1), ...]
        for a, z, cols in grid:
            cols = split_cols(mask[a:z + 1], cols)
            fr = []
            for c0, c1 in cols:
                m = mask[a:z + 1, c0:c1 + 1]
                # 칸 경계 격자선·점 부스러기 지우기 (가늘고 어두운 조각, 아주 작은 조각)
                lb, _ = ndimage.label(m, structure=np.ones((3, 3)))
                lum = im[a:z + 1, c0:c1 + 1].mean(2)
                for li, sl in enumerate(ndimage.find_objects(lb), 1):
                    seg = lb[sl] == li
                    hh, ww = seg.shape
                    area = int(seg.sum())
                    dark = lum[sl][seg].mean() < bg.mean() + 25
                    if area < 10 or (dark and min(hh, ww) <= 3):
                        m[sl][seg] = False
                        alpha[a:z + 1, c0:c1 + 1][sl][seg] = 0
                ys, xs = np.where(m)
                fr.append((c0 + xs.min(), a + ys.min(), c0 + xs.max(), a + ys.max()))
            frames.append(fr)
            print(f"줄 {len(frames) - 1}: y{a}-{z} 프레임 {len(fr)}")
        # 칸 밖으로 삐져나간 이웃 픽셀이 안 섞이게, 칸 경계 밖은 지움
        keep = np.zeros_like(mask)
        for a, z, cols in grid:
            cols = split_cols(mask[a:z + 1], cols)
            for c0, c1 in cols:
                keep[a:z + 1, c0:c1 + 1] = True
        mask &= keep
        alpha[~keep] = 0

    if os.environ.get("DUMP"):
        # 칸 번호 확인용 그림 (줄,칸 라벨)
        from PIL import ImageDraw
        dump = Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), "RGBA").convert("RGB")
        dump = dump.resize((dump.width * 2, dump.height * 2), Image.NEAREST)
        dr = ImageDraw.Draw(dump)
        for ri, fr in enumerate(frames):
            for fi, (x0, y0, x1, y1) in enumerate(fr):
                dr.rectangle([x0 * 2, y0 * 2, x1 * 2, y1 * 2], outline=(255, 0, 0))
                dr.text((x0 * 2 + 2, y0 * 2 + 2), f"{ri},{fi}", fill=(255, 255, 0))
        dump.save(os.environ["DUMP"])
    if preset:
        anims, moves = preset["anims"], preset["moves"]
    else:
        if len(frames) != len(STD_ORDER):
            sys.exit(f"줄이 {len(frames)}개 — 표준 배치는 {len(STD_ORDER)}줄이어야 함 (--split 로 붙은 줄을 자르거나 PRESETS 추가)")
        anims = {
            n: dict(src=[(i, k) for k in range(len(frames[i]))], fps=fps, loop=loop)
            for i, (n, fps, loop) in enumerate(STD_ORDER)
        }
        moves = {}
        for mid, (an, ratio) in STD_MOVES.items():
            n = len(anims[an]["src"])
            moves[mid] = {"anim": an, "from": 0, "impact": min(n - 1, int(n * ratio)), "to": n - 1}

    def anchor(box):
        x0, y0, x1, y1 = box
        bm = body[y0:y1 + 1, x0:x1 + 1]
        ys, xs = np.where(bm)
        if len(ys) == 0:
            ys, xs = np.where(mask[y0:y1 + 1, x0:x1 + 1])
        top = ys.min()
        foot = ys.max()
        head = xs[ys < top + max(6, (foot - top) * 0.25)]
        return x0 + head.mean(), y0 + foot, foot - top

    picks = {}
    heights = [anchor(frames[ri][fi])[2] for ri, fi in anims["idle"]["src"]]
    scale = round(float(np.median(heights)) / (preset or {}).get("bodyH", BODY_H), 3)
    left = right = up = down = 0
    for name, ad in anims.items():
        lst = []
        for ri, fi in ad["src"]:
            box = frames[ri][fi]
            ax, ay, _ = anchor(box)
            left = max(left, ax - box[0])
            right = max(right, box[2] + 1 - ax)
            up = max(up, ay - box[1])
            down = max(down, box[3] + 1 - ay)
            lst.append((box, ax, ay))
        picks[name] = lst
    pad = 2
    L, R, U, D = (int(np.ceil(v)) + pad for v in (left, right, up, down))
    cw, ch = L + R, U + D
    ncol = max(len(v) for v in picks.values())
    out = np.zeros((ch * len(anims), cw * ncol, 4), np.uint8)
    src_rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    for row, (name, lst) in enumerate(picks.items()):
        for col, (box, ax, ay) in enumerate(lst):
            x0, y0, x1, y1 = box
            piece = src_rgba[y0:y1 + 1, x0:x1 + 1].copy()
            piece[~mask[y0:y1 + 1, x0:x1 + 1] & (alpha[y0:y1 + 1, x0:x1 + 1] < 0.05)] = 0
            dx = int(round(col * cw + L - (ax - x0)))
            dy = int(round(row * ch + U - (ay - y0)))
            ph, pw = piece.shape[:2]
            dst = out[dy:dy + ph, dx:dx + pw]
            sel = piece[..., 3] > dst[..., 3]
            dst[sel] = piece[sel]
    outdir = Path("public/fight")
    Image.fromarray(out, "RGBA").save(outdir / f"{cid}.webp", "WEBP", quality=90, method=6)
    meta = {
        "image": f"/fight/{cid}.webp",
        "cell": [cw, ch],
        "anchor": [L, U],
        "scale": scale,
        "pixel": True,
        "facing": "right",
        "anims": {
            n: {"row": i, "frames": len(picks[n]), "fps": ad["fps"], "loop": ad["loop"]}
            for i, (n, ad) in enumerate(anims.items())
        },
        "moves": moves,
        **({"chain": preset["chain"]} if preset and preset.get("chain") else {}),
        "states": STATES if "down" in anims else FALLBACK_STATES,
        **({} if "down" in anims else {"layDown": True}),
    }
    (outdir / f"{cid}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
    print(f"칸 {cw}x{ch}, 기준점 ({L},{U}), 시트 {out.shape[1]}x{out.shape[0]}")


if __name__ == "__main__":
    args = sys.argv[1:]
    wm, splits, pos = [], [], []
    i = 0
    while i < len(args):
        if args[i] == "--wm":
            wm.append(tuple(int(v) for v in args[i + 1].split(",")))
            i += 2
        elif args[i] == "--split":
            splits.append(int(args[i + 1]))
            i += 2
        else:
            pos.append(args[i])
            i += 1
    main(pos[0], pos[1], wm, splits)
