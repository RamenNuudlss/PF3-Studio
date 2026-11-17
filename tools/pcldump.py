import sys,re
def dump(d,maxraster=3):
    i=0;n=len(d);rows=0;out=[]
    while i<n:
        c=d[i]
        if c==0x1b:
            if d[i+1:i+2]==b'%':
                m=re.match(rb'\x1b%(-?\d*)([A-Za-z])',d[i:])
                if m and m.group(2)==b'P':
                    j=d.find(b'udw.quit;',i); out.append(('UDW',d[i+3:j+9].decode('latin1').replace('\n',' '))); i=j+9; continue
                out.append(('ESC%',m.group(0)[1:].decode())); i+=len(m.group(0))
                if m.group(0).endswith(b'X'):
                    # PJL lines
                    while d[i:i+1]==b'@':
                        j=d.find(b'\n',i); out.append(('PJL',d[i:j].decode('latin1').strip())); i=j+1
                continue
            if d[i+1:i+2]==b'E': out.append(('RESET','')); i+=2; continue
            m=re.match(rb'\x1b([!-/])([`-~])',d[i:])
            if not m: out.append(('??',d[i:i+8])); i+=1; continue
            p,g=m.group(1),m.group(2); i+=3
            while True:
                m2=re.match(rb'([+-]?\d*\.?\d*)([`-~@-^])',d[i:])
                val,ch=m2.group(1),m2.group(2); i+=len(m2.group(0))
                cmd=(p+g+ch.lower()).decode()
                v=int(float(val)) if val not in (b'',b'+',b'-') else 0
                if ch in b'WV@[\\]^' or (ch.upper()==b'W' ) or (cmd in('*bv','*bw','*gw','*ow','&bw')):
                    data=d[i:i+v]; i+=v
                    if cmd in('*bw','*bv'):
                        rows+=1
                        if rows<=maxraster: out.append((cmd,v,data[:16].hex()))
                    else: out.append((cmd,v,data.hex()))
                else:
                    if cmd not in('*by',) or rows<maxraster: out.append((cmd,val.decode()))
                if ch.isupper() or ch==b'@': break
        else:
            j=i
            while j<n and d[j]!=0x1b: j+=1
            if j-i>0 and any(d[i:j]): out.append(('TEXT',d[i:j][:60]))
            i=j
    return out,rows
if __name__=='__main__':
    d=open(sys.argv[1],'rb').read()
    out,rows=dump(d)
    for o in out[:int(sys.argv[2]) if len(sys.argv)>2 else 200]: print(o)
    print('raster rows',rows)
