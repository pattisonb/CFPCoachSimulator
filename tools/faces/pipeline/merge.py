"""merge.py W : every reviewed face -> cfb_sim_data/faces/<team>.json  ({"players": {slug: face}, "coaches": {name: face}, "rolled": {...}})"""
import json,sys,os,glob
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from common import *
W=sys.argv[1]; DROP={'coach:Fran Brown'}   # a player's photo under the coach's name
done={}
for f in sorted(glob.glob(W+'/teams/*/faces.json')):
    d=json.load(open(f)); done.update(d['players']); done.update({'coach:'+k:v for k,v in d['coaches'].items()})
for k in DROP: done.pop(k,None)
rolled=json.load(open(W+'/rolled.json')) if os.path.exists(W+'/rolled.json') else {}
def dump(o):
    return "{\n"+",\n".join(f' {json.dumps(k)}: {{\n'+",\n".join(f'  {json.dumps(n, ensure_ascii=False)}: {json.dumps(f)}' for n,f in v.items())+("\n" if v else "")+" }" for k,v in o.items())+"\n}\n"
tot=[0,0,0]
for s in sorted(json.load(open(W+'/espn/map.json'))):
    path=f'{ROOT}/cfb_sim_data/faces/{s}.json'
    out=json.load(open(path)) if os.path.exists(path) else {}
    out={"players":dict(out.get("players") or {}),"coaches":dict(out.get("coaches") or {}),"rolled":dict(out.get("rolled") or {})}
    for i,n,p in game_people(s):
        if i in done:
            if i.startswith('coach:'): out["coaches"][n]=done[i]
            else: out["players"][i]=done[i]
        elif i in rolled and not i.startswith('coach:') and i not in out["players"]: out["rolled"][i]=rolled[i]
        elif i in rolled and i.startswith('coach:') and n not in out["coaches"]: out["rolled"][i]=rolled[i]
    out["players"]=dict(sorted(out["players"].items())); out["rolled"]=dict(sorted(out["rolled"].items()))
    s_=dump(out); json.loads(s_); open(path,'w',encoding='utf-8').write(s_)
    for k,key in enumerate(("players","coaches","rolled")): tot[k]+=len(out[key])
print("players %d, coaches %d, rolled %d"%tuple(tot))
