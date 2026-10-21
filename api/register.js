const L = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return L.json(res, 405, { error: 'method not allowed' });
    if (!L.sameOriginOk(req)) return L.json(res, 403, { error: 'forbidden' });
    const body = await L.readBody(req);
    const name = L.safeUser(body.user || body.username || body.name);
    const pass = String(body.pass || body.password || '');
    if (!name) return L.json(res, 400, { error: '用户名需 2–32 位（字母数字下划线或中文）' });
    if (pass.length < 4) return L.json(res, 400, { error: '密码至少 4 位' });
    if (await L.loadUser(name)) return L.json(res, 409, { error: '用户名已存在' });
    const user = {
      hash: L.hashPass(pass),
      created: Date.now(),
      follows: [],
      favorites: [],
      uploads: [],
      dislikes: L.normDislikes(body.localDislikes),
      viewed: L.normViewed(body.localViewed),
    };
    await L.saveUser(name, user);
    const { token } = await L.createSession(name);
    L.setSessionCookie(res, token);
    return L.json(res, 200, { ok: true, token, profile: L.profile(name, user) });
  } catch (e) {
    return L.json(res, e.status || 500, { error: e.message || 'register failed' });
  }
};
