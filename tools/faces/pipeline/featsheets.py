"""featsheets.py W : for every reviewed folder, feat/NN.jpg sheets of 25 (only the photos that became a face), numbered by index"""
import json,sys,os,glob
from PIL import Image, ImageDraw
W=sys.argv[1]; tot=0; rows=[]
for pf in sorted(glob.glob(W+'/teams/*/people.json')):
    d=os.path.dirname(pf)
    if not os.path.exists(d+'/faces.json') or os.path.basename(d).startswith('sc-2'): continue
    ppl=json.load(open(pf)); fz=json.load(open(d+'/faces.json')); used=set(fz['players'])|{'coach:'+k for k in fz['coaches']}
    idx=[i for i,p in enumerate(ppl) if (p['id'] in used or 'coach:'+p['name'] in used) and os.path.exists(f"{d}/img/{i:03d}.jpg")]
    if not idx: continue
    os.makedirs(d+'/feat',exist_ok=True)
    for f in glob.glob(d+'/feat/*.jpg'): os.remove(f)
    for s in range(0,len(idx),25):
        sh=Image.new('RGB',(5*256,5*256),'white'); dr=ImageDraw.Draw(sh)
        for k,i in enumerate(idx[s:s+25]):
            x,y=(k%5)*256,(k//5)*256; sh.paste(Image.open(f"{d}/img/{i:03d}.jpg").resize((256,256)),(x,y))
            dr.rectangle([x,y,x+40,y+20],fill='black'); dr.text((x+5,y+4),str(i),fill='yellow')
        sh.save(f"{d}/feat/{s//25:02d}.jpg",quality=85)
    rows.append((os.path.basename(d),len(idx))); tot+=len(idx)
print(tot,len(rows))
# batches of about 950 photos
b=[];cur=[];n=0
for name,c in rows:
    cur.append(name); n+=c
    if n>=950: b.append(cur); cur=[];n=0
if cur: b.append(cur)
json.dump(b,open(W+'/featbatches.json','w')); print(len(b),[len(x) for x in b])
