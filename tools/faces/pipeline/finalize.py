"""finalize.py W slug  : reads teams/<slug>/table.txt, validates, writes faces.json and compare.png
table line:  idx shape skin hairColor hair fade beard mouth eye nose ears      (or:  idx SKIP reason)"""
import json,sys,subprocess,os
from PIL import Image, ImageDraw
W,slug=sys.argv[1],sys.argv[2]; d=f"{W}/teams/{slug}"
ppl=json.load(open(d+'/people.json'))
SH={f"0{i}" for i in range(8)}; SK="porcelain light tan brown dark deep".split(); HC="black darkbrown brown blond red auburn".split()
HAIR="00 01 02 03 04 05 06 07 08 09 10 11 12 14 17 19 20 23 24 25 26 27 -".split(); BE="01 02 03 04 -".split()
EY="brown dark hazel green blue gray".split(); errs=[]; rows={}
for ln,line in enumerate(open(d+'/table.txt').read().splitlines(),1):
    t=line.split()
    if not t or t[0].startswith('#'): continue
    try: i=int(t[0])
    except ValueError: errs.append(f"line {ln}: bad index"); continue
    if not 0<=i<len(ppl): errs.append(f"line {ln}: index {i} out of range"); continue
    if i in rows: errs.append(f"line {ln}: index {i} twice")
    if len(t)>1 and t[1]=='SKIP': rows[i]=None; continue
    if len(t)!=11: errs.append(f"line {ln}: need 11 fields, got {len(t)}"); continue
    _,sh,sk,hc,ha,fa,be,mo,ey,no,ea=t
    bad=[n for n,ok in (('shape',sh in SH),('skin',sk in SK),('hairColor',hc in HC),('hair',ha in HAIR),('fade',fa in '01'),('beard',be in BE),
         ('mouth',mo in ('00','01','02','03','04')),('eye',ey in EY),('nose',no in ('00','01','02','03','04')),('ears',ea in ('00','01','02','03'))) if not ok]
    if bad: errs.append(f"line {ln}: bad {', '.join(bad)}"); continue
    rows[i]={"faceShape":"face_shape_"+sh,"skinTone":sk,"hairColor":hc,"eyeColor":ey,"ears":"ears_"+ea,"chin":None,"nose":"nose_"+no,
             "beard":None if be=='-' else "beard_"+be,"mouth":"mouth_"+mo,"brows":"brows_00","hair":None if ha=='-' else "hair_"+ha,"hairFade":fa=='1',"flip":[]}
miss=[i for i in range(len(ppl)) if i not in rows]
if miss: errs.append(f"no line for index: {miss}")
if errs: print("\n".join(errs)); sys.exit(1)
idx=[i for i in range(len(ppl)) if rows[i]]
json.dump([rows[i] for i in idx],open(d+'/specs.json','w'))
subprocess.run(["node",W+"/code/px.mjs",d+"/specs.json",d+"/faces.bin",d+"/resolved.json"],check=True)
res=json.load(open(d+'/resolved.json')); out={"players":{},"coaches":{}}
for i,f in zip(idx,res):
    p=ppl[i]
    if p['id'].startswith('coach:'): out["coaches"][p['name']]=f
    else: out["players"][p['id']]=f
json.dump(out,open(d+'/faces.json','w'))
json.dump([ppl[i]['id'] for i in range(len(ppl)) if not rows[i]],open(d+'/skipped.json','w'))
b=open(d+'/faces.bin','rb').read(); C=6;Wd=150;H=Wd+18;rws=(len(idx)+C-1)//C
sh=Image.new('RGB',(C*2*Wd,rws*H),(235,235,235)); dr=ImageDraw.Draw(sh)
for k,i in enumerate(idx):
    x,y=(k%C)*2*Wd,(k//C)*H
    try: sh.paste(Image.open(f"{d}/img/{i:03d}.jpg").resize((Wd,Wd)),(x,y))
    except Exception: pass
    im=Image.frombytes('RGBA',(48,48),b[k*9216:(k+1)*9216]).crop((6,10,42,46)).resize((144,144),Image.NEAREST)
    sh.paste(im,(x+Wd+3,y+3),im); dr.text((x+3,y+Wd+3),f"{i} {ppl[i]['name']} {ppl[i]['pos'][:4]}",fill='black')
sh.save(d+'/compare.png')
print(f"OK {slug}: {len(out['players'])} players, {len(out['coaches'])} coaches, {len(ppl)-len(idx)} skipped")
