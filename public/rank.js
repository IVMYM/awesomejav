/* 踩 / 减少推荐: dislike profile + home ranking. Pure functions (browser global `Rank`, also node module). */
(function (root) {
  const GENERIC = new Set(['单体作品','高清','独家分发','4K','配信専用','数位马赛克','薄码','ハイクオリティVR','VR专用','素人','精选、综合','DMM独家','独占配信','ハイビジョン','デジモ','单体作品・独家','独家','高画质','字幕']);
  const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // weights: same actress heavy, same series medium, studio light, tag overlap (>=2 shared) light
  const W = { actor: 4, actorCap: 8, series: 2, seriesCap: 4, studio: 0.5, studioCap: 1, tag: 0.8, tagCap: 2.5, tagMin: 2, hard: 6 };
  function namesOf(i) {
    const s = new Set();
    ((i && i.actresses) || []).forEach(a => a && a.name && s.add(String(a.name).trim()));
    ((i && i.actresses_list) || []).forEach(n => n && s.add(String(n).trim()));
    return [...s].filter(Boolean);
  }
  const specificTags = i => [...new Set(((i && i.genres) || []).filter(g => g && !GENERIC.has(g)))];
  const inc = (m, k, v = 1) => m.set(k, (m.get(k) || 0) + v);
  /** codes: disliked 番号; lookup(normCode)->work|null; isFollowedName(name)->bool */
  function buildProfile(codes, lookup, isFollowedName) {
    const P = { codes: new Set(), actors: new Map(), series: new Map(), studios: new Map(), tags: new Map(), n: 0 };
    isFollowedName = isFollowedName || (() => false);
    for (const c of codes || []) {
      const k = normCode(c); if (!k || P.codes.has(k)) continue;
      P.codes.add(k);
      const w = lookup ? lookup(k) : null; if (!w) continue;
      P.n++;
      for (const nm of namesOf(w)) if (!isFollowedName(nm)) inc(P.actors, nm);
      if (w.series) inc(P.series, w.series);
      if (w.studio) inc(P.studios, w.studio);
      for (const t of specificTags(w)) inc(P.tags, t);
    }
    return P;
  }
  /** Hard-hide if any actress name is in blocked (Set of strings). Followed actresses exempt. */
  function blockedByActress(i, blocked, isFollowedName) {
    if (!blocked || !blocked.size || !i) return false;
    const ns = namesOf(i);
    if (isFollowedName && ns.some(isFollowedName)) return false;
    for (const nm of ns) if (blocked.has(nm)) return true;
    return false;
  }
  function penalty(i, P, isFollowedName) {
    if (!P || !P.n || !i) return 0;
    const ns = namesOf(i);
    if (isFollowedName && ns.some(isFollowedName)) return 0; // followed actresses are never pushed down
    let a = 0; for (const nm of ns) a += (P.actors.get(nm) || 0) * W.actor;
    let s = i.series ? (P.series.get(i.series) || 0) * W.series : 0;
    let st = i.studio ? (P.studios.get(i.studio) || 0) * W.studio : 0;
    const ov = specificTags(i).filter(t => P.tags.has(t));
    let t = ov.length >= W.tagMin ? ov.reduce((x, g) => x + Math.min(1, P.tags.get(g) / P.n), 0) * W.tag : 0;
    return Math.min(a, W.actorCap) + Math.min(s, W.seriesCap) + Math.min(st, W.studioCap) + Math.min(t, W.tagCap);
  }
  /** Home sections. opt: {dislikes:Set(normCode), blockedActresses:Set(name), viewed:Set(normCode), profile, isFollowedName, hasCover, heat:Map(code->n)}.
   * Disliked / blocked actress / suppressed / penalty>=hard never shown; others stable-sorted by penalty (pushed back);
   * sections never share a 番号. */
  function buckets(items, opt) {
    opt = opt || {};
    const dis = opt.dislikes || new Set(), blk = opt.blockedActresses || new Set(), seenV = opt.viewed || new Set(), P = opt.profile, isF = opt.isFollowedName || (() => false);
    const hasCover = opt.hasCover || (i => !!i.cover), heat = opt.heat || new Map();
    const K = i => normCode(i.code) || String(i.vid);
    const pen = new Map();
    for (const i of items) pen.set(i, penalty(i, P, isF));
    const pushBack = arr => arr.map((x, k) => [x, k]).sort((a, b) => (pen.get(a[0]) - pen.get(b[0])) || (a[1] - b[1])).map(x => x[0]);
    const seen = new Set(), ok = [];
    let hidden = 0, viewedHidden = 0;
    for (const i of items) {
      const k = K(i);
      if (seen.has(k)) continue; seen.add(k);
      if (seenV.has(k)) { viewedHidden++; continue; } // 已浏览: never re-shown on home
      if (dis.has(k) || i.suppressed || blockedByActress(i, blk, isF) || pen.get(i) >= W.hard) { hidden++; continue; }
      ok.push(i);
    }
    const hotPicks = pushBack(ok.filter(i => i.hot).sort((a, b) => (b.hot.batch || '').localeCompare(a.hot.batch || '') || (b.hot.score || 0) - (a.hot.score || 0)));
    const related = pushBack(ok.filter(i => i.match).sort((a, b) => (b.match.batch || '').localeCompare(a.match.batch || '') || (hasCover(b) - hasCover(a)))).slice(0, 12);
    const hotCodes = new Set(hotPicks.map(K)), relCodes = new Set(related.map(K));
    const covered = pushBack(ok.filter(hasCover));
    const carItems = covered.filter(i => !hotCodes.has(K(i)) && !relCodes.has(K(i))).slice(0, 5);
    const carCodes = new Set(carItems.map(K));
    const newest = covered.filter(i => { const k = K(i); return !hotCodes.has(k) && !relCodes.has(k) && !carCodes.has(k); }).slice(0, 12);
    const used = new Set([...hotCodes, ...relCodes, ...carCodes, ...newest.map(K)]);
    const sc = i => (hasCover(i) ? 1000 : 0) + (heat.get(i.code) || 0) + Math.max(0, (Date.parse(i.date) || 0) / 1e11);
    const ranked = pushBack(ok.filter(i => !used.has(K(i))).sort((a, b) => sc(b) - sc(a))).slice(0, 40);
    return { hotPicks, related, carItems, newest, ranked, used, hidden, viewedHidden, pen };
  }
  /** 热门 = this week's hottest across the WHOLE archive (data.json + every 精选 work).
   * opt as buckets() plus week: {CODE:{s,src,d,wk}} from hot_week.json (snapshots of the last 7 days).
   * Returns {week: ranked works that appear on a current-week list (weekly lists outrank daily-only),
   *          rest: everything else, fallback order (cover, heat, date)}. Same 踩/已浏览 filtering as home. */
  function weekHot(all, opt) {
    opt = opt || {};
    const dis = opt.dislikes || new Set(), blk = opt.blockedActresses || new Set(), seenV = opt.viewed || new Set(), P = opt.profile, isF = opt.isFollowedName || (() => false);
    const hasCover = opt.hasCover || (i => !!i.cover), heat = opt.heat || new Map(), wk = opt.week || {};
    const K = i => normCode(i.code) || String(i.vid);
    const wmap = new Map(); for (const c in wk) wmap.set(normCode(c), wk[c]);
    const seen = new Set(), ok = []; let hidden = 0, viewedHidden = 0;
    for (const i of all) {
      const k = K(i); if (seen.has(k)) continue; seen.add(k);
      if (seenV.has(k)) { viewedHidden++; continue; }
      if (dis.has(k) || i.suppressed || blockedByActress(i, blk, isF) || penalty(i, P, isF) >= W.hard) { hidden++; continue; }
      ok.push(i);
    }
    const ws = i => wmap.get(K(i));
    const week = ok.filter(ws).sort((a, b) => { const A = ws(a), B = ws(b);
      return (B.wk - A.wk) || (B.s - A.s) || (hasCover(b) - hasCover(a)); });
    const sc = i => (hasCover(i) ? 1000 : 0) + (heat.get(i.code) || 0) + Math.max(0, (Date.parse(i.date) || 0) / 1e11);
    const rest = ok.filter(i => !ws(i)).sort((a, b) => sc(b) - sc(a));
    return { week, rest, hidden, viewedHidden, wscore: ws };
  }
  const api = { GENERIC, W, normCode, namesOf, specificTags, buildProfile, penalty, blockedByActress, buckets, weekHot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rank = api;
})(typeof window !== 'undefined' ? window : globalThis);
