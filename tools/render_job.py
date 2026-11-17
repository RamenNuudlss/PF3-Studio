import sys,re
import os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from m10 import decode_row,WHITE
from PIL import Image
def m9_decode(d,seed):  # mode 9 for K plane (bytes) -- minimal: return seed if empty
    return seed
def render(path,out):
    d=open(path,'rb').read(); i=0; n=len(d)
    width=None; rows=[]; seed=None; comp=0; images=[]
    while i<n:
        if d[i]!=0x1b: i+=1; continue
        m=re.match(rb'\x1b([*&])([a-z])',d[i:])
        if not m:
            i+=1; continue
        p,g=m.group(1),m.group(2); j=i+3
        while True:
            m2=re.match(rb'([+-]?\d*)([A-Za-z])',d[j:])
            if not m2: break
            val=int(m2.group(1)) if m2.group(1) not in(b'',b'+',b'-') else 0; ch=m2.group(2); j+=len(m2.group(0))
            key=(p+g+ch.lower()).decode()
            if key=='*rs': width=val
            if key=='*ra': seed=[WHITE]*width; rows=[]
            if key=='*by':
                for _ in range(val): rows.append(None)
                seed=[WHITE]*width
            if key in('*bw','*bv','*ow','*gw','&bw'):
                data=d[j:j+val]; j+=val
                if key=='*bw':
                    seed=decode_row(data,seed,width) if val else seed
                    rows.append(seed)
            if key=='*rc' and rows:
                images.append((width,rows)); rows=[]
            if ch.isupper(): break
        i=j
    w,rws=max(images,key=lambda t:len(t[1]))
    im=Image.new('RGB',(w,len(rws)),'white'); px=im.load()
    for y,r in enumerate(rws):
        if r is None: continue
        for x in range(0,w):
            v=r[x]; px[x,y]=((v>>16)&255,(v>>8)&255,v&255)
    from PIL import ImageOps
    bb=ImageOps.invert(im).getbbox(); print("bbox",bb, "center",((bb[0]+bb[2])/2,(bb[1]+bb[3])/2))
    im.thumbnail((900,900)); im.save(out); print(path,'->',out,w,len(rws))
render(sys.argv[1],sys.argv[2])
