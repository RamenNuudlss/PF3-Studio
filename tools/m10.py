"""HP PCL3GUI Mode 10 (pixel delta/RLE) decode for verification."""
import re
WHITE=0xFFFFFF
def rd_vli(d,i):
    tot=0
    while True:
        b=d[i]; i+=1; tot+=b
        if b!=255: return tot,i
def rd_pix(d,i,seed):
    b0=d[i]
    if b0&0x80:
        v=(b0<<8)|d[i+1]; i+=2
        dr=(v>>10)&0x1f; dg=(v>>5)&0x1f; db=v&0x1f
        if dr&0x10: dr-=32
        if dg&0x10: dg-=32
        if db&0x10: db-=32
        db*=2
        r=((seed>>16)&255)+dr; g=((seed>>8)&255)+dg; b=(seed&255)+db
        return ((r&255)<<16)|((g&255)<<8)|(b&255), i
    v=((b0<<16)|(d[i+1]<<8)|d[i+2])<<1; i+=3
    return v&0xFFFFFF, i
def decode_row(d,seed,width):
    row=list(seed); x=0; i=0; cache=WHITE; n=len(d)
    while i<n and x<width:
        cmd=d[i]; i+=1
        rle=cmd&0x80; src=cmd&0x60; seedcnt=(cmd>>3)&3; cnt=cmd&7
        if seedcnt==3:
            e,i=rd_vli(d,i); seedcnt+=e
        x+=seedcnt  # copy from seed (already in row)
        if x>=width: break
        def first():
            nonlocal i,cache
            if src==0x00:
                p,i2=rd_pix(d,i,seed[x]); i=i2; cache=p; return p
            if src==0x20: return row[x-1]
            if src==0x40: return seed[x+1] if x+1<width else WHITE
            return cache
        if rle:
            cnt+=2
            p=first()
            if cmd&7==7:
                e,i=rd_vli(d,i); cnt+=e
            for k in range(cnt):
                if x<width: row[x]=p
                x+=1
        else:
            total=cnt+1; extra=(cnt==7)
            k=1
            p=first(); row[x]=p; x+=1
            if src!=0x00: pass
            # remaining pixels
            def maybe_spill():
                nonlocal total,i,extra
                if extra and (k-8)%255==0:
                    b=d[i]; i+=1; total+=b
                    extra=(b==255)
            if k==8 or False: pass
            # spill rule: after pixel number 8, 263, ...
            if extra and k==8: maybe_spill()
            while k<total:
                p,i=rd_pix(d,i,seed[x] if x<width else WHITE)
                if x<width: row[x]=p
                x+=1; k+=1
                if extra and (k-8)%255==0 and k>=8:
                    b=d[i]; i+=1; total+=b; extra=(b==255)
    return row
