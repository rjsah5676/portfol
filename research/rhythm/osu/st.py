import json,collections,bisect,statistics as st,sys
cs=json.load(open(sys.argv[1]))
def band(lv): return 'easy' if lv<3.5 else 'normal' if lv<6.5 else 'hard' if lv<11.5 else 'expert' if lv<14.5 else 'nm' if lv<18.5 else '19+'
def q(v,p):
    v=sorted(v); return v[min(len(v)-1,int(p*len(v)))] if v else 0
def feat(C):
    c=C
    notes=sorted(c['notes'],key=lambda n:(n[0],n[1]))
    tps=c['tps'] or [[0,500,4]]; tts=[t[0] for t in tps]
    def bpos(t):
        i=max(0,bisect.bisect_right(tts,t)-1); t0,bl,_=tps[i]; return ((t-t0)/bl)%1,bl
    R=collections.OrderedDict()
    for n in notes: R.setdefault(n[0],set()).add(n[1])
    T=list(R); rows=[R[t] for t in T]; nR=len(rows); N=len(notes)
    dur=(T[-1]-T[0])/1000
    bl=st.median(t[1] for t in tps); bpm=60000/bl
    gaps=[T[i]-T[i-1] for i in range(1,nR)]
    # nps windows 4s
    tn=[n[0] for n in notes]
    w=[(bisect.bisect_left(tn,t+4000)-bisect.bisect_left(tn,t))/4 for t in range(int(T[0]),int(T[-1]-4000),1000)] or [N/dur]
    sz=collections.Counter(len(r) for r in rows)
    jack=sum(1 for i in range(1,nR) if rows[i]&rows[i-1])
    # grid position
    pos=collections.Counter()
    for t in T:
        f,b=bpos(t); d=min(f,1-f)
        k='on' if d<0.04 else 'half' if abs(f-0.5)<0.04 else 'q' if min(abs(f-.25),abs(f-.75))<0.04 else 'trip' if min(abs(f-1/3),abs(f-2/3),abs(f-1/6),abs(f-5/6))<0.03 else 'other'
        pos[k]+=1
    holds=[n for n in notes if len(n)>2 and n[2]-n[0]>30]
    # trill: alternating two lanes single notes for >=4 rows fast
    trill=stair=0
    for i in range(3,nR):
        a,b,cc_,d=rows[i-3],rows[i-2],rows[i-1],rows[i]
        if all(len(x)==1 for x in (a,b,cc_,d)) and gaps[i-1]<=200 and gaps[i-2]<=200 and gaps[i-3]<=200:
            la,lb,lc,ld=[next(iter(x)) for x in (a,b,cc_,d)]
            if la==lc and lb==ld and la!=lb: trill+=1
            if (lb-la==lc-lb==ld-lc) and abs(lb-la)==1: stair+=1
    # one-hand fast rows
    hand=lambda l:l<2
    oh=sum(1 for i in range(1,nR) if gaps[i-1]<=130 and len(rows[i])==1 and len(rows[i-1])==1 and rows[i]!=rows[i-1] and hand(next(iter(rows[i])))==hand(next(iter(rows[i-1]))))
    fast=sum(1 for g in gaps if g<=130)
    # chord followed by chord fast
    cc=sum(1 for i in range(1,nR) if gaps[i-1]<=130 and len(rows[i])>=2 and len(rows[i-1])>=2)
    # beat-length of min gap (in subdivisions)
    g5=q(gaps,0.05)
    return dict(title=C['title'],ver=C["ver"],lv=C["stars"]*4,bpm=bpm,dur=dur,nps=N/dur,rps=nR/dur,
        p50=q(w,.5),p90=q(w,.9),p10=q(w,.1),quiet=sum(1 for x in w if x<q(w,.5)*0.5)/len(w),
        ch=100*(nR-sz[1])/nR,c3=100*(sz[3]+sz[4])/nR,c4=100*sz[4]/nR,jack=100*jack/(nR-1),ln=100*len(holds)/N,
        lnd=st.median(n[2]-n[0] for n in holds) if holds else 0,
        on=100*pos['on']/nR,half=100*pos['half']/nR,q=100*pos['q']/nR,trip=100*pos['trip']/nR,oth=100*pos['other']/nR,
        g5=g5,g5b=g5/bl if bl else 0,trill=100*trill/nR,stair=100*stair/nR,oh=100*oh/max(1,fast),cc=100*cc/max(1,fast),fastfrac=100*fast/nR)
F=[feat(c) for c in cs if c['stars']>0]
json.dump(F,open(sys.argv[2],'w'))
by=collections.defaultdict(list)
for f in F: by[band(f['lv'])].append(f)
keys=['nps','rps','p50','p90','p10','quiet','ch','c3','jack','ln','lnd','on','half','q','trip','oth','g5b','trill','stair','oh','cc','fastfrac']
print('band n  '+' '.join(f'{k:>6}' for k in keys))
for b in ['easy','normal','hard','expert','nm','19+']:
    L=by[b]
    if not L: continue
    print(f'{b:6} {len(L):3} '+' '.join(f'{st.median(x[k] for x in L):6.2f}' for k in keys))
