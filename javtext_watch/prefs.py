import json,collections,re
R='/workspace/jav-site/'
GENERIC={'单体作品','高清','独家分发','4K','配信専用','数位马赛克','薄码','ハイクオリティVR','VR专用','口交','接吻','主观','第一人称','素人','精选、综合','DMM独家','独占配信','ハイビジョン','デジモ'}
DIS_TAG_W=30  # each user-踩 work carrying a tag subtracts this from that tag's preference score
_D=None
def dislike():
    """Shared Dislike filter (feed-prefs API; empty = no filtering when the API fails)."""
    global _D
    if _D is None:
        import sys; sys.path.insert(0,'/workspace/javtext_watch')
        try:
            from feed_prefs import load_prefs,Dislike
            _D=Dislike(load_prefs())
        except Exception as e:
            print('dislike filter disabled:',e)
            from feed_prefs import Dislike; _D=Dislike(None)
    return _D
def prefs(topn=12):
    fav=json.load(open(R+'data/favorites.json'))
    names=set()
    for a in fav: names|={a['name'],*a.get('aliases',[])}
    D=dislike()
    names|={n for n in D.follow_names if len(n)>1}  # cloud follows (all users)
    fi=json.load(open(R+'data/fav_items.json'));C=collections.Counter()
    for k,s in fi.items():
        if k=='_meta' or not isinstance(s,dict): continue
        ws=[w for w in s.values() if isinstance(w,dict)]
        # weight each actress store equally so the 300-work male actor doesn't dominate
        for w in ws:
            for g in set(w.get('genres',[])): C[g]+=100/len(ws)
    for g,n in D.tags.items(): C[g]-=DIS_TAG_W*n  # 喜好标签打分减去不喜欢标签
    top=[(g,round(v,1)) for g,v in C.most_common() if g not in GENERIC and v>0][:topn]
    return fav,names,top
def parts(g): return {p for p in re.split(r'[・/、]',g) if p}
def tag_hits(genres,top):
    out=[]
    for t,_ in top:
        tp=parts(t)
        if any(g==t or parts(g)&tp or t in g or g in t for g in genres): out.append(t)
    return out
def actress_hit(it,names):
    ns=set(it.get('actresses_list') or [])|{a.get('name','') for a in it.get('actresses') or []}
    return sorted(n for n in ns if n and any(n==x or n in x or x in n for x in names if len(x)>1))
if __name__=='__main__':
    fav,names,top=prefs(); print(names); print(top)
    its=json.load(open(R+'data/items.json'));d=collections.Counter()
    for it in its:
        h=tag_hits(it.get('genres',[]),top); d[len(h)]+=1
        a=actress_hit(it,names)
        if a or len(h)>=4: print(it['code'],a,h,it.get('cover_src'),it['title'][:30])
    print(d)
