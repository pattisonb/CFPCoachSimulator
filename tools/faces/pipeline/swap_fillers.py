"""swap_fillers.py W [--write] : give each made-up roster player the name, number and photo of an unused real player
at his position on the school's ESPN roster. The player keeps his id (slug), ratings, class and size: only the name
and jersey change. Records every swap in tools/faces/roster_swaps.json and lays the photos out for review in
W/teams/sw-NN/."""
import json,sys,os,glob
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from common import *
W=sys.argv[1]; WRITE='--write' in sys.argv
KNOWN_REAL={'jamaun-thompson','nico-wiedmann','wydeek-collier-johnson','guy-fernandez-iii','lagarion-wilson','taveon-robinson','tim-anthony',
            'tyrese-cathey','balint-vorosmarty','joshua-tavui','marquez-wimberly','l-a-jessie-harrold','quantaves-gaskins'}
FINE={"QB":"QB","HB":"RB","FB":"FB","WR":"WR","TE":"TE","LT":"OT","RT":"OT","LG":"G","RG":"G","C":"C","DT":"DT","LEDG":"DE","REDG":"DE",
      "SAM":"LB","MIKE":"LB","WILL":"LB","CB":"CB","FS":"S","SS":"S","K":"K","P":"P"}
EFINE={"QB":"QB","RB":"RB","FB":"FB","WR":"WR","TE":"TE","OT":"OT","G":"G","OG":"G","C":"C","OL":"OL","DT":"DT","NT":"DT","DL":"DL","DE":"DE","EDGE":"DE",
       "LB":"LB","OLB":"LB","ILB":"LB","CB":"CB","S":"S","DB":"DB","PK":"K","K":"K","P":"P"}
COARSE={"QB":"QB","RB":"RB","FB":"RB","WR":"WR","TE":"TE","OT":"OL","G":"OL","C":"OL","OL":"OL","DT":"DL","DE":"DL","DL":"DL","LB":"LB","CB":"DB","S":"DB","DB":"DB","K":"K","P":"P"}
YEARS={"FR":0,"SO":1,"JR":2,"SR":3}
def yrs(c):
    c=(c or '').upper().replace('RS','').strip(); return YEARS.get(c[:2],1.5)
corr={c['slug']:c['roster_name'] for c in json.load(open(ROOT+'/tools/faces/name_corrections.json'))}
swaps=[];left=[]
for s in sorted(json.load(open(W+'/espn/map.json'))):
    tp=f'{ROOT}/cfb_sim_data/teams/{s}.json'; t=json.load(open(tp)); fz=json.load(open(f'{ROOT}/cfb_sim_data/faces/{s}.json'))
    fill=[p for p in t['roster'] if p['slug'] not in fz['players'] and p['slug'] not in KNOWN_REAL]
    if not fill: continue
    used={norm(p['name']) for p in t['roster']}|{norm(corr[p['slug']]) for p in t['roster'] if p['slug'] in corr}
    cands=[]
    for g in json.load(open(f'{W}/espn/{s}.json')).get('athletes',[]):
        for a in g['items']:
            f=EFINE.get((a.get('position') or {}).get('abbreviation'))
            if f and norm(a['fullName']) not in used:
                cands.append({'name':a['fullName'],'fine':f,'jersey':str(a.get('jersey') or ''),'weight':a.get('weight'),'height':a.get('displayHeight'),
                              'class':(a.get('experience') or {}).get('abbreviation'),'img':(a.get('headshot') or {}).get('href'),'espn_id':a['id']})
    pairs=[]
    for i,p in enumerate(fill):
        pf=FINE.get(p['position'])
        if not pf: continue
        for j,c in enumerate(cands):
            if COARSE[pf]!=COARSE[c['fine']]: continue
            same=str(p.get('jersey') or '')==c['jersey']!=''
            cost=(0 if pf==c['fine'] else 3)-(10 if same else 0)+(abs((p.get('weight_lbs') or 0)-c['weight'])/15 if c['weight'] and p.get('weight_lbs') else 2)\
                 +abs(yrs(p.get('class'))-yrs(c['class']))+(0 if c['img'] else 6)
            pairs.append((cost,i,j,same))
    ti=set();tj=set()
    for cost,i,j,same in sorted(pairs):
        if i in ti or j in tj: continue
        ti.add(i);tj.add(j); p=fill[i]; c=cands[j]
        swaps.append({'team':s,'slug':p['slug'],'was':p['name'],'now':c['name'],'position':p['position'],'was_jersey':str(p.get('jersey') or ''),'now_jersey':c['jersey'],
                      'match':'same position and number' if same else 'assigned by position, size and class','his_real_position':c['fine'],
                      'his_real_class':c['class'],'his_real_height':c['height'],'his_real_weight':c['weight'],'photo':c['img'],'espn_id':c['espn_id']})
        if WRITE:
            p['name']=c['name']
            if c['jersey']: p['jersey']=c['jersey']
    left+=[(s,p['slug'],p['name'],p['position']) for i,p in enumerate(fill) if i not in ti]
    if WRITE:
        raw=open(tp,encoding='utf-8').read(); ea=json.dumps(json.loads(raw),indent=1,ensure_ascii=True)==raw     # keep the file's own style
        open(tp,'w',encoding='utf-8').write(json.dumps(t,indent=1,ensure_ascii=ea))
import collections
print(len(swaps),collections.Counter(x['match'] for x in swaps),'no photo:',sum(1 for x in swaps if not x['photo']),'left:',len(left))
print(collections.Counter(x[0] for x in left).most_common(8))
if WRITE:
    open(ROOT+'/tools/faces/roster_swaps.json','w',encoding='utf-8').write("[\n"+",\n".join(" "+json.dumps(x,ensure_ascii=False) for x in swaps)+"\n]\n")
    ph=[{'id':x['slug'],'name':x['now'],'pos':x['position'],'img':x['photo'],'team':x['team']} for x in swaps if x['photo']]
    for k in range(0,len(ph),80):
        d=f'{W}/teams/sw-{k//80:02d}'; os.makedirs(d,exist_ok=True); json.dump(ph[k:k+80],open(d+'/people.json','w'),indent=1)
    json.dump(left,open(W+'/swap_left.json','w'))
