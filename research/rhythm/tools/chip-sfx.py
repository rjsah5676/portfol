# PIXEL Rhythm Up 8비트 효과음 합성 (사각파·삼각파·노이즈) — 저장소 맨 위에서: python3 research/rhythm/tools/chip-sfx.py
# 크기는 옛 네온 효과음(git 기록의 web/public/rhythm/sfx — 지운 뒤라 다시 돌리려면 그 커밋에서 꺼내 둘 것)의 RMS에 맞춘 뒤 LUFS로 한 번 더 맞춤 (2026-10-17)
import numpy as np, subprocess, os
SR=44100
def nf(n):  # note name -> freq, e.g. 'C5','F#4'
    names={'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11}
    k=n[:-1]; o=int(n[-1]); return 440*2**((names[k]+12*(o-4)-9)/12)
def t_(d): return np.arange(int(SR*d))/SR
def pulse(f,d,duty=0.5,vib=0.0,sweep=0.0):
    t=t_(d); ff=f*(1+sweep*t/d) if sweep else f*np.ones_like(t)
    if vib: ff=ff*(1+vib*np.sin(2*np.pi*6*t))
    ph=np.cumsum(ff)/SR; return np.where((ph%1)<duty,1.0,-1.0)
def tri(f,d):
    t=t_(d); ph=(f*t)%1; return 4*np.abs(ph-0.5)-1
def noise(d,lp=1):
    n=np.random.uniform(-1,1,int(SR*d))
    # sample-and-hold for 8bit noise
    step=max(1,int(lp)); n=np.repeat(n[::step],step)[:int(SR*d)]; return n
def env(x,a=0.002,dcy=None,sus=1.0,rel=0.03):
    n=len(x); e=np.ones(n)
    na=int(SR*a); e[:na]=np.linspace(0,1,na) if na else 1
    if dcy: 
        e*=np.exp(-np.arange(n)/SR/dcy)
    nr=int(SR*rel)
    if nr and nr<n: e[-nr:]*=np.linspace(1,0,nr)
    return x*e*sus
def seq(notes, dur, wave='pulse', duty=0.5, dcy=None, gap=0.0, vol=1.0):
    out=[]
    for n in notes:
        if n is None: out.append(np.zeros(int(SR*dur))); continue
        f=nf(n)
        w=pulse(f,dur-gap,duty) if wave=='pulse' else tri(f,dur-gap)
        out.append(np.concatenate([env(w,dcy=dcy),np.zeros(int(SR*gap))]))
    return np.concatenate(out)*vol
def mix(*parts):
    L=max(len(p[1])+int(SR*p[0]) for p in parts); o=np.zeros(L)
    for off,x in parts:
        s=int(SR*off); o[s:s+len(x)]+=x
    return o
def save(name,x,rms_target):
    x=x/ (np.max(np.abs(x))+1e-9)
    r=np.sqrt(np.mean(x[np.abs(x)>1e-4]**2)) if np.any(np.abs(x)>1e-4) else 1
    x=x*(rms_target/r)
    pk=np.max(np.abs(x))
    if pk>0.95: x=x*0.95/pk
    pcm=(np.clip(x,-1,1)*32767).astype(np.int16)
    wav=f'/tmp/{name}.wav'
    import wave
    with wave.open(wav,'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    out=f'web/public/rhythm/px/sfx/{name}.mp3'
    subprocess.run(['ffmpeg','-v','error','-y','-i',wav,'-af','lowpass=f=7000','-codec:a','libmp3lame','-b:a','128k','-ac','2',out],check=True)
def rms_of(path):
    raw=subprocess.run(['ffmpeg','-v','error','-i',path,'-ac','1','-ar',str(SR),'-f','f32le','-'],capture_output=True).stdout
    x=np.frombuffer(raw,np.float32); x=x[np.abs(x)>1e-4]; return float(np.sqrt(np.mean(x**2))) if len(x) else 0.1
np.random.seed(3)
R={n:rms_of(f'web/public/rhythm/sfx/{n}.mp3') for n in ['ui-move','ui-select','ui-back','ui-open','title-start','song-decide','countdown','go','combo-milestone','combo-break','fail','rank-reveal','clear','fullcombo','allperfect','new-record']}
print({k:round(v,3) for k,v in R.items()})
S={}
S['ui-move']=env(pulse(nf('E6'),0.05,0.25),dcy=0.03,rel=0.01)
S['ui-select']=seq(['C6','G6'],0.06,duty=0.25,dcy=0.08)
S['ui-open']=seq(['C5','E5','G5','C6'],0.045,duty=0.25,dcy=0.1)
S['ui-back']=seq(['G5','C5'],0.07,duty=0.5,dcy=0.08)
S['title-start']=mix((0,seq(['B5','E6'],0.07,duty=0.25)),(0.14,seq(['E6','G#6','B6','E7'],0.05,duty=0.125,dcy=0.12)),(0,0.5*env(tri(nf('E3'),0.5),dcy=0.25)))
S['song-decide']=mix((0,seq(['C5','E5','G5','C6','E6','G6'],0.055,duty=0.25)),(0.33,0.8*env(pulse(nf('C6'),0.9,0.25,vib=0.01),dcy=0.5)),(0.33,0.5*env(pulse(nf('G5'),0.9,0.5),dcy=0.5)),(0.33,0.6*env(tri(nf('C3'),0.9),dcy=0.6)),(0,0.25*env(noise(0.08,4),dcy=0.03)))
S['countdown']=env(pulse(nf('A5'),0.11,0.5),dcy=0.05)+0.3*env(noise(0.04,2),dcy=0.01)[:int(0.11*SR)] if False else env(pulse(nf('A5'),0.11,0.5),dcy=0.05)
S['go']=mix((0,0.8*env(pulse(nf('A6'),0.4,0.5),dcy=0.18)),(0,0.5*env(pulse(nf('E6'),0.4,0.25),dcy=0.18)),(0,0.5*env(tri(nf('A3'),0.4),dcy=0.2)),(0,0.3*env(noise(0.1,3),dcy=0.03)))
S['combo-milestone']=mix((0,seq(['C6','E6','G6','C7','E7'],0.04,duty=0.125,dcy=0.15)),(0.2,0.5*env(pulse(nf('C7'),0.3,0.125,vib=0.02),dcy=0.12)))
cb=pulse(nf('E5'),0.4,0.5,sweep=-0.6); S['combo-break']=mix((0,env(cb,dcy=0.2)),(0,0.5*env(noise(0.25,6),dcy=0.08)))
S['rank-reveal']=mix((0,0.6*env(noise(0.3,8),dcy=0.1)),(0,0.8*env(tri(nf('C2'),0.8),dcy=0.4)),(0.12,seq(['G4','C5','E5','G5'],0.05,duty=0.25)),(0.32,0.7*env(pulse(nf('C6'),0.7,0.25),dcy=0.35)))
S['new-record']=mix((0,seq(['E5','G5','C6','E6','G6','C7'],0.06,duty=0.125)),(0.36,0.7*env(pulse(nf('C7'),0.6,0.125,vib=0.02),dcy=0.3)),(0,0.5*seq(['C4','E4','G4','C5'],0.12,wave='tri')))
def jingle(mel,bass,step,hold,duty=0.25):
    m=seq(mel,step,duty=duty,dcy=step*3,gap=0.01)
    b=seq(bass,step*2,wave='tri',dcy=step*4)
    return mix((0,m),(0,0.6*b),(len(mel)*step,0.8*env(pulse(nf(mel[-1]),hold,duty,vib=0.012),dcy=hold*0.6)),(len(mel)*step,0.5*env(tri(nf(bass[-1]),hold),dcy=hold*0.6)))
S['clear']=jingle(['C5','E5','G5','C6','G5','C6','E6','G6'],['C3','G3','C3','G3'],0.11,1.0)
S['fullcombo']=jingle(['G4','C5','E5','G5','C6','E6','G6','C7','E7'],['C3','E3','G3','C3','G3'],0.1,1.2,duty=0.125)
ap=jingle(['C5','E5','G5','C6','D6','F6','A6','D7','E6','G6','B6','E7'],['C3','G3','D3','A3','E3','B3'],0.09,1.6,duty=0.125)
sp=np.zeros(len(ap))
for i in range(14):
    s=int(SR*(1.0+0.12*i)); 
    if s>=len(sp): break
    b=0.25*env(pulse(nf(['C7','E7','G7','B7'][i%4]),0.05,0.125),dcy=0.03); sp[s:s+len(b)]+=b[:len(sp)-s]
S['allperfect']=ap+sp
fl=seq(['G4','F#4','F4'],0.22,duty=0.5,dcy=0.3,gap=0.02)
S['fail']=mix((0,fl),(0.66,0.8*env(pulse(nf('E4'),1.2,0.5,sweep=-0.25,vib=0.02),dcy=0.7)),(0,0.6*seq(['C3','B2','A#2'],0.22,wave='tri')),(0.66,0.6*env(tri(nf('A2'),1.2),dcy=0.7)))
for k,x in S.items(): save(k,x,(R[k] if R[k]>0.02 else 0.12)*0.7)
print('done', len(S))
