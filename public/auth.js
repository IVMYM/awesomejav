/* Cloud auth via /api/* (Vercel Blob). localStorage is cache only. */
const Auth = (() => {
  const SESS = 'jav_session_v1';
  const TOK = 'jav_token_v1';
  const CACHE = 'jav_profile_v1';
  const USERS_LEGACY = 'jav_users_v1';
  const GUEST_DIS = 'jav_guest_dislikes_v1';
  const GUEST_VIEW = 'jav_guest_viewed_v1';
  const VIEW_CAP = 3000;
  const VIEW_DEBOUNCE = 1500;
  const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const loadArr = (k) => { try { const a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

  function current() { return localStorage.getItem(SESS) || null; }
  function getToken() { return localStorage.getItem(TOK) || ''; }
  function cacheProfile(p) {
    if (!p) return;
    localStorage.setItem(CACHE, JSON.stringify(p));
    localStorage.setItem(SESS, p.user);
    if (Array.isArray(p.follows)) localStorage.setItem(`jav_u_${p.user}_follows`, JSON.stringify(p.follows));
    if (Array.isArray(p.favorites)) localStorage.setItem(`jav_u_${p.user}_favorites`, JSON.stringify(p.favorites));
    if (Array.isArray(p.dislikes)) localStorage.setItem(`jav_u_${p.user}_dislikes`, JSON.stringify(p.dislikes));
    if (Array.isArray(p.viewed)) {
      // server list + ops not yet acknowledged (in flight / queued) → never drop local entries
      p.viewed = applyOps(applyOps(normViewed(p.viewed), fly), pend);
      localStorage.setItem(CACHE, JSON.stringify(p));
      localStorage.setItem(`jav_u_${p.user}_viewed`, JSON.stringify(p.viewed));
      viewRev++;
    }
  }
  function cachedProfile() {
    try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { return null; }
  }
  function legacyLists(name) {
    const load = (k) => { try { return JSON.parse(localStorage.getItem(`jav_u_${name}_${k}`) || '[]'); } catch { return []; } };
    return { follows: load('follows'), favorites: load('favorites'), dislikes: load('dislikes'), viewed: load('viewed') };
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const tok = getToken();
    if (tok) headers.Authorization = 'Bearer ' + tok;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const ms = opts.timeoutMs != null ? opts.timeoutMs : 8000;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    const { timeoutMs, ...rest } = opts;
    try {
      const res = await fetch(path, Object.assign({}, rest, { headers, credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined }));
      let data = null;
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok) throw new Error((data && data.error) || ('请求失败 ' + res.status));
      return data;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('请求超时');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function register(name, pw) {
    name = (name || '').trim();
    const data = await api('/api/register', { method: 'POST', body: JSON.stringify({ user: name, pass: pw, localDislikes: loadArr(GUEST_DIS), localViewed: normViewed(loadArr(GUEST_VIEW)) }) });
    resetViewQueue();
    if (data.token) localStorage.setItem(TOK, data.token);
    cacheProfile(data.profile);
    localStorage.removeItem(GUEST_DIS);
    localStorage.removeItem(GUEST_VIEW);
    return data.profile.user;
  }

  async function login(name, pw) {
    name = (name || '').trim();
    const leg = legacyLists(name);
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ user: name, pass: pw, localFollows: leg.follows, localFavorites: leg.favorites,
        localDislikes: [...new Set([...loadArr(GUEST_DIS), ...leg.dislikes].map(normCode).filter(Boolean))],
        localViewed: normViewed([...loadArr(GUEST_VIEW), ...leg.viewed]) }),
    });
    resetViewQueue();
    if (data.token) localStorage.setItem(TOK, data.token);
    cacheProfile(data.profile);
    localStorage.removeItem(GUEST_DIS);
    localStorage.removeItem(GUEST_VIEW);
    return data.profile.user;
  }

  async function logout() {
    try { await flushViewed(true); } catch (_) {}
    resetViewQueue();
    try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch (_) {}
    localStorage.removeItem(SESS);
    localStorage.removeItem(TOK);
    localStorage.removeItem(CACHE);
  }

  async function refresh() {
    if (!getToken()) return cachedProfile();
    try {
      const seq = putSeq;
      const p = await api('/api/me');
      // A PUT finished while this GET was in flight → its body may be stale; keep local lists.
      if (disPending > 0 || seq !== putSeq) p.dislikes = dislikes();
      if (seq !== putSeq) p.viewed = viewed();
      cacheProfile(p);
      return p;
    } catch (e) {
      // Keep cache on network blip; clear only on hard 401
      if (e && /未登录|401/.test(String(e.message||e))) {
        localStorage.removeItem(SESS);
        localStorage.removeItem(TOK);
        return null;
      }
      return cachedProfile();
    }
  }

  function follows() {
    const p = cachedProfile();
    if (p && Array.isArray(p.follows)) return p.follows.slice();
    const u = current();
    if (!u) return [];
    try { return JSON.parse(localStorage.getItem(`jav_u_${u}_follows`) || '[]'); } catch { return []; }
  }
  function favorites() {
    const p = cachedProfile();
    if (p && Array.isArray(p.favorites)) return p.favorites.slice();
    const u = current();
    if (!u) return [];
    try { return JSON.parse(localStorage.getItem(`jav_u_${u}_favorites`) || '[]'); } catch { return []; }
  }
  function isFollowing(slug) { return follows().includes(slug); }
  function isFavorited(vid) { return favorites().includes(String(vid)); }

  function writeLocalFollows(arr) {
    const u = current(); if (!u) return;
    localStorage.setItem(`jav_u_${u}_follows`, JSON.stringify(arr));
    const p = cachedProfile();
    if (p && p.user === u) { p.follows = arr; localStorage.setItem(CACHE, JSON.stringify(p)); }
  }
  function writeLocalFavorites(arr) {
    const u = current(); if (!u) return;
    localStorage.setItem(`jav_u_${u}_favorites`, JSON.stringify(arr));
    const p = cachedProfile();
    if (p && p.user === u) { p.favorites = arr; localStorage.setItem(CACHE, JSON.stringify(p)); }
  }
  function emitSaveFail(msg) {
    try { dispatchEvent(new CustomEvent('jav-save-fail', { detail: String(msg || '保存失败') })); } catch (_) {}
  }

  /** ONE serialized queue for every PUT /api/me (fav / follow / dislike / viewed). */
  let chain = Promise.resolve();
  let disPending = 0;
  let putSeq = 0;
  let listTimer = null;
  let wantDislikes = false;
  let listFails = 0;
  const LIST_DEBOUNCE = 100;

  /** Flush latest local lists (and optional disliked / viewed ops). Never blocks UI. */
  function flushLists() {
    if (listTimer) { clearTimeout(listTimer); listTimer = null; }
    if (!current() || !getToken()) return Promise.resolve(null);
    const job = chain.then(async () => {
      const body = { follows: follows(), favorites: favorites() };
      if (wantDislikes || disPending > 0) { body.dislikes = dislikes(); wantDislikes = false; }
      const ops = takeOps(); if (ops) body.viewedOps = ops;
      let p;
      try {
        p = await api('/api/me', { method: 'PUT', body: JSON.stringify(body) });
      } catch (e) {
        if (ops) requeue(ops);
        wantDislikes = true;
        if (++listFails <= 4) {
          listTimer = setTimeout(() => { listTimer = null; flushLists().catch(() => {}); }, 800 * listFails);
        } else {
          listFails = 0;
          try { const fresh = await api('/api/me'); cacheProfile(fresh); } catch (_) {}
          emitSaveFail(e.message || e);
        }
        throw e;
      }
      listFails = 0; putSeq++; fly = null;
      // Local is authoritative if the user clicked again while the PUT was in flight.
      const keepD = dislikes(), keepF = favorites(), keepFo = follows();
      cacheProfile(Object.assign({}, p, { dislikes: keepD, favorites: keepF, follows: keepFo }));
      const srvD = Array.isArray(p.dislikes) ? p.dislikes : [];
      if (keepD.length !== srvD.length || keepD.some((x, i) => x !== srvD[i])) wantDislikes = true;
      if (wantDislikes && !listTimer) schedulePersist({ dislikes: true });
      return p;
    });
    chain = job.catch(() => {});
    return job;
  }
  function schedulePersist(opts = {}) {
    if (opts.dislikes) wantDislikes = true;
    if (!current() || !getToken()) return;
    if (listTimer) clearTimeout(listTimer);
    listTimer = setTimeout(() => { listTimer = null; flushLists().catch(() => {}); }, LIST_DEBOUNCE);
  }

  /** @deprecated path kept for rare callers — now optimistic. */
  async function persistLists(followsArr, favoritesArr, dislikesArr) {
    if (Array.isArray(followsArr)) writeLocalFollows(followsArr);
    if (Array.isArray(favoritesArr)) writeLocalFavorites(favoritesArr);
    if (Array.isArray(dislikesArr)) writeLocalDislikes(dislikesArr);
    schedulePersist({ dislikes: Array.isArray(dislikesArr) });
    return cachedProfile();
  }

  async function toggleFollow(slug) {
    if (!current()) return false;
    let a = follows();
    if (a.includes(slug)) a = a.filter(x => x !== slug); else a = [slug, ...a];
    writeLocalFollows(a);
    schedulePersist();
    return a.includes(slug);
  }
  async function toggleFavorite(vid) {
    if (!current()) return false;
    vid = String(vid);
    let a = favorites();
    if (a.includes(vid)) a = a.filter(x => x !== vid); else a = [vid, ...a];
    writeLocalFavorites(a);
    schedulePersist();
    return a.includes(vid);
  }

  /* ---- 踩 / 不感兴趣 (normalized 番号, newest first) ---- */
  function dislikes() {
    const u = current();
    if (!u) return loadArr(GUEST_DIS);
    const p = cachedProfile();
    if (p && p.user === u && Array.isArray(p.dislikes)) return p.dislikes.slice();
    return loadArr(`jav_u_${u}_dislikes`);
  }
  function isDisliked(code) { const k = normCode(code); return !!k && dislikes().includes(k); }
  function writeLocalDislikes(arr) {
    const u = current();
    if (!u) { localStorage.setItem(GUEST_DIS, JSON.stringify(arr)); return; }
    localStorage.setItem(`jav_u_${u}_dislikes`, JSON.stringify(arr));
    const p = cachedProfile();
    if (p && p.user === u) { p.dislikes = arr; localStorage.setItem(CACHE, JSON.stringify(p)); }
  }
  /** Optimistic: flip local instantly, cloud save is debounced & background. */
  async function setDislike(code, on) {
    const k = normCode(code); if (!k) return false;
    let a = dislikes().filter(x => x !== k);
    if (on) a = [k, ...a];
    writeLocalDislikes(a);
    if (!current() || !getToken()) return on;
    disPending++;
    schedulePersist({ dislikes: true });
    // Clear disPending after the next flush has had a chance to pick it up.
    setTimeout(() => { disPending = Math.max(0, disPending - 1); }, LIST_DEBOUNCE + 50);
    return on;
  }
  function toggleDislike(code) { return setDislike(code, !isDisliked(code)); }


  /* ---- 已浏览 (viewed): [{c, t}] newest first. Saved as delta ops through the same queue. ---- */
  function normViewed(arr) {
    const best = new Map();
    for (const e of Array.isArray(arr) ? arr : []) {
      let c, t;
      if (typeof e === 'string') { c = e; t = 0; }
      else if (Array.isArray(e)) { c = e[0]; t = e[1]; }
      else if (e && typeof e === 'object') { c = e.c || e.code; t = e.t; }
      const k = normCode(c); if (k.length < 2 || k.length > 32) continue;
      t = Number(t) || 0;
      if (!best.has(k) || best.get(k) < t) best.set(k, t);
    }
    return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, VIEW_CAP).map(([c, t]) => ({ c, t }));
  }
  const emptyOps = () => ({ add: new Map(), del: new Map(), clearAt: 0 });
  let pend = emptyOps(); // queued, not yet sent
  let fly = null;        // sent, not yet acknowledged
  let viewTimer = null;
  const opsEmpty = (o) => !o || (!o.add.size && !o.del.size && !o.clearAt);
  function applyOps(arr, o) {
    if (opsEmpty(o)) return arr;
    return normViewed([...arr, ...[...o.add].map(([c, t]) => ({ c, t }))])
      .filter((e) => e.t > o.clearAt && !(o.del.has(e.c) && e.t <= o.del.get(e.c)));
  }
  function mergeOps(a, b) { // a ⊕ b (b newer)
    const o = emptyOps();
    for (const x of [a, b]) {
      if (!x) continue;
      for (const [c, t] of x.add) if (!o.add.has(c) || o.add.get(c) < t) o.add.set(c, t);
      for (const [c, t] of x.del) if (!o.del.has(c) || o.del.get(c) < t) o.del.set(c, t);
      o.clearAt = Math.max(o.clearAt, x.clearAt || 0);
    }
    return o;
  }
  const opsJson = (o) => ({ add: [...o.add].map(([c, t]) => ({ c, t })), del: Object.fromEntries(o.del), clearAt: o.clearAt });
  /** Move queued ops to "in flight" and return their JSON (or null). */
  function takeOps() {
    if (opsEmpty(pend)) return null;
    fly = mergeOps(fly, pend); pend = emptyOps();
    if (viewTimer) { clearTimeout(viewTimer); viewTimer = null; }
    return opsJson(fly);
  }
  function requeue() { pend = mergeOps(fly, pend); fly = null; }
  function resetViewQueue() { pend = emptyOps(); fly = null; if (viewTimer) { clearTimeout(viewTimer); viewTimer = null; } }

  let _vs = null, _vsKey = null, viewRev = 0;
  function viewed() {
    const u = current();
    if (!u) return normViewed(loadArr(GUEST_VIEW));
    const p = cachedProfile();
    if (p && p.user === u && Array.isArray(p.viewed)) return p.viewed.slice();
    return normViewed(loadArr(`jav_u_${u}_viewed`));
  }
  function viewedSet() {
    const key = (current() || '') + '|' + viewRev;
    if (_vs && _vsKey === key) return _vs;
    _vs = new Set(viewed().map((e) => e.c)); _vsKey = key; return _vs;
  }
  function isViewed(code) { const k = normCode(code); return !!k && viewedSet().has(k); }
  function writeLocalViewed(arr) {
    viewRev++;
    const u = current();
    if (!u) { localStorage.setItem(GUEST_VIEW, JSON.stringify(arr)); return; }
    localStorage.setItem(`jav_u_${u}_viewed`, JSON.stringify(arr));
    const p = cachedProfile();
    if (p && p.user === u) { p.viewed = arr; localStorage.setItem(CACHE, JSON.stringify(p)); }
  }
  function queueOps(o) {
    writeLocalViewed(applyOps(viewed(), o));
    if (!current() || !getToken()) return;
    pend = mergeOps(pend, o);
    if (viewTimer) clearTimeout(viewTimer);
    viewTimer = setTimeout(() => { viewTimer = null; flushViewed().catch(() => {}); }, VIEW_DEBOUNCE);
  }
  let viewFails = 0;
  /** Send queued viewed ops (debounced batch). Serialized with every other PUT. */
  function flushViewed(keepalive) {
    if (viewTimer) { clearTimeout(viewTimer); viewTimer = null; }
    if (!current() || !getToken()) return Promise.resolve(null);
    const job = chain.then(async () => {
      const ops = takeOps(); if (!ops) return null;
      let p;
      try { p = await api('/api/me', { method: 'PUT', body: JSON.stringify({ viewedOps: ops }), keepalive: !!keepalive }); }
      catch (e) {
        requeue();
        if (++viewFails <= 5 && !viewTimer) viewTimer = setTimeout(() => { viewTimer = null; flushViewed().catch(() => {}); }, 4000 * viewFails);
        throw e;
      }
      viewFails = 0; putSeq++; fly = null;
      if (disPending > 0) p.dislikes = dislikes();
      cacheProfile(p);
      return p;
    });
    chain = job.catch(() => {});
    return job;
  }
  let lastT = 0; // strictly increasing local clock so add-after-clear/remove in the same ms still wins
  const tick = () => { const t = Math.max(Date.now(), lastT + 1); lastT = t; return t; };
  function addViewed(code) {
    const k = normCode(code); if (!k) return;
    const o = emptyOps(); o.add.set(k, tick()); queueOps(o);
  }
  function removeViewed(code) {
    const k = normCode(code); if (!k) return;
    const o = emptyOps(); o.del.set(k, tick()); queueOps(o);
  }
  function clearViewed() { const o = emptyOps(); o.clearAt = tick(); queueOps(o); }
  function viewedPending() { return !opsEmpty(pend) || !opsEmpty(fly); }
  if (typeof addEventListener === 'function') {
    const bye = () => {
      const pendingLists = !!listTimer || wantDislikes;
      if (listTimer) { clearTimeout(listTimer); listTimer = null; }
      if (pendingLists) flushLists().catch(() => {});
      if (!opsEmpty(pend)) flushViewed(true).catch(() => {});
    };
    addEventListener('pagehide', bye);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') bye(); });
  }

  function uploads() {
    const p = cachedProfile();
    return (p && Array.isArray(p.uploads)) ? p.uploads.slice() : [];
  }

  return {
    current, logout, register, login, refresh, follows, favorites,
    isFollowing, isFavorited, toggleFollow, toggleFavorite, uploads, getToken, cachedProfile,
    dislikes, isDisliked, setDislike, toggleDislike, normCode,
    viewed, isViewed, viewedSet, addViewed, removeViewed, clearViewed, flushViewed, viewedPending,
  };
})();
