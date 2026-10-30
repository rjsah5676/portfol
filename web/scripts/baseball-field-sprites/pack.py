# 굽은 렌더(256 칸) → 픽셀 스프라이트 시트 + 팀색 마스크 시트 + json
# python3 pack.py bk_fd fd   → out/field_fd.webp · out/field_fd_mask.png · out/field_fd.json
import sys, os, json, numpy as np
from PIL import Image
SRC, NAME = sys.argv[1], sys.argv[2]
F = int(os.environ.get('F', 3)); K = int(os.environ.get('K', 48))
OUT = os.environ.get('OUT', 'packout3')
os.makedirs(OUT, exist_ok=True)
meta = json.load(open(f'{SRC}/meta.json'))
acts = meta['acts']

def block(a, F):
    H = a.shape[0] // F * F
    a = a[:H, :H]
    n = H // F
    return a.reshape(n, F, n, F, -1).transpose(0, 2, 1, 3, 4).reshape(n, n, F * F, a.shape[-1])

cells = {}
allpx = []
for tag, A in acts.items():
    for d in range(8):
        for i in range(A['n']):
            a = np.asarray(Image.open(f'{SRC}/{tag}_d{d}_f{i}.png').convert('RGBA')).astype(np.float32) / 255
            m = np.asarray(Image.open(f'{SRC}/{tag}_d{d}_f{i}_m.png').convert('RGBA')).astype(np.float32) / 255
            b = block(a, F)
            al = b[..., 3]
            opaque = al.mean(axis=2) > 0.42
            rgb = np.where(al[..., None] > 0.5, b[..., :3], np.nan)
            with np.errstate(all='ignore'):
                rgb = np.nan_to_num(np.nanmedian(rgb, axis=2))
            mb = block(m, F)
            # 팀색 칸: 불투명 픽셀 중 마스크 흰색이 절반 넘으면
            mm = np.where(mb[..., 3] > 0.5, mb[..., 0], np.nan)
            with np.errstate(all='ignore'):
                team = np.nan_to_num(np.nanmedian(mm, axis=2)) > 0.5
            team &= opaque
            if os.environ.get('ENH', '1') == '1':
                # 또렷하게: 대비 · 채도 조금 올리고, 몸 안쪽 경계(팔 · 다리 겹침 등 밝기 차가 큰 곳)의 어두운 쪽을 진하게 = 안쪽 선
                lum = rgb @ np.array([0.299, 0.587, 0.114])
                mean = rgb.mean(axis=2, keepdims=True)
                rgb = np.clip(mean + (rgb - mean) * 1.18, 0, 1)
                rgb = np.clip((rgb - 0.5) * 1.12 + 0.5 + 0.02, 0, 1)
                L = np.where(opaque, lum, np.nan)
                nb = np.full((4,) + L.shape, np.nan)
                nb[0, 1:, :] = L[:-1, :]; nb[1, :-1, :] = L[1:, :]; nb[2, :, 1:] = L[:, :-1]; nb[3, :, :-1] = L[:, 1:]
                with np.errstate(all='ignore'):
                    mx = np.nanmax(nb, axis=0)
                edge = opaque & (mx - L > 0.28) & ~team
                rgb[edge] = rgb[edge] * 0.55
            cells[(tag, d, i)] = (rgb, opaque, team)
            allpx.append(rgb[opaque & ~team])
            allpx.append(rgb[team])
allpx = np.concatenate(allpx)
pal = Image.fromarray((allpx[None] * 255).astype(np.uint8), 'RGB').quantize(colors=K, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
OUTLINE = np.array([29, 23, 18], np.uint8)
n0 = next(iter(cells.values()))[1].shape[0]
C = n0 + 2  # 외곽선 1px 여백
# 배치: 동작마다 8방향 줄, 한 줄 = 그 동작 프레임
maxn = max(A['n'] for A in acts.values())
rows = sum(8 for _ in acts)
W, H = maxn * C, rows * C
sheet = np.zeros((H, W, 4), np.uint8)
msheet = np.zeros((H, W), np.uint8)
row = 0
jacts = {}
for tag, A in acts.items():
    jacts[tag] = {**A, 'row': row}
    for d in range(8):
        for i in range(A['n']):
            rgb, op, team = cells[(tag, d, i)]
            q = np.asarray(Image.fromarray((rgb * 255).astype(np.uint8), 'RGB').quantize(palette=pal, dither=Image.Dither.NONE).convert('RGB'))
            out = np.zeros((C, C, 4), np.uint8)
            mm = np.zeros((C, C), bool); mm[1:-1, 1:-1] = op
            out[1:-1, 1:-1, :3] = q
            out[..., 3] = mm * 255
            ring = np.zeros_like(mm)
            ring[1:, :] |= mm[:-1, :]; ring[:-1, :] |= mm[1:, :]; ring[:, 1:] |= mm[:, :-1]; ring[:, :-1] |= mm[:, 1:]
            ring &= ~mm
            out[ring, :3] = OUTLINE; out[ring, 3] = 255
            y, x = (row + d) * C, i * C
            sheet[y:y + C, x:x + C] = out
            tm = np.zeros((C, C), np.uint8); tm[1:-1, 1:-1] = team * 255
            msheet[y:y + C, x:x + C] = tm
    row += 8
Image.fromarray(sheet, 'RGBA').save(f'{OUT}/field_{NAME}.webp', lossless=True, quality=100, method=6)
Image.fromarray(msheet, 'L').save(f'{OUT}/field_{NAME}_mask.png', optimize=True)
ax, ay = meta['anchor']
json.dump({'cell': C, 'f': F, 'ax': ax / F + 1, 'ay': ay / F + 1, 'acts': jacts}, open(f'{OUT}/field_{NAME}.json', 'w'))
print(NAME, 'sheet', W, H, 'cell', C, os.path.getsize(f'{OUT}/field_{NAME}.webp'), os.path.getsize(f'{OUT}/field_{NAME}_mask.png'))
