# 곡 구성 분석: 오디오가 거의 같은 마디 쌍에서 osu 채보가 얼마나 같은 패턴을 쓰는지
import json, sys, numpy as np, subprocess, collections, random
sys.path.insert(0, '/home/claude/ref')
from align import load, SR
cs = json.load(open('/home/claude/osz2/charts_new.json'))
bysets = collections.defaultdict(list)
for c in cs: bysets[c['set']].append(c)
random.seed(1)
def bar_feats(x, t0, bl, nbars, sub=8):
    # 밴드 로그 에너지 × 8 (8분 단위) per bar
    N = 2048; H = 512
    n = (len(x) - N) // H
    win = np.hanning(N)
    frames = np.lib.stride_tricks.as_strided(x, (n, N), (x.strides[0]*H, x.strides[0]))
    S = np.abs(np.fft.rfft(frames * win, axis=1))
    edges = np.geomspace(2, S.shape[1]-1, 13).astype(int)
    B = np.stack([np.log1p(S[:, edges[i]:edges[i+1]].sum(1)) for i in range(12)], 1)  # n×12
    fr = SR / H
    F = np.zeros((nbars, sub, 12))
    for b in range(nbars):
        for s in range(sub):
            a = int((t0 + b*bl*4 + s*bl*4/sub) * fr); z = int((t0 + b*bl*4 + (s+1)*bl*4/sub) * fr)
            if z <= a or z > n: continue
            F[b, s] = B[a:z].mean(0)
    return F.reshape(nbars, -1)
def patt(notes, t0, bl, b):
    a = (t0 + b*bl*4) * 1000; z = a + bl*4000  # ms
    rows = set(); lanes = set()
    for t, l, *_ in notes:
        if a - 1 <= t < z - 1:
            s = int(round((t - a) / (bl * 1000 / 4)))  # 16분 칸
            rows.add(s); lanes.add((s, l))
    return rows, lanes
def jac(a, b):
    return len(a & b) / len(a | b) if (a | b) else 1.0
out = []
sets = list(bysets.keys())
for st in sets:
    charts = bysets[st]
    sid = st.split()[0]
    mp3 = f'/home/claude/osz2/audio/osu_audio/{sid}.mp3'
    try: x = load(mp3)
    except Exception: continue
    if len(x) < SR * 10: continue
    top = max(charts, key=lambda c: c['stars'])
    t0, bl, _ = top['tps'][0]; t0 /= 1000; bl /= 1000
    # 템포 변경 많은 곡은 뺌
    if len([t for t in top['tps']]) > 3: continue
    dur = len(x) / SR
    nb = int((dur - t0) / (bl*4)) - 1
    if nb < 16: continue
    F = bar_feats(x, t0, bl, nb)
    Fn = (F - F.mean(0, keepdims=True)) / (F.std(0, keepdims=True) + 1e-6)  # 곡 안에서 차원별 z-score
    Fn /= (np.linalg.norm(Fn, axis=1, keepdims=True) + 1e-9)
    sim = Fn @ Fn.T
    for c in charts:
        P = [patt(c['notes'], t0, bl, b) for b in range(nb)]
        dens = [len(P[b][0]) for b in range(nb)]
        same_r = []; same_l = []; base_r = []; base_l = []; same_m = []; base_m = []; same_h = []; base_h = []
        mir = lambda L: {(s, 3 - l) for s, l in L}
        hand = lambda L: {(s, l // 2) for s, l in L}
        for a in range(nb):
            if dens[a] < 3: continue
            for b in range(a + 4, nb):
                if dens[b] < 3: continue
                if sim[a, b] > 0.9:
                    same_r.append(jac(P[a][0], P[b][0])); same_l.append(jac(P[a][1], P[b][1]))
                    same_m.append(max(jac(P[a][1], P[b][1]), jac(mir(P[a][1]), P[b][1]))); same_h.append(jac(hand(P[a][1]), hand(P[b][1])))
                elif -0.2 < sim[a, b] < 0.5 and random.random() < 0.05:
                    base_r.append(jac(P[a][0], P[b][0])); base_l.append(jac(P[a][1], P[b][1]))
                    base_m.append(max(jac(P[a][1], P[b][1]), jac(mir(P[a][1]), P[b][1]))); base_h.append(jac(hand(P[a][1]), hand(P[b][1])))
        if len(same_r) >= 10 and len(base_r) >= 10:
            out.append(dict(set=st, ver=c['ver'], stars=c['stars'], n=len(same_r),
                            same_r=float(np.mean(same_r)), same_l=float(np.mean(same_l)),
                            base_r=float(np.mean(base_r)), base_l=float(np.mean(base_l)),
                            exact_l=float(np.mean([v == 1.0 for v in same_l])), same_m=float(np.mean(same_m)), base_m=float(np.mean(base_m)),
                            same_h=float(np.mean(same_h)), base_h=float(np.mean(base_h)), exact_m=float(np.mean([v == 1.0 for v in same_m]))))
json.dump(out, open('/home/claude/osz2/rep_osu.json', 'w'))
import statistics as S
print('charts', len(out))
def band(s): return 'easy' if s*4 < 3.5 else 'normal' if s*4 < 6.5 else 'hard' if s*4 < 11.5 else 'expert' if s*4 < 14.5 else 'nm'
by = collections.defaultdict(list)
for o in out: by[band(o['stars'])].append(o)
print('band    n  | same-audio: timing lane lane|mirror hand exact exact|mir | dissimilar: timing lane lane|mir hand')
for b in ['easy','normal','hard','expert','nm']:
    L = by[b]
    if not L: continue
    print(f"{b:7} {len(L):3} |   {S.median(o['same_r'] for o in L):.2f}  {S.median(o['same_l'] for o in L):.2f}  {S.median(o['same_m'] for o in L):.2f}  {S.median(o['same_h'] for o in L):.2f}  {100*S.median(o['exact_l'] for o in L):3.0f}%  {100*S.median(o['exact_m'] for o in L):3.0f}%  |  {S.median(o['base_r'] for o in L):.2f}  {S.median(o['base_l'] for o in L):.2f}  {S.median(o['base_m'] for o in L):.2f}  {S.median(o['base_h'] for o in L):.2f}")
