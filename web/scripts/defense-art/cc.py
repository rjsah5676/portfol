"""덩어리(연결 요소) 기준으로 한 줄을 나눠 자르기 — 캐릭터가 겹쳐 세로 경계로 못 나눌 때
python3 cc.py sheet.png y0 y1 size out_dir id1 id2 ..."""
import sys, numpy as np
from PIL import Image
from scipy import ndimage
src,y0,y1,size,out=sys.argv[1],int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]),sys.argv[5]; ids=sys.argv[6:]
A=np.array(Image.open(src).convert('RGBA')); band=A[y0:y1].copy()
hard=band[:,:,3]>110; soft=band[:,:,3]>8
lab,n=ndimage.label(hard); idx=np.arange(1,n+1)
areas=np.array(ndimage.sum(hard,lab,idx)); cms=np.array(ndimage.center_of_mass(hard,lab,idx))
xs=np.nonzero(hard.sum(0))[0]; lo,hi=xs.min(),xs.max(); N=len(ids)
cent=np.array([lo+(hi-lo)*(k+0.5)/N for k in range(N)])
for _ in range(30):
    asg=np.abs(cms[:,1][:,None]-cent[None]).argmin(1)
    for k in range(N):
        s=asg==k
        if s.any(): cent[k]=(cms[s,1]*areas[s]).sum()/areas[s].sum()
for k,name in enumerate(ids):
    keep=idx[(asg==k)&(areas>=12)]
    m=ndimage.binary_dilation(np.isin(lab,keep),iterations=5)&soft&~np.isin(lab,idx[asg!=k])
    cell=band.copy(); cell[:,:,3]=np.where(m,cell[:,:,3],0)
    yy,xx=np.nonzero(m); spr=Image.fromarray(cell[yy.min():yy.max()+1,xx.min():xx.max()+1])
    kk=min(size*0.9/spr.height,size*0.98/spr.width)
    spr=spr.resize((round(spr.width*kk),round(spr.height*kk)),Image.LANCZOS)
    cv=Image.new('RGBA',(size,size),(0,0,0,0)); cv.paste(spr,((size-spr.width)//2,size-round(size*0.04)-spr.height),spr)
    cv.save(f'{out}/{name}.webp',quality=92,method=6); print(name,'w',xx.max()-xx.min()+1)
