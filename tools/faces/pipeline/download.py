"""download.py W slug...  -> teams/<slug>/img/NNN.jpg (320x320, top-centre crop) and sheets/NN.jpg (16 per sheet, numbered)"""
import json,sys,os,io,time,urllib.parse,urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageDraw, ImageOps
W=sys.argv[1]
UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=40).read()
def one(slug,i,p):
    f=f"{W}/teams/{slug}/img/{i:03d}.jpg"
    if os.path.exists(f): return True
    u=p['img']
    if u.startswith('//'): u='https:'+u
    tries=[u]
    if 'sidearm' in u or 'cloudfront' in u: tries.insert(0,"https://images.sidearmdev.com/crop?url="+urllib.parse.quote(u,safe='')+"&width=320&height=320&gravity=north&type=jpeg")
    for t in tries:
        try:
            im=Image.open(io.BytesIO(get(t))).convert('RGB')
            w,h=im.size; s=min(w,h)
            im=im.crop(((w-s)//2,0,(w-s)//2+s,s)).resize((320,320))
            im.save(f,quality=85); return True
        except Exception as e: err=e
    print('FAIL',slug,i,p['name'],str(err)[:80],flush=True); return False
def team(slug):
    d=f"{W}/teams/{slug}"; os.makedirs(d+'/img',exist_ok=True); os.makedirs(d+'/sheets',exist_ok=True)
    ppl=json.load(open(d+'/people.json'))
    with ThreadPoolExecutor(int(os.environ.get("THREADS","4"))) as ex: ok=list(ex.map(lambda a: one(slug,*a), enumerate(ppl)))
    N=16
    for s in range(0,len(ppl),N):
        sh=Image.new('RGB',(4*320,4*320),'white'); dr=ImageDraw.Draw(sh)
        for k in range(N):
            i=s+k
            if i>=len(ppl): break
            x,y=(k%4)*320,(k//4)*320
            try: sh.paste(Image.open(f"{d}/img/{i:03d}.jpg"),(x,y))
            except Exception: dr.text((x+100,y+150),"NO PHOTO",fill='red')
            dr.rectangle([x,y,x+46,y+22],fill='black'); dr.text((x+5,y+5),str(i),fill='yellow')
        sh.save(f"{d}/sheets/{s//N:02d}.jpg",quality=85)
    print(slug,sum(ok),len(ppl),flush=True)
for slug in sys.argv[2:]: team(slug)
