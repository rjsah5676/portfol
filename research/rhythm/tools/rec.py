import json,glob,statistics as st,collections,sys
osu=[c for c in json.load(open('/home/claude/osz2/charts_new.json')) if c['stars']>0]
lo,hi,diff=float(sys.argv[2]),float(sys.argv[3]),sys.argv[4]
def rec(notes):
    rows=collections.OrderedDict()
    for n in notes: rows.setdefault(round(n[0]),set()).add(n[1])
    ts=list(rows); R=[rows[t] for t in ts]
    single=[i for i in range(2,len(R)) if len(R[i])==1 and len(R[i-1])==1 and len(R[i-2])==1 and ts[i]-ts[i-2]<=400]
    aba=sum(1 for i in single if R[i]==R[i-2])
    chordrow=[i for i in range(1,len(R)) if ts[i]-ts[i-1]<=250]
    ch_share=sum(1 for i in chordrow if len(R[i])>=2 or len(R[i-1])>=2)/max(1,len(chordrow))
    # lane balance: max lane share
    c=collections.Counter(l for r in R for l in r); tot=sum(c.values())
    return aba/max(1,len(single)), len(single)/max(1,len(R)), max(c.values())/tot
O=[rec(c['notes']) for c in osu if lo<=c['stars']*4<hi]
U=[]
for f in glob.glob(f'out_{sys.argv[1]}/o_*.json'):
    ex=json.load(open(f))['charts'].get(diff)
    if ex and lo<=ex['level']<hi: U.append(rec([[n[0]*1000,n[1]] for n in ex['notes']]))
for name,L in (('osu',O),('ours',U)): print(name,'ABA among fast single triples %.3f'%st.mean(x[0] for x in L),'single-triple share %.3f'%st.mean(x[1] for x in L),'maxlane %.3f'%st.mean(x[2] for x in L))
