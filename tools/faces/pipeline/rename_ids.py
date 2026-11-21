"""rename_ids.py [--write] : give every swapped-in real player an id (slug) made from his own name, everywhere the old
made-up id is written (rosters, starters, depth charts, saved adjustments, faces, the notes under tools/faces)."""
import json,re,sys,unicodedata,glob,os
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
WRITE='--write' in sys.argv
def slugify(name):
    s=unicodedata.normalize('NFKD',name).encode('ascii','ignore').decode().lower()
    return re.sub(r'-+','-',re.sub(r'[^a-z0-9]+','-',s)).strip('-')
sw=json.load(open(ROOT+'/tools/faces/roster_swaps.json'))
taken=set()
for f in glob.glob(ROOT+'/cfb_sim_data/teams/*.json'):
    taken|={p['slug'] for p in json.load(open(f)).get('roster',[])}
old={x.get('old_slug',x['slug']) for x in sw}
ren={}
for x in sw:
    if x.get('old_slug'): continue                     # already renamed
    new=slugify(x['now'])
    if new in taken and new!=x['slug']: new=f"{new}-{x['team']}"
    assert new not in taken or new==x['slug'], new
    taken.add(new); ren[x['slug']]=new; x['old_slug']=x['slug']; x['slug']=new
print(len(ren),'ids to rename;',sum(1 for o,n in ren.items() if n.endswith(tuple('-'+x['team'] for x in sw))),'needed the school added')
files=glob.glob(ROOT+'/cfb_sim_data/teams/*.json')+glob.glob(ROOT+'/cfb_sim_data/faces/*.json')+glob.glob(ROOT+'/cfb_sim_data/*.json')\
     +[f for f in glob.glob(ROOT+'/data/*.json') if os.path.basename(f) not in ('engine_teams.json','player_potential.json','base_league.json','base_meta.json')]\
     +[ROOT+'/tools/faces/missing_features.json',ROOT+'/tools/faces/name_corrections.json']
pat=re.compile(r'"('+'|'.join(re.escape(o) for o in sorted(ren,key=len,reverse=True))+r')"') if ren else None
n=0
for f in files:
    s=open(f,encoding='utf-8').read(); t,k=pat.subn(lambda m:'"'+ren[m.group(1)]+'"',s) if pat else (s,0)
    if k:
        n+=k; json.loads(t)
        if WRITE: open(f,'w',encoding='utf-8').write(t)
        if not f.endswith(('teams/'+os.path.basename(f),)) or True: pass
print(n,'places changed in',len(files),'files')
if WRITE: open(ROOT+'/tools/faces/roster_swaps.json','w',encoding='utf-8').write("[\n"+",\n".join(" "+json.dumps(x,ensure_ascii=False) for x in sw)+"\n]\n")
