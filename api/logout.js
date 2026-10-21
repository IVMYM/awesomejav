const L = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return L.json(res, 405, { error: 'method not allowed' });
    const sess = L.getSessionToken(req);
    await L.destroySession(sess);
    L.clearSessionCookie(res);
    return L.json(res, 200, { ok: true });
  } catch (e) {
    L.clearSessionCookie(res);
    return L.json(res, 200, { ok: true });
  }
};
