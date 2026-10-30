# 지피티 구장 그림 → 배치 맞춤(ECC 아핀) → 보통 788 · 확대 1575, 고정 팔레트 (흰 선 · 베이스는 흰색 유지)
import sys, numpy as np, cv2
from PIL import Image
SRC, REF, OUT = sys.argv[1:4]
g = np.array(Image.open(SRC).convert('RGB'))
r = np.array(Image.open(REF).convert('RGB'))
H, W = r.shape[:2]
gs = cv2.resize(g, (W, H), interpolation=cv2.INTER_AREA)
def feat(a):
    a = a.astype(int); R, G, B = a[..., 0], a[..., 1], a[..., 2]
    d = ((R > 140) & (R - B > 50) & (G > 80) & (R > G)).astype(np.float32)
    gr = ((G > R + 30) & (G > B + 20)).astype(np.float32)
    return cv2.GaussianBlur(d + gr * 0.5, (0, 0), 3)
M = np.eye(2, 3, dtype=np.float32)
cc, M = cv2.findTransformECC(feat(r), feat(gs), M, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), None, 5)
print('ecc', round(cc, 4), M.round(4).tolist())
al = cv2.warpAffine(gs, M, (W, H), flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
def finish(img, size, pal=None):
    im = Image.fromarray(img).resize(size, Image.BOX if size[0] < W else Image.LANCZOS)
    a = np.array(im).astype(int)
    white = (a.min(-1) > 200) & (a.max(-1) - a.min(-1) < 40)
    if pal is None:
        pal = Image.fromarray(a.astype(np.uint8)).quantize(colors=72, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    q = np.array(Image.fromarray(a.astype(np.uint8)).quantize(palette=pal, dither=Image.Dither.NONE).convert('RGB'))
    q[white] = [245, 245, 240]
    return q, pal
n, pal = finish(al, (788, 443))
h, _ = finish(al, (1575, 886), pal)
Image.fromarray(n).save(f'{OUT}/field_bg.webp', lossless=True, quality=100, method=6)
Image.fromarray(h).save(f'{OUT}/field_bg_hd.webp', lossless=True, quality=100, method=6)
