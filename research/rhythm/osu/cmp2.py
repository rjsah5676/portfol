import json,glob,os,sys,collections,statistics as st,bisect
sys.path.insert(0,'/home/claude/osz2')
src=open('/home/claude/osz2/st.py').read().split('F=[feat(c)')[0]
exec(src.replace("cs=json.load(open(sys.argv[1]))","cs=[]"))
osu=json.load(open('/home/claude/osz2/charts_new.json'))
bySet=collections.defaultdict(list)
for c in osu: bySet[c['set'].split(' ')[0]].append(c)
ours=json.load(open('/home/claude/osz2/ours_gen_stars.json'))
KEYS=['nps','p10','p90','ch','c3','jack','ln','lnd','on','half','q','trip','oth','g5b','fastfrac','oh','cc','trill','stair']
def bpm_of(c):
    bl=st.median(t[1] for t in c['tps']); return 60000/bl
rows=[]; bpmrows=[]
for o in ours:
    sid=o['id']; L=bySet.get(sid)
    if not L: continue
    obpm=bpm_of(L[0]); ob=o['bpmLabel']
    r=ob/obpm
    cls='same' if abs(r-1)<0.03 else 'x2' if abs(r-2)<0.06 else 'x0.5' if abs(r-0.5)<0.03 else 'x1.5' if abs(r-1.5)<0.05 else 'x0.67' if abs(r-2/3)<0.03 else 'x0.75' if abs(r-0.75)<0.03 else 'x1.33' if abs(r-4/3)<0.04 else 'other'
    bpmrows.append((sid,L[0]['title'],obpm,ob,o['div'],cls))
    F_osu=[(c,feat(c)) for c in L]
    for d,ch in o['charts'].items():
        oc=dict(title=sid,ver=d,tps=[[(o['beatOffset']*1000)%(60000/o['bpm']),60000/o['bpm'],4]],notes=[[round(n[0]*1000),n[1]]+([round(n[2]*1000)] if len(n)>2 else []) for n in ch['notes']],stars=ch['stars'])
        fo=feat(oc)
        # nearest osu chart by level
        best=min(F_osu,key=lambda x:abs(x[1]['lv']-fo['lv']))
        dl=best[1]['lv']-fo['lv']
        rows.append(dict(sid=sid,title=L[0]['title'],diff=d,lv=fo['lv'],osu_ver=best[0]['ver'],osu_lv=best[1]['lv'],dlv=dl,ours=fo,osu=best[1],bpmcls=cls))
json.dump(dict(rows=rows,bpm=bpmrows),open('/home/claude/osz2/cmp2.json','w'))
# ── BPM 판정 ──
cnt=collections.Counter(b[5] for b in bpmrows)
print('BPM 판정 (우리 표시 BPM / osu BPM):',dict(cnt))
for b in bpmrows:
    if b[5]!='same': print(f"   {b[1][:30]:30} osu {b[2]:.1f}  ours {b[3]:.1f} div{b[4]} → {b[5]}")
# ── 난이도별 비교 (레벨 차 ±1.5 안에 osu 채보가 있는 경우만) ──
print('\n난이도별: 우리 중앙값 / 같은 곡 가장 가까운 레벨 osu 채보 중앙값  (n = 비교 쌍 수)')
for d in ['easy','normal','hard','expert','nightmare']:
    R=[r for r in rows if r['diff']==d and abs(r['dlv'])<=1.5]
    Rall=[r for r in rows if r['diff']==d]
    if not R: print(d,'no pairs'); continue
    lv=st.median(r['lv'] for r in Rall); olv=st.median(r['osu_lv'] for r in R)
    line=f"{d:9} n={len(R):3}/{len(Rall):3} lv {lv:4.1f} (osu {olv:4.1f}) | "
    line+=' '.join(f"{k} {st.median(r['ours'][k] for r in R):5.1f}/{st.median(r['osu'][k] for r in R):5.1f}" for k in KEYS)
    print(line)
# ── 비율 분포: 곡마다 ours/osu (nps, ch, jack) ──
print('\n곡별 비율 ours/osu 분포 (p25 / 중앙 / p75):')
for d in ['normal','hard','expert','nightmare']:
    R=[r for r in rows if r['diff']==d and abs(r['dlv'])<=1.5]
    for k in ['nps','ch','jack','ln','fastfrac']:
        v=sorted((r['ours'][k]+0.01)/(r['osu'][k]+0.01) for r in R)
        if v: print(f"  {d:9} {k:8} {v[len(v)//4]:5.2f} / {v[len(v)//2]:5.2f} / {v[3*len(v)//4]:5.2f}")
