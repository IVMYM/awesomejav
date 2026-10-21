"""Collapse items sharing a 番号 (javtext sometimes lists one code under several vids). Keep the richest, merge hot/match/samples."""
import re
def norm(code): return re.sub(r'[^A-Z0-9]','',str(code or '').upper())
def _score(x):
    return (x.get('cover_src') in ('r18','dmm'), bool(x.get('plot_zh')), bool(x.get('actresses')), len(x.get('samples') or []), len(x.get('genres') or []))
def dedupe_items(items):
    best={}; order=[]
    for it in items:
        k=norm(it.get('code')) or str(it.get('vid'))
        o=best.get(k)
        if o is None: best[k]=it; order.append(k); continue
        win,lose=(it,o) if _score(it)>_score(o) else (o,it)
        for f in ('hot','match'):
            if lose.get(f) and not win.get(f): win[f]=lose[f]
        if not win.get('samples') and lose.get('samples'): win['samples']=lose['samples']
        best[k]=win
    return [best[k] for k in order]
