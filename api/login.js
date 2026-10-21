const L = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return L.json(res, 405, { error: 'method not allowed' });
    if (!L.sameOriginOk(req)) return L.json(res, 403, { error: 'forbidden' });
    const body = await L.readBody(req);
    const name = L.safeUser(body.user || body.username || body.name);
    const pass = String(body.pass || body.password || '');
    if (!name) return L.json(res, 400, { error: '用户名无效' });
    const user = await L.loadUser(name);
    if (!user || user.hash !== L.hashPass(pass)) return L.json(res, 401, { error: '用户名或密码错误' });
    // one-time migrate from client local cache if cloud empty
    const locF = Array.isArray(body.localFollows) ? body.localFollows : [];
    const locFav = Array.isArray(body.localFavorites) ? body.localFavorites : [];
    let changed = false;
    if ((!user.follows || !user.follows.length) && locF.length) {
      user.follows = [...new Set(locF.map(String))];
      changed = true;
    }
    if ((!user.favorites || !user.favorites.length) && locFav.length) {
      user.favorites = [...new Set(locFav.map(String))];
      changed = true;
    }
    // 踩: union of cloud + local (guest / cached) — never drops cloud entries
    const locDis = L.normDislikes(body.localDislikes);
    if (locDis.length) {
      const cur = L.normDislikes(user.dislikes);
      const merged = L.normDislikes([...cur, ...locDis]);
      if (merged.length !== cur.length) { user.dislikes = merged; changed = true; }
    }
    // 已浏览: union (max t per code)
    const locView = L.normViewed(body.localViewed);
    if (locView.length) {
      const cur = L.normViewed(user.viewed);
      const merged = L.normViewed([...cur, ...locView]);
      if (JSON.stringify(merged) !== JSON.stringify(cur)) { user.viewed = merged; changed = true; }
    }
    if (changed) await L.saveUser(name, user);
    const { token } = await L.createSession(name);
    L.setSessionCookie(res, token);
    return L.json(res, 200, { ok: true, token, profile: L.profile(name, user) });
  } catch (e) {
    return L.json(res, e.status || 500, { error: e.message || 'login failed' });
  }
};
