import json, sys, numpy as np, bisect
for song in ['anima','aragami']:
    R=json.load(open(f'{song}_ref.json')); A=json.load(open(sys.argv[1].replace('SONG',song)))
    sh=R['shift']; top=max(R['charts'],key=lambda c:len(c['notes']))
    ref=sorted(set(round(n[0]+sh,4) for n in top['notes']))
    ons=sorted(o['t'] for o in A['onsets']); strong=sorted(o['t'] for o in A['onsets'] if o['s']>0.35)
    def cov(ref,ts,w=0.025):
        n=0
        for t in ref:
            i=bisect.bisect_left(ts,t)
            if any(abs(ts[j]-t)<=w for j in (i-1,i) if 0<=j<len(ts)): n+=1
        return n/len(ref)
    print(f'{song}: onsets {len(ons)} (strong {len(strong)})  osu-top rows covered by any onset {cov(ref,ons)*100:.1f}%  by strong {cov(ref,strong)*100:.1f}%   onsets that are near an osu row {cov(ons,ref)*100:.1f}%')
