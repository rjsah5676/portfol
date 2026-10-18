import json,glob,math,statistics as st
import numpy as np
P=[]
for f in sorted(glob.glob('probe3_?.json')): P+=json.load(open(f))
C=json.load(open('cmp2.json'))['bpm']; truth={b[0]:b[2] for b in C}
truth.update({'builtin:fullcombo':180,'builtin:jilju':170,'builtin:monarch':150,'builtin:natsukasumi':118.5,'builtin:newdim':155,'builtin:velocity':180,'builtin:malguem':147.7})
def norm(b):
    while b>300: b/=2
    return b
def ratio_cls(est,tr):
    r=est/tr
    for name,v in [('same',1),('x0.5',.5),('x2',2),('x0.67',2/3),('x1.5',1.5),('x0.75',.75),('x1.33',4/3)]:
        if abs(r/v-1)<0.04: return name
    return 'other'
def grid_feats(hp,fl,fm,fh,period):
    """fixed grid with phase/period refinement; returns features"""
    n=len(hp); best=None
    for pr in np.linspace(period*0.99,period*1.01,9):
        nb=int(n/pr)-1
        for ph in np.linspace(0,pr,24,endpoint=False):
            idx=(ph+np.arange(nb)*pr).astype(int)
            s=hp[idx].sum()
            if best is None or s>best[0]: best=(s,pr,ph)
    _,pr,ph=best
    nb=int(n/pr)-1
    b=(ph+np.arange(nb)*pr); 
    def at(arr,pos):
        i=np.clip(np.round(pos).astype(int),0,n-1)
        # max over ±1 frame
        return np.maximum.reduce([arr[np.clip(i+d,0,n-1)] for d in (-1,0,1)])
    Eb=at(hp,b).mean(); Em=at(hp,b+pr/2).mean(); Eq=(at(hp,b+pr/4).mean()+at(hp,b+3*pr/4).mean())/2
    mb=at(fm,b); lb=at(fl,b)
    ev=mb[0::2].mean(); od=mb[1::2].mean(); alt_snare=abs(ev-od)/max(1e-6,ev+od)
    lev=lb[0::2].mean(); lod=lb[1::2].mean(); alt_kick=abs(lev-lod)/max(1e-6,lev+lod)
    hev=at(hp,b)[0::2].mean(); hod=at(hp,b)[1::2].mean(); alt_any=min(hev,hod)/max(hev,hod,1e-6)
    return dict(Eb=Eb,Em=Em,Eq=Eq,alt_snare=alt_snare,alt_kick=alt_kick,alt_any=alt_any,mid_ratio=Em/max(Eb,1e-6),q_ratio=Eq/max(Eb,1e-6))
rows=[]
for p in P:
    tr=norm(truth[p['id']]); fps=p['fps']
    hp=np.array(p['hp']); fl=np.array(p['fl']); fm=np.array(p['fm']); fh=np.array(p['fh'])
    base=p['rawBpm']  # pipeline's raw (dotted for triplet)
    out={'id':p['id'],'true':tr,'div':p['div'],'cands':{}}
    for name,mult in [('1',1),('2',2),('0.5',0.5),('1.5',1.5),('0.67',2/3)]:
        bpm=base*mult
        if bpm<55 or bpm>330: continue
        period=fps*60/bpm
        f=grid_feats(hp,fl,fm,fh,period); f['bpm']=bpm; f['cls']=ratio_cls(bpm*(1.5 if p['div']==12 else 1),tr)
        out['cands'][name]=f
    rows.append(out)
json.dump(rows,open('octave_feats.json','w'))
# print: for each song, the features of the candidate that is 'same' vs the pipeline's pick ('1')
print('song | pick(1) cls | feats of x1 | feats of the correct candidate')
for r in rows:
    c1=r['cands']['1']; corr=[(k,v) for k,v in r['cands'].items() if v['cls']=='same']
    f=lambda v: f"E b/m/q {v['Eb']:.2f}/{v['Em']:.2f}/{v['Eq']:.2f} sn {v['alt_snare']:.2f} kk {v['alt_kick']:.2f} any {v['alt_any']:.2f}"
    print(f"{r['id'][-8:]:8} {r['true']:5.0f} x1={c1['cls']:5} | {f(c1)} | "+(f"x{corr[0][0]} {f(corr[0][1])}" if corr else 'no correct cand'))
