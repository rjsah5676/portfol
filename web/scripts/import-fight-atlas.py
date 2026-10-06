#!/usr/bin/env python3
"""
격투 캐릭터 스프라이트 → 아틀라스(webp + json) 만들기. 설정은 scripts/fight-sprites.json.

  python3 scripts/import-fight-atlas.py <원본 폴더> [캐릭터id ...]

원본 폴더에는 배경이 투명한 시트(PNG)가 있어야 함 (체크무늬가 그려진 그림은
scripts/dechecker.py 로 먼저 투명하게).

프레임마다 크기가 달라도 됨: 칸을 꽉 맞게 잘라 한 장에 빽빽이 모으고, 각 프레임의
[x, y, w, h, 발x, 발y] 를 json 에 적음 (src/lib/fight/sprites.ts 의 frames 형식).
몸 키(idle 프레임 높이 중간값)를 body(px)에 맞춰 scale 을 정함.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "fight"
SPEC = json.loads((ROOT / "scripts" / "fight-sprites.json").read_text())

# 기술 → 동작 (약 4단·발차기 2단은 chain)
MOVE_ANIM = {"L": "L1", "H": "H1", "J": "J", "K": "K", "S": "S", "X": "X"}
STATES = {
    "idle": {"anim": "idle"},
    "walk": {"anim": "walk"},
    "jump": {"anim": "jump", "frame": 0},
    "hit": {"anim": "hit"},
    "block": {"anim": "block", "frame": 0},
    "down": {"anim": "down"},
    "ko": {"anim": "down"},
    "win": {"anim": "win"},
    "dash": {"anim": "dash"},
}


_lab_cache: dict = {}


def grow(sheet: np.ndarray, box):
    """칸 경계에 걸쳐 잘리는 이펙트를 살림: 칸 안에 대부분 들어오는 덩어리는 칸 밖 부분까지 포함.
    단 덩어리가 칸보다 훨씬 크면(이웃 프레임과 이어진 경우) 칸으로 자름."""
    key = id(sheet)
    if key not in _lab_cache:
        m = sheet[..., 3] > 40
        _lab_cache[key] = (m, *ndimage.label(m, structure=np.ones((3, 3))))
    m, lab, n = _lab_cache[key]
    x0, y0, x1, y1 = box
    inside = lab[y0:y1, x0:x1]
    ids, cnt = np.unique(inside[inside > 0], return_counts=True)
    bw, bh = x1 - x0, y1 - y0
    keep = np.zeros(lab.max() + 1, bool)
    gx0, gy0, gx1, gy1 = x0, y0, x1, y1
    objs = ndimage.find_objects(lab)
    for i, c in zip(ids, cnt):
        sl = objs[i - 1]
        total = (lab[sl] == i).sum()
        if c / total < 0.6:
            continue
        cx0, cy0, cx1, cy1 = sl[1].start, sl[0].start, sl[1].stop, sl[0].stop
        if (cx1 - cx0) > bw * 1.5 or (cy1 - cy0) > bh * 1.5:
            continue
        keep[i] = True
        gx0, gy0, gx1, gy1 = min(gx0, cx0), min(gy0, cy0), max(gx1, cx1), max(gy1, cy1)
    sub = lab[gy0:gy1, gx0:gx1]
    mask = keep[sub]
    # 칸 안의 나머지(작은 조각·큰 덩어리의 칸 안 부분)도 포함
    inbox = np.zeros_like(mask)
    inbox[y0 - gy0 : y1 - gy0, x0 - gx0 : x1 - gx0] = True
    mask |= inbox & m[gy0:gy1, gx0:gx1]
    a = sheet[gy0:gy1, gx0:gx1].copy()
    a[~mask] = 0
    return a


def cut(sheet: np.ndarray, box, anchor="feet"):
    a = grow(sheet, box)
    m = a[..., 3] > 40
    if not m.any():
        raise SystemExit(f"빈 칸: {box}")
    ys, xs = np.where(m)
    tx0, ty0, tx1, ty1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    piece = a[ty0:ty1, tx0:tx1].copy()
    pm = m[ty0:ty1, tx0:tx1]
    piece[~pm] = 0
    h, w = pm.shape
    if anchor == "bottom":
        return piece, (w / 2, h)
    if anchor == "center":
        return piece, (w / 2, h / 2)
    # 발: 가장 큰 덩어리(몸)의 맨 아래, 그 근처 픽셀 가로 가운데
    lab, n = ndimage.label(ndimage.binary_dilation(pm, np.ones((3, 3))))
    if n == 0:
        return piece, (w / 2, h)
    sizes = ndimage.sum(pm, lab, range(1, n + 1))
    body = (lab == (int(np.argmax(sizes)) + 1)) & pm
    bys, bxs = np.where(body)
    foot = bys.max()
    near = bxs[bys >= foot - max(4, (foot - bys.min()) * 0.12)]
    return piece, (float(near.mean()), float(foot + 1))


def pack(pieces, width=2048, pad=2):
    x = y = row_h = 0
    pos = []
    for p in pieces:
        h, w = p.shape[:2]
        if x + w + pad > width:
            x, y, row_h = 0, y + row_h + pad, 0
        pos.append((x, y))
        x += w + pad
        row_h = max(row_h, h)
    H = y + row_h
    atlas = np.zeros((H, width, 4), np.uint8)
    for (px, py), p in zip(pos, pieces):
        h, w = p.shape[:2]
        atlas[py : py + h, px : px + w] = p
    used_w = max(px + p.shape[1] for (px, _), p in zip(pos, pieces))
    return atlas[:, :used_w], pos


def build(cid: str, src: Path):
    spec = SPEC[cid]
    sheet = np.asarray(Image.open(src / spec["sheet"]).convert("RGBA"))
    _lab_cache.clear()
    pieces, anchors, anims = [], [], {}
    for name, ad in spec["anims"].items():
        idx = []
        for box in ad["f"]:
            p, anc = cut(sheet, box, ad.get("anchor", "feet"))
            idx.append(len(pieces))
            pieces.append(p)
            anchors.append(anc)
        anims[name] = {"list": idx, "frames": len(idx), "fps": ad["fps"], "loop": bool(ad.get("loop")), "row": 0}
    # 크기: idle 프레임 높이 중간값 → body px
    hs = [pieces[i].shape[0] for i in anims["idle"]["list"]]
    scale = round(float(np.median(hs)) / spec["body"], 3)
    atlas, pos = pack(pieces)
    frames = [[x, y, p.shape[1], p.shape[0], round(a[0], 1), round(a[1], 1)] for (x, y), p, a in zip(pos, pieces, anchors)]

    def mv(anim):
        n = anims[anim]["frames"]
        return {"anim": anim, "from": 0, "impact": min(n - 1, (n + 1) // 2 if n > 2 else n - 1), "to": n - 1}

    moves = {k: mv(a) for k, a in MOVE_ANIM.items()}
    chain = {"L": [mv(f"L{i}") for i in range(1, 5)], "H": [mv("H1"), mv("H2")]}
    states = dict(STATES)
    meta = {
        "image": f"/fight/{cid}.webp",
        "cell": [0, 0],
        "anchor": [0, 0],
        "scale": scale,
        "facing": "right",
        "frames": frames,
        "anims": anims,
        "moves": moves,
        "chain": chain,
        "states": states,
    }
    Image.fromarray(atlas, "RGBA").save(OUT / f"{cid}.webp", "WEBP", quality=88, method=6)
    (OUT / f"{cid}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n")
    # 효과 그림 (탄 등)
    for fx, fd in spec.get("fx", {}).items():
        # 이펙트는 빛 번짐 아래 체크무늬까지 지운 시트(dechecker --glow)를 따로 쓸 수 있음
        fsheet = np.asarray(Image.open(src / fd["sheet"]).convert("RGBA")) if "sheet" in fd else sheet
        _lab_cache.clear()
        p, _ = cut(fsheet, fd["box"], "center")
        if "neutralAlpha" in fd:
            # 물보라 속 회색·흰 얼룩(남은 체크무늬)은 반투명하게
            rgb = p[..., :3].astype(int)
            neutral = (rgb.max(2) - rgb.min(2) < 14) & (p[..., 3] > 0)
            p[..., 3] = np.where(neutral, np.minimum(p[..., 3], fd["neutralAlpha"]), p[..., 3])
        (OUT / "fx").mkdir(exist_ok=True)
        Image.fromarray(p, "RGBA").save(OUT / "fx" / f"{fx}.webp", "WEBP", quality=88, method=6)
    print(cid, "frames", len(frames), "atlas", atlas.shape[1], "x", atlas.shape[0], "scale", scale)


def art(src: Path):
    A = SPEC["_art"]
    (OUT / "art").mkdir(exist_ok=True)
    por = Image.open(src / A["portraits"]).convert("RGBA")
    for cid, box in A["faces"].items():
        if cid in V2:
            continue
        face = por.crop(box).convert("RGB")
        face.thumbnail((320, 352), Image.LANCZOS)
        face.save(OUT / "art" / f"{cid}-face.webp", "WEBP", quality=88, method=6)
    zf = A["zenaFace"]
    Image.open(src / zf[0]).convert("RGBA").crop(zf[1:]).resize((320, 320), Image.LANCZOS).save(
        OUT / "art" / "zena-face.webp", "WEBP", quality=88, method=6
    )
    for cid, (f, *box) in A["full"].items():
        if cid in V2:
            continue
        im = Image.open(src / f).convert("RGBA")
        # 옆·아래 다른 그림(앉은 그림 머리 등)과 붙은 곳은 다각형으로 지움 (시트 좌표)
        polys = A.get("fullClear", {}).get(cid, [])
        if polys:
            mask = Image.new("L", im.size, 255)
            d = ImageDraw.Draw(mask)
            for poly in polys:
                d.polygon([tuple(pt) for pt in poly], fill=0)
            im.putalpha(Image.fromarray(np.minimum(np.asarray(im)[..., 3], np.asarray(mask))))
        im = im.crop(box)
        a = np.asarray(im).copy()
        # 가장 큰 덩어리(전신 그림)만 — 옆의 작은 스프라이트·앉은 그림 조각 빼기
        lab, n = ndimage.label(ndimage.binary_dilation(a[..., 3] > 40, np.ones((5, 5))))
        if n > 1:
            sizes = ndimage.sum(np.ones(lab.shape), lab, range(1, n + 1))
            a[lab != int(np.argmax(sizes)) + 1] = 0
            im = Image.fromarray(a, "RGBA")
        ys, xs = np.where(a[..., 3] > 40)
        im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
        im.save(OUT / "art" / f"{cid}.webp", "WEBP", quality=88, method=6)
    print("art ok")


# v2 에셋(scripts/fight-atlas-v2.py)으로 바꾼 캐릭터는 여기서 건드리지 않음
V2 = set(json.loads((ROOT / "scripts" / "fight-sprites-v2.json").read_text())) - {"_doc"}

if __name__ == "__main__":
    src = Path(sys.argv[1])
    ids = sys.argv[2:] or [k for k in SPEC if not k.startswith("_") and k not in V2]
    for cid in ids:
        build(cid, src)
    art(src)
