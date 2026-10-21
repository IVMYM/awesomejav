#!/usr/bin/env python3
"""Trial batch: follow/tag-matched new releases + non-repeating hot picks (javdb rankings + missav hot) -> jav-site data."""
import sys,os,json,re,time,collections
sys.path.insert(0,'/workspace/jav-site'); sys.path.insert(0,'/workspace/javtext_watch')
import scrape as S
from prefs import prefs,tag_hits,actress_hit,dislike
from bs4 import BeautifulSoup
R='/workspace/jav-site/'; W='/workspace/javtext_watch/'; DAY=time.strftime('%Y-%m-%d'); NOW=time.strftime('%Y-%m-%d %H:%M')
REP=W+f'reports/{DAY}/'; os.makedirs(REP,exist_ok=True)
fav,names,top=prefs()
items=json.load(open(R+'data/items.json'))
for it in items: it['genres']=[g for g in it.get('genres',[]) if g]
D=dislike()  # 踩: aggregated from all users via /api/feed-prefs (empty -> no filtering)
for it in items:  # already in library: drop from 首页推送 / 热门推荐 / 关注相关 (still searchable)
    if D.code(it.get('code')):
        if it.get('hot') or it.get('match') or not it.get('suppressed'): D.note('已在库·踩过',it['code'])
        it.pop('hot',None); it.pop('match',None); it['suppressed']='dislike'
    elif it.get('suppressed')=='dislike' and D.ok: it.pop('suppressed',None)  # un-踩
hist_p=W+'recommended_hot.json'; hist=json.load(open(hist_p)) if os.path.exists(hist_p) else {"pushed":{}, "batches":[]}
fi=json.load(open(R+'data/fav_items.json'))
fav_codes={w['code'] for k,s in fi.items() if k!='_meta' for w in s.values() if isinstance(w,dict) and w.get('code')}
item_codes={i['code'] for i in items}
log=collections.OrderedDict()
# ---- 1. related among this batch's new releases
related=[]
for it in items:
    if it.get('match_reported') or it.get('suppressed'): continue
    if D.seen(it.get('code')):  # 已浏览: keep in library, don't push again
        if actress_hit(it,names): D.note('关注相关·已看过',it['code'])
        continue
    a=actress_hit(it,names); h=[t for t in tag_hits(it['genres'],top) if t not in D.tags]
    neg=D.tag_penalty(it['genres'])
    if not a and D.actor_hit(it):
        if len(h)>=4: D.note('关注相关·不喜欢演员',it['code'])
        continue
    if a or len(h)-len(neg)>=4:
        why=(['演员:'+'/'.join(a)] if a else [])+(['标签:'+'、'.join(h)] if h else [])
        it['match']={"actress":a,"tags":h,"why":'；'.join(why),"batch":DAY}
        related.append(it)
for it in related:
    if it.get('cover_src') not in ('r18','dmm'): it.pop('cover_src',None); S.fetch_cover(it); time.sleep(1)
    if it.get('cover_src') in ('r18','dmm'): S.fetch_samples(it)
log['related']=len(related)
# ---- 2. hot sources
UA=S.UA; hot=collections.defaultdict(lambda:{"src":[],"score":0.0})
def add(code,src,rank,n,extra=''):
    code=code.upper().strip()
    if not re.match(r'^[A-Z0-9]+-\d+$',code): return
    h=hot[code]; h['src'].append(f"{src}#{rank}"+(f"({extra})" if extra else '')); h['score']+=(n-rank+1)/n
src_status={}
for p in ('daily','weekly'):
    u=f"https://javdb.com/rankings/movies?p={p}&t=censored"
    try:
        r=S.S.get(u,headers=UA,timeout=30); time.sleep(1.5)
        its=BeautifulSoup(r.text,'html.parser').select('.movie-list .item') if r.status_code==200 else []
        src_status[f'javdb {p}']=f"{r.status_code}, {len(its)} 条"
        for k,i in enumerate(its[:40],1):
            t=i.select_one('.video-title strong'); sc=S.T(i.select_one('.score'))
            m=re.search(r'([\d.]+)分.*?(\d+)人',sc); add(S.T(t),f'javdb{"日" if p=="daily" else "周"}榜',k,40,f"{m.group(1)}分/{m.group(2)}人评" if m else '')
            hot[S.T(t).upper()].setdefault('title_jdb',S.T(i.select_one('.video-title')).replace(S.T(t),'',1).strip())
    except Exception as e: src_status[f'javdb {p}']='err '+str(e)[:80]
for path,lab in (('dm301/cn/today-hot','missav今日热门'),('dm170/cn/weekly-hot','missav周热门')):
    ok=False
    for host in ('missav123.com','missav.live','missav.ws','missav.ai'):
        u=f"https://{host}/{path}"
        try:
            r=S.S.get(u,headers=UA,timeout=30); time.sleep(1.5)
            cards=BeautifulSoup(r.text,'html.parser').select('div.thumbnail') if r.status_code==200 else []
            codes=[]
            for c in cards:
                a=c.select_one('a[href]'); m=re.search(r'/([a-z0-9]+-\d+)(?:-[a-z-]+)?$',a['href']) if a else None
                if m and m.group(1).upper() not in codes: codes.append(m.group(1).upper())
            if codes:
                src_status[lab]=f"{host} 200, {len(codes)} 条"; ok=True
                for k,c in enumerate(codes,1): add(c,lab,k,max(len(codes),12))
                break
            src_status[lab]=f"{host} {r.status_code}"
        except Exception as e: src_status[lab]=f"{host} err"
    if not ok: src_status[lab]+=' → 跳过'
# javtext own hot? (no public view counts) -> just used for metadata
# ---- 3. pick non-repeated hot
excl=item_codes|fav_codes|set(hist['pushed'])
fav_hot=[(c,v) for c,v in hot.items() if c in fav_codes]
cand=[]
for c,v in sorted(((c,v) for c,v in hot.items() if c not in excl),key=lambda x:-x[1]['score']):
    if D.code(c): D.note('热门·踩过的番号',c); continue
    if D.seen(c): D.note('热门·已看过',c); continue
    cand.append((c,v))
target=max(5,min(10,12-len(related)))
picked=[]
for code,v in cand:
    if len(picked)>=target: break
    h=S.get("/search?type=id&q="+code); time.sleep(1.2)
    hit=[x for x in (S.parse_list(h) if h else []) if x['code']==code]
    if not hit: print('no javtext',code); continue
    it=hit[0]; d=S.get(f"/v/{it['vid']}"); time.sleep(1.2)
    if d: S.parse_detail(d,it)
    it['genres']=[g for g in it.get('genres',[]) if g]
    if D.actor_hit(it): D.note('热门·不喜欢演员',code); print('skip disliked actor',code,D.actor_hit(it)); continue
    it['url']=f"https://javtext.com/v/{it['vid']}"; it['seen_at']=NOW
    it['hot']={"score":round(v['score'],3),"src":v['src'],"batch":DAY}
    th=tag_hits(it['genres'],top); ah=actress_hit(it,names)
    if th: it['hot']['tags']=th
    S.fetch_cover(it); time.sleep(0.8)
    if it.get('cover_src') in ('r18','dmm'): S.fetch_samples(it)
    picked.append(it); print('hot',code,it.get('cover_src'),v['src'],flush=True)
# ---- 4. persist
db={i['vid']:i for i in items}
for it in picked: db[it['vid']]=it
from collections import Counter
def _f(it): return os.path.join(R,'public',it.get('cover','').split('?')[0])
for it in db.values():
    f=_f(it)
    if it.get('cover_src') in ('r18','dmm') and it.get('cover') and os.path.exists(f) and S.valid_cover(open(f,'rb').read()):
        it['cover']='covers/'+os.path.basename(f)+'?v='+S.cover_ver(f)
    else: it.update(cover='',cover_src='none')
out=sorted(db.values(),key=lambda x:(x.get('date',''),S._vi(x)),reverse=True)
json.dump(out,open(R+'data/items.json','w'),ensure_ascii=False,indent=1)
json.dump(sorted(db),open(R+'data/seen.json','w'))
import sys as _s; _s.path.insert(0,R); from dedupe import dedupe_items
json.dump({"updated":NOW,"items":dedupe_items(out)},open(R+'public/data.json','w'),ensure_ascii=False)
S.write_samples_index(out)
# thumbs
from PIL import Image
for it in out:
    if not it.get('cover'): continue
    src=_f(it); dst=os.path.join(R,'public/thumbs',os.path.basename(src))
    if not os.path.exists(dst):
        im=Image.open(src).convert('RGB'); im.thumbnail((360,360)); im.save(dst,'JPEG',quality=82)
for it in picked: hist['pushed'][it['code']]={"batch":DAY,"src":it['hot']['src']}
hist['batches'].append({"date":NOW,"related":[i['code'] for i in related],"hot":[i['code'] for i in picked]})
json.dump(hist,open(hist_p,'w'),ensure_ascii=False,indent=1)
rep={"date":NOW,"prefs":{"names":sorted(names),"top_tags":top},"sources":src_status,
 "related":[{"code":i['code'],"title":i['title'][:40],"actresses":i.get('actresses_list'),"why":i['match']['why'],"cover":i.get('cover_src'),"samples":len(i.get('samples') or [])} for i in related],
 "fav_hot":[{"code":c,"src":v['src']} for c,v in fav_hot],
 "hot":[{"code":i['code'],"title":i['title'][:40],"actresses":i.get('actresses_list'),"src":i['hot']['src'],"score":i['hot']['score'],"tags":i['hot'].get('tags',[]),"cover":i.get('cover_src'),"samples":len(i.get('samples') or [])} for i in picked],
 "dislike_filter":D.summary(),"viewed_skipped_n":len(D.filtered.get('热门·已看过',[]))+len(D.filtered.get('关注相关·已看过',[])),"dislike_filtered_n":D.total(),"dislike_note":f"本批因踩过滤 {D.total()} 条",
 "total_items":len(out),"hot_candidates":len(hot),"excluded_repeat":len([c for c in hot if c in excl])}
json.dump(rep,open(REP+'trial_batch.json','w'),ensure_ascii=False,indent=1)
print(json.dumps(rep,ensure_ascii=False,indent=1))
print(f"本批因踩过滤 {D.total()} 条",D.filtered if D.filtered else '',flush=True)
