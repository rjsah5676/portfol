# usage: cmp_sub.py <ours_gen dir> → per-diff medians ours/osu for nps,p10,p90,ch,c3,jack,fastfrac,oh (same-level pairs)
import json,glob,os,sys,collections,statistics as st
src=open('/home/claude/osz2/st.py').read().split('F=[feat(c)')[0]
exec(src.replace("cs=json.load(open(sys.argv[1]))","cs=[]"))
osu=json.load(open('/home/claude/osz2/charts_new.json'))
bySet=collections.defaultdict(list)
for c in osu: bySet[c['set'].split(' ')[0]].append(c)
d=sys.argv[1]
ours=[]
for f in sorted(glob.glob(d+'/*.json')): ours.append(json.load(open(f)))
# stars
import subprocess,tempfile
tmp=d+'/_stars.json'
files=[f for f in glob.glob(d+'/*.json') if not f.endswith('_stars.json')]
if not os.path.exists(tmp) or os.path.getmtime(tmp)<max(os.path.getmtime(f) for f in files):
    ts=open('/tmp/claude-0/ours_gen_stars.ts').read().replace('"/home/claude/osz2/ours_gen"','"%s"'%d).replace('"/home/claude/osz2/ours_gen_stars.json"','"%s"'%tmp).replace('for (const f of fs.readdirSync(dir).sort()) {','for (const f of fs.readdirSync(dir).sort()) {\n  if (f.startsWith("_")) continue;')
    open('/tmp/claude-0/_st.ts','w').write(ts)
    r=subprocess.run(['npx','-y','tsx','/tmp/claude-0/_st.ts'],cwd='/home/claude/p2/web',capture_output=True,text=True)
    if r.returncode: print(r.stderr[-500:])
ours=json.load(open(tmp))
KEYS=['nps','p10','p90','ch','c3','jack','ln','fastfrac','oh','cc']
pairs=collections.defaultdict(list)
for o in ours:
    L=bySet.get(o['id']); 
    if not L: continue
    FO=[(c,feat(c)) for c in L]
    for dn,ch in o['charts'].items():
        oc=dict(title=o['id'],ver=dn,tps=[[0,60000/o['bpm'],4]],notes=[[round(n[0]*1000),n[1]]+([round(n[2]*1000)] if len(n)>2 else []) for n in ch['notes']],stars=ch['stars'])
        fo=feat(oc); best=min(FO,key=lambda x:abs(x[1]['lv']-fo['lv']))
        if abs(best[1]['lv']-fo['lv'])<=1.5: pairs[dn].append((fo,best[1]))
for dn in ['normal','hard','expert','nightmare']:
    R=pairs[dn]
    print(f"{dn:9} n={len(R):3} "+' '.join(f"{k} {st.median(a[k] for a,b in R):5.1f}/{st.median(b[k] for a,b in R):5.1f}" for k in KEYS)+f"  p10/p50 {st.median(a['p10']/a['p50'] for a,b in R):.2f}/{st.median(b['p10']/b['p50'] for a,b in R):.2f}")
