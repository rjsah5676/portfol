# 25~50ms 어긋남의 정체: 곡마다 짝 맞은 줄의 부호 있는 차이(osu−ours) 분포, 중앙값 보정 후 F1
import json,collections,bisect,statistics as S,sys
osu=json.load(open('charts_new.json'))
bySet=collections.defaultdict(list)
for c in osu: bySet[c['set'].split(' ')[0]].append(c)
def band(lv): return 'normal' if lv<6.5 else 'hard' if lv<11.5 else 'expert' if lv<14.5 else 'nm'
stars=json.load(open(sys.argv[1]+'/_stars.json'))
def matchF(ta,tb,w):
    used=set(); m=0
    for t in ta:
        i=bisect.bisect_left(tb,t)
        cand=[j for j in (i-1,i,i+1) if 0<=j<len(tb) and abs(tb[j]-t)<=w and j not in used]
        if cand: used.add(min(cand,key=lambda j:abs(tb[j]-t))); m+=1
    P=m/max(1,len(ta)); R=m/max(1,len(tb)); return 2*P*R/max(1e-9,P+R)
res=collections.defaultdict(list); meds=[]
for o in stars:
    L=bySet.get(o['id'])
    if not L: continue
    for dn,ch in o['charts'].items():
        lv=ch['stars']*4 if ch.get('stars') else ch['level']
        best=min(L,key=lambda c:abs(c['stars']*4-lv))
        if abs(best['stars']*4-lv)>1.5: continue
        ta=sorted(set(round(n[0]*1000) for n in ch['notes'])); tb=sorted(set(n[0] for n in best['notes']))
        # 부호 있는 차이 (±60ms)
        ds=[]
        for t in ta:
            i=bisect.bisect_left(tb,t)
            c2=[tb[j]-t for j in (i-1,i) if 0<=j<len(tb)]
            if c2:
                d=min(c2,key=abs)
                if abs(d)<=60: ds.append(d)
        if len(ds)<30: continue
        med=S.median(ds)
        f0=matchF(ta,tb,25)
        ta2=[t+med for t in ta]
        f1=matchF(ta2,tb,25)
        mad=S.median([abs(x-med) for x in ds])
        res[band(lv)].append((f0,f1,med,mad))
        if dn=='expert': meds.append(med)
for b in ['normal','hard','expert','nm']:
    L=res[b]
    if L: print(f"{b:7} n={len(L):3}  F1±25 {S.median(x[0] for x in L):.2f} → 곡별 상수 보정 후 {S.median(x[1] for x in L):.2f}   |중앙값| {S.median(abs(x[2]) for x in L):4.1f}ms  흔들림MAD {S.median(x[3] for x in L):4.1f}ms")
import numpy as np
print('expert 곡별 중앙값 분포(ms):', [round(x) for x in sorted(meds)][:40])
