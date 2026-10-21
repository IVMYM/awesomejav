const L = require('./_lib');

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  return { contentType: m[1], buf };
}

module.exports = async (req, res) => {
  try {
    if (!L.sameOriginOk(req)) return L.json(res, 403, { error: 'forbidden' });
    if (req.method === 'DELETE') {
      const { username, user } = await L.requireUser(req);
      const url = new URL(req.url, 'http://x');
      const id = url.searchParams.get('id');
      if (!id) return L.json(res, 400, { error: 'missing id' });
      const uploads = Array.isArray(user.uploads) ? user.uploads : [];
      const hit = uploads.find((u) => u.id === id);
      if (!hit) return L.json(res, 404, { error: 'not found' });
      user.uploads = uploads.filter((u) => u.id !== id);
      await L.saveUser(username, user);
      if (hit.url) {
        try { await L.blobDel(hit.url); } catch (_) {}
      }
      return L.json(res, 200, { ok: true, profile: L.profile(username, user) });
    }
    if (req.method !== 'POST') return L.json(res, 405, { error: 'method not allowed' });
    const { username, user } = await L.requireUser(req);
    const body = await L.readBody(req);
    const code = L.safeCode(body.code);
    if (!code) return L.json(res, 400, { error: '番号无效' });
    const parsed = parseDataUrl(body.dataUrl || body.data);
    if (!parsed) return L.json(res, 400, { error: '需要图片 dataURL' });
    if (parsed.buf.length > L.MAX_UPLOAD) return L.json(res, 413, { error: '单张不要超过 3MB（云端限制）' });
    const uploads = Array.isArray(user.uploads) ? user.uploads : [];
    const forCode = uploads.filter((u) => u.code === code);
    if (forCode.length >= L.MAX_PER_CODE) return L.json(res, 400, { error: `每个番号最多 ${L.MAX_PER_CODE} 张` });
    const id = L.randToken(8);
    const ext = (parsed.contentType.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('svg+xml', 'png');
    const pathname = `shots/${username}/${code}/${id}.${ext}`;
    const put = await L.blobPut(pathname, parsed.buf, {
      contentType: parsed.contentType,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });
    const url = put.url || L.publicUrl(pathname);
    const row = { id, code, url, pathname, ts: Date.now() };
    user.uploads = [...uploads, row];
    await L.saveUser(username, user);
    return L.json(res, 200, { ok: true, shot: row, profile: L.profile(username, user) });
  } catch (e) {
    return L.json(res, e.status || 500, { error: e.message || 'upload failed' });
  }
};
