const L = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (!L.sameOriginOk(req)) return L.json(res, 403, { error: 'forbidden' });
    if (req.method !== 'GET') return L.json(res, 405, { error: 'method not allowed' });

    await L.requireUser(req);

    const url = new URL(req.url, 'http://x');
    const code = L.safeCode(url.searchParams.get('code'));
    if (!code) return L.json(res, 400, { error: '番号无效' });

    const base = String(process.env.TORLINK_URL || '').replace(/\/$/, '');
    const token = process.env.TORLINK_TOKEN;
    if (!base || !token) return L.json(res, 503, { error: 'torlnk 未配置' });

    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 55000) : null;
    let upstream;
    try {
      upstream = await fetch(`${base}/search?q=${encodeURIComponent(code)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (e) {
      const msg = e && e.name === 'AbortError' ? '搜索超时' : (e.message || 'upstream failed');
      return L.json(res, 504, { error: msg });
    } finally {
      if (timer) clearTimeout(timer);
    }

    const text = await upstream.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      return L.json(res, 502, { error: 'upstream 返回非 JSON' });
    }
    if (!upstream.ok) {
      const errMsg = (body && body.error) || text.slice(0, 200) || `upstream ${upstream.status}`;
      return L.json(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, { error: errMsg });
    }
    return L.json(res, 200, body);
  } catch (e) {
    return L.json(res, e.status || 500, { error: e.message || 'torlnk failed' });
  }
};
