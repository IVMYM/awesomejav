#!/usr/bin/env python3
"""javtext 新上架 scraper -> data/items.json, public/data.json, public/covers/"""
import json, os, re, time, sys, requests, hashlib
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from dedupe import dedupe_items
from bs4 import BeautifulSoup
ROOT=os.path.dirname(os.path.abspath(__file__))
MIRRORS=["https://javtext.com","https://javtxt.net"]
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36","Accept-Language":"zh-CN,zh;q=0.9,ja;q=0.8"}
R18UA={"User-Agent":"GrokBot-javtext-watch/1.0"}
PAGES=int(os.environ.get("PAGES","3")); S=requests.Session()
def get(path):
    for m in MIRRORS:
        try:
            r=S.get(m+path,headers=UA,timeout=20)
            if r.status_code==200: return r.text
        except Exception as e: print("err",m+path,e)
        time.sleep(0.5)
    return None
def T(el): return el.get_text(" ",strip=True) if el else ""
def parse_list(html):
    out=[]
    for a in BeautifulSoup(html,"html.parser").select("a.work"):
        m=re.search(r"/v/(\d+)",a.get("href",""))
        if not m: continue
        date=re.search(r"\d{4}-\d{2}-\d{2}",T(a.select_one(".work-meta")))
        out.append({"vid":m.group(1),"code":T(a.select_one(".work-id")).upper(),"title":T(a.select_one(".work-title")),
          "studio":T(a.select_one(".work-meta-studio")).replace("🎥","").strip(),"date":date.group(0) if date else "",
          "actresses_list":[T(x) for x in a.select(".work-actresses .work-actress")]})
    return out
def parse_detail(html,it):
    s=BeautifulSoup(html,"html.parser")
    it["title_jp"]=T(s.select_one("h1.text-jp,.title.text-jp"))
    p=s.select_one("p.text-jp"); it["plot_jp"]=p.get_text("\n",strip=True) if p else ""
    it["plot_zh"]="\n".join(x.get_text("\n",strip=True) for x in s.select("div.text-zh p"))
    it["actresses"]=[{"id":re.search(r"\d+",a["href"]).group(0),"name":T(a)} for a in s.select(".intro a.actress[href^='/actress/']")]
    attrs={}
    dl=s.select_one(".attributes dl")
    if dl:
        for dd in dl.find_all("dd"):
            dt=dd.find_next_sibling("dt"); k=re.sub(r"^\W+","",T(dd))
            attrs[k]=[T(a) for a in dt.find_all("a")] or [T(dt)]
    it["series"]=(attrs.get("系列") or [""])[0]; it["label"]=(attrs.get("厂牌") or attrs.get("发行商") or [""])[0]
    it["genres"]=attrs.get("类别",[])
    m=re.search(r"\(([^)]+)\)",(attrs.get("番号") or [""])[0]); it["content_id"]=m.group(1) if m else ""
def is_img(r): return r.status_code==200 and r.headers.get("content-type","").startswith("image") and len(r.content)>3000
def valid_cover(b):
    """Real DMM/R18 jackets are landscape (~800x538). Reject portraits/avatars/squares and tiny placeholders."""
    try:
        from PIL import Image; import io
        w,h=Image.open(io.BytesIO(b)).size
        return len(b)>=30000 and w>=400 and w/h>=1.3
    except Exception: return False
def cover_ver(path): return hashlib.sha1(open(path,"rb").read()).hexdigest()[:8]
def fetch_cover(it):
    code=it["code"]; dst=os.path.join(ROOT,"public/covers",code+".jpg"); rel="covers/"+code+".jpg"
    if os.path.exists(dst) and it.get("cover_src") in ("r18","dmm"): return
    urls=[]
    try:
        r=S.get(f"https://r18.dev/videos/vod/movies/detail/-/dvd_id={code}/json",headers=R18UA,timeout=20); time.sleep(0.5)
        if r.status_code==200:
            j=r.json(); u=((j.get("images") or {}).get("jacket_image") or {}).get("large2") or j.get("jacket_full_url")
            if u: urls.append(("r18",u))
            cid=j.get("content_id")
            if cid: urls.append(("r18",f"https://pics.dmm.co.jp/digital/video/{cid}/{cid}pl.jpg"))
    except Exception as e: print("r18 err",code,e)
    cid=it.get("content_id","").lower()
    m=re.match(r"^(.*?)-?(\d+)$",cid)
    if m:
        for c in dict.fromkeys([cid.replace("-",""),m.group(1).replace("-","")+m.group(2).zfill(5)]):
            urls.append(("dmm",f"https://pics.dmm.co.jp/digital/video/{c}/{c}pl.jpg"))
    for kind,u in urls:
        try:
            r=S.get(u,headers=UA,timeout=30); time.sleep(0.5)
            if is_img(r) and "now_printing" not in r.url and valid_cover(r.content):
                open(dst,"wb").write(r.content); it.update(cover=rel,cover_src=kind); return
        except Exception as e: print("img err",u,e)
    it.update(cover="",cover_src="none")
def resolve_cids(it):
    """Candidate DMM content_ids for sample stills (official pics.dmm.co.jp only)."""
    cids=[]
    cid=(it.get("content_id") or "").lower().strip()
    if cid: cids.append(cid.replace("-",""))
    code=it.get("code") or ""
    try:
        r=S.get(f"https://r18.dev/videos/vod/movies/detail/-/dvd_id={code.lower()}/json",headers=R18UA,timeout=20); time.sleep(0.5)
        if r.status_code!=200:
            r=S.get(f"https://r18.dev/videos/vod/movies/detail/-/dvd_id={code.lower().replace('-','')}/json",headers=R18UA,timeout=20); time.sleep(0.5)
        if r.status_code==200:
            j=r.json(); c=j.get("content_id")
            if c: cids.append(c.lower().replace("-","")); it.setdefault("content_id",c)
    except Exception as e: print("r18 cid err",code,e)
    # also try zero-padded dvd form from code ABC-123 -> abc00123
    m=re.match(r"^([A-Z0-9]+?)-?(\d+)$",code.upper())
    if m: cids.append(m.group(1).lower()+m.group(2).zfill(5))
    out=[]; seen=set()
    for c in cids:
        if c and c not in seen: seen.add(c); out.append(c)
    return out
def valid_sample(b):
    """Sample frames are landscape (~800x450). Reject tiny placeholders / now_printing."""
    try:
        from PIL import Image; import io
        w,h=Image.open(io.BytesIO(b)).size
        return len(b)>=20000 and w>=400 and w/h>=1.3
    except Exception: return False
def fetch_samples(it, force=False):
    """Download official DMM sample stills ({cid}jp-N.jpg) into public/samples/{CODE}/NN.jpg.
    Never fetches magnets/video. Returns list of relative paths (may be empty)."""
    code=it.get("code") or ""
    if not code: return []
    ddir=os.path.join(ROOT,"public/samples",code)
    if not force and os.path.isdir(ddir) and any(f.endswith(".jpg") for f in os.listdir(ddir)):
        paths=sorted("samples/%s/%s"%(code,f) for f in os.listdir(ddir) if f.endswith(".jpg"))
        it["samples"]=paths; return paths
    cids=resolve_cids(it)
    saved=[]
    for cid in cids:
        got=0
        for n in range(1,21):
            u=f"https://pics.dmm.co.jp/digital/video/{cid}/{cid}jp-{n}.jpg"
            try:
                r=S.get(u,headers=UA,timeout=30); time.sleep(0.35)
                if not is_img(r) or "now_printing" in r.url or not valid_sample(r.content):
                    break
                os.makedirs(ddir,exist_ok=True)
                fn=f"{n:02d}.jpg"; open(os.path.join(ddir,fn),"wb").write(r.content)
                saved.append(f"samples/{code}/{fn}"); got+=1
            except Exception as e:
                print("sample err",code,n,e); break
        if got: break
        time.sleep(0.5)
    it["samples"]=saved
    if saved: print("samples",code,len(saved),flush=True)
    return saved
def write_samples_index(items_extra=None):
    """Build public/samples.json from items + fav works that have samples/ dirs or .samples."""
    m={}
    def add(it):
        code=it.get("code"); 
        if not code: return
        if it.get("samples"): m[code]=it["samples"]; return
        d=os.path.join(ROOT,"public/samples",code)
        if os.path.isdir(d):
            paths=sorted(f"samples/{code}/{f}" for f in os.listdir(d) if f.endswith(".jpg"))
            if paths: m[code]=paths
    p=os.path.join(ROOT,"data/items.json")
    if os.path.exists(p):
        for it in json.load(open(p)): add(it)
    fp=os.path.join(ROOT,"data/fav_items.json")
    if os.path.exists(fp):
        db=json.load(open(fp))
        for store in db.values():
            if isinstance(store,dict):
                for it in store.values():
                    if isinstance(it,dict): add(it)
    if items_extra:
        for it in items_extra: add(it)
    json.dump({"updated":time.strftime("%Y-%m-%d %H:%M"),"samples":m},open(os.path.join(ROOT,"public/samples.json"),"w"),ensure_ascii=False)
    print("samples.json",len(m),"works")
    return m
def _dislike():
    """踩 filter from /api/feed-prefs (javtext_watch/feed_prefs.py). Any failure -> no filtering."""
    try:
        sys.path.insert(0,"/workspace/javtext_watch")
        from feed_prefs import load_prefs,Dislike
        return Dislike(load_prefs())
    except Exception as e:
        print("dislike filter disabled:",e)
        class _N:
            ok=False; filtered={}; codes=set()
            def code(self,c): return False
            def note(self,*a): pass
            def total(self): return 0
            def summary(self): return {"api_ok":False}
        return _N()
def _write_dislike_report(D):
    try:
        d=os.path.join("/workspace/javtext_watch/reports",time.strftime("%Y-%m-%d")); os.makedirs(d,exist_ok=True)
        json.dump({"date":time.strftime("%Y-%m-%d %H:%M"),"note":f"本批因踩过滤 {D.total()} 条",**D.summary()},
                  open(os.path.join(d,"dislike_filter_scrape.json"),"w"),ensure_ascii=False,indent=1)
    except Exception as e: print("dislike report err",e)
    print(f"本批因踩过滤 {D.total()} 条",flush=True)
def main():
    p=os.path.join(ROOT,"data/items.json")
    db={i["vid"]:i for i in json.load(open(p))} if os.path.exists(p) else {}
    D=_dislike()
    new=0
    for pg in range(1,PAGES+1):
        h=get(f"/latest?page={pg}"); time.sleep(0.5)
        if not h: print("list blocked page",pg); continue
        for it in parse_list(h):
            if D.code(it["code"]) and it["vid"] not in db:  # 踩过的番号不入库
                D.note("新片·踩过的番号",it["code"]); continue
            old=db.get(it["vid"])
            if old and old.get("plot_jp") is not None and "plot_zh" in old: continue
            d=get(f"/v/{it['vid']}"); time.sleep(0.5)
            if d: parse_detail(d,it)
            it["url"]=f"https://javtext.com/v/{it['vid']}"; it["seen_at"]=time.strftime("%Y-%m-%d %H:%M")
            fetch_cover(it); fetch_samples(it); db[it["vid"]]=it; new+=1
            print(it["code"],it.get("cover_src"),flush=True)
    if os.environ.get("RECOVER"):
        for it in db.values():
            if it.get("cover_src") in (None,"none","avatar"):
                it.pop("cover_src",None); fetch_cover(it); print("recover",it["code"],it["cover_src"],flush=True)
    from collections import Counter
    def _f(it): return os.path.join(ROOT,"public",it.get("cover","").split("?")[0])
    hc=Counter(cover_ver(_f(i)) for i in db.values() if i.get("cover") and os.path.exists(_f(i)))
    for it in db.values():  # never use avatars/placeholders as covers
        f=_f(it); ok=it.get("cover_src") in ("r18","dmm") and it.get("cover") and os.path.exists(f) and valid_cover(open(f,"rb").read()) and hc[cover_ver(f)]==1
        if ok: it["cover"]="covers/"+os.path.basename(f)+"?v="+cover_ver(f); continue
        if True:
            if it.get("cover") and os.path.exists(f): os.remove(f); print("reject cover",it["code"])
            it.update(cover="",cover_src="none")
    for it in db.values():  # already in library: never pushed on 首页 / 热门 / 关注相关 (still searchable)
        if D.code(it.get("code")):
            if it.get("hot") or it.get("match") or not it.get("suppressed"): D.note("已在库·踩过",it["code"])
            it.pop("hot",None); it.pop("match",None); it["suppressed"]="dislike"
        elif it.get("suppressed")=="dislike" and getattr(D,"ok",False): it.pop("suppressed",None)
    _write_dislike_report(D)
    items=sorted(db.values(),key=lambda x:(x["date"],int(x["vid"])),reverse=True)
    json.dump(items,open(p,"w"),ensure_ascii=False,indent=1)
    json.dump(sorted(db),open(os.path.join(ROOT,"data/seen.json"),"w"))
    json.dump({"updated":time.strftime("%Y-%m-%d %H:%M"),"items":dedupe_items(items)},open(os.path.join(ROOT,"public/data.json"),"w"),ensure_ascii=False)
    write_samples_index(items)
    c={}; [c.__setitem__(i.get("cover_src"),c.get(i.get("cover_src"),0)+1) for i in items]
    print("new",new,"total",len(items),"covers",c)
def _vi(x):
    try: return int(x["vid"])
    except Exception: return 0
JDB="https://javdb.com"
def crawl_javdb(a,store,db,p):
    """Male actors: javtext has no male-actor pages, so the filmography (codes, newest first) comes from the
    javdb actor list pages (list pages only: never detail/magnet pages). Each code is then looked up on javtext
    (search type=id) for the Chinese title/plot; cover via r18/DMM with the same validation. ~1s between requests."""
    limit=int(os.environ.get("FAV_LIMIT") or (0 if os.environ.get("FAV_FULL")=="1" else a.get("limit",300)))
    codes=[]; pg=1
    while True:
        r=S.get(f"{JDB}/actors/{a['javdb_id']}?page={pg}",headers=UA,timeout=30); time.sleep(1)
        if r.status_code!=200: print("javdb",r.status_code,pg); break
        s=BeautifulSoup(r.text,"html.parser")
        if pg==1:
            m=re.search(r"(\d+)\s*部影片",s.get_text()); a["total"]=int(m.group(1)) if m else None
        its=s.select(".movie-list .item")
        for i in its:
            t=i.select_one(".video-title"); c=t.select_one("strong")
            code=T(c).upper(); title=T(t).replace(T(c),"",1).strip()
            codes.append({"code":code,"title_jdb":title,"date":T(i.select_one(".meta"))})
        if not its or (limit and len(codes)>=limit) or f"page={pg+1}" not in r.text: break
        pg+=1
    if limit: codes=codes[:limit]
    print("javdb codes",len(codes),"total",a.get("total"),flush=True)
    known={w.get("code"):w for w in store.values()}
    for c in codes:
        if c["code"] in known and "plot_zh" in known[c["code"]]: continue
        h=get("/search?type=id&q="+requests.utils.quote(c["code"])); time.sleep(1)
        hit=[x for x in (parse_list(h) if h else []) if x["code"]==c["code"]]
        if hit:
            it=hit[0]; d=get(f"/v/{it['vid']}"); time.sleep(1)
            if d: parse_detail(d,it)
            it["url"]=f"https://javtext.com/v/{it['vid']}"
        else:
            it={"vid":"n-"+c["code"],"code":c["code"],"title":c["title_jdb"],"studio":"","date":c["date"],"url":""}
        it.setdefault("plot_zh",""); it["date"]=it.get("date") or c["date"]; it["seen_at"]=time.strftime("%Y-%m-%d %H:%M")
        fetch_cover(it); time.sleep(0.5); store[it["vid"]]=it
        print("fav",a["slug"],it["code"],"javtext" if hit else "no-javtext",it.get("cover_src"),bool(it["plot_zh"]),flush=True)
        json.dump(db,open(p,"w"),ensure_ascii=False)
def refresh_favorites():
    """Favorites by actress (config data/favorites.json). Lists ALL works from javtext actress pages,
    fetches javtext detail (Chinese plot) + validated cover. Polite: >=1s between requests. No magnet/video links."""
    cfg=json.load(open(os.path.join(ROOT,"data/favorites.json")))
    p=os.path.join(ROOT,"data/fav_items.json"); db=json.load(open(p)) if os.path.exists(p) else {}
    out=[]
    for a in cfg:
        store=db.setdefault(a["slug"],{}); pg=1
        if a.get("source")=="javdb":
            if not os.environ.get("FAV_SLUG") or os.environ["FAV_SLUG"]==a["slug"]: crawl_javdb(a,store,db,p); db.setdefault("_meta",{})[a["slug"]]=a.get("total")
            a["total"]=db.get("_meta",{}).get(a["slug"]); pg=None
        while pg and (not os.environ.get("FAV_SLUG") or os.environ["FAV_SLUG"]==a["slug"]):
            h=get(f"/actress/{a['javtext_id']}?page={pg}"); time.sleep(1)
            if not h: break
            lst=parse_list(h)
            if not lst: break
            fresh=0
            for it in lst:
                old=store.get(it["vid"])
                if old and "plot_zh" in old:
                    if old.get("cover_src") not in ("r18","dmm") and os.environ.get("RECOVER"): old.pop("cover_src",None); fetch_cover(old)
                    continue
                d=get(f"/v/{it['vid']}"); time.sleep(1)
                if d: parse_detail(d,it)
                it.setdefault("plot_zh","")
                it["url"]=f"https://javtext.com/v/{it['vid']}"; it["seen_at"]=time.strftime("%Y-%m-%d %H:%M")
                fetch_cover(it); fetch_samples(it); time.sleep(0.5); store[it["vid"]]=it; fresh+=1
                print("fav",a["slug"],it["code"],it.get("cover_src"),bool(it["plot_zh"]),flush=True)
                json.dump(db,open(p,"w"),ensure_ascii=False)
            if fresh==0 and os.environ.get("FAV_FULL")!="1" and pg>1: break  # incremental: stop at already-known pages
            if f"page={pg+1}" not in h: break
            pg+=1
        for it in store.values():  # same cover validation as main list
            f=os.path.join(ROOT,"public",it.get("cover","").split("?")[0])
            if it.get("cover_src") in ("r18","dmm") and it.get("cover") and os.path.exists(f) and valid_cover(open(f,"rb").read()):
                it["cover"]="covers/"+os.path.basename(f)+"?v="+cover_ver(f)
            else:
                it.update(cover="",cover_src="none")
        best={}  # javtext sometimes lists the same code under several vids: keep the richest entry
        for w in store.values():
            k=w.get("code") or w["vid"]; o=best.get(k)
            sc=lambda x:(bool(x.get("cover")),bool(x.get("plot_zh")),_vi(x))
            if not o or sc(w)>sc(o): best[k]=w
        works=sorted(best.values(),key=lambda x:(x.get("date",""),_vi(x)),reverse=True)
        if a.get("limit"): works=works[:a["limit"]]
        out.append({**a,"works":works})
        print("fav total",a["slug"],len(works),"covers",sum(1 for w in works if w["cover"]),"plots",sum(1 for w in works if w.get("plot_zh")))
    json.dump(db,open(p,"w"),ensure_ascii=False)
    json.dump({"updated":time.strftime("%Y-%m-%d %H:%M"),"actresses":out},open(os.path.join(ROOT,"public/fav.json"),"w"),ensure_ascii=False)
    write_samples_index()
if __name__=="__main__":
    if os.environ.get("SAMPLES_ONLY")=="1":
        # Batch-fetch sample stills for newest covered items (+ optional fav slice). Wed/Fri routine: normal scrape already calls fetch_samples on new releases.
        n=int(os.environ.get("SAMPLES_N","20")); fav_n=int(os.environ.get("SAMPLES_FAV","8"))
        items=json.load(open(os.path.join(ROOT,"data/items.json"))) if os.path.exists(os.path.join(ROOT,"data/items.json")) else []
        cov=[i for i in items if i.get("cover_src") in ("r18","dmm")][:n]
        extra=[]
        fp=os.path.join(ROOT,"data/fav_items.json")
        if fav_n and os.path.exists(fp):
            db=json.load(open(fp)); seen=set()
            for slug,store in db.items():
                if not isinstance(store,dict): continue
                for it in sorted((x for x in store.values() if isinstance(x,dict) and x.get("cover_src") in ("r18","dmm")),
                                 key=lambda x:x.get("date",""),reverse=True):
                    if it["code"] in seen: continue
                    seen.add(it["code"]); extra.append(it)
                    if len(extra)>=fav_n: break
                if len(extra)>=fav_n: break
        for it in cov+extra:
            fetch_samples(it); time.sleep(0.4)
        # persist samples lists back into items.json for covered ones
        by={i["vid"]:i for i in items}
        for it in cov:
            if it["vid"] in by and it.get("samples") is not None: by[it["vid"]]["samples"]=it["samples"]
        json.dump(list(by.values()) if by else items, open(os.path.join(ROOT,"data/items.json"),"w"),ensure_ascii=False,indent=1)
        json.dump({"updated":time.strftime("%Y-%m-%d %H:%M"),"items":dedupe_items(sorted(by.values(),key=lambda x:(x.get("date",""),int(x.get("vid") or 0)),reverse=True)) if by else dedupe_items(items)},
                  open(os.path.join(ROOT,"public/data.json"),"w"),ensure_ascii=False)
        write_samples_index(cov+extra)
    else:
        if os.environ.get("ONLY_FAV")!="1": main()
        if os.environ.get("FAV","1")=="1": refresh_favorites()
