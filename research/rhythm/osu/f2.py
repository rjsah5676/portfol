# 겹침을 쪼개 봄: 창 ±25/±50ms F1, 그리고 "우리 최고밀도(나이트메어) 줄"이 osu 줄을 얼마나 덮는지(선택 상한)
import json,collections,bisect,statistics as S,sys
osu=json.load(open('charts_new.json'))
bySet=collections.defaultdict(list)
for c in osu: bySet[c['set'].split(' ')[0]].append(c)
def band(lv): return 'normal' if lv<6.5 else 'hard' if lv<11.5 else 'expert' if lv<14.5 else 'nm'
stars=json.load(open(sys.argv[1]+'/_stars.json'))
def rows(notes,ms=False):
    T=sorted(set(round(n[0]*(1 if ms else 1000)) for n in notes)); return T
def matchF(ta,tb,w):
    used=set(); m=0
    for t in ta:
        i=bisect.bisect_left(tb,t)
        cand=[j for j in (i-1,i,i+1) if 0<=j<len(tb) and abs(tb[j]-t)<=w and j not in used]
        if cand: used.add(min(cand,key=lambda j:abs(tb[j]-t))); m+=1
    P=m/max(1,len(ta)); R=m/max(1,len(tb)); return 2*P*R/max(1e-9,P+R), R
res=collections.defaultdict(list)
for o in stars:
    L=bySet.get(o['id'])
    if not L: continue
    nmrows=rows(o['charts'].get('nightmare',{'notes':[]})['notes']) if 'nightmare' in o['charts'] else None
    for dn,ch in o['charts'].items():
        lv=ch['stars']*4 if ch.get('stars') else ch['level']
        best=min(L,key=lambda c:abs(c['stars']*4-lv))
        if abs(best['stars']*4-lv)>1.5: continue
        ta=rows(ch['notes']); tb=rows(best['notes'],ms=True)
        f25,_=matchF(ta,tb,25); f50,_=matchF(ta,tb,50)
        ceil=None
        if nmrows:
            _,ceil=matchF(nmrows,tb,50)  # 나이트메어 줄이 osu 줄을 덮는 비율 (재현율)
        res[band(lv)].append((f25,f50,ceil))
for b in ['normal','hard','expert','nm']:
    L=res[b]
    if L:
        c=[x[2] for x in L if x[2] is not None]
        print(f"{b:7} n={len(L):3}  F1 ±25ms {S.median(x[0] for x in L):.2f}  ±50ms {S.median(x[1] for x in L):.2f}  osu줄이 우리 NM줄에 덮임 {S.median(c):.2f}")
