import glob,re,hashlib,json,os
out=[];seen=set()
for p in sorted(glob.glob('/home/claude/osz2/raw/*/*.osu')):
    raw=open(p,'rb').read();h=hashlib.md5(raw).hexdigest()
    if h in seen: continue
    s=raw.decode('utf-8','ignore')
    m=re.search(r'^Mode:\s*(\d)',s,re.M);cs=re.search(r'^CircleSize:\s*([\d.]+)',s,re.M)
    if not(m and m.group(1)=='3' and cs and float(cs.group(1))==4): continue
    seen.add(h)
    def sect(name):
        mm=re.search(r'^\['+name+r'\]\s*$(.*?)(?=^\[|\Z)',s,re.M|re.S); return mm.group(1).strip().splitlines() if mm else []
    meta={}
    for l in sect('Metadata')+sect('Difficulty')+sect('General'):
        if ':' in l: k,v=l.split(':',1); meta[k.strip()]=v.strip()
    tps=[]
    for l in sect('TimingPoints'):
        f=l.split(',')
        if len(f)<2: continue
        try:
            t=float(f[0]);bl=float(f[1])
        except: continue
        unin = (len(f)<7) or f[6].strip()=='1'
        if bl>0 and unin: tps.append([t,bl,int(f[2]) if len(f)>2 and f[2].strip().isdigit() else 4])
    notes=[]
    for l in sect('HitObjects'):
        f=l.split(',')
        if len(f)<5: continue
        x=int(float(f[0]));t=int(float(f[2]));typ=int(f[3])
        lane=min(3,max(0,x*4//512))
        if typ&128:
            end=int(f[5].split(':')[0]); notes.append([t,lane,end])
        else: notes.append([t,lane])
    if len(notes)<50: continue
    out.append({'file':os.path.basename(p),'set':os.path.basename(os.path.dirname(p)),'title':meta.get('Title',''),'ver':meta.get('Version',''),'od':float(meta.get('OverallDifficulty','8')),'tps':tps,'notes':notes})
json.dump(out,open('charts_new.json','w'))
print(len(out),'charts', len(set(c['set'] for c in out)),'sets')
