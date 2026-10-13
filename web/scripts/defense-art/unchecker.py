"""가짜 투명 배경(회색 · 흰 체커 무늬가 그림에 박힌 것) 지우기 → 진짜 투명 PNG
  python3 unchecker.py in.png out.png
ChatGPT 가 "투명 배경" 을 체커 무늬로 그려 줄 때. 테두리에서 이어진 회색 칸 + 안쪽에 갇힌 체커 덩어리(두 톤이 섞인 것)를 지우고,
그 둘레 1px 의 밝은 회색 번짐도 지움. 캐릭터는 굵은 외곽선이 있어서 안쪽 흰 머리 · 갑옷은 남음.
"""
import sys, numpy as np
from PIL import Image
from scipy import ndimage

src, dst = sys.argv[1], sys.argv[2]
a = np.array(Image.open(src).convert('RGB')).astype(int)
mx, mn = a.max(2), a.min(2)
gray = (mx - mn < 14) & (mn > 192)
lab, n = ndimage.label(gray)
bg = np.zeros_like(gray)
edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
idx = np.arange(1, n + 1)
area = ndimage.sum(gray, lab, idx)
dark = ndimage.sum(gray & (mn < 232), lab, idx)
for k in idx:
    if k in edge:
        bg |= lab == k
    elif area[k - 1] >= 120:
        f = dark[k - 1] / area[k - 1]
        if 0.2 < f < 0.8:  # 체커 두 톤이 섞인 갇힌 덩어리
            bg |= lab == k
# 둘레 번짐 (밝고 색 없는 픽셀) 1~2px
for _ in range(2):
    ring = ndimage.binary_dilation(bg) & ~bg & (mx - mn < 30) & (mn > 165)
    bg |= ring
alpha = np.where(bg, 0, 255).astype(np.uint8)
out = np.dstack([a.astype(np.uint8), alpha])
Image.fromarray(out, 'RGBA').save(dst)
print('bg', bg.mean().round(3))
