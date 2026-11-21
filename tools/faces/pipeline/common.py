import json,re,unicodedata,html,urllib.parse,os
ROOT='/home/user/CFPCoachSimulator'
def norm(s):
    s=unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower()
    s=re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?","",s)
    return re.sub(r'[^a-z]','',s)
def game_people(slug):
    """[(id, name, pos)] : players by slug, coaches by 'coach:<name>'"""
    t=json.load(open(f'{ROOT}/cfb_sim_data/teams/{slug}.json'))
    out=[(p['slug'],p['name'],p['position']) for p in t['roster']]
    for role,c in (t.get('coaches') or {}).items():
        if c and c.get('name'): out.append(('coach:'+c['name'],c['name'],role))
    return out
def parse_nuxt(h):
    """Sidearm 'nextgen' roster page -> {name: image url}"""
    site={}
    for m in re.finditer(r'<a href="(/sports/football/roster/[^"]+)"[^>]*aria-label="([^"]+?)(?: jersey number (\d+))? full bio"[^>]*thumbnail-link">',h):
        seg=h[m.end():m.end()+3000].split('</a>')[0]
        u=re.search(r'crop\?url=([^&"]+)',seg)
        name=html.unescape(m.group(2)).strip()
        if u and name not in site: site[name]=urllib.parse.unquote(html.unescape(u.group(1)))
    return site

def parse_jsonld(h):
    """old Sidearm: schema.org Person list -> {name: image url}"""
    site={}
    for m in re.finditer(r'\{"@type":"Person","@context":"http://schema.org","image":\{"@type":"ImageObject","url":"([^"]*)"[^}]*\},"name":"([^"]+)"',h):
        u,name=m.group(1),html.unescape(m.group(2)).strip()
        if u and not u.rstrip('/').endswith(('.com','.edu','.net')) and name not in site: site[name]=u.replace('http://','https://')
    return site
def parse_wmt(h):
    """WMT (Nuxt payload): people dicts with first_name/last_name and a photo -> {name: image url}"""
    m=re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>',h,re.S)
    if not m: return {}
    try: a=json.loads(m.group(1))
    except ValueError: return {}
    def val(i): return a[i] if isinstance(i,int) and 0<=i<len(a) else None
    site={}
    for d in a:
        if not (isinstance(d,dict) and 'first_name' in d and 'last_name' in d): continue
        fn,ln=val(d['first_name']),val(d['last_name'])
        if not (isinstance(fn,str) and isinstance(ln,str)): continue
        name=f"{fn} {ln}".strip(); url=None
        for k in ('master_photo','photo','default_photo','featured_image'):
            ph=val(d.get(k))
            if isinstance(ph,dict) and isinstance(val(ph.get('url')),str): url=val(ph['url']); break
        if url and name not in site: site[name]=url
    return site
def parse_any(h):
    for kind,fn in (('nuxt',parse_nuxt),('jsonld',parse_jsonld),('wmt',parse_wmt)):
        s=fn(h)
        if len(s)>=30: return kind,s
    return None,{}
def match(slug, site):
    """-> (people [{id,name,pos,img}], missing [(id,name,pos)])"""
    sn={norm(k):v for k,v in site.items()}
    # also first-initial+last and last-name-unique fallbacks are left to a person: exact normalised names only here
    ppl=[];miss=[]
    for i,n,p in game_people(slug):
        u=sn.get(norm(n))
        (ppl.append({'id':i,'name':n,'pos':p,'img':u}) if u else miss.append((i,n,p)))
    return ppl,miss

def _parts(name):
    s=unicodedata.normalize('NFKD',name).encode('ascii','ignore').decode().lower()
    s=re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?","",s); t=[re.sub(r'[^a-z]','',x) for x in s.replace('-',' ').split()]
    t=[x for x in t if x]
    return (t[0] if t else '', t[-1] if t else '')
def fuzzy(name, cands):
    """a looser match for a nickname or a shortened first name: same last name, first names share an initial; only
    when exactly one candidate fits. cands: iterable of names. -> name or None"""
    f,l=_parts(name)
    def ok(c):
        cf,cl=_parts(c)
        return cl==l and cf[:1]==f[:1] and (cf[:2]==f[:2] or len(cf)<=2 or len(f)<=2)
    hits=[c for c in cands if ok(c)]
    return hits[0] if len(hits)==1 else None

def parse_nuxt_full(h):
    """Sidearm nextgen -> [(name, jersey or None, image url)]"""
    out=[];seen=set()
    for m in re.finditer(r'<a href="(/sports/football/roster/[^"]+)"[^>]*aria-label="([^"]+?)(?: jersey number (\d+))? full bio"[^>]*thumbnail-link">',h):
        seg=h[m.end():m.end()+3000].split('</a>')[0]
        u=re.search(r'crop\?url=([^&"]+)',seg); name=html.unescape(m.group(2)).strip()
        if u and name not in seen and '/coaches/' not in m.group(1) and '/staff/' not in m.group(1):
            seen.add(name); out.append((name,m.group(3),urllib.parse.unquote(html.unescape(u.group(1)))))
    return out
def lasts(name):
    s=unicodedata.normalize('NFKD',name).encode('ascii','ignore').decode().lower()
    s=re.sub(r'"[^"]*"|\([^)]*\)',' ',s); s=re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?","",s)
    t=[re.sub(r'[^a-z]','',x) for x in s.split()]; t=[x for x in t if x]
    if not t: return set()
    return {t[-1]} | set(t[-1].split('-')) | {re.sub(r'[^a-z]','',p) for p in s.split()[-1].split('-')}

def parse_wmt_entries(h):
    """WMT roster-entry records (the photo sits here, not on the person) -> [(name, jersey, image url)]"""
    m=re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>',h,re.S)
    if not m: return []
    try: a=json.loads(m.group(1))
    except ValueError: return []
    def val(i): return a[i] if isinstance(i,int) and not isinstance(i,bool) and 0<=i<len(a) else None
    out=[]
    for d in a:
        if not (isinstance(d,dict) and 'player' in d and 'photo' in d): continue
        pl,ph=val(d['player']),val(d['photo'])
        if not (isinstance(pl,dict) and isinstance(ph,dict)): continue
        fn,ln,u=val(pl.get('first_name')),val(pl.get('last_name')),val(ph.get('url'))
        j=val(d.get('jersey_number_label')) or val(d.get('jersey_number'))
        if isinstance(fn,str) and isinstance(ln,str) and isinstance(u,str): out.append((f"{fn} {ln}".strip(),str(j) if j is not None else '',u))
    return out
