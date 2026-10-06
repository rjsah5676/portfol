#!/usr/bin/env python3
"""
격투 캐릭터 에셋 v2 (지피티 단색 배경 시트) → 아틀라스 webp + json.

  python3 scripts/fight-atlas-v2.py <원본 폴더> <캐릭터id>

<원본 폴더>/<id>/ 안에 시트 그림들, 설정은 scripts/fight-sprites-v2.json 의 <id>:
  sheets: { 이름: { file, bg: green|black, rows, splits?: {줄: [x...]}, ref?: "줄.칸", scale? } }
     ref = 그 시트에서 '서 있는 자세' 프레임 → 모든 시트의 캐릭터 키를 기준 시트(첫 시트) 키에 맞춤
  anims: { 동작: { fps, loop?, f: ["시트:줄.칸", ...] } }
  body: 서 있을 때 게임 속 키(px)
  fx: { 이름: ["시트:줄.칸", ...] }  → public/fight/fx/<id>-<이름>-<n>.webp
  art: { file, portrait: [x0,y0,x1,y1], face: [x0,y0,x1,y1], full: [x0,y0,x1,y1] }

프레임 찾기·배경 빼기는 fight-sheet-cut.py (덩어리 단위, 칸 격자 안 믿음).
발 기준점: 프레임에서 가장 큰 덩어리 맨 아래의 '어두운'(신발·바지) 픽셀 가운데 — 먼지·빛 이펙트에 안 끌려감.
"""
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "fight"
_spec = importlib.util.spec_from_file_location("cut", ROOT / "scripts" / "fight-sheet-cut.py")
cut = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cut)



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


def feet(piece: np.ndarray, anchor="feet"):
    a = piece[..., 3] > 60
    h, w = a.shape
    if anchor == "center":
        return w / 2, h / 2
    if anchor == "bottom":
        return w / 2, h
    if anchor == "upper":
        # 몸이 위쪽, 아래로 긴 무기·이펙트가 뻗은 그림: 줄마다 폭을 보고, 가장 넓은 줄(몸)에서
        # 아래로 내려가며 폭이 확 좁아지는 곳(무기만 남는 곳)을 발로 봄
        cnt = a.sum(1).astype(float)
        top = int(np.argmax(cnt[: max(1, int(h * 0.7))]))
        foot = top
        while foot < h - 1 and cnt[foot] >= cnt[top] * 0.18:
            foot += 1
        ys, xs = np.where(a[max(0, foot - 12) : foot + 1])
        return (float(xs.mean()) if len(xs) else w / 2), float(foot)
    lab, n = ndimage.label(ndimage.binary_dilation(a, np.ones((3, 3))))
    if n == 0:
        return w / 2, h
    sizes = ndimage.sum(a, lab, range(1, n + 1))
    body = (lab == int(np.argmax(sizes)) + 1) & a
    lum = piece[..., :3].astype(int).mean(2)
    dark = body & (lum < 95)
    use = dark if dark.sum() > 40 else body
    ys, xs = np.where(use)
    foot = ys.max()
    tall = foot - ys.min()
    near = xs[ys >= foot - max(5, tall * 0.1)]
    return float(near.mean()), float(foot + 1)


class Sheets:
    def __init__(self, src: Path, cfg: dict):
        self.src = src
        self.cfg = cfg
        self.cache = {}

    def get(self, name):
        if name not in self.cache:
            c = self.cfg[name]
            rgba = cut.key(Image.open(self.src / c["file"]), c["bg"])
            out, lab = cut.segment(rgba, c["rows"], {int(k): v for k, v in c.get("splits", {}).items()})
            self.cache[name] = (rgba, out, lab)
        return self.cache[name]

    def frame(self, ref: str) -> np.ndarray:
        name, rc = ref.split(":")
        r, c = map(int, rc.split("."))
        rgba, out, lab = self.get(name)
        piece, _ = cut.crop(rgba, lab, out[r][c])
        return piece

    def size_factor(self, name: str, base_h: float) -> float:
        c = self.cfg[name]
        if "scale" in c:
            return c["scale"]
        if "ref" not in c:
            return 1.0
        return base_h / self.frame(f"{name}:{c['ref']}").shape[0]


def resize(p: np.ndarray, k: float) -> np.ndarray:
    if abs(k - 1) < 0.01:
        return p
    h, w = p.shape[:2]
    # 투명 픽셀 색 번짐 방지: 미리 곱한 알파로 줄이기
    f = p.astype(np.float32)
    f[..., :3] *= f[..., 3:4] / 255
    im = Image.fromarray(f.astype(np.uint8), "RGBA").resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    g = np.asarray(im).astype(np.float32)
    g[..., :3] = np.where(g[..., 3:4] > 0, g[..., :3] * 255 / np.maximum(g[..., 3:4], 1), 0)
    return np.clip(g, 0, 255).astype(np.uint8)


MOVE_ANIM = {"L": "L1", "H": "H1", "J": "J", "K": "K", "S": "S", "X": "X", "T": "T", "G": "G"}
STATES = {
    "idle": {"anim": "idle"},
    "walk": {"anim": "walk"},
    "jump": {"anim": "jump"},
    "hit": {"anim": "hit"},
    "block": {"anim": "block", "frame": 0},
    "down": {"anim": "down"},
    "ko": {"anim": "ko"},
    "win": {"anim": "win"},
    "dash": {"anim": "dash"},
}


def build(src_root: Path, cid: str):
    spec = json.loads((ROOT / "scripts" / "fight-sprites-v2.json").read_text())[cid]
    src = src_root / cid
    sh = Sheets(src, spec["sheets"])
    first = next(iter(spec["sheets"]))
    base_h = sh.frame(f"{first}:{spec['sheets'][first]['ref']}").shape[0]
    factors = {n: sh.size_factor(n, base_h) for n in spec["sheets"]}
    print("sheet size factors", {k: round(v, 3) for k, v in factors.items()})

    # 저장 해상도: 원본은 화면보다 훨씬 커서 줄여서 저장 (scale 이 그만큼 작아짐)
    out_k = spec.get("outScale", 0.6)
    factors = {k: v * out_k for k, v in factors.items()}
    pieces, anchors, anims, seen = [], [], {}, {}
    for name, ad in spec["anims"].items():
        idx = []
        for ref in ad["f"]:
            if ref not in seen:
                p = resize(sh.frame(ref), factors[ref.split(":")[0]])
                seen[ref] = len(pieces)
                pieces.append(p)
                anchors.append(feet(p, ad.get("anchor", "feet")))
            idx.append(seen[ref])
        anims[name] = {"list": idx, "frames": len(idx), "fps": ad["fps"], "loop": bool(ad.get("loop")), "row": 0}
    # 자동으로 잡은 발 위치가 이상한 프레임 (무기 끝을 발로 잡는 등) 손으로 고정: {"시트:행.칸": [x, y]} (저장 크기 기준)
    for ref, xy in spec.get("anchorFix", {}).items():
        if ref in seen:
            anchors[seen[ref]] = (float(xy[0]), float(xy[1]))
    idle_h = float(np.median([pieces[i].shape[0] for i in anims["idle"]["list"]]))
    scale = round(idle_h / spec["body"], 3)
    atlas, pos = pack(pieces)
    frames = [[x, y, p.shape[1], p.shape[0], round(a[0], 1), round(a[1], 1)] for (x, y), p, a in zip(pos, pieces, anchors)]

    def mv(anim, impact=None):
        n = anims[anim]["frames"]
        imp = impact if impact is not None else min(n - 1, (n + 1) // 2 if n > 2 else n - 1)
        return {"anim": anim, "from": 0, "impact": imp, "to": n - 1}

    imp = spec.get("impact", {})
    moves = {k: mv(a, imp.get(a)) for k, a in MOVE_ANIM.items() if a in anims}
    chain = {
        "L": [mv(f"L{i}", imp.get(f"L{i}")) for i in range(1, 5) if f"L{i}" in anims],
        "H": [mv(f"H{i}", imp.get(f"H{i}")) for i in range(1, 3) if f"H{i}" in anims],
    }
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
        "states": STATES,
        "v2": True,
    }
    Image.fromarray(atlas, "RGBA").save(OUT / f"{cid}.webp", "WEBP", quality=86, method=6)
    (OUT / f"{cid}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n")
    print(cid, "frames", len(frames), "atlas", atlas.shape[1], "x", atlas.shape[0], "scale", scale)

    # 이펙트
    (OUT / "fx").mkdir(exist_ok=True)
    for fx, refs in spec.get("fx", {}).items():
        for k, ref in enumerate(refs):
            p = resize(sh.frame(ref), out_k * 0.8)
            Image.fromarray(p, "RGBA").save(OUT / "fx" / f"{cid}-{fx}-{k}.webp", "WEBP", quality=88, method=6)
    # 프로필(얼굴)·전신
    art = spec.get("art")
    if art:
        im = Image.open(src / art["file"]).convert("RGB")
        (OUT / "art").mkdir(exist_ok=True)
        face = im.crop(tuple(art["face"]))
        face.thumbnail((320, 352), Image.LANCZOS)
        face.save(OUT / "art" / f"{cid}-face.webp", "WEBP", quality=90, method=6)
        full = cut.key(im.crop(tuple(art["full"])), "green")
        a = full[..., 3] > 40
        lab, n = ndimage.label(ndimage.binary_dilation(a, np.ones((5, 5))))
        if n > 1:
            sizes = ndimage.sum(a, lab, range(1, n + 1))
            full[lab != int(np.argmax(sizes)) + 1] = 0
        ys, xs = np.where(full[..., 3] > 30)
        full = full[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
        if full.shape[0] > 760:
            full = resize(full, 760 / full.shape[0])
        Image.fromarray(full, "RGBA").save(OUT / "art" / f"{cid}.webp", "WEBP", quality=90, method=6)
        print("art ok", full.shape)


if __name__ == "__main__":
    build(Path(sys.argv[1]), sys.argv[2])
