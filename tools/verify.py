import sys; import os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import re, numpy as np
from m10 import decode_row, WHITE
def decode(path):
    d=open(path,'rb').read(); i=0; n=len(d); width=None; rows=[]; seed=None
    while i<n:
        if d[i]!=0x1b: i+=1; continue
        m=re.match(rb'\x1b([*&])([a-z])',d[i:])
        if not m: i+=1; continue
        p,g=m.group(1),m.group(2); j=i+3
        while True:
            m2=re.match(rb'([+-]?\d*)([A-Za-z])',d[j:])
            if not m2: break
            val=int(m2.group(1)) if m2.group(1) not in(b'',b'+',b'-') else 0; ch=m2.group(2); j+=len(m2.group(0))
            key=(p+g+ch.lower()).decode()
            if key=='*rs': width=val
            if key=='*ra': seed=[WHITE]*width; rows=[]
            if key=='*by':
                rows+= [[WHITE]*width]*val; seed=[WHITE]*width
            if key in('*bw','*bv','*ow','*gw','&bw'):
                data=d[j:j+val]; j+=val
                if key=='*bw':
                    seed=decode_row(data,seed,width) if val else seed; rows.append(seed)
            if ch.isupper(): break
        i=j
    return width,rows
q=sys.argv[1]
w,rows=decode(f'/tmp/job_{q}.pcl')
src=np.frombuffer(open(f'/tmp/src_{q}.rgb','rb').read(),np.uint8).reshape(w,w,3).astype(int)
dec=np.full((w,w,3),255,int)
for y,r in enumerate(rows):
    a=np.array(r,np.int64); dec[y,:,0]=(a>>16)&255; dec[y,:,1]=(a>>8)&255; dec[y,:,2]=a&255
diff=np.abs(src-dec)
print('rows',len(rows),'max diff per channel',diff.reshape(-1,3).max(0),'pixels with R/G diff',int(((diff[:,:,0]>0)|(diff[:,:,1]>0)).sum()),'blue>1',int((diff[:,:,2]>1).sum()))
