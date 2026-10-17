import colorsys, sys
from PIL import Image, ImageDraw
SRC="web/public/defense/enemies/"  # 레포 루트에서: python3 web/scripts/defense-art/gim-elites.py (결과는 현재 폴더 → enemies 로 복사)
def recolor(im, hue, sat=None, val=1.0, keep_pink=True):
    im=im.copy(); px=im.load()
    for y in range(im.height):
        for x in range(im.width):
            r,g,b,a=px[x,y]
            if a==0: continue
            h,s,v=colorsys.rgb_to_hsv(r/255,g/255,b/255)
            # 눈 · 글리치 분홍/하늘은 그대로
            if keep_pink and s>0.45 and v>0.75 and (0.8<h<0.98 or 0.45<h<0.56): continue
            if s<0.08 and v<0.2: continue  # 테두리 검정
            nh=hue; ns=s if sat is None else min(1,s*sat+ (sat if s<0.15 else 0)*0)
            if sat is not None: ns=sat*max(s,0.35)
            nv=min(1,v*val)
            rr,gg,bb=colorsys.hsv_to_rgb(nh,min(1,ns),nv)
            px[x,y]=(int(rr*255),int(gg*255),int(bb*255),a)
    return im
def blocks(d, pts, c, s=4):
    for x,y in pts: d.rectangle([x*s,y*s,x*s+s-1,y*s+s-1], fill=c)
O='#120a1e'
# 도둑 고블린: 벌레 → 금색 + 돈 자루
t=recolor(Image.open(SRC+'bug.webp').convert('RGBA'), 0.12, 0.9, 1.08)
d=ImageDraw.Draw(t)
bag=[(x,y) for y in range(5,11) for x in range(23,29) if not ((y==5 and x in(23,28)) or (y==10 and x in(23,28)))]
blocks(d,[(x-1,y) for x,y in bag]+[(x+1,y) for x,y in bag]+[(x,y-1) for x,y in bag]+[(x,y+1) for x,y in bag],O)
blocks(d,bag,'#c98a00'); blocks(d,[(24,6),(24,7),(25,6)],'#fff2a8'); blocks(d,[(25,4),(26,4),(25,3),(26,3)],'#8a5a00')
blocks(d,[(25,8),(26,8)],'#ffd23f')
t.save('gim-thief.webp')
# 치유 사제: 유령 → 초록 + 머리 위 십자 후광
h=recolor(Image.open(SRC+'ghost.webp').convert('RGBA'), 0.36, 0.75, 1.0, keep_pink=False)
d=ImageDraw.Draw(h)
cross=[(x,y) for x in (15,16) for y in range(1,8)]+[(x,y) for y in (3,4) for x in range(12,20)]
blocks(d,[(x+dx,y+dy) for x,y in cross for dx,dy in((1,0),(-1,0),(0,1),(0,-1))],O)
blocks(d,cross,'#eaffef'); blocks(d,[(15,3),(16,3),(15,4),(16,4)],'#6dff8f')
h.save('gim-healer.webp')
# 분열 골렘: 골렘 → 보라 + 금 간 빛
g=recolor(Image.open(SRC+'golem.webp').convert('RGBA'), 0.76, 0.7, 1.15)
d=ImageDraw.Draw(g)
blocks(d,[(15,9),(16,10),(16,11),(15,12),(15,13),(16,14),(17,15)],'#ff9ef0')
g.save('gim-golem.webp')
# 거울 기사: 블록 → 은빛 하늘 + 사선 반짝
m=recolor(Image.open(SRC+'block.webp').convert('RGBA'), 0.55, 0.35, 1.25)
px=m.load()
for y in range(128):
    for x in range(128):
        if px[x,y][3] and 0 <= (x+y) % 40 < 6 and (x+y)//40 in (2,3):
            r,gg,b,a=px[x,y]; px[x,y]=(min(255,r+90),min(255,gg+90),min(255,b+90),a)
m.save('gim-mirror.webp')
W=Image.new('RGBA',(512,128),(40,40,60,255))
for i,n in enumerate(['thief','healer','golem','mirror']): W.alpha_composite(Image.open(f'gim-{n}.webp'),(i*128,0))
W.resize((1024,256),Image.NEAREST).save('sheet.png')
