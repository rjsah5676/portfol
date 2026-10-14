# python3 eval.py OUTDIR [-q]  → (밴드, 빠르기)별 중앙값: osu / qv / 내장곡 / 내음악. 목표 범위 = [min(osu,qv)-tol, max(osu,qv)+tol]
import json,glob,os,sys,collections,statistics as st
src=open('/home/claude/osz2/st.py').read().split('F=[feat(c)')[0]
exec(src.replace("cs=json.load(open(sys.argv[1]))","cs=[]"))
def band2(lv): return 'easy' if lv<3.5 else 'normal' if lv<6.5 else 'hard' if lv<11.5 else 'expert' if lv<14.5 else 'nm' if lv<18 else 'ult'
K=['nps','p10p50','p90p50','ch','c3','jack','fastfrac','oh','cc','trill','stair','on','half','q']
TOL={'nps':.3,'p10p50':.03,'p90p50':.04,'ch':2,'c3':1,'jack':1.5,'fastfrac':4,'oh':2,'cc':1,'trill':.3,'stair':.3,'on':3,'half':3,'q':3}
def spd(f):
    bpm=f['bpm']
    while bpm<120: bpm*=2
    while bpm>=240: bpm/=2
    return 'fast' if bpm>=160 else 'slow'
def agg(cs):
    by=collections.defaultdict(list)
    for c in cs:
        try: f=feat(c)
        except Exception: continue
        if not f['p50']: continue
        f['p10p50']=f['p10']/f['p50']; f['p90p50']=f['p90']/f['p50']
        by[(band2(f['lv']),spd(f))].append(f)
    return {f'{b}|{s}':{k:st.median(x[k] for x in L) for k in K}|{'n':len(L)} for (b,s),L in by.items()}
REF='/tmp/claude-0/qvs/ref2.json'
if not os.path.exists(REF):
    osu=[c for c in json.load(open('/home/claude/osz2/charts_new.json')) if c['stars']>0]
    qv=json.load(open('/tmp/claude-0/qv/qv_stars.json'))
    json.dump({'osu':agg(osu),'qv':agg(qv)},open(REF,'w'))
R=json.load(open(REF))
def load(d, which):
    out=[]
    for f in glob.glob(d+'/[bo]_*.json'):
        O=json.load(open(f))
        if not O['id'].startswith(which+'_'): continue
        bs=O['beats']
        tps=[[round(b*1000),round((bs[i+1]-b)*1000) if i+1<len(bs) else 60000/O['bpm'],4] for i,b in enumerate(bs)]
        for k,ch in O['charts'].items():
            out.append(dict(title=O['id'],ver=k,stars=ch['level']/4,tps=tps,notes=[[round(n[0]*1000),n[1]]+([round(n[2]*1000)] if len(n)>2 else []) for n in ch['notes']]))
    return out
d=sys.argv[1]; quiet='-q' in sys.argv
res={w:agg(load(d,w)) for w in ('b','o')}
json.dump(res,open(d+'/_eval.json','w'))
tot=collections.Counter(); per=collections.Counter()
for b in ['normal','hard','expert','nm','ult']:
  for s in ['slow','fast']:
    g=f'{b}|{s}'
    if g not in R['osu'] or g not in R['qv']: continue
    head=f"== {g}  n osu {R['osu'][g]['n']} qv {R['qv'][g]['n']} 내장 {res['b'].get(g,{}).get('n','-')} 내음악 {res['o'].get(g,{}).get('n','-')}"
    lines=[]
    for k in K:
        o=R['osu'][g][k]; q=R['qv'][g][k]; lo,hi=min(o,q)-TOL[k],max(o,q)+TOL[k]
        row=f"  {k:9} osu {o:6.2f} qv {q:6.2f} |"
        for w in ('b','o'):
            v=res[w].get(g,{}).get(k)
            if v is None or res[w][g]['n']<4: row+='     -   '; continue
            bad = v<lo or v>hi
            if bad:
                pen=min(abs(v-lo),abs(v-hi))/(abs(hi-lo)/2+TOL[k]); tot[w]+=pen; per[(w,k)]+=pen
            row+=f" {v:6.2f}{'*' if bad else ' '}"
        lines.append(row)
    if not quiet: print(head); print('\n'.join(lines))
print('score(낮을수록 좋음) 내장 %.1f 내음악 %.1f'%(tot['b'],tot['o']))
print('  지표별:', ' '.join(f"{w}{k}:{v:.1f}" for (w,k),v in sorted(per.items(),key=lambda x:-x[1])[:14]))
