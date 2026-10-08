import json,glob,math,statistics as st
P=[]
for f in sorted(glob.glob('probe2_?.json')): P+=json.load(open(f))
C=json.load(open('cmp2.json'))['bpm']; truth={b[0]:b[2] for b in C}
truth.update({'builtin:fullcombo':180,'builtin:jilju':170,'builtin:monarch':150,'builtin:natsukasumi':118.5,'builtin:newdim':155,'builtin:rinkaku':163,'builtin:velocity':180,'builtin:malguem':147.7})
# osu BPM over 300 is usually double-time notation → the musical beat is half
def norm(b):
    while b>300: b/=2
    return b
def classify(est,tr):
    r=est/tr
    for name,v in [('same',1),('x0.5',.5),('x2',2),('x0.67',2/3),('x1.5',1.5),('x0.75',.75),('x1.33',4/3)]:
        if abs(r/v-1)<0.04: return name
    return 'other'
def pick(p,prior_c,prior_sig,h2,h3,minbpm,maxbpm,tatum=None):
    ac=p['ac']; fps=p['fps']
    minLag=math.floor(fps*60/maxbpm); maxLag=math.ceil(fps*60/minbpm)
    best=None;bs=-1e9
    for lag in range(minLag,min(maxLag,len(ac)-1)+1):
        bpm=60*fps/lag
        w=math.exp(-0.5*(math.log2(bpm/prior_c)/prior_sig)**2)
        a1=ac[lag]; a2=ac[lag*2] if lag*2<len(ac) else 0; a3=ac[lag*3] if lag*3<len(ac) else 0
        s=w*(a1+h2*a2+h3*a3)
        if s>bs: bs=s;best=lag
    return 60*fps/best
def evaluate(**kw):
    cnt={}
    for p in P:
        tr=norm(truth[p['id']])
        est=pick(p,**kw)
        # triplet songs: the analyzer later multiplies by 1.5 (div 12) — emulate by taking current ratio bpm/rawBpm
        if p['div']==12: est*=1.5
        c=classify(est,tr); cnt[c]=cnt.get(c,0)+1
    return cnt
print('current (120, .9, .5, .25, 60-200):',evaluate(prior_c=120,prior_sig=0.9,h2=0.5,h3=0.25,minbpm=60,maxbpm=200))
best=[]
for c in [120,140,150,160,170,180]:
  for sig in [0.6,0.8,1.0,1.3]:
    for h2 in [0,0.25,0.5]:
      for h3 in [0,0.25]:
        for mx in [240,280,320]:
          r=evaluate(prior_c=c,prior_sig=sig,h2=h2,h3=h3,minbpm=60,maxbpm=mx)
          best.append((r.get('same',0),c,sig,h2,h3,mx,r))
best.sort(reverse=True)
for b in best[:12]: print(b)
