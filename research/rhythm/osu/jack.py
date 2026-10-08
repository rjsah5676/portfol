# 잭(같은 레인 연타) 통계: 난이도 밴드별 — 단노트 기준 같은 레인 재타율, 간격 분포
import json, sys, os, collections, statistics as S
def band(lv): return 'easy' if lv<3.5 else 'normal' if lv<6.5 else 'hard' if lv<11.5 else 'expert' if lv<14.5 else 'nm' if lv<18 else 'ult'
def feats(notes_ms, bl):
    # rows: 시각 → 레인 집합
    R = collections.OrderedDict()
    for t,l,*_ in sorted(notes_ms): R.setdefault(round(t,1), set()).add(l)
    rows = list(R.items())
    if len(rows) < 80: return None
    jack=0; n=0; j3=0; gaps=[]
    fast = bl*0.6  # 8분 이하 간격(빠른 연속)만
    run=1
    for i in range(1,len(rows)):
        dt = rows[i][0]-rows[i-1][0]
        if dt > fast*1.05 or dt<=0: run=1; continue
        inter = rows[i][1] & rows[i-1][1]
        n+=1
        if inter:
            jack+=1; gaps.append(dt); run+=1
            if run>=3: j3+=1
        else: run=1
    if n<40: return None
    return jack/n, j3/max(1,jack), (S.median(gaps) if gaps else 0)
if __name__=='__main__':
    cs=json.load(open('charts_new.json'))
    res=collections.defaultdict(list)
    for c in cs:
        if c['stars']<=0 or len(c['tps'])>3: continue
        bl=c['tps'][0][1]
        f=feats(c['notes'], bl)
        if f: res[band(c['stars']*4)].append(f)
    print('osu: 빠른 연속(8분 이하) 중 같은 레인 비율 | 잭 중 3연타 이상 비율 | 잭 간격 중앙값(ms)')
    for b in ['easy','normal','hard','expert','nm','ult']:
        L=res[b]
        if L: print(f'{b:7}{len(L):4}  jack {100*S.median(x[0] for x in L):5.1f}%  run3+ {100*S.median(x[1] for x in L):5.1f}%  gap {S.median(x[2] for x in L):4.0f}ms')
    for d in sys.argv[1:]:
        res=collections.defaultdict(list)
        for fn in os.listdir(d):
            O=json.load(open(os.path.join(d,fn)))
            if not isinstance(O,dict) or 'charts' not in O: continue
            bl=60000/O['bpm']
            for k,ch in O['charts'].items():
                f=feats([[n[0]*1000,n[1]] for n in ch['notes']], bl)
                if f: res[band(ch['level'])].append((k,*f))
        print(f'== {d}')
        for b in ['easy','normal','hard','expert','nm','ult']:
            L=res[b]
            if L: print(f'{b:7}{len(L):4}  jack {100*S.median(x[1] for x in L):5.1f}%  run3+ {100*S.median(x[2] for x in L):5.1f}%  gap {S.median(x[3] for x in L):4.0f}ms   ' + ' '.join(f'{x[0][:3]}{100*x[1]:.0f}%' for x in L))
    EOF_MARK=1
