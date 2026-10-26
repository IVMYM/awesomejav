const L = require('./_lib');

/** Synced with h112 torlnk-api scrapers (extend as upstream adds sources). */
const SOURCES = [
  { id: '5cili', label: '无极磁链' },
  { id: 'btdig', label: 'BTDigg' },
  { id: 'sukebei', label: 'Sukebei' },
];

function resolveSource(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '5cili';
  return SOURCES.some((x) => x.id === s) ? s : null;
}

function magnetCachePath(code, source) {
  const c = L.normCode(code) || L.safeCode(code);
  return `magnets/${c}__${source}.json`;
}

function pickUpstreamFields(body) {
  if (!body || typeof body !== 'object') return { results: [] };
  const out = {};
  if (Array.isArray(body.results)) out.results = body.results;
  else out.results = [];
  if (body.rawCount != null) out.rawCount = body.rawCount;
  if (body.matched != null) out.matched = body.matched;
  if (body.query != null) out.query = body.query;
  return out;
}

async function readCache(code, source) {
  try {
    return await L.blobGetJsonFresh(magnetCachePath(code, source));
  } catch (_) {
    return null;
  }
}

async function writeCache(code, source, fields) {
  const payload = {
    code,
    source,
    updatedAt: Date.now(),
    ...fields,
  };
  await L.blobPut(magnetCachePath(code, source), JSON.stringify(payload), {
    contentType: 'application/json',
    allowOverwrite: true,
  });
  return payload;
}

module.exports = async (req, res) => {
  try {
    if (!L.sameOriginOk(req)) return L.json(res, 403, { error: 'forbidden' });
    if (req.method !== 'GET') return L.json(res, 405, { error: 'method not allowed' });

    await L.requireUser(req);

    const url = new URL(req.url, 'http://x');

    if (url.searchParams.get('list') === '1') {
      return L.json(res, 200, { sources: SOURCES });
    }

    const code = L.safeCode(url.searchParams.get('code'));
    if (!code) return L.json(res, 400, { error: '番号无效' });

    const sourceParam = url.searchParams.get('source');
    const source = resolveSource(sourceParam);
    if (sourceParam != null && String(sourceParam).trim() && !source) {
      return L.json(res, 400, { error: '未知磁力来源' });
    }
    const resolvedSource = source || '5cili';

    const fresh =
      url.searchParams.get('fresh') === '1' || url.searchParams.get('refresh') === '1';

    if (!fresh) {
      const cached = await readCache(code, resolvedSource);
      if (cached && Array.isArray(cached.results)) {
        return L.json(res, 200, {
          ...pickUpstreamFields(cached),
          code: cached.code || code,
          source: cached.source || resolvedSource,
          updatedAt: cached.updatedAt || null,
          cached: true,
        });
      }
    }

    const base = String(process.env.TORLINK_URL || '').replace(/\/$/, '');
    const token = process.env.TORLINK_TOKEN;
    if (!base || !token) return L.json(res, 503, { error: 'torlnk 未配置' });

    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 55000) : null;
    let upstream;
    try {
      const q = `${base}/search?q=${encodeURIComponent(code)}&source=${encodeURIComponent(resolvedSource)}`;
      upstream = await fetch(q, {
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
      return L.json(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, {
        error: errMsg,
      });
    }

    const fields = pickUpstreamFields(body);
    const saved = await writeCache(code, resolvedSource, fields);

    return L.json(res, 200, {
      ...fields,
      code,
      source: resolvedSource,
      updatedAt: saved.updatedAt,
      cached: false,
    });
  } catch (e) {
    return L.json(res, e.status || 500, { error: e.message || 'torlnk failed' });
  }
};
