#!/usr/bin/env python3
"""
AI로 뽑은 맵 배경 그림을 게임용으로 (16:9로 잘라 1920×1080 webp).

  python3 scripts/import-fight-bg.py <그림.png> <맵id>   → public/fight/bg/<맵id>.webp

그 다음 src/lib/fight/maps.ts 의 맵에 bg: "/fight/bg/<맵id>.webp" 를 넣고,
그림에 발판까지 그려져 있으면 bgPlats: true + 발판 좌표(1152×648 기준)를 그림에 맞춤.
배치 가이드 그림: scripts/fight-map-guides.py
"""
import sys
from pathlib import Path

from PIL import Image

src, mid = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
w, h = im.size
# 가운데 기준 16:9로 자르기
if w * 9 > h * 16:
    nw = h * 16 // 9
    im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
elif w * 9 < h * 16:
    nh = w * 9 // 16
    im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
im = im.resize((1920, 1080), Image.LANCZOS)
out = Path("public/fight/bg")
out.mkdir(parents=True, exist_ok=True)
im.save(out / f"{mid}.webp", "WEBP", quality=86, method=6)
print(out / f"{mid}.webp")
