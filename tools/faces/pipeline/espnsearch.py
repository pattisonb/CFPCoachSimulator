import json,sys,os,glob,urllib.parse,urllib.request,time
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from common import *
W=sys.argv[1]; miss=json.load(open(W+'/miss.json'))
inr3={p['id'] for f in glob.glob(W+'/teams/r3-*/people.json') for p in json.load(open(f))}
todo=[m for m in miss if not m[1].startswith('coach:') and m[1] not in inr3]
cache=json.load(open(W+'/espn/search.json')) if os.path.exists(W+'/espn/search.json') else {}
def q(m):
    s,i,n,p=m
    if i in cache: return
    try:
        d=json.load(urllib.request.urlopen(urllib.request.Request("https://site.web.api.espn.com/apis/search/v2?limit=10&type=player&query="+urllib.parse.quote(n),headers={'User-Agent':'Mozilla/5.0'}),timeout=30))
        c=[x for r in d.get('results',[]) if r.get('type')=='player' for x in r.get('contents',[])]
        cache[i]=[{'name':x.get('displayName'),'league':x.get('description'),'team':x.get('subtitle'),'img':(x.get('image') or {}).get('default')} for x in c]
    except Exception as e: print('FAIL',n,e)
with ThreadPoolExecutor(4) as ex: list(ex.map(q,todo))
json.dump(cache,open(W+'/espn/search.json','w'))
hit=[]
for s,i,n,p in todo:
    c=[x for x in cache.get(i,[]) if x['league']=='NCAAF' and x['img'] and norm(x['name'] or '')==norm(n)]
    if len(c)==1: hit.append({'id':i,'name':n,'pos':p,'img':c[0]['img'],'team':s,'espn_team':c[0]['team']})
print(len(todo),len(hit))
json.dump(hit,open(W+'/espn/search_hits.json','w'),indent=1)
