# 같은 곡·가장 가까운 레벨 쌍에서: 줄(시각) 겹침 F1(±25ms), 겹친 줄의 동시치기 개수 일치율, 손(좌/우) 일치율(거울 허용)
import json,glob,os,sys,collections,bisect,statistics as S
osu=json.load(open('charts_new.json'))
bySet=collections.defaultdict(list)
for c in osu: bySet[c['set'].split(' ')[0]].append(c)
def band(lv): return 'normal' if lv<6.5 else 'hard' if lv<11.5 else 'expert' if lv<14.5 else 'nm'
d=sys.argv[1]
stars=json.load(open(d+'/_stars.json'))
res=collections.defaultdict(list)
for o in stars:
    L=bySet.get(o['id'])
    if not L: continue
    for dn,ch in o['charts'].items():
        lv=ch['stars']*4 if ch.get('stars') else ch['level']
        best=min(L,key=lambda c:abs(c['stars']*4-lv))
        if abs(best['stars']*4-lv)>1.5: continue
        A=collections.OrderedDict()
        for n in ch['notes']: A.setdefault(round(n[0]*1000),set()).add(n[1])
        B=collections.OrderedDict()
        for n in best['notes']: B.setdefault(n[0],set()).add(n[1])
        ta=list(A); tb=list(B)
        used=set(); match=[]
        for t in ta:
            i=bisect.bisect_left(tb,t)
            cand=[j for j in (i-1,i,i+1) if 0<=j<len(tb) and abs(tb[j]-t)<=25 and j not in used]
            if cand:
                j=min(cand,key=lambda j:abs(tb[j]-t)); used.add(j); match.append((A[t],B[tb[j]]))
        if not match: continue
        P=len(match)/len(ta); R=len(match)/len(tb); F=2*P*R/(P+R)
        size=sum(1 for a,b in match if len(a)==len(b))/len(match)
        hand=lambda L:tuple(sorted(l//2 for l in L))
        h=sum(1 for a,b in match if hand(a)==hand(b) or hand({3-x for x in a})==hand(b))/len(match)
        res[band(lv)].append((o['id'],dn,F,P,R,size,h))
for b in ['normal','hard','expert','nm']:
    L=res[b]
    if L: print(f"{b:7} n={len(L):3}  F1 {S.median(x[2] for x in L):.2f} (P {S.median(x[3] for x in L):.2f} R {S.median(x[4] for x in L):.2f})  동시개수일치 {S.median(x[5] for x in L):.2f}  손일치(거울포함) {S.median(x[6] for x in L):.2f}")
