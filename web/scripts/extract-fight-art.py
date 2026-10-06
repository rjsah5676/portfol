#!/usr/bin/env python3
"""
격투게임 화면용 그림 잘라내기 (캐릭터 설정화·이펙트 그림 → 배경 지운 webp)

  python3 scripts/extract-fight-art.py <카이·이그나 설정화.png> <화염구.png> <맵.png> [<소영·릴리 설정화.png>]

만드는 것 (public/fight/)
  art/<id>.webp       캐릭터 선택 화면 전신 그림
  art/<id>-face.webp  체력바·선택 화면 얼굴 그림
  fx/igna-fireball.webp  이그나 화염구 (오른쪽을 보는 그림)
  bg/<맵>-thumb.webp  맵 선택 화면 썸네일
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

OUT = Path("public/fight")

# 설정화(1536×1024) 안의 위치
ART = {
    "kai": dict(full=(4, 88, 291, 742), face=(35, 911, 135, 989), keep_dark=True),
    "igna": dict(full=(775, 84, 1058, 739), face=(804, 911, 906, 989), keep_dark=False),
}
# 두 번째 설정화
ART2 = {
    # 아래쪽 스킬 예시 칸과 다리가 겹침 → y 765 아래는 오른발(x 188~262)만 남김
    "soyoung": dict(full=(0, 131, 306, 892), face=(20, 898, 106, 967), keep_dark=True, below=(752, 190, 252)),
    "lily": dict(full=(783, 133, 1076, 714), face=(797, 906, 871, 965), keep_dark=False),
}
FIREBALL = (340, 270, 850, 570)


def cutout(im: Image.Image, keep_dark: bool, near_t=32, below=None) -> Image.Image:
    """테두리와 이어진 배경색 영역을 지우고 그림만 남김"""
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    q = (a // 4).astype(int).reshape(-1, 3)
    vals, cnt = np.unique(q, axis=0, return_counts=True)
    bg = a.reshape(-1, 3)[(q == vals[cnt.argmax()]).all(1)].mean(0)
    dist = np.abs(a - bg).sum(2)
    near = dist < near_t
    if keep_dark:
        near &= a.mean(2) >= bg.mean() - 10
    lab, n = ndimage.label(near)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    hard = np.isin(lab, list(edge))
    fg = ~hard
    # 작은 부스러기 지우고 구멍 메우기
    lab2, n2 = ndimage.label(fg, structure=np.ones((3, 3)))
    if n2:
        sizes = ndimage.sum(np.ones_like(dist), lab2, range(1, n2 + 1))
        keep = np.zeros(n2 + 1, bool)
        keep[1:] = sizes >= 40
        fg = keep[lab2]
    fg = ndimage.binary_fill_holes(fg)
    # 배경 격자선 조각: 가늘고(열기 연산에 지워짐) 배경보다 살짝만 어두운 픽셀
    thin = fg & ~ndimage.binary_opening(fg, np.ones((3, 3)))
    fg &= ~(thin & (a.mean(2) >= bg.mean() - 18))
    # 바깥 가장자리 중 배경색에 가까운 픽셀을 두 겹까지 벗겨 냄 (지저분한 테두리 방지)
    for _ in range(2):
        rim = fg & ~ndimage.binary_erosion(fg, np.ones((3, 3)))
        fg &= ~(rim & (dist < 60))
    if below:
        y, x0, x1 = below
        cut = np.zeros_like(fg)
        cut[y:, :] = True
        cut[y:, x0:x1] = False
        # 남긴 칸 안에서는 칸 배경색과 비슷하면서 칸 가장자리에 이어진 영역만 지움
        zone = a[y:, x0:x1]
        zq = (zone // 6).astype(int).reshape(-1, 3)
        zv, zc = np.unique(zq, axis=0, return_counts=True)
        zbg = zone.reshape(-1, 3)[(zq == zv[zc.argmax()]).all(1)].mean(0)
        zl, _ = ndimage.label(np.abs(zone - zbg).sum(2) < 28)
        border = set(np.unique(np.concatenate([zl[:, 0], zl[:, -1], zl[-1]]))) - {0}
        cut[y:, x0:x1] = np.isin(zl, list(border))
        fg &= ~cut
        # 그 칸의 부스러기 정리
        fg[y:] = ndimage.binary_opening(fg[y:], np.ones((3, 3)))
    alpha = fg.astype(np.float32)
    out = np.dstack([a, alpha * 255]).astype(np.uint8)
    ys, xs = np.where(fg)
    return Image.fromarray(out, "RGBA").crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def glow_cutout(im: Image.Image) -> Image.Image:
    """빛나는 이펙트: 어두운 배경과의 밝기 차이를 알파로 (번짐 유지)"""
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    bg = np.median(a.reshape(-1, 3), axis=0)
    d = np.clip((a - bg).max(2), 0, None)
    alpha = np.clip((d - 22) / 35, 0, 1)
    alpha[ndimage.binary_fill_holes(alpha > 0.5)] = 1
    rgb = np.clip(bg + (a - bg) / np.maximum(alpha, 1e-3)[..., None], 0, 255)
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    ys, xs = np.where(alpha > 0.04)
    return Image.fromarray(out, "RGBA").crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def extract(src: Image.Image, art: dict):
    for cid, d in art.items():
        b = d.get("below")
        if b:
            b = (b[0] - d["full"][1], b[1] - d["full"][0], b[2] - d["full"][0])
        full = cutout(src.crop(d["full"]), d["keep_dark"], below=b)
        full.save(OUT / "art" / f"{cid}.webp", "WEBP", quality=90, method=6)
        face = src.crop(d["face"]).resize((160, 128), Image.NEAREST)
        face.save(OUT / "art" / f"{cid}-face.webp", "WEBP", quality=90, method=6)
        print(cid, full.size)


def main(sheet: str, fireball: str, map_img: str, sheet2: str | None = None):
    (OUT / "art").mkdir(parents=True, exist_ok=True)
    (OUT / "fx").mkdir(parents=True, exist_ok=True)
    extract(Image.open(sheet).convert("RGB"), ART)
    if sheet2:
        extract(Image.open(sheet2).convert("RGB"), ART2)
    fb = glow_cutout(Image.open(fireball).crop(FIREBALL))
    fb.save(OUT / "fx" / "igna-fireball.webp", "WEBP", quality=90, method=6)
    print("fireball", fb.size)
    Image.open(map_img).convert("RGB").resize((480, 270), Image.LANCZOS).save(
        OUT / "bg" / "temple-thumb.webp", "WEBP", quality=85, method=6
    )


if __name__ == "__main__":
    main(*sys.argv[1:5])
