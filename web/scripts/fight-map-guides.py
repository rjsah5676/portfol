#!/usr/bin/env python3
"""
맵 발판 배치 가이드 그림 (AI 배경 그릴 때 참고 이미지로 넣음) → <출력폴더>/<맵id>.png

  npx tsx -e 'import {MAPS} from "./src/lib/fight/maps"; console.log(JSON.stringify(MAPS))' > /tmp/maps.json
  python3 scripts/fight-map-guides.py /tmp/maps.json <출력폴더>
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

W, H, K = 1152, 648, 1920 / 1152
maps = json.load(open(sys.argv[1]))
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
for m in maps:
    im = Image.new("RGB", (1920, 1080), (40, 44, 60))
    d = ImageDraw.Draw(im)
    for x in range(0, 1920, 96):
        d.line([(x, 0), (x, 1080)], fill=(52, 56, 74))
    for y in range(0, 1080, 96):
        d.line([(0, y), (1920, y)], fill=(52, 56, 74))
    for p in m["plats"]:
        x0, x1, y = p["x0"] * K, p["x1"] * K, (H - p["y"]) * K
        if p.get("solid"):
            d.rectangle([x0, y, x1, 1080], fill=(120, 96, 70))
            d.rectangle([x0, y, x1, y + 10], fill=(230, 210, 150))
        else:
            d.rectangle([x0, y, x1, y + 18], fill=(230, 210, 150))
    # 캐릭터 키 기준 (62px)
    for sx in m["spawn"]:
        x = sx * K
        best = max((p for p in m["plats"] if p["x0"] <= sx <= p["x1"] and p.get("solid")), key=lambda p: p["y"], default=None)
        if best:
            y = (H - best["y"]) * K
            d.rectangle([x - 12, y - 62 * K, x + 12, y], outline=(255, 120, 120), width=3)
    im.save(out / f"{m['id']}.png")
    print(out / f"{m['id']}.png")
