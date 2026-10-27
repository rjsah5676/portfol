"""
타자 스프라이트를 3D 뼈대(관절 각도 · IK)로 직접 그림 → 도트 → 층(atlas)
  python3 scripts/baseball-batter-3d.py [out.png] [미리보기 폴더]

자세는 타격 단계별 실제 동작 기준 (스탠스 → 로드 → 스트라이드 → 앞발 착지 → 골반 회전 → 배트 래그 →
임팩트 → 익스텐션 → 랩 · 피니시). 우타자 기준, 좌타는 게임에서 좌우 뒤집음.
좌표: +x = 홈플레이트 쪽(타자 정면), +z = 투수 쪽, +y = 위. 단위 ≈ 헬멧 지름.
층: fixed(외곽선 · 신발 · 하이라이트) / team(상의 · 양말) / helm / skin / pants(바지 · 장갑) / dark(벨트) / bat
"""
import json
import os
import sys
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "public/baseball/sprites/batter-v2.png"
PREV = sys.argv[2] if len(sys.argv) > 2 else None

PX = float(os.environ.get("BPX", 50))  # 1 단위 = 픽셀
LAYERS = ["fixed", "team", "helm", "skin", "pants", "dark", "bat"]
M_TEAM, M_HELM, M_SKIN, M_PANTS, M_DARK, M_BAT, M_SHOE, M_GLOVE = 1, 2, 3, 4, 5, 6, 7, 8
UP = np.array([0.0, 1.0, 0.0])


def nrm(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def yawv(deg):
    a = np.radians(deg)
    return np.array([np.cos(a), 0.0, np.sin(a)])


# ── 카메라: 포수 뒤 · 살짝 3루 쪽 · 위에서 ──
TO_CAM = nrm([float(os.environ.get("CAMX", 0.3)), 0.0, -1.0])
ELEV = np.radians(float(os.environ.get("ELEV", 20)))
TO_CAM = nrm(TO_CAM * np.cos(ELEV) + UP * np.sin(ELEV))
FWD = -TO_CAM
RIGHT = nrm(np.cross(UP, FWD))
SUP = nrm(np.cross(FWD, RIGHT))
LIGHT = nrm(TO_CAM * 0.55 + UP * 0.9 - RIGHT * 0.45)


def ik(a, t, l1, l2, pole):
    """두 마디 IK: a(어깨/골반) → t(손/발목), pole 쪽으로 굽힘"""
    a, t = np.asarray(a, float), np.asarray(t, float)
    d = t - a
    L = np.linalg.norm(d)
    L = min(L, l1 + l2 - 1e-4)
    dn = d / np.linalg.norm(d)
    t = a + dn * L
    x = (l1 * l1 - l2 * l2 + L * L) / (2 * L)
    h = np.sqrt(max(l1 * l1 - x * x, 0))
    p = np.asarray(pole, float)
    p = p - dn * np.dot(p, dn)
    p = nrm(p) if np.linalg.norm(p) > 1e-6 else nrm(np.cross(dn, UP))
    return a + dn * x + p * h, t


# ── 자세 ──
def build(k):
    """k = 키프레임 dict → 그릴 도형 목록 [(종류, 재질, 인자...)] + 등번호 자리"""
    P = np.array(k["P"], float)
    F = yawv(k["hy"])
    Lh = np.array([-F[2], 0, F[0]])  # 왼쪽 = 투수 쪽
    Fs = yawv(k["sy"])
    Ls = np.array([-Fs[2], 0, Fs[0]])
    lean = np.radians(k.get("lean", 16))
    tilt = np.radians(k.get("tilt", 0))
    U = nrm(UP * np.cos(lean) + Fs * np.sin(lean) - Ls * np.sin(tilt))
    S = P + U * 0.55
    shL, shR = S + Ls * 0.29, S - Ls * 0.29
    neck = S + U * 0.08
    H = S + U * 0.55 + np.array(k.get("head_off", [0, 0, 0]))
    hF = nrm(yawv(k.get("hyaw", 80)) * np.cos(np.radians(12)) - UP * np.sin(np.radians(12)))
    hL = nrm(np.cross(UP, hF) * -1)
    hL = np.array([-hF[2], 0, hF[0]]); hL = nrm(hL)

    prims = []
    cap = lambda m, a, b, ra, rb=None: prims.append(("cone", m, np.asarray(a, float), np.asarray(b, float), ra, ra if rb is None else rb))
    sph = lambda m, c, r: prims.append(("cone", m, np.asarray(c, float), np.asarray(c, float) + 1e-4, r, r))

    # 몸통 (상의) · 골반 (바지) · 벨트
    waist = P + U * 0.1
    cap(M_TEAM, waist, S - U * 0.06, 0.26, 0.29)
    cap(M_TEAM, shL - U * 0.04, shR - U * 0.04, 0.12)
    cap(M_PANTS, P - U * 0.02 + Lh * 0.12, P - U * 0.02 - Lh * 0.12, 0.19)
    cap(M_PANTS, P - U * 0.02, waist, 0.235)
    belt_y = (P + U * 0.07, U)
    # 목 · 머리 · 귀
    cap(M_SKIN, S, neck + U * 0.12, 0.1)
    sph(M_SKIN, H - UP * 0.06 + hF * 0.05, 0.42)
    sph(M_SKIN, H - hL * 0.43 - UP * 0.1, 0.085)
    # 헬멧 (구 + 앞아래는 열림) · 챙 · 귀덮개(투수 쪽)
    prims.append(("helmet", M_HELM, H, hF, 0.46))
    prims.append(("brim", M_HELM, H + hF * 0.42 + UP * 0.03, hF, hL))
    sph(M_HELM, H + hL * 0.39 - UP * 0.12 + hF * 0.03, 0.17)

    # 팔: 손 위치 · 배트 방향
    D = nrm(k["D"])
    Hd = np.array(k["hand"], float)
    hb = Hd  # 아래 손(왼손, 노브 쪽)
    ht = Hd + D * k.get("grip", 0.13)  # 위 손(오른손)
    for sh, hand, pole, m_up in ((shL, hb, k.get("poleL", [0, -1, 0]), M_TEAM), (shR, ht, k.get("poleR", [0, -1, -0.3]), M_TEAM)):
        el, hand2 = ik(sh, hand, 0.31, 0.3, pole)
        mid = sh + (el - sh) * 0.55
        cap(M_TEAM, sh, mid, 0.12, 0.105)
        cap(M_SKIN, mid, el, 0.095, 0.09)
        cap(M_SKIN, el, hand2, 0.088, 0.075)
        sph(M_GLOVE, hand2, 0.11)
    # 배트
    knob = Hd - D * 0.07
    cap(M_BAT, knob, knob + D * 0.5, 0.03, 0.04)
    cap(M_BAT, knob + D * 0.5, knob + D * 1.22, 0.04, 0.062)
    sph(M_BAT, knob, 0.045)

    # 다리
    for side, hip, ank, toe, heel_up, pole in (
        ("L", P + Lh * 0.13 - U * 0.05, k["footL"], k.get("toeL", 15), k.get("heelL", 0), k.get("kneeL", None)),
        ("R", P - Lh * 0.13 - U * 0.05, k["footR"], k.get("toeR", -5), k.get("heelR", 0), k.get("kneeR", None)),
    ):
        ank = np.array(ank, float)
        td = yawv(toe)
        pole = np.array(pole, float) if pole is not None else td + UP * 0.2
        kn, ank2 = ik(hip, ank, 0.38, 0.35, pole)
        cap(M_PANTS, hip, kn, 0.175, 0.15)
        sh_mid = kn + (ank2 - kn) * 0.42
        cap(M_PANTS, kn, sh_mid, 0.15, 0.135)
        cap(M_TEAM, sh_mid, ank2, 0.13, 0.11)
        # 신발: 발끝 방향 · 뒤꿈치 들기
        hu = np.radians(heel_up)
        fd = nrm(td * np.cos(hu) - UP * np.sin(hu))
        heel = ank2 - fd * 0.06 - UP * 0.04
        cap(M_SHOE, heel, heel + fd * 0.34, 0.1, 0.09)

    # 등번호 자리: 등 한가운데
    num_at = P + U * 0.36 - Fs * 0.27
    back_vis = float(np.dot(-Fs, TO_CAM))
    tip = knob + D * 1.1
    return prims, (belt_y, P, U, Fs), num_at, back_vis, tip


# ── SDF ──
def sd_cone(p, a, b, ra, rb):
    ba = b - a
    L2 = max(np.dot(ba, ba), 1e-8)
    pa = p - a
    h = np.clip((pa @ ba) / L2, 0, 1)
    d = np.linalg.norm(pa - h[..., None] * ba, axis=-1)
    return d - (ra + (rb - ra) * h)


def sd_prim(p, pr):
    kind = pr[0]
    if kind == "cone":
        return sd_cone(p, pr[2], pr[3], pr[4], pr[5])
    if kind == "helmet":
        H, hF, r = pr[2], pr[3], pr[4]
        q = p - H
        d = np.linalg.norm(q, axis=-1) - r
        cut = nrm(hF * 0.75 - UP * 0.66)
        return np.maximum(d, (q @ cut) - 0.12)
    if kind == "brim":
        c, f, l = pr[2], pr[3], pr[4]
        q = p - c
        u = np.cross(f, l)
        e = np.stack([q @ f / 0.2, q @ u / 0.035, q @ l / 0.3], -1)
        k0 = np.linalg.norm(e, axis=-1)
        return (k0 - 1) * 0.035
    raise ValueError(kind)


def render(k):
    prims, belt, num_at, back_vis, tip = build(k)
    # 화면 범위 (넉넉히)
    W, Hh = 260, 290
    ox, oy = 120, 250  # 원점(발 사이 바닥)이 오는 픽셀
    xs = (np.arange(W) + 0.5 - ox) / PX
    ys = (oy - (np.arange(Hh) + 0.5)) / PX
    gx, gy = np.meshgrid(xs, ys)
    O = gx[..., None] * RIGHT + gy[..., None] * SUP + TO_CAM * 6
    t = np.zeros(gx.shape)
    mat = np.zeros(gx.shape, int)
    hit = np.zeros(gx.shape, bool)
    alive = np.ones(gx.shape, bool)
    for _ in range(90):
        idx = np.nonzero(alive)
        if len(idx[0]) == 0:
            break
        p = O[idx] + FWD * t[idx][..., None]
        best = np.full(len(idx[0]), 9.0)
        bm = np.zeros(len(idx[0]), int)
        for pr in prims:
            d = sd_prim(p, pr)
            m = d < best
            best = np.where(m, d, best)
            bm = np.where(m, pr[1], bm)
        t[idx] += best
        done = best < 0.002
        far = t[idx] > 12
        hy_, hx_ = idx[0][done], idx[1][done]
        hit[hy_, hx_] = True
        mat[hy_, hx_] = bm[done]
        alive[idx[0][done | far], idx[1][done | far]] = False
    # 법선
    P = O + FWD * t[..., None]
    pts = P[hit]

    def field(q):
        best = np.full(len(q), 9.0)
        for pr in prims:
            best = np.minimum(best, sd_prim(q, pr))
        return best

    e = 0.004
    n = np.stack([field(pts + np.array(v) * e) - field(pts - np.array(v) * e) for v in ([1, 0, 0], [0, 1, 0], [0, 0, 1])], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
    lam = n @ LIGHT
    rim = 1 - np.abs(n @ TO_CAM)
    shade = np.where(lam < 0.12, 0, np.where(lam < 0.55, 1, 2))
    spec = (n @ nrm(LIGHT + TO_CAM)) > 0.975
    S = np.full(gx.shape, -1)
    S[hit] = shade
    SP = np.zeros(gx.shape, bool)
    SP[hit] = spec
    # 벨트 띠 · 양말 줄
    (bc, bu), Pp, U, Fs = belt
    hm = mat[hit]
    hb = np.abs((pts - bc) @ bu) < 0.045
    hm = np.where(((hm == M_PANTS) | (hm == M_TEAM)) & hb & (np.linalg.norm((pts - bc) - ((pts - bc) @ bu)[:, None] * bu, axis=-1) > 0.15), M_DARK, hm)
    mat[hit] = hm
    depth = np.where(hit, t, 99)
    return dict(hit=hit, mat=mat, shade=S, spec=SP, depth=depth, ox=ox, oy=oy, num=num_at, back=back_vis, tip=tip)


def project(p, ox, oy):
    return ox + float(np.dot(p, RIGHT)) * PX, oy - float(np.dot(p, SUP)) * PX


OUTLINE = (28, 23, 38, 255)
SHOE = [(40, 38, 52), (62, 60, 78), (96, 94, 114)]


def to_layers(r):
    hit, mat, sh, dp = r["hit"], r["mat"], r["shade"], r["depth"]
    Hh, W = hit.shape
    L = np.zeros((len(LAYERS), Hh, W, 4), np.uint8)
    lay = {M_TEAM: 1, M_HELM: 2, M_SKIN: 3, M_PANTS: 4, M_GLOVE: 4, M_DARK: 5, M_BAT: 6}
    g = np.array([128, 191, 255])
    for m, li in lay.items():
        sel = hit & (mat == m)
        v = g[np.clip(sh, 0, 2)]
        L[li][sel] = np.stack([v, v, v, np.full_like(v, 255)], -1)[sel]
    sel = hit & (mat == M_SHOE)
    for i in range(3):
        L[0][sel & (sh == i)] = SHOE[i] + (255,)
    # 하이라이트 (헬멧 · 신발 · 배트)
    hl = hit & r["spec"] & np.isin(mat, [M_HELM, M_SHOE, M_BAT])
    L[0][hl] = (255, 255, 255, 170)
    # 외곽선: 실루엣 안쪽 1px + 깊이 차이 (뒤쪽 픽셀)
    edge = np.zeros_like(hit)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        nb_hit = np.roll(np.roll(hit, dy, 0), dx, 1)
        nb_d = np.roll(np.roll(dp, dy, 0), dx, 1)
        nb_m = np.roll(np.roll(mat, dy, 0), dx, 1)
        edge |= hit & ~nb_hit
        edge |= hit & nb_hit & (dp - nb_d > 0.16)
        # 배트 · 장갑 · 팔은 몸 위로 지나갈 때 테두리 확실히
        edge |= hit & nb_hit & (dp - nb_d > 0.06) & np.isin(nb_m, [M_BAT, M_GLOVE, M_SKIN]) & (nb_m != mat)
    L[:, edge] = 0
    L[0][edge] = OUTLINE
    return L


# ── 키프레임 (우타) ──
STANCE = dict(P=[0, 0.78, 0], hy=-8, sy=-14, lean=17, footL=[0.02, 0.11, 0.47], footR=[0.0, 0.11, -0.42], toeL=18, toeR=-6,
              hand=[0.38, 1.3, -0.2], D=[-0.45, 0.8, -0.4], hyaw=78, poleL=[0.3, -1, 0.4], poleR=[-0.2, -1, -0.6])
K = {}
K["stance"] = STANCE
K["waggle"] = {**STANCE, "hand": [0.38, 1.32, -0.2], "D": [-0.35, 0.86, -0.36]}
K["load"] = {**STANCE, "P": [0, 0.78, -0.05], "hy": -20, "sy": -30, "hand": [0.32, 1.33, -0.3], "D": [-0.3, 0.88, -0.35], "kneeL": [0.6, 0.2, -0.4]}
K["stride"] = {**K["load"], "P": [0, 0.8, -0.06], "footL": [0.06, 0.22, 0.5], "toeL": 5, "heelL": -35, "kneeL": [0.8, 0.4, -0.2], "hy": -24, "sy": -32}
K["plant"] = {**K["load"], "P": [0, 0.73, 0.1], "hy": -6, "sy": -30, "footL": [0.03, 0.1, 0.78], "toeL": 28,
              "hand": [0.3, 1.31, -0.32], "D": [-0.35, 0.83, -0.42], "kneeL": None}
K["launch"] = {**K["plant"], "P": [0, 0.73, 0.13], "hy": 28, "sy": 0, "hand": [0.33, 1.22, -0.24], "D": [-0.55, 0.6, -0.58],
               "poleR": [-0.2, -1, -0.2], "heelR": 10}
K["lag"] = {**K["launch"], "P": [0, 0.74, 0.15], "hy": 55, "sy": 34, "tilt": 12, "hand": [0.4, 1.12, -0.06], "D": [-0.45, 0.5, -0.74],
            "poleR": [0, -1, -0.3], "heelR": 30, "kneeR": [0.8, 0, 0.6]}
K["contact"] = {**K["lag"], "P": [0, 0.76, 0.16], "hy": 78, "sy": 60, "tilt": 16, "lean": 14, "hand": [0.33, 1.03, 0.18], "D": [0.97, -0.1, 0.22],
                "poleL": [0, -1, 0.2], "poleR": [0, -1, -0.5], "heelR": 55, "footR": [0.08, 0.12, -0.32], "toeR": 30, "kneeR": [0.7, 0, 1]}
K["extend"] = {**K["contact"], "hy": 92, "sy": 100, "tilt": 12, "hand": [0.2, 1.1, 0.58], "D": [0.4, 0.06, 0.92], "heelR": 65, "toeR": 55}
K["wrap"] = {**K["extend"], "hy": 102, "sy": 140, "tilt": 4, "lean": 10, "hand": [-0.3, 1.55, 0.3], "D": [-0.7, 0.3, -0.65],
             "poleL": [0.3, -0.6, -0.5], "poleR": [0.6, -0.8, 0.3], "heelR": 70, "toeR": 70, "hyaw": 70}
K["finish"] = {**K["wrap"], "hand": [-0.28, 1.45, 0.28], "D": [-0.75, 0.1, -0.65], "lean": 8}
K["bunt"] = {**STANCE, "P": [0, 0.68, 0.02], "hy": 45, "sy": 70, "lean": 22, "footL": [0.1, 0.1, 0.46], "toeL": 40, "toeR": 20,
             "hand": [0.42, 1.15, 0.02], "grip": 0.42, "D": [0.94, 0.3, 0.15], "poleL": [0, -1, 0.3], "poleR": [0, -1, -0.4], "kneeR": [1, 0, 0.5]}
K["rest"] = {**STANCE, "P": [0, 0.8, 0], "hy": -5, "sy": -5, "lean": 6, "hand": [0.18, 0.88, -0.3], "D": [0.5, -0.85, 0.12], "grip": 0.11,
             "footL": [0.02, 0.1, 0.28], "footR": [0, 0.1, -0.28], "poleL": [0.2, -1, 0.2], "poleR": [0.2, -1, -0.2]}
ORDER = ["stance", "waggle", "load", "stride", "plant", "launch", "lag", "contact", "extend", "wrap", "finish", "bunt", "rest"]

if __name__ == "__main__":
    rs = [render(K[n]) for n in ORDER]
    Ls = [to_layers(r) for r in rs]
    # 칸 크기 = 모든 프레임 그림 영역 합집합
    allm = np.zeros(rs[0]["hit"].shape, bool)
    for L in Ls:
        allm |= L[:, :, :, 3].max(0) > 0
    ys, xs = np.nonzero(allm)
    y0, y1, x0, x1 = ys.min() - 1, ys.max() + 2, xs.min() - 1, xs.max() + 2
    CW, CH = x1 - x0, y1 - y0
    atlas = np.zeros((len(LAYERS) * CH, CW * len(ORDER), 4), np.uint8)
    meta = []
    for i, (r, L) in enumerate(zip(rs, Ls)):
        for li in range(len(LAYERS)):
            atlas[li * CH:(li + 1) * CH, i * CW:(i + 1) * CW] = L[li, y0:y1, x0:x1]
        ax, ay = r["ox"] - x0, r["oy"] - y0
        nx, ny = project(r["num"], r["ox"], r["oy"])
        tx, ty = project(r["tip"], r["ox"], r["oy"])
        meta.append(dict(name=ORDER[i], ax=round(float(ax), 1), ay=round(float(ay), 1), num=[int(round(nx - x0)), int(round(ny - y0))] if r["back"] > 0.6 else None, tip=[round(tx - x0, 1), round(ty - y0, 1)]))
    Image.fromarray(atlas, "RGBA").save(OUT, optimize=True)
    print(json.dumps(dict(CW=int(CW), CH=int(CH), frames=meta), ensure_ascii=False))
    if PREV:
        cols = {1: (236, 120, 52), 2: (236, 120, 52), 3: (238, 196, 160), 4: (240, 240, 244), 5: (36, 34, 50), 6: (214, 160, 92)}
        strip = np.zeros((CH, CW * len(ORDER), 4))
        for li in range(1, 7):
            lay = atlas[li * CH:(li + 1) * CH].astype(float) / 255
            c = np.array(cols[li]) / 255
            rgb = lay[..., :3] * c
            a = lay[..., 3:4]
            strip[..., :3] = strip[..., :3] * (1 - a) + rgb * a
            strip[..., 3:4] = np.maximum(strip[..., 3:4], a)
        f = atlas[:CH].astype(float) / 255
        a = f[..., 3:4]
        strip[..., :3] = strip[..., :3] * (1 - a) + f[..., :3] * a
        strip[..., 3:4] = np.maximum(strip[..., 3:4], a)
        im = Image.fromarray((strip * 255).astype(np.uint8), "RGBA")
        bg = Image.new("RGBA", im.size, (64, 98, 64, 255))
        bg.alpha_composite(im)
        bg.convert("RGB").resize((im.width * 3, im.height * 3), Image.NEAREST).save(PREV + "/frames.png")
