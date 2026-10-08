import json, sys, numpy as np
sys.path.insert(0, '/home/claude/ref')
from intens import intensity
song = sys.argv[1]; files = sys.argv[2:]  # label=path ...
A = json.load(open(f'/home/claude/ref/{song}_an.json'))
bar0, barSec, I, *_ = intensity(A)
nB = len(I)
print(f'{song}  (bar {barSec:.2f}s)')
print('bar  :', ' '.join(f'{b:3d}' for b in range(nB)))
print('I    :', ' '.join(f'{int(x*99):3d}' for x in I))
osu = None
try:
    R = json.load(open(f'/home/claude/ref/{song}_ref.json')); sh = R['shift']
    top = max(R['charts'], key=lambda c: len(c['notes']))
    rt = np.array(sorted(n[0]+sh for n in top['notes']))
    print('osuTop:', ' '.join(f'{((rt>=bar0+b*barSec)&(rt<bar0+(b+1)*barSec)).sum():3d}' for b in range(nB)))
except FileNotFoundError:
    pass
for lf in files:
    label, path = lf.split('=')
    O = json.load(open(path))
    for d in ['hard', 'expert', 'nightmare']:
        if d not in O['charts']: continue
        ot = np.array(sorted(n[0] for n in O['charts'][d]['notes']))
        cnt = np.array([((ot>=bar0+b*barSec)&(ot<bar0+(b+1)*barSec)).sum() for b in range(nB)])
        lo = cnt[I < 0.3]; hi = cnt[I > 0.7]
        print(f'{label[:3]}{d[:3]}Lv{O["charts"][d]["level"]:2}:', ' '.join(f'{x:3d}' for x in cnt), f' | quiet(I<.3) {lo.mean():4.1f}  loud(I>.7) {hi.mean():4.1f}  ratio {hi.mean()/max(0.1,lo.mean()):.1f}  n={len(ot)}')
