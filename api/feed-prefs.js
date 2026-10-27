/* Read-only aggregate prefs for the scraper. Auth: x-feed-key == env FEED_KEY.
 * Returns ONLY aggregated dislikes + viewed codes + derived dislike actors/series/studios/tags + merged follows.
 * Never returns usernames, password hashes, sessions or uploads. */
const crypto = require('crypto');
const L = require('./_lib');

const GENERIC = new Set(['单体作品','高清','独家分发','4K','配信専用','数位马赛克','薄码','ハイクオリティVR','VR专用','素人','精选、综合','DMM独家','独占配信','ハイビジョン','デジモ','单体作品・独家','独家','高画质','字幕']);

function keyOk(req) {
  const want = process.env.FEED_KEY || '';
  const got = String(req.headers['x-feed-key'] || '');
  if (!want || !got) return false;
  const a = crypto.createHash('sha256').update(want).digest();
  const b = crypto.createHash('sha256').update(got).digest();
  return crypto.timingSafeEqual(a, b);
}

function slugName(slug) {
  // n-<hex of utf8 name, first 40 hex chars> → (possibly truncated) name prefix
  const m = /^n-([0-9a-f]+)$/.exec(String(slug || ''));
  if (!m) return '';
  try {
    let s = Buffer.from(m[1].slice(0, m[1].length - (m[1].length % 2)), 'hex').toString('utf8');
    return s.replace(/\uFFFD+$/g, '').trim();
  } catch { return ''; }
}

const top = (m, n = 60) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, n: v }));
const inc = (m, k, v = 1) => { if (k) m.set(k, (m.get(k) || 0) + v); };

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return L.json(res, 405, { error: 'method not allowed' });
    if (!keyOk(req)) return L.json(res, 401, { error: 'unauthorized' });
    // newest blob per user (users/{name}/{ts}.json), legacy users/{name}.json as fallback
    const blobs = await L.blobListAll('users/');
    const per = new Map();
    for (const b of blobs) {
      const p = String(b.pathname || '');
      let m = /^users\/([^/]+)\/[^/]+\.json$/.exec(p), legacy = false;
      if (!m) { m = /^users\/([^/]+)\.json$/.exec(p); legacy = true; }
      if (!m) continue;
      const t = new Date(b.uploadedAt || 0).getTime() + (legacy ? -1e15 : 0);
      const o = per.get(m[1]);
      if (!o || t > o.t) per.set(m[1], { t, pathname: p });
    }
    const users = await Promise.all([...per.values()].map(async ({ pathname }) => {
      try {
        return await L.blobGetJsonFresh(pathname);
      } catch { return null; }
    }));
    const disCnt = new Map(), viewCnt = new Map(), blockedCnt = new Map(), follows = new Set();
    for (const u of users) {
      if (!u) continue;
      for (const c of L.normDislikes(u.dislikes)) inc(disCnt, c);
      for (const n of L.normBlockedActresses(u.blocked_actresses)) inc(blockedCnt, n);
      for (const e of L.normViewed(u.viewed)) inc(viewCnt, e.c);
      for (const f of Array.isArray(u.follows) ? u.follows : []) follows.add(String(f));
    }
    // derive features from the site's own public catalog
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const base = `https://${host}`;
    const byCode = new Map();
    let favs = [];
    const add = (w) => { const k = L.normCode(w && w.code); if (k && !byCode.has(k)) byCode.set(k, w); };
    try { const d = await (await fetch(`${base}/data.json`)).json(); (d.items || []).forEach(add); } catch (_) {}
    try { const f = await (await fetch(`${base}/fav.json`)).json(); favs = f.actresses || []; favs.forEach((a) => (a.works || []).forEach(add)); } catch (_) {}
    const followNames = new Set();
    for (const s of follows) {
      const a = favs.find((x) => x.slug === s);
      if (a) { followNames.add(a.name); (a.aliases || []).forEach((n) => followNames.add(n)); continue; }
      const n = slugName(s); if (n) followNames.add(n);
    }
    const isFollowed = (n) => [...followNames].some((x) => x && n && (x === n || (x.length > 1 && (n.includes(x) || x.includes(n)))));
    const actors = new Map(), series = new Map(), studios = new Map(), tags = new Map();
    let known = 0;
    for (const [code] of disCnt) {
      const w = byCode.get(code); if (!w) continue;
      known++;
      const ns = new Set([...(w.actresses || []).map((a) => a && a.name), ...(w.actresses_list || [])].filter(Boolean));
      for (const n of ns) if (!isFollowed(n)) inc(actors, n);
      inc(series, w.series); inc(studios, w.studio);
      for (const g of new Set(w.genres || [])) if (g && !GENERIC.has(g)) inc(tags, g);
    }
    return L.json(res, 200, {
      updated: new Date().toISOString(),
      users: users.filter(Boolean).length,
      dislikes: [...disCnt.keys()],
      dislike_counts: top(disCnt, 3000),
      dislike_known: known,
      dislike_actors: top(actors),
      dislike_series: top(series),
      dislike_studios: top(studios),
      dislike_tags: top(tags),
      blocked_actresses: top(blockedCnt, 500),
      viewed: [...viewCnt.keys()],
      viewed_counts: top(viewCnt, 5000),
      follows: [...follows],
      follow_names: [...followNames],
    });
  } catch (e) {
    return L.json(res, e.status || 500, { error: e.message || 'feed-prefs failed' });
  }
};
