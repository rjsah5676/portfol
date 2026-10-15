"""
해피 타운 보스 그림 — PIXEL MARBLE UR 말 도트(public/fight/ur-*.webp 서기 프레임)를 글리치 시티 보스처럼 「오염」시켜 192×192 로.
  python web/scripts/defense-art/town-bosses.py   (web 폴더 기준 경로)
보라 · 하늘 색 어긋남(색수차) + 가로로 찢긴 줄 + 둘레 글리치 조각 + 어두운 보라 그늘. 시드 고정이라 다시 돌려도 같음.
"""
import json, random
from PIL import Image, ImageChops, ImageFilter
import os
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "public")
S = 192
for name in ["dice", "moa", "forte"]:
    rnd = random.Random(name)
    meta = json.load(open(f"{ROOT}/fight/ur-{name}.json"))
    x, y, w, h = meta["frames"][0][:4]
    src = Image.open(f"{ROOT}/fight/ur-{name}.webp").convert("RGBA").crop((x, y, x + w, y + h))
    k = 158 / h
    spr = src.resize((round(w * k), round(h * k)), Image.NEAREST)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ox, oy = (S - spr.width) // 2, S - spr.height - 6
    a = spr.getchannel("A")
    # 어두운 보라 그늘 (오라)
    glow = Image.new("RGBA", spr.size, (120, 40, 200, 0))
    glow.putalpha(a.filter(ImageFilter.MaxFilter(9)).point(lambda v: 110 if v > 0 else 0))
    out.alpha_composite(glow, (ox, oy))
    # 색수차: 자홍 왼쪽 · 하늘 오른쪽
    for col, dx in (((255, 60, 220), -4), ((80, 240, 255), 4)):
        g = Image.new("RGBA", spr.size, col + (0,))
        g.putalpha(a.point(lambda v: 150 if v > 128 else 0))
        out.alpha_composite(g, (ox + dx, oy))
    body = spr.copy()
    # 조금 어둡고 차갑게 (오염)
    r, gch, b, al = body.split()
    body = Image.merge("RGBA", (r.point(lambda v: int(v * 0.86)), gch.point(lambda v: int(v * 0.8)), b.point(lambda v: min(255, int(v * 0.95 + 12))), al))
    out.alpha_composite(body, (ox, oy))
    # 가로로 찢긴 줄
    for _ in range(5):
        yy = rnd.randrange(oy + 10, S - 14)
        hh = rnd.choice([2, 3, 4])
        band = out.crop((0, yy, S, yy + hh))
        out.paste((0, 0, 0, 0), (0, yy, S, yy + hh))
        out.alpha_composite(band, (rnd.choice([-7, -5, 5, 7]), yy))
    # 둘레 글리치 조각
    px = out.load()
    for _ in range(70):
        cx, cy = rnd.randrange(8, S - 8), rnd.randrange(16, S - 8)
        if a.getpixel((min(spr.width - 1, max(0, cx - ox)), min(spr.height - 1, max(0, cy - oy)))) if 0 <= cx - ox < spr.width and 0 <= cy - oy < spr.height else 0:
            continue
        col = rnd.choice([(255, 79, 216, 220), (95, 242, 255, 220), (40, 20, 70, 230), (166, 107, 255, 220)])
        s2 = rnd.choice([2, 2, 4])
        for dx in range(s2):
            for dy in range(s2):
                if 0 <= cx + dx < S and 0 <= cy + dy < S:
                    px[cx + dx, cy + dy] = col
    out.save(f"{ROOT}/defense/bosses/ur-{name}.webp", lossless=True)
    print("ok", name)
