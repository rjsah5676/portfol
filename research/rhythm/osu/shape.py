# 채보 '모양' 통계: osu vs ours — 마디 단위 패턴의 지역 반복(모티프 일관성), 레인 전이 예측 가능성, 거울 대칭, 손 번갈기, 앵커(같은 레인 연타 몰림)
import json, sys, numpy as np, collections, os, statistics as S
def band(lv): return 'easy' if lv<3.5 else 'normal' if lv<6.5 else 'hard' if lv<11.5 else 'expert' if lv<14.5 else 'nm'
def rows_of(notes_ms):
    R = collections.OrderedDict()
    for n in notes_ms: R.setdefault(n[0], set()).add(n[1])
    return list(R.items())
def bar_patterns(notes_ms, t0, bl):
    # bar → set of (16분 칸, lane)
    bars = collections.defaultdict(set)
    for t, l, *_ in notes_ms:
        b = int((t - t0) // (bl*4))
        s = int(round((t - t0 - b*bl*4) / (bl/4)))
        bars[b].add((s % 16, l))
    return bars
def jac(a, b): return len(a & b)/len(a | b) if (a|b) else 1.0
def feats(notes_ms, t0, bl):
    rows = rows_of(sorted(notes_ms))
    if len(rows) < 50: return None
    f = {}
    # 1) 지역 모티프 일관성: 리듬이 같은(칸 집합 jac>0.75) 이웃 마디(거리 1~2, 4)에서 레인까지 같은 비율(거울 포함)
    bars = bar_patterns(notes_ms, t0, bl)
    keys = sorted(bars)
    def rhythm(b): return {s for s, _ in bars[b]}
    def lanes(b): return bars[b]
    mir = lambda L: {(s, 3-l) for s, l in L}
    for name, dists in [('loc12', (1, 2)), ('loc4', (4,)), ('far8', (8, 16))]:
        v = []
        for b in keys:
            if len(rhythm(b)) < 3: continue
            for d in dists:
                if b + d in bars and jac(rhythm(b), rhythm(b+d)) > 0.75:
                    v.append(max(jac(lanes(b), lanes(b+d)), jac(mir(lanes(b)), lanes(b+d))))
        f[name] = float(np.mean(v)) if len(v) >= 5 else None
        f[name+'_n'] = len(v)
    # 2) 레인 전이 예측 가능성(단노트 연속): 이전 두 레인 → 다음 레인 분포의 조건부 엔트로피 (낮을수록 규칙적)
    single = [next(iter(ls)) for _, ls in rows if len(ls) == 1]
    tr = collections.Counter(); ctx = collections.Counter()
    for i in range(2, len(single)):
        tr[(single[i-2], single[i-1], single[i])] += 1; ctx[(single[i-2], single[i-1])] += 1
    H = 0
    for k, n in tr.items():
        p = n / ctx[k[:2]]; H -= (n / len(single)) * np.log2(p)
    f['H'] = float(H)
    # 3) 손 번갈기(단노트): 다음 노트가 다른 손일 비율 / 같은 레인 연타(잭) 비율
    alt = sum(1 for i in range(1, len(single)) if (single[i] < 2) != (single[i-1] < 2)) / max(1, len(single)-1)
    f['alt'] = alt
    # 4) 레인 균형(엔트로피, 최대 2.0)
    cnt = collections.Counter(l for _, ls in rows for l in ls); tot = sum(cnt.values())
    f['laneH'] = float(-sum((c/tot)*np.log2(c/tot) for c in cnt.values()))
    # 5) 동시치기 모양 분포: 양끝(0,3) / 한손(01,23) / 안쪽(12) / 교차(02,13)
    ch = collections.Counter()
    for _, ls in rows:
        if len(ls) == 2:
            a, b = sorted(ls)
            ch['edge' if (a, b) == (0, 3) else 'hand' if (a, b) in ((0, 1), (2, 3)) else 'inner' if (a, b) == (1, 2) else 'cross'] += 1
    t2 = sum(ch.values()) or 1
    for k in ('edge', 'hand', 'inner', 'cross'): f['c_'+k] = ch[k]/t2
    # 6) 계단(연속 3개 이상 단조 한 칸씩) · 트릴(ABAB) 비율 — 빠른 단노트 연속 기준
    ts = [t for t, ls in rows if len(ls) == 1]
    st = tr_ = 0
    for i in range(3, len(single)):
        a, b, c, d = single[i-3:i+1]
        if ts[i] - ts[i-3] < bl * 3:
            if b - a == c - b == d - c and abs(b - a) == 1: st += 1
            if a == c and b == d and a != b: tr_ += 1
    f['stair'] = st / max(1, len(single)); f['trill'] = tr_ / max(1, len(single))
    return f
keys = ['loc12', 'loc4', 'far8', 'H', 'alt', 'laneH', 'c_edge', 'c_hand', 'c_inner', 'c_cross', 'stair', 'trill']
def table(rows_by_band, label):
    print(f'== {label}')
    print('band    n   ' + ' '.join(f'{k:>7}' for k in keys))
    for b in ['normal', 'hard', 'expert', 'nm']:
        L = rows_by_band[b]
        if not L: continue
        print(f'{b:7} {len(L):3}  ' + ' '.join(f"{S.median(x[k] for x in L if x[k] is not None):7.2f}" if any(x[k] is not None for x in L) else '      -' for k in keys))
if __name__ == '__main__':
    cs = json.load(open('/home/claude/osz2/charts_new.json'))
    osu = collections.defaultdict(list)
    for c in cs:
        if c['stars'] <= 0 or len(c['tps']) > 3: continue
        t0, bl, _ = c['tps'][0]
        f = feats(c['notes'], t0, bl)
        if f: osu[band(c['stars']*4)].append(f)
    table(osu, 'osu ranked')
    for d in sys.argv[1:]:
        ours = collections.defaultdict(list)
        for fn in os.listdir(d):
            O = json.load(open(os.path.join(d, fn)))
            if not isinstance(O, dict) or 'charts' not in O: continue
            bl = 60000 / O['bpm']; t0 = O['beatOffset'] * 1000
            for k, ch in O['charts'].items():
                notes = [[int(n[0]*1000), n[1]] for n in ch['notes']]
                f = feats(notes, t0, bl)
                if f: ours[band(ch['level'])].append(f)
        table(ours, d)
