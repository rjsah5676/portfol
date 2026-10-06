#!/usr/bin/env python3
"""
단색 배경 스프라이트 시트 → 프레임 조각 (격투 에셋 v2 공용).

  초록(#00FF00) 배경: 초록 정도로 투명도, 가장자리 초록 번짐 제거
  검정(#000000) 배경: 밝기를 투명도로 (빛나는 이펙트용, 번짐 유지)

칸 격자를 믿지 않고 덩어리(이어진 그림)로 프레임을 찾음:
  큰 덩어리 = 프레임, 작은 조각(떨어진 이펙트 부스러기)은 같은 줄의 가장 가까운 프레임에 붙임.
  줄은 덩어리 세로 중심을 rows 개로 묶어서 나눔. 붙어 버린 프레임은 split(가로 자를 위치)로 나눔.

  python3 scripts/fight-sheet-cut.py <시트.png> <green|black> <줄 수> [미리보기.png]
  → 줄마다 프레임 수와 위치를 출력하고, 번호 붙인 미리보기를 저장
"""
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def key(img: Image.Image, bg: str) -> np.ndarray:
    """RGBA (투명 배경)"""
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    if bg == "green":
        k = g - np.maximum(r, b)
        alpha = np.clip(1 - (k - 30) / 110, 0, 1)
        # 반투명 가장자리(불꽃 끝 등): 초록 배경이 섞인 만큼 빼서 원래 색 되살림 (c = a·색 + (1-a)·초록)
        am = np.maximum(alpha, 0.05)
        r2 = np.clip(r / am, 0, 255)
        b2 = np.clip(b / am, 0, 255)
        g2 = np.clip((g - (1 - alpha) * 255) / am, 0, 255)
        g2 = np.minimum(g2, np.maximum(r2, b2) + 8)  # 남은 초록 번짐 빼기
        rgb = np.dstack([r2, g2, b2])
    else:
        m = a.max(2)
        alpha = np.clip((m - 14) / 70, 0, 1)
        rgb = np.clip(a / np.maximum(alpha, 0.05)[..., None], 0, 255)
    alpha[alpha < 0.06] = 0
    return np.dstack([rgb, alpha * 255]).astype(np.uint8)


def _kmeans1d(v: np.ndarray, k: int) -> np.ndarray:
    c = np.quantile(v, np.linspace(0.5 / k, 1 - 0.5 / k, k))
    for _ in range(30):
        lab = np.argmin(np.abs(v[:, None] - c[None, :]), 1)
        for j in range(k):
            if (lab == j).any():
                c[j] = v[lab == j].mean()
    order = np.argsort(c)
    return np.argsort(order)[lab]


def segment(rgba: np.ndarray, rows: int, splits: dict | None = None, min_area=900, gap=None):
    """[[frame, ...] 줄마다] — frame = (x0, y0, x1, y1, 라벨 마스크 전체 크기 bool)"""
    alpha = rgba[..., 3] > 30
    closed = ndimage.binary_closing(alpha, np.ones((5, 5)))
    lab, n = ndimage.label(closed)
    if n == 0:
        return []
    area = ndimage.sum(alpha, lab, range(1, n + 1))
    objs = ndimage.find_objects(lab)
    big = [i for i in range(n) if area[i] >= min_area]
    cy = np.array([(objs[i][0].start + objs[i][0].stop) / 2 for i in big])
    rlab = _kmeans1d(cy, rows) if len(big) >= rows else np.zeros(len(big), int)
    out: list[list[dict]] = [[] for _ in range(rows)]
    for i, r in zip(big, rlab):
        sl = objs[i]
        out[r].append({"ids": [i + 1], "box": [sl[1].start, sl[0].start, sl[1].stop, sl[0].stop]})
    # 같은 줄에서 가로로 대부분 겹치는 덩어리(몸에서 떨어진 큰 이펙트 조각)는 한 프레임으로
    for r in range(rows):
        row = sorted(out[r], key=lambda f: -(f["box"][2] - f["box"][0]))
        merged: list[dict] = []
        for fr in row:
            x0, y0, x1, y1 = fr["box"]
            host = None
            for m in merged:
                ov = min(x1, m["box"][2]) - max(x0, m["box"][0])
                if ov > 0.5 * min(x1 - x0, m["box"][2] - m["box"][0]):
                    host = m
                    break
            if host:
                host["ids"] += fr["ids"]
                hb = host["box"]
                host["box"] = [min(hb[0], x0), min(hb[1], y0), max(hb[2], x1), max(hb[3], y1)]
            else:
                merged.append(fr)
        out[r] = merged
    # 붙어 버린 프레임 나누기: split[줄] = 가로 자를 위치들
    splits = splits or {}
    for r, cuts in splits.items():
        r = int(r)
        new = []
        for fr in out[r]:
            x0, y0, x1, y1 = fr["box"]
            inner = [c for c in cuts if x0 < c < x1]
            if not inner:
                new.append(fr)
                continue
            edges = [x0, *inner, x1]
            for a, b in zip(edges[:-1], edges[1:]):
                new.append({"ids": fr["ids"], "box": [a, y0, b, y1], "clip": [a, b]})
        out[r] = new
    # 작은 조각: 같은 줄에서 가장 가까운 프레임에 붙임
    for i in range(n):
        if area[i] >= min_area or area[i] < 30:
            continue
        sl = objs[i]
        cx, cyy = (sl[1].start + sl[1].stop) / 2, (sl[0].start + sl[0].stop) / 2
        best, bd = None, 1e9
        for row in out:
            for fr in row:
                x0, y0, x1, y1 = fr["box"]
                d = max(x0 - cx, 0, cx - x1) + max(y0 - cyy, 0, cyy - y1)
                if d < bd:
                    best, bd = fr, d
        if best is not None and bd < 120:
            best["ids"].append(i + 1)
            x0, y0, x1, y1 = best["box"]
            best["box"] = [min(x0, sl[1].start), min(y0, sl[0].start), max(x1, sl[1].stop), max(y1, sl[0].stop)]
    for row in out:
        row.sort(key=lambda f: f["box"][0])
    return out, lab


def crop(rgba: np.ndarray, lab: np.ndarray, fr: dict) -> np.ndarray:
    x0, y0, x1, y1 = fr["box"]
    if "clip" in fr:
        x0, x1 = fr["clip"]
    sub = rgba[y0:y1, x0:x1].copy()
    m = np.isin(lab[y0:y1, x0:x1], fr["ids"])
    # 덩어리 사이 구멍(닫힘 연산으로 메운 곳)은 원래 투명도 그대로
    sub[..., 3] = np.where(m, sub[..., 3], 0)
    ys, xs = np.where(sub[..., 3] > 30)
    if len(ys) == 0:
        return sub, (x0, y0)
    return sub[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1], (x0 + xs.min(), y0 + ys.min())


def preview(rgba, out, path):
    im = Image.fromarray(rgba, "RGBA")
    bg = Image.new("RGBA", im.size, (36, 34, 60, 255))
    bg.alpha_composite(im)
    d = ImageDraw.Draw(bg)
    for r, row in enumerate(out):
        for c, fr in enumerate(row):
            x0, y0, x1, y1 = fr["box"]
            if "clip" in fr:
                x0, x1 = fr["clip"]
            d.rectangle([x0, y0, x1, y1], outline=(255, 90, 90, 255))
            d.rectangle([x0, y0, x0 + 34, y0 + 14], fill=(0, 0, 0, 200))
            d.text((x0 + 2, y0 + 1), f"{r}.{c}", fill=(255, 255, 0, 255))
    bg.convert("RGB").save(path)


if __name__ == "__main__":
    src, bgk, rows = sys.argv[1], sys.argv[2], int(sys.argv[3])
    rgba = key(Image.open(src), bgk)
    out, lab = segment(rgba, rows)
    for r, row in enumerate(out):
        print(r, len(row), [f["box"] for f in row])
    if len(sys.argv) > 4:
        preview(rgba, out, sys.argv[4])
