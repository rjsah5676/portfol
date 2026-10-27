"""
타석 타자 픽셀 스프라이트 만들기
  python3 scripts/baseball-batter-sprite.py <시트.png> public/baseball/sprites/batter-v1.png [배율 0.69]
sheet: 지피티 시트(5칸×2줄, 초록 #00FF00 배경, 방망이 마젠타 #FF00FF) 를 768×512 로 줄인 것
출력: 프레임은 가로, 층(fixed · team · helm · skin · pants · dark · bat)은 세로. 색 층은 3단 회색 명암 → 게임이 색을 곱함
프레임 기준점 · 등번호 자리는 src/lib/baseball/batterSprite.ts FRAMES (출력 info 의 헬멧 가운데 · 발바닥 참고)
"""
import numpy as np, json, sys
from PIL import Image
from scipy import ndimage
SHEET,OUT=sys.argv[1],sys.argv[2]
S=float(sys.argv[3]) if len(sys.argv)>3 else 0.69
src=Image.open(SHEET).convert("RGB")
a=np.asarray(src).astype(float)/255
R,G,B=a[...,0],a[...,1],a[...,2]
g=G-np.maximum(R,B)
alpha=np.clip(1-(g-0.15)/0.3,0,1)
G2=np.minimum(G,np.maximum(R,B)+0.02)
rgb=np.stack([R,G2,B],-1)
H,W=alpha.shape
cw,ch=W/5,H/2
CW,CH=round(cw*S),round(ch*S)
frames=[]
for r in range(2):
  for c in range(5):
    x0,y0=int(round(c*cw)),int(round(r*ch))
    sub=rgb[y0:y0+int(ch),x0:x0+int(cw)]; al=alpha[y0:y0+int(ch),x0:x0+int(cw)]
    # remove specks: keep big components
    lab,n=ndimage.label(al>0.5); sizes=ndimage.sum(al>0.5,lab,range(1,n+1))
    # 옆 칸 방망이 조각 빼고 몸통 덩어리만
    big=ndimage.binary_dilation(al>0.5,iterations=2)
    lab2,n2=ndimage.label(big); s2=ndimage.sum(big,lab2,range(1,n2+1))
    main=lab2==(int(np.argmax(s2))+1)
    keep=(al>0.5)&main
    keep=ndimage.binary_dilation(keep,iterations=2)
    al=al*keep
    pm=np.concatenate([sub*al[...,None],al[...,None]],-1)
    im=Image.fromarray((pm*255).astype(np.uint8),"RGBA")  # premultiplied stored as rgba
    sm=np.asarray(im.resize((CW,CH),Image.BOX)).astype(float)/255
    A=sm[...,3]; C=np.where(A[...,None]>0,sm[...,:3]/np.maximum(A[...,None],1e-6),0)
    frames.append((np.clip(C,0,1),A))
F=np.array([np.concatenate([c,a[...,None]],-1) for c,a in frames])
N,CH,CW,_=F.shape
LAY=["fixed","team","helm","skin","pants","dark","bat"]
OUTC=np.array([28,23,38])/255
atlas=np.zeros((len(LAY)*CH,N*CW,4))
info=[]
def hsv(c):
    mx=c.max(-1); mn=c.min(-1); d=np.maximum(mx-mn,1e-6)
    r,g,b=c[...,0],c[...,1],c[...,2]
    h=np.where(mx==r,((g-b)/d)%6,np.where(mx==g,(b-r)/d+2,(r-g)/d+4))*60
    s=np.where(mx>0,(mx-mn)/np.maximum(mx,1e-6),0)
    return h,s,mx
for k in range(N):
    C=F[k,...,:3]; A=F[k,...,3]
    op=A>0.45
    h,s,v=hsv(C)
    lum=0.3*C[...,0]+0.59*C[...,1]+0.11*C[...,2]
    warm=(h<48)|(h>345)
    cls=np.full((CH,CW),-1)
    cls[op]=0
    team=op&warm&(s>0.55)&(v>0.38)
    skin=op&warm&(s>0.12)&(s<=0.55)&(v>0.55)
    white=op&(s<0.18)&(v>0.42)
    ys0=np.where(op)[0]; ft,fb=ys0.min(),ys0.max()
    rows=np.arange(CH)[:,None]
    navy=op&(h>195)&(h<265)&(s>0.28)&(v>0.18)&(rows>ft+(fb-ft)*0.3)&(rows<fb-(fb-ft)*0.3)
    mag=op&(h>270)&(h<345)&(s>0.3)&(v>0.3)
    cls[team]=1; cls[skin]=3; cls[white]=4; cls[navy]=5; cls[mag]=6
    # helmet = team component containing topmost team pixel
    lab,n=ndimage.label(cls==1)
    if n:
        ys,xs=np.where(cls==1); top=lab[ys.min(),xs[ys==ys.min()][0]]
        # pick components whose centroid is in top 40% of the figure
        figtop=np.where(op)[0].min(); figbot=np.where(op)[0].max()
        for i in range(1,n+1):
            yy=np.where(lab==i)[0]
            if yy.mean()< figtop+(figbot-figtop)*0.36 and len(yy)>3: cls[lab==i]=2
        if (cls==2).any():
            hb=np.where(cls==2)[0].max()
            rows=np.arange(CH)[:,None]
            cls[(cls==1)&(rows<hb-3)]=2
    # outline: opaque pixels touching transparent
    edge=op&~ndimage.binary_erosion(op,structure=np.array([[0,1,0],[1,1,1],[0,1,0]]))
    cls[edge]=0
    # dark/outline fixed
    darkpx=op&(v<0.3)&(cls!=5)
    cls[darkpx]=0
    out=np.zeros((len(LAY),CH,CW,4))
    fixed=np.zeros((CH,CW,4))
    fx=(cls==0)
    # fixed color: outline for edges & very dark; otherwise original quantized
    col=C.copy()
    col[edge]=OUTC
    col[op&(v<0.3)&~edge]=np.clip(C[op&(v<0.3)&~edge]*0.9,0,1)
    fixed[fx,:3]=col[fx]; fixed[fx,3]=1
    for ci,name in [(1,"team"),(2,"helm"),(3,"skin"),(4,"pants"),(5,"dark"),(6,"bat")]:
        m=cls==ci
        if not m.any(): continue
        ref=np.median(lum[m]) if m.sum()>4 else lum[m].mean()
        rel=lum/max(ref,1e-3)
        lev=np.where(rel<0.72,0.5,np.where(rel<0.9,0.75,1.0))
        hi=m&(rel>1.18)
        L=np.zeros((CH,CW,4)); L[m,0]=L[m,1]=L[m,2]=lev[m]; L[m,3]=1
        out[LAY.index(name)]=L
        # highlight -> fixed white semi
        fixed[hi,:3]=1; fixed[hi,3]=0.45
    out[0]=fixed
    for li in range(len(LAY)):
        atlas[li*CH:(li+1)*CH,k*CW:(k+1)*CW]=out[li]
    ys,xs=np.where(op)
    info.append(dict(top=int(ys.min()),bot=int(ys.max()),l=int(xs.min()),r=int(xs.max())))
Image.fromarray((atlas*255).round().astype(np.uint8),"RGBA").quantize(colors=96,method=Image.Quantize.FASTOCTREE,dither=Image.Dither.NONE).save(OUT,optimize=True)
print("cell",CW,CH,info)
