import json, sys, numpy as np
sys.path.insert(0, '/home/claude/ref')
from align import load, SR
song, mp3 = sys.argv[1:3]
R = json.load(open(f'/home/claude/ref/{song}_ref.json')); A = json.load(open(f'/home/claude/ref/{song}_an.json'))
x = load(mp3)
hop = 32
n = len(x)//hop
e = np.sqrt((x[:n*hop].reshape(n, hop)**2).mean(1))
# spectral-flux-ish: log-energy rise
le = np.log(e + 1e-5); d = np.diff(le, prepend=le[0]); d[d < 0] = 0
fr = SR/hop
def score(times, lag):
    idx = np.round((np.array(times) + lag) * fr).astype(int)
    idx = idx[(idx >= 0) & (idx < len(d))]
    # take max in ±6ms to be robust
    w = int(0.006*fr)
    return np.mean([d[max(0,i-w):i+w+1].max() for i in idx])
beats = np.array(A['beats'])
lags = np.arange(-0.1, 0.1001, 0.002)
sc = [score(beats, l) for l in lags]
best = lags[int(np.argmax(sc))]
sh = R['shift']; top = max(R['charts'], key=lambda c: len(c['notes']))
t0, bl = top['tps'][0]; t0 = t0/1000 + sh; bl /= 1000
beat = 60/A['bpm']
while bl > beat*1.5: bl /= 2
ob = np.array([t0 + j*bl for j in range(int((A['duration']-t0)/bl))])
sco = [score(ob, l) for l in lags]
besto = lags[int(np.argmax(sco))]
print(f'{song}: energy-rise peak lag relative to OUR beats: {best*1000:+.0f}ms (score {max(sc):.3f} vs at 0: {score(beats,0):.3f})')
print(f'        energy-rise peak lag relative to OSU beats: {besto*1000:+.0f}ms (score {max(sco):.3f} vs at 0: {score(ob,0):.3f})')
# also on osu 16th grid (all notes)
notes = sorted(set(nn[0]+sh for nn in top['notes']))
scn = [score(notes, l) for l in lags]
print(f'        energy-rise peak lag relative to OSU notes: {lags[int(np.argmax(scn))]*1000:+.0f}ms')
