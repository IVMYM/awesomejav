const L = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (!L.sameOriginOk(req)) return L.json(res, 403, { error: 'forbidden' });
    if (req.method === 'GET') {
      const { username, user } = await L.requireUser(req);
      return L.json(res, 200, L.profile(username, user));
    }
    if (req.method === 'PUT') {
      const { username, user } = await L.requireUser(req);
      const body = await L.readBody(req);
      if (Array.isArray(body.follows)) user.follows = [...new Set(body.follows.map(String))];
      if (Array.isArray(body.favorites)) user.favorites = [...new Set(body.favorites.map(String))];
      if (Array.isArray(body.dislikes)) user.dislikes = L.normDislikes(body.dislikes);
      if (Array.isArray(body.blocked_actresses)) user.blocked_actresses = L.normBlockedActresses(body.blocked_actresses);
      if (Array.isArray(body.viewed)) user.viewed = L.normViewed(body.viewed);
      if (body.viewedOps && typeof body.viewedOps === 'object') user.viewed = L.applyViewedOps(user.viewed, body.viewedOps);
      await L.saveUser(username, user);
      return L.json(res, 200, L.profile(username, user));
    }
    return L.json(res, 405, { error: 'method not allowed' });
  } catch (e) {
    return L.json(res, e.status || 500, { error: e.message || 'me failed' });
  }
};
