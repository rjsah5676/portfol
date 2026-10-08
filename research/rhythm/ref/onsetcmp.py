import json, sys, numpy as np, bisect
song = sys.argv[1]
R = json.load(open(f'/home/claude/ref/{song}_ref.json')); A = json.load(open(f'/home/claude/ref/{song}_an.json'))
sh = R['shift']
top = max(R['charts'], key=lambda c: len(c['notes']))
ref = sorted(set(round(n[0]+sh, 4) for n in top['notes']))
t0, bl = top['tps'][0]; t0 = t0/1000 + sh; bl /= 1000
beat = 60/A['bpm']
while bl > beat*1.5: bl /= 2
def signed(ts, ref, win=0.08):
    out = []
    for t in ts:
        i = bisect.bisect_left(ref, t)
        c = [ref[j]-t for j in (i-1, i) if 0 <= j < len(ref)]
        if c:
            d = min(c, key=abs)
            if abs(d) <= win: out.append(d*1000)
    return np.array(out)
# 1) our grid-snapped onsets vs osu: (osu − ours), positive = ours early
on = [o for o in A['onsets']]
strong = [o['t'] for o in on if o['s'] > 0.35]
d = signed(strong, ref)
print(f'{song}: strong onsets {len(strong)} matched {len(d)}  osu−ours median {np.median(d):.1f}ms  p25/p75 {np.percentile(d,25):.0f}/{np.percentile(d,75):.0f}')
# 2) our beat grid vs osu grid
errs = []
for b in A['beats']:
    j = round((b - t0)/bl); errs.append((t0 + j*bl - b)*1000)
errs = np.array(errs)
print(f'  osu grid − our beats: median {np.median(errs):.1f}ms  first10 {np.round(errs[:10],1).tolist()}  last5 {np.round(errs[-5:],1).tolist()}')
# 3) raw (unsnapped) onset timing: onsets with grid == -1 are off-grid; compare all onsets' t to grid
# 4) 16th-slot occupancy: for each osu top note, which of our grid slot it lands on; distribution of osu note − nearest our grid slot
g = np.array(A['grid'])
dd = []
for t in ref:
    i = np.searchsorted(g, t); c = [g[j]-t for j in (i-1, i) if 0 <= j < len(g)]
    dd.append(min(c, key=abs)*1000)
dd = np.array(dd)
print(f'  osu notes vs our grid slots: median {np.median(dd):.1f}ms, |d|>20ms: {np.mean(np.abs(dd)>20)*100:.1f}%  (grid step {(g[1]-g[0])*1000:.1f}ms)')
