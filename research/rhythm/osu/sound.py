# 같은 소리 → 같은 레인 일관성: 노트 시각의 음색(12밴드 로그 에너지, 60ms)이 거의 같은 노트 쌍(8마디 안)에서 레인이 같은 비율
import json, sys, os, numpy as np, collections, random, statistics as S
sys.path.insert(0, '/home/claude/ref')
from align import load, SR
random.seed(2)
def band(lv): return 'easy' if lv<3.5 else 'normal' if lv<6.5 else 'hard' if lv<11.5 else 'expert' if lv<14.5 else 'nm'
def timbre(x, times):
    N = 1024; H = 256; n = (len(x)-N)//H; win = np.hanning(N)
    frames = np.lib.stride_tricks.as_strided(x, (n, N), (x.strides[0]*H, x.strides[0]))
    Sx = np.abs(np.fft.rfft(frames*win, axis=1)); edges = np.geomspace(2, Sx.shape[1]-1, 13).astype(int)
    B = np.stack([np.log1p(Sx[:, edges[i]:edges[i+1]].sum(1)) for i in range(12)], 1)
    fr = SR/H; out = []
    for t in times:
        i = int(t*fr); seg = B[max(0,i):i+5]
        out.append(seg.mean(0) if len(seg) else np.zeros(12))
    F = np.array(out); F = (F - F.mean(0)) / (F.std(0)+1e-6); F /= (np.linalg.norm(F, axis=1, keepdims=True)+1e-9)
    return F
def consist(notes_s, x, bl):
    # 단노트만 (동시치기는 레인 모호)
    R = collections.defaultdict(set)
    for t, l in notes_s: R[round(t, 3)].add(l)
    single = sorted((t, next(iter(ls))) for t, ls in R.items() if len(ls) == 1)
    if len(single) < 60: return None
    ts = [t for t, _ in single]; ls = [l for _, l in single]
    F = timbre(x, ts)
    same = 0; n = 0; base = 0; bn = 0
    for i in range(len(ts)):
        for j in range(i+1, len(ts)):
            if ts[j] - ts[i] > bl*32: break
            if ts[j] - ts[i] < bl*0.5: continue
            c = float(F[i] @ F[j])
            if c > 0.95: n += 1; same += ls[i] == ls[j]
            elif c < 0.3 and random.random() < 0.1: bn += 1; base += ls[i] == ls[j]
    if n < 30 or bn < 30: return None
    return same/n, base/bn, n
if __name__ == '__main__':
    cs = json.load(open('/home/claude/osz2/charts_new.json'))
    bysets = collections.defaultdict(list)
    for c in cs: bysets[c['set']].append(c)
    res = collections.defaultdict(list); audio = {}
    for st, charts in bysets.items():
        sid = st.split()[0]
        try: x = load(f'/home/claude/osz2/audio/osu_audio/{sid}.mp3')
        except Exception: continue
        audio[sid] = x
        for c in charts:
            if c['stars'] <= 0 or len(c['tps']) > 3: continue
            bl = c['tps'][0][1]/1000
            r = consist([(t/1000, l) for t, l, *_ in c['notes']], x, bl)
            if r: res[band(c['stars']*4)].append(r)
    print('osu: same-sound pairs → same lane | different-sound pairs → same lane (baseline 0.25)')
    for b in ['normal','hard','expert','nm']:
        L = res[b]
        if L: print(f'{b:7}{len(L):3}  {S.median(r[0] for r in L):.2f}  |  {S.median(r[1] for r in L):.2f}')
    for d in sys.argv[1:]:
        res = collections.defaultdict(list)
        for fn in os.listdir(d):
            O = json.load(open(os.path.join(d, fn)))
            if not isinstance(O, dict) or 'charts' not in O: continue
            sid = fn[:-5]
            if sid not in audio:
                try: audio[sid] = load(f'/home/claude/osz2/audio/osu_audio/{sid}.mp3')
                except Exception: continue
            bl = 60/O['bpm']
            for k, ch in O['charts'].items():
                r = consist([(n[0], n[1]) for n in ch['notes']], audio[sid], bl)
                if r: res[band(ch['level'])].append(r)
        print(f'== {d}')
        for b in ['normal','hard','expert','nm']:
            L = res[b]
            if L: print(f'{b:7}{len(L):3}  {S.median(r[0] for r in L):.2f}  |  {S.median(r[1] for r in L):.2f}')
