#!/usr/bin/env python3
"""Pull aggregated 踩/已浏览/关注 prefs from https://jav.xxznote.eu.org/api/feed-prefs (x-feed-key from .feed_key)
and cache to feed_prefs.json. If the API fails, scraping continues WITHOUT dislike filtering (empty prefs).

  python3 feed_prefs.py          # fetch + cache + print summary
Library:
  from feed_prefs import load_prefs, Dislike
  D = Dislike(load_prefs())      # load_prefs() fetches once per process
  D.code(code) / D.seen(code) [已浏览] / D.actor_hit(item) / D.tag_penalty(genres) / D.filtered (counter)
"""
import os, re, json, time, urllib.request
W = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get('FEED_PREFS_URL', 'https://jav.xxznote.eu.org/api/feed-prefs')
KEY_P = os.path.join(W, '.feed_key'); CACHE_P = os.path.join(W, 'feed_prefs.json')
GENERIC = {'单体作品','高清','独家分发','4K','配信専用','数位马赛克','薄码','ハイクオリティVR','VR专用','素人','精选、综合','DMM独家','独占配信','ハイビジョン','デジモ','单体作品・独家','独家','高画质','字幕'}
EMPTY = {"ok": False, "dislikes": [], "dislike_actors": [], "dislike_series": [], "dislike_studios": [], "dislike_tags": [], "follows": [], "follow_names": [], "viewed": []}
def norm(c): return re.sub(r'[^A-Z0-9]', '', str(c or '').upper())
_cached = None
def fetch(timeout=25):
    key = open(KEY_P).read().strip()
    req = urllib.request.Request(URL, headers={'x-feed-key': key, 'User-Agent': 'jav-feed-prefs/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.load(r)
    d['ok'] = True; d['fetched_at'] = time.strftime('%Y-%m-%d %H:%M')
    tmp = CACHE_P + '.tmp'; json.dump(d, open(tmp, 'w'), ensure_ascii=False, indent=1); os.replace(tmp, CACHE_P)
    return d
def load_prefs():
    global _cached
    if _cached is not None: return _cached
    try: _cached = fetch()
    except Exception as e:
        print('feed-prefs 获取失败，本次不按踩过滤:', str(e)[:120], flush=True)
        _cached = dict(EMPTY, error=str(e)[:200])
    return _cached
def _names(it):
    return {n for n in (list(it.get('actresses_list') or []) + [a.get('name', '') for a in it.get('actresses') or []]) if n}
def _m(a, b): return a == b or (len(a) > 1 and len(b) > 1 and (a in b or b in a))
class Dislike:
    def __init__(self, p=None):
        p = p or EMPTY; self.ok = bool(p.get('ok'))
        self.codes = {norm(c) for c in p.get('dislikes', []) if norm(c)}
        self.follow_names = [n for n in p.get('follow_names', []) if n]
        self.actors = {x['k']: x['n'] for x in p.get('dislike_actors', [])}
        self.series = {x['k']: x['n'] for x in p.get('dislike_series', [])}
        self.tags = {x['k']: x['n'] for x in p.get('dislike_tags', [])}
        self.viewed = {norm(c) for c in p.get('viewed', []) if norm(c)}  # 已浏览 (any user): never re-recommend
        self.filtered = {}  # reason -> [codes]
    def note(self, reason, code): self.filtered.setdefault(reason, []).append(code)
    def total(self): return len({c for v in self.filtered.values() for c in v})
    def code(self, code): return norm(code) in self.codes
    def seen(self, code): return norm(code) in self.viewed
    def followed(self, it): return any(_m(n, f) for n in _names(it) for f in self.follow_names)
    def actor_hit(self, it):
        """Disliked actresses in this work (never when a followed actress is in it)."""
        if self.followed(it): return []
        return sorted(n for n in _names(it) if n in self.actors)
    def series_hit(self, it): return bool(it.get('series')) and it['series'] in self.series and not self.followed(it)
    def tag_penalty(self, genres):
        return {g: self.tags[g] for g in set(genres or []) if g in self.tags and g not in GENERIC}
    def summary(self):
        return {"api_ok": self.ok, "disliked_codes": len(self.codes), "viewed_codes": len(self.viewed), "dislike_actors": len(self.actors), "dislike_tags": len(self.tags),
                "filtered_total": self.total(), "filtered": self.filtered}
if __name__ == '__main__':
    p = load_prefs(); D = Dislike(p)
    print(json.dumps({"ok": p.get('ok'), "users": p.get('users'), "dislikes": len(D.codes), "viewed": len(D.viewed), "actors": list(D.actors)[:20],
                      "tags": list(D.tags)[:20], "series": list(D.series)[:10], "follows": len(p.get('follows', [])),
                      "follow_names": D.follow_names[:20], "error": p.get('error')}, ensure_ascii=False, indent=1))
