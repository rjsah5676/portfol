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
from PIL import Image, ImageDraw
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


def shrink_front(p: np.ndarray, cut: float, k: float) -> np.ndarray:
    """cut 오른쪽만 가로로 k배 눌러 줄임 (오른쪽을 보는 그림, cut 에서 이어지게 — 이음매 없음)"""
    h, w = p.shape[:2]
    c = int(round(cut))
    if c >= w - 1:
        return p
    right = p[:, c:]
    nw = max(1, round(right.shape[1] * k))
    f = right.astype(np.float32)
    f[..., :3] *= f[..., 3:4] / 255
    g = np.asarray(Image.fromarray(f.astype(np.uint8), "RGBA").resize((nw, h), Image.LANCZOS)).astype(np.float32)
    g[..., :3] = np.where(g[..., 3:4] > 0, g[..., :3] * 255 / np.maximum(g[..., 3:4], 1), 0)
    out = np.concatenate([p[:, :c], np.clip(g, 0, 255).astype(np.uint8)], 1)
    xs = np.where(out[..., 3].max(0) > 0)[0]
    return out[:, : xs.max() + 1].copy()


def _poly_mask(shape, poly) -> np.ndarray:
    img = Image.new("1", (shape[1], shape[0]), 0)
    ImageDraw.Draw(img).polygon([tuple(p) for p in poly], fill=1)
    return np.asarray(img, bool)


def grid_frames(rgba: np.ndarray, grid: list):
    """칸을 손으로 정한 시트: grid = [{"y": [y0, y1], "x": [x0, 자를 곳..., x끝]}, ...] (줄마다)
    덩어리가 절반 넘게 그 칸 안에 있으면 통째로 그 프레임 (칸 경계를 넘는 발 · 귀 · 채찍 끝도 살림),
    옆 칸까지 이어진 큰 덩어리는 칸 가로 범위만 잘라 씀. 프레임 = {"mask": 시트 크기 bool}"""
    alpha = rgba[..., 3] > 30
    lab, n = ndimage.label(ndimage.binary_closing(alpha, np.ones((5, 5))))
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    objs = ndimage.find_objects(lab)
    out = []
    for row in grid:
        y0, y1 = row["y"]
        frs = []
        for x0, x1 in zip(row["x"][:-1], row["x"][1:]):
            cell = lab[y0:y1, x0:x1]
            ids, cnt = np.unique(cell[cell > 0], return_counts=True)
            # 옆 칸까지 크게 걸친 덩어리(붙어 버린 두 프레임 · 긴 채찍)는 통째로 안 가져옴
            mg, mgy = 0.3 * (x1 - x0), 0.3 * (y1 - y0)
            inside = lambda i: (
                objs[i - 1][1].start >= x0 - mg and objs[i - 1][1].stop <= x1 + mg
                and objs[i - 1][0].start >= y0 - mgy and objs[i - 1][0].stop <= y1 + mgy
            )
            full = [int(i) for i, k in zip(ids, cnt) if k >= 0.5 * sizes[i - 1] and inside(i)]
            part = [int(i) for i, k in zip(ids, cnt) if int(i) not in full and (k >= 0.3 * sizes[i - 1] or k >= 6000)]
            m = np.isin(lab, full)
            pm = np.zeros_like(m)
            pm[y0:y1, x0:x1] = np.isin(cell, part)
            m |= pm
            if "own" in row:
                # 옆 그림과 붙거나 겹친 곳(옆 그림 마이크 끝이 몸에 닿는 등)은 칸 경계 대신 own 다각형으로 나눔:
                # own = [[칸, [[x, y], ...]], ...] — 다각형 안 그림은 전부 그 칸 몫 (다른 칸에선 뺌)
                for oc, poly in row["own"]:
                    pg = _poly_mask(lab.shape, poly)
                    if oc == len(frs):
                        m |= pg & (lab > 0)
                    else:
                        m &= ~pg
            frs.append({"mask": m})
        out.append(frs)
    return out, lab


def _frame_mask(fr: dict, lab: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    if "mask" in fr:
        return fr["mask"] & alpha
    x0, y0, x1, y1 = fr["box"]
    if "clip" in fr:
        x0, x1 = fr["clip"]
    m = np.zeros(alpha.shape, bool)
    m[y0:y1, x0:x1] = np.isin(lab[y0:y1, x0:x1], fr["ids"])
    return m & alpha


def fix_orphans(rgba: np.ndarray, out: list, lab: np.ndarray):
    """칸 경계(곧은 선)로 잘린 덩어리 정리: 한 프레임 안에서 몸과 안 이어진 조각(옆 칸 그림의 팔 · 이펙트 끝이
    경계를 넘어 들어온 것)은, 경계 건너 옆 프레임의 몸에 닿아 있으면 그 프레임으로 옮김.
    (내 몸에서 잘려 나간 조각은 되돌아오고, 옆 그림 조각은 빠짐) — 시트 설정 "orphans": false 로 끔"""
    alpha = rgba[..., 3] > 30
    st = np.ones((3, 3), bool)
    for row in out:
        if len(row) < 2:
            continue
        masks = [_frame_mask(fr, lab, alpha) for fr in row]
        # 여러 프레임에 나뉘어 들어간 덩어리만
        shared = {}
        for fi, m in enumerate(masks):
            for L in np.unique(lab[m]):
                if L:
                    shared.setdefault(int(L), []).append(fi)
        shared = {L: fs for L, fs in shared.items() if len(fs) > 1}
        if not shared:
            continue
        changed = False
        for _ in range(3):
            body = []
            for m in masks:
                bl, bn = ndimage.label(m, st)
                if bn == 0:
                    body.append(np.zeros_like(m))
                    continue
                sz = ndimage.sum(m, bl, range(1, bn + 1))
                body.append(bl == int(np.argmax(sz)) + 1)
            moved = False
            for L, fs in shared.items():
                bm = lab == L
                for fi in fs:
                    piece = masks[fi] & bm
                    pl, pn = ndimage.label(piece, st)
                    for j in range(1, pn + 1):
                        comp = pl == j
                        if (comp & body[fi]).any():
                            continue
                        near = ndimage.binary_dilation(comp, st, iterations=2)
                        for fd in fs:
                            if fd != fi and (near & body[fd]).any():
                                masks[fi] &= ~comp
                                masks[fd] |= comp
                                moved = changed = True
                                break
            if not moved:
                break
        if changed:
            for fr, m in zip(row, masks):
                fr["mask"] = m


class Sheets:
    def __init__(self, src: Path, cfg: dict):
        self.src = src
        self.cfg = cfg
        self.cache = {}

    def get(self, name):
        if name not in self.cache:
            c = self.cfg[name]
            rgba = cut.key(Image.open(self.src / c["file"]), c["bg"])
            if "grid" in c:
                out, lab = grid_frames(rgba, c["grid"])
            else:
                out, lab = cut.segment(rgba, c["rows"], {int(k): v for k, v in c.get("splits", {}).items()})
            if c.get("orphans", True):
                fix_orphans(rgba, out, lab)
            self.cache[name] = (rgba, out, lab)
        return self.cache[name]

    def frame(self, ref: str) -> np.ndarray:
        name, rc = ref.split(":")
        r, c = map(int, rc.split("."))
        rgba, out, lab = self.get(name)
        fr = out[r][c]
        if "mask" in fr:
            ys, xs = np.where(fr["mask"] & (rgba[..., 3] > 30))
            sub = rgba[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1].copy()
            sub[..., 3] = np.where(fr["mask"][ys.min() : ys.max() + 1, xs.min() : xs.max() + 1], sub[..., 3], 0)
            return sub
        piece, _ = cut.crop(rgba, lab, fr)
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
    # 앞으로 뻗은 이펙트가 판정보다 너무 커 보이는 프레임: 앞쪽(발 기준 x 픽셀부터)만 k배로 줄임 (몸은 그대로)
    #   "shrinkFx": {"시트:행.칸": [x, k]} (저장 크기 기준)
    for ref, (fx_x, k) in spec.get("shrinkFx", {}).items():
        if ref in seen:
            i = seen[ref]
            pieces[i] = shrink_front(pieces[i], anchors[i][0] + fx_x, k)
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
