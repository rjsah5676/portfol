import json, collections, numpy as np, statistics as S, sys, os
def band(lv): return 'easy' if lv<3.5 else 'normal' if lv<6.5 else 'hard' if lv<11.5 else 'expert' if lv<14.5 else 'nm'
def stat(notes, t0, bl):
    best=None
    for p in range(4):
        r=stat1(notes, t0+p*bl, bl)
        if r and (best is None or r['phrase']>best['phrase']): best=r
    return best
def stat1(notes, t0, bl):
    R=collections.defaultdict(set)
    for t,l,*_ in notes: R[t].add(l)
    down={}
    for t,ls in R.items():
        b=(t-t0)/(bl*4)
        if abs(b-round(b))*bl*4<20: down[round(b)]=len(ls)
    if len(down)<16: return None
    ph=[[] for _ in range(4)]
    for b,n in down.items(): ph[b%4].append(n>=2)
    rates=[np.mean(p) if p else 0 for p in ph]
    k=int(np.argmax(rates)); rest=[rates[i] for i in range(4) if i!=k]
    ph8=[[] for _ in range(8)]
    for b,n in down.items(): ph8[b%8].append(n>=2)
    r8=[np.mean(p) if p else 0 for p in ph8]
    return dict(phrase=rates[k], rest=np.mean(rest), r8max=max(r8), r8med=np.median(r8))
def table(res,label):
    print(f'== {label}: P(chord on downbeat) phrase-start vs other | 8-bar max vs median')
    for b in ['normal','hard','expert','nm']:
        L=res[b]
        if L: print(f"{b:7}{len(L):3} |  {S.median(x['phrase'] for x in L):.2f} vs {S.median(x['rest'] for x in L):.2f}  |  {S.median(x['r8max'] for x in L):.2f} vs {S.median(x['r8med'] for x in L):.2f}")
cs=json.load(open('/home/claude/osz2/charts_new.json')); res=collections.defaultdict(list)
for c in cs:
    if c['stars']<=0 or len(c['tps'])>3: continue
    t0,bl,_=c['tps'][0]; s=stat(c['notes'],t0,bl)
    if s: res[band(c['stars']*4)].append(s)
table(res,'osu')
for d in sys.argv[1:]:
    res=collections.defaultdict(list)
    for fn in os.listdir(d):
        O=json.load(open(os.path.join(d,fn)))
        if not isinstance(O,dict) or 'charts' not in O: continue
        bl=60000/O['bpm']; t0=O['beatOffset']*1000
        for k,ch in O['charts'].items():
            s=stat([[int(n[0]*1000),n[1]] for n in ch['notes']],t0,bl)
            if s: res[band(ch['level'])].append(s)
    table(res,d)
