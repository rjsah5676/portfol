"""초록 배경(#00FF00) 빼기: python3 chroma.py in.png out.png [--hard]
--hard: 몸에 초록이 없는 그림(유물)이면 남은 초록 기운 · 갇힌 초록 구멍도 다 뺌
진한 초록(배경)만 투명 → 배경에 닿은 가장자리 2px 만 초록 기운 빼기 (고블린 피부 같은 몸 안 초록은 그대로)"""
import sys, numpy as np
from PIL import Image
from scipy import ndimage
A = np.array(Image.open(sys.argv[1]).convert('RGBA')).astype(np.int32)
r, g, b = A[..., 0], A[..., 1], A[..., 2]
bg = (g > 150) & (g - np.maximum(r, b) > 80) & (r < 140) & (b < 140)
# 배경과 이어진 것만 (몸 안 초록 구멍은 남김) — 크게 열린 덩어리만
lab, n = ndimage.label(bg)
sizes = ndimage.sum(bg, lab, range(1, n + 1))
hard = '--hard' in sys.argv
keep = {i + 1 for i, s in enumerate(sizes) if s > (12 if hard else 400)}
bg = np.isin(lab, list(keep))
edge = ndimage.binary_dilation(bg, iterations=2) & ~bg
spill = (edge | (hard & (g > np.maximum(r, b) + 30))) & (g > np.maximum(r, b))
A[..., 1] = np.where(spill, np.maximum(r, b), g)
A[..., 3] = np.where(bg, 0, 255)
Image.fromarray(A.astype(np.uint8)).save(sys.argv[2])
