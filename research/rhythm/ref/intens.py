import json, sys, numpy as np
FPS = 22050/256
def intensity(A, w=(0.5,0.25,0.25), lo=0.35, hi=0.95, mix=(0.15,0.55,0.3)):
    beats=np.array(A['beats']); beatSec=60/A['bpm']; barSec=beatSec*4
    rms=np.array(A['rms'])
    # bar phase: like autochart (kick strongest on beat k mod 4) — approximate with onsets low*s
    ons=A['onsets']
    def lowAt(t):
        v=0
        for o in ons:
            if abs(o['t']-t)<0.03: v=max(v,o['low']*o['s'])
        return v
    best=-1;phase=0
    for k in range(4):
        s=sum(lowAt(beats[i]) for i in range(k,len(beats),4))
        if s>best: best=s;phase=k
    bar0=beats[phase]-np.ceil(beats[phase]/barSec)*barSec
    nB=int((A['duration']-bar0)/barSec)+1
    rmsBar=np.zeros(nB); hitBar=np.zeros(nB); highBar=np.zeros(nB)
    for b in range(nB):
        ts=np.arange(bar0+b*barSec, bar0+(b+1)*barSec, 0.05); ts=ts[(ts>=0)&(ts<=A['duration'])]
        idx=np.clip(np.round(ts*FPS).astype(int),0,len(rms)-1); rmsBar[b]=rms[idx].mean() if len(idx) else 0
    for o in ons:
        b=int((o['t']-bar0)//barSec)
        if 0<=b<nB: hitBar[b]+=o['s']; highBar[b]+=o['high']*o['s']
    def norm(a):
        q=np.sort(a)[int(nB*0.95)] or 1; return np.minimum(1,a/q)
    nr,nh,ng=norm(rmsBar),norm(hitBar),norm(highBar)
    v=w[0]*nr+w[1]*nh+w[2]*ng
    vp=np.concatenate([[v[0]],v[:-1]]); vn=np.concatenate([v[1:],[v[-1]]])
    mixed=mix[0]*vp+mix[1]*v+mix[2]*vn
    I=np.clip((mixed-lo)/(hi-lo),0,1)
    return bar0, barSec, I, nr, nh, ng
if __name__=='__main__':
    song=sys.argv[1]; osuname=sys.argv[2] if len(sys.argv)>2 else None
    A=json.load(open(f'/home/claude/ref/{song}_an.json'))
    bar0,barSec,I,nr,nh,ng=intensity(A)
    print(f'{song}: barSec {barSec:.3f} bars {len(I)}')
    print('bar  :', ' '.join(f'{b:3d}' for b in range(len(I))))
    print('I    :', ' '.join(f'{int(x*99):3d}' for x in I))
    print('rms  :', ' '.join(f'{int(x*99):3d}' for x in nr))
    print('hit  :', ' '.join(f'{int(x*99):3d}' for x in nh))
    print('high :', ' '.join(f'{int(x*99):3d}' for x in ng))
    if osuname:
        R=json.load(open(f'/home/claude/ref/{song}_ref.json')); sh=R['shift']
        c=[c for c in R['charts'] if c['ver']==osuname][0]
        rt=np.array(sorted(n[0]+sh for n in c['notes']))
        d=[((rt>=bar0+b*barSec)&(rt<bar0+(b+1)*barSec)).sum() for b in range(len(I))]
        print('osu/b:', ' '.join(f'{x:3d}' for x in d))
    O=json.load(open(f'/home/claude/p2/web/src/data/rhythm/{song}.json'))
    for dname in ['expert','nightmare']:
        ot=np.array(sorted(n[0] for n in O['charts'][dname]['notes']))
        d=[((ot>=bar0+b*barSec)&(ot<bar0+(b+1)*barSec)).sum() for b in range(len(I))]
        print(f'{dname[:5]}:', ' '.join(f'{x:3d}' for x in d))
