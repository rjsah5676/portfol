import json, sys, numpy as np, bisect
song = sys.argv[1]
R = json.load(open(f'/home/claude/ref/{song}_ref.json'))
O = json.load(open(f'/home/claude/p2/web/src/data/rhythm/{song}.json'))
sh = R['shift']
bpm = O['bpm']; beat = 60/bpm; off = O['beatOffset']
print(f'== {song}: ours bpm {bpm} beatOffset {off:.3f}; shift {sh*1000:.1f}ms')
for c in R['charts']:
    t0, bl = c['tps'][0]
    t0 = t0/1000 + sh; bl /= 1000
    # osu beat might be half (98 bpm); compare at our beat resolution
    while bl > beat*1.5: bl /= 2
    # phase error of our grid relative to osu grid at several times
    errs = []
    for T in [10, 40, 70, 100]:
        k = round((T - off)/beat); ot = off + k*beat
        j = round((ot - t0)/bl); rt = t0 + j*bl
        errs.append((ot - rt)*1000)
    print(f"  [{c['ver']}] osu bpm {60/bl:.3f} off {t0:.3f}; our grid − osu grid (ms) @10/40/70/100s:", [round(e,1) for e in errs])
    break
# note alignment vs top osu chart (union of all osu diffs as 'musical events')
ref_all = sorted(set(round(n[0]+sh, 3) for c in R['charts'] for n in c['notes']))
top = max(R['charts'], key=lambda c: len(c['notes']))
ref_top = sorted(set(round(n[0]+sh, 3) for n in top['notes']))
def near(ts, ref):
    d = []
    for t in ts:
        i = bisect.bisect_left(ref, t)
        c = [abs(ref[j]-t) for j in (i-1, i) if 0 <= j < len(ref)]
        d.append(min(c)*1000 if c else 1e9)
    return np.array(d)
for diff, ch in O['charts'].items():
    ts = sorted(set(n[0] for n in ch['notes']))
    d = near(ts, ref_all)
    med = np.median(d)
    print(f"  ours {diff:9} Lv{ch['level']:2} rows {len(ts):4}: within 25ms of ANY osu note {np.mean(d<=25)*100:5.1f}%  within 60ms {np.mean(d<=60)*100:5.1f}%  signed-median offset {np.median([ (t - ref_all[min(len(ref_all)-1,bisect.bisect_left(ref_all,t))]) for t in ts])*1000:.0f}ms")
# reverse: how many osu top-chart rows do we hit (by level)
for diff, ch in O['charts'].items():
    ts = sorted(set(n[0] for n in ch['notes']))
    d = near(ref_top, ts)
    print(f"  osu top rows covered by ours {diff:9}: {np.mean(d<=25)*100:5.1f}%")
# per-osu-chart row counts and 4s density profile correlation with ours of similar level
def prof(ts, dur, w=4):
    ts = np.array(ts); return np.array([((ts>=a)&(ts<a+w)).sum() for a in range(0, int(dur)-w, 2)])
dur = O['duration']
for c in sorted(R['charts'], key=lambda c: len(c['notes'])):
    rts = sorted(set(round(n[0]+sh, 3) for n in c['notes']))
    pr = prof(rts, dur)
    line = f"  osu [{c['ver']}] rows {len(rts):4} notes {len(c['notes']):4}:"
    for diff, ch in O['charts'].items():
        ts = sorted(set(n[0] for n in ch['notes']))
        po = prof(ts, dur)
        line += f" {diff[:2]} r={np.corrcoef(pr, po)[0,1]:.2f}"
    print(line)
