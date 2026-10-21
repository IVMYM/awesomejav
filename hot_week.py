#!/usr/bin/env python3
"""本周热门快照: javdb 周榜/日榜 + missav 周热门/今日热门 -> public/hot_week.json.
Keeps snapshots from the last 7 days (data/hot_week_hist.json); the site ranks EVERY archived work
(data.json + fav.json) by its best current-week score. Run standalone or from javtext_watch/trial_batch.py."""
import os,sys,re,json,time
ROOT=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,ROOT)
import scrape as S
from bs4 import BeautifulSoup
HIST=os.path.join(ROOT,'data/hot_week_hist.json'); OUT=os.path.join(ROOT,'public/hot_week.json')
# weekly lists dominate; daily lists only add a small boost
SRC_W={'javdb周榜':1.0,'missav周热门':1.0,'javdb日榜':0.35,'missav今日热门':0.35}
def snapshot():
    ranks={}
    def add(code,lab,k,n):
        code=str(code or '').upper().strip()
        if not re.match(r'^[A-Z0-9]+-\d+$',code): return
        r=ranks.setdefault(code,{}); r.setdefault(lab,k)
    st={}
    for p,lab in (('weekly','javdb周榜'),('daily','javdb日榜')):
        try:
            r=S.S.get(f"https://javdb.com/rankings/movies?p={p}&t=censored",headers=S.UA,timeout=30); time.sleep(1.2)
            its=BeautifulSoup(r.text,'html.parser').select('.movie-list .item') if r.status_code==200 else []
            st[lab]=len(its)
            for k,i in enumerate(its,1): add(S.T(i.select_one('.video-title strong')),lab,k,len(its))
        except Exception as e: st[lab]='err '+str(e)[:60]
    for path,lab in (('dm170/cn/weekly-hot','missav周热门'),('dm301/cn/today-hot','missav今日热门')):
        for host in ('missav123.com','missav.live','missav.ws','missav.ai'):
            try:
                r=S.S.get(f"https://{host}/{path}",headers=S.UA,timeout=30); time.sleep(1.2)
                codes=[]
                for c in (BeautifulSoup(r.text,'html.parser').select('div.thumbnail') if r.status_code==200 else []):
                    a=c.select_one('a[href]'); m=re.search(r'/([a-z0-9]+-\d+)(?:-[a-z-]+)?$',a['href']) if a else None
                    if m and m.group(1).upper() not in codes: codes.append(m.group(1).upper())
                if codes:
                    st[lab]=len(codes)
                    for k,c in enumerate(codes,1): add(c,lab,k,len(codes))
                    break
            except Exception: pass
        st.setdefault(lab,0)
    return {"date":time.strftime('%Y-%m-%d'),"at":time.strftime('%Y-%m-%d %H:%M'),"sizes":st,"ranks":ranks}
def build(new=None):
    hist=json.load(open(HIST)) if os.path.exists(HIST) else []
    if new and new['ranks']: hist=[h for h in hist if h['date']!=new['date']]+[new]
    cut=time.strftime('%Y-%m-%d',time.localtime(time.time()-7*86400))
    hist=sorted([h for h in hist if h['date']>cut],key=lambda h:h['date'])
    os.makedirs(os.path.dirname(HIST),exist_ok=True); json.dump(hist,open(HIST,'w'),ensure_ascii=False)
    out={}
    for h in hist:  # older first -> newest snapshot overrides
        sz=h.get('sizes',{})
        for code,rk in h['ranks'].items():
            sc=0.0; src=[]
            for lab,k in rk.items():
                n=sz.get(lab) if isinstance(sz.get(lab),int) and sz.get(lab) else 40
                sc+=SRC_W.get(lab,0.3)*(n-k+1)/n; src.append(f"{lab}#{k}")
            out[code]={"s":round(sc,4),"src":src,"d":h['date'],"wk":any('周' in s for s in src)}
    res={"updated":time.strftime('%Y-%m-%d %H:%M'),"window_from":hist[0]['date'] if hist else None,
         "snapshots":[h['date'] for h in hist],"ranks":out}
    json.dump(res,open(OUT,'w'),ensure_ascii=False,separators=(',',':'))
    return res
if __name__=='__main__':
    snap=snapshot(); print('sizes',snap['sizes'])
    r=build(snap); print('codes',len(r['ranks']),'snapshots',r['snapshots'])
