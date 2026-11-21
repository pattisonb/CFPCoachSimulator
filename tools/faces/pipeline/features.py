"""features.py W : collect teams/*/features.txt -> tools/faces/missing_features.json"""
import json,sys,os,glob,collections,re
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from common import *
W=sys.argv[1]
who={}   # id -> (team, name, role)
for s in sorted(json.load(open(W+'/espn/map.json'))):
    for i,n,p in game_people(s): who.setdefault(i,(s,n,p))
tags={}
for ff in sorted(glob.glob(W+'/teams/*/features.txt')):
    d=os.path.dirname(ff); ppl=json.load(open(d+'/people.json')); fz=json.load(open(d+'/faces.json')) if os.path.exists(d+'/faces.json') else {'players':{},'coaches':{}}
    for line in open(ff).read().splitlines():
        t=line.split()
        if len(t)<2 or not t[0].isdigit() or int(t[0])>=len(ppl): continue
        p=ppl[int(t[0])]; i=p['id'] if p['id'] in who else 'coach:'+p['name']
        if i not in who: continue
        ok=[x.lower() for x in t[1:] if re.fullmatch(r'[a-z_]+|other:[a-z0-9_]+',x.lower())]
        if ok: tags.setdefault(i,set()).update(ok)
people=[];counts=collections.Counter();cc=collections.Counter()
for i,ts in tags.items():
    s,n,role=who[i]; coach=i.startswith('coach:')
    people.append({'team':s,'id':None if coach else i,'name':n,'role':role,'coach':coach,'tags':sorted(ts)})
    for t in ts: counts[t]+=1; cc[t]+=coach
people.sort(key=lambda p:(p['team'],not p['coach'],p['name']))
out={"about":"What each real player's or coach's photo showed that the face parts cannot draw yet (noted from the roster photos; earrings and braids-versus-cornrows are the least certain at the size the photos were viewed).",
     "counts":{t:{"people":c,"coaches":cc[t]} for t,c in counts.most_common()},"people":people}
p=ROOT+'/tools/faces/missing_features.json'
open(p,'w',encoding='utf-8').write('{\n "about": '+json.dumps(out["about"])+',\n "counts": {\n'+",\n".join(f'  {json.dumps(k)}: {json.dumps(v)}' for k,v in out["counts"].items())+'\n },\n "people": [\n'+",\n".join("  "+json.dumps(x,ensure_ascii=False) for x in people)+'\n ]\n}\n')
json.load(open(p)); print(len(people), sum(p['coach'] for p in people)); print(counts.most_common(30)); print('coaches:',cc.most_common(12))
