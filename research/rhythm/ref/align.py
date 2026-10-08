import sys, json, subprocess, numpy as np, re, glob, os
SR = 22050
def load(p):
    raw = subprocess.run(['ffmpeg','-v','error','-i',p,'-ac','1','-ar',str(SR),'-f','f32le','-'],capture_output=True).stdout
    return np.frombuffer(raw, np.float32)
def env(x, hop=64):
    n = len(x)//hop
    e = np.sqrt((x[:n*hop].reshape(n,hop)**2).mean(1))
    e = np.diff(e, prepend=0); e[e<0]=0
    return e
def shift(a, b, hop=64, maxs=5.0):
    # returns seconds s such that b(t) ≈ a(t - s)  (b = ref, a = ours); i.e. ours_time = ref_time - s... compute by xcorr
    ea, eb = env(a,hop), env(b,hop)
    n = min(len(ea), len(eb)); ea, eb = ea[:n]-ea[:n].mean(), eb[:n]-eb[:n].mean()
    m = int(maxs*SR/hop)
    best=None
    for d in range(-m, m+1):
        if d>=0: c = np.dot(ea[d:], eb[:n-d])
        else: c = np.dot(ea[:n+d], eb[-d:])
        if best is None or c>best[0]: best=(c,d)
    return best[1]*hop/SR  # ours index = ref index + d  → our_t = ref_t + d
def parse_osu(p):
    txt = open(p, encoding='utf-8', errors='ignore').read()
    ver = re.search(r'^Version:(.*)$', txt, re.M).group(1).strip()
    cs = float(re.search(r'^CircleSize:(.*)$', txt, re.M).group(1))
    tp = txt.split('[TimingPoints]')[1].split('[')[0].strip().splitlines()
    tps = []
    for l in tp:
        f = l.split(',')
        if len(f) < 2: continue
        if len(f) < 7 or f[6] == '1':
            tps.append((float(f[0]), float(f[1])))
    ho = txt.split('[HitObjects]')[1].strip().splitlines()
    notes = []
    for l in ho:
        f = l.split(',')
        if len(f) < 5: continue
        x = int(f[0]); t = int(f[2]); typ = int(f[3])
        lane = int(x * cs / 512)
        end = None
        if typ & 128: end = int(f[5].split(':')[0])
        notes.append((t/1000, lane, end/1000 if end else None))
    return ver, cs, tps, notes
if __name__ == '__main__':
    song, ours_mp3, ref_mp3, ref_dir = sys.argv[1:5]
    a = load(ours_mp3); b = load(ref_mp3)
    d = shift(a, b)
    print(f'{song}: our_t = ref_t + {d*1000:.1f} ms')
    out = {'shift': d, 'charts': []}
    for p in sorted(glob.glob(os.path.join(ref_dir, '*.osu'))):
        ver, cs, tps, notes = parse_osu(p)
        if cs != 4: continue
        out['charts'].append({'ver': ver, 'tps': tps, 'notes': notes})
        print(' ', ver, 'tp0', tps[0], 'bpm', round(60000/tps[0][1],3), 'notes', len(notes))
    json.dump(out, open(f'/home/claude/ref/{song}_ref.json','w'))
