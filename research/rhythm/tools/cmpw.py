import json,sys
R=json.load(open('/tmp/claude-0/qvs/refw.json'))
runs=sys.argv[1:]
E={r:json.load(open(f'/tmp/claude-0/qvs/out_{r}/_eval.json')) for r in runs}
G=['hard|f160','expert|f160','expert|f185','nm|f160','nm|f185','ult|f160','ult|f185']
K=['ln','nps','p10p50','p90p50','ch','c3','jack','fastfrac','oh','cc','q']
for g in G:
    print('==',g, ' n', [E[r]['o'].get(g,{}).get('n') for r in runs])
    for k in K:
        o=R['osu'][g][k];q=R['qv'][g][k]
        print(f"  {k:8} osu {o:6.2f} qv {q:6.2f} |"+''.join(f" {E[r]['o'].get(g,{}).get(k,float('nan')):6.2f}" for r in runs))
