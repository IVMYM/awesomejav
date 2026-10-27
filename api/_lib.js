/* Shared helpers for jav-report serverless API. Zero deps — Vercel Blob REST or R2 S3 API. */
const crypto = require('crypto');

const BLOB_API = 'https://vercel.com/api/blob';
const BLOB_VER = '12';
const SALT = 'jav-archive-bili-2026';
const COOKIE = 'jav_sess';
/** Login never expires (until explicit logout). Cookie Max-Age ~10y; browsers may clamp. */
const SESSION_COOKIE_MAX_AGE = 10 * 365 * 24 * 60 * 60;
const MAX_UPLOAD = 3 * 1024 * 1024; // stay under Vercel 4.5MB body limit (base64 expands)
const MAX_PER_CODE = 40;
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const R2_REGION = 'auto';

function token() {
  const t = process.env.BLOB_READ_WRITE_TOKEN;
  if (!t) throw new Error('BLOB_READ_WRITE_TOKEN missing');
  return t;
}

function storeId() {
  return token().split('_')[3] || '';
}

function r2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
    host: `${accountId}.r2.cloudflarestorage.com`,
  };
}

function useR2() {
  return r2Config() != null;
}

function awsEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function awsEncodePath(key) {
  return String(key || '')
    .split('/')
    .map(awsEncode)
    .join('/');
}

function sha256Hex(data) {
  if (data == null) return EMPTY_SHA256;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function signR2Request(cfg, { method, key, query = {}, headers = {}, body = null }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const objectKey = String(key || '');
  const canonicalUri = objectKey
    ? `/${cfg.bucket}/${awsEncodePath(objectKey)}`
    : `/${cfg.bucket}`;
  const qs = Object.keys(query)
    .sort()
    .map((k) => `${awsEncode(k)}=${awsEncode(String(query[k]))}`)
    .join('&');
  const hdrs = {
    host: cfg.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...headers,
  };
  const signedKeys = Object.keys(hdrs)
    .map((k) => k.toLowerCase())
    .sort();
  const signedHeaders = signedKeys.join(';');
  const canonicalHeaders = `${signedKeys.map((k) => `${k}:${String(hdrs[k]).trim()}\n`).join('')}`;
  const canonicalRequest = [
    method,
    canonicalUri,
    qs,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${R2_REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  let signingKey = hmacSha256(`AWS4${cfg.secretAccessKey}`, dateStamp);
  signingKey = hmacSha256(signingKey, R2_REGION);
  signingKey = hmacSha256(signingKey, 's3');
  signingKey = hmacSha256(signingKey, 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const outHeaders = { ...hdrs, authorization };
  const url = `https://${cfg.host}${canonicalUri}${qs ? `?${qs}` : ''}`;
  return { url, headers: outHeaders, body };
}

async function r2Request(cfg, opts) {
  const signed = signR2Request(cfg, opts);
  const res = await fetch(signed.url, {
    method: opts.method,
    headers: signed.headers,
    body: signed.body,
  });
  const buf = await res.arrayBuffer().then((ab) => Buffer.from(ab));
  return { res, buf };
}

function pathnameFromBlobUrl(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.replace(/^\//, ''));
  } catch {
    return url;
  }
}

function parseListObjectsXml(xml) {
  const blobs = [];
  for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || []) {
    const key = /<Key>([^<]*)<\/Key>/.exec(block)?.[1];
    const lastMod = /<LastModified>([^<]*)<\/LastModified>/.exec(block)?.[1];
    if (key) blobs.push({ pathname: key, uploadedAt: lastMod, url: null });
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const nextToken = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] || '';
  return { blobs, truncated, nextToken };
}

function hashPass(pw) {
  return crypto.createHash('sha256').update(SALT + String(pw)).digest('hex');
}

function randToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

function safeUser(name) {
  const u = String(name || '').trim();
  if (!/^[a-zA-Z0-9_\u4e00-\u9fff-]{2,32}$/.test(u)) return null;
  return u;
}

function safeCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,32}$/.test(c)) return null;
  return c;
}

/** 踩 list: normalized 番号 (A-Z0-9 only), unique, newest first, capped. */
const MAX_DISLIKES = 3000;
function normCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function normDislikes(arr) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(arr) ? arr : []) {
    const k = normCode(c);
    if (k.length < 2 || k.length > 32 || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= MAX_DISLIKES) break;
  }
  return out;
}

/** Blocked actress names from dislikes: trimmed strings, unique, order preserved. */
function normBlockedActresses(arr) {
  const out = [];
  const seen = new Set();
  for (const s of Array.isArray(arr) ? arr : []) {
    const n = String(s || '').trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** 已浏览: [{c: normCode, t: ms}] unique by code (max t wins), newest first, capped.
 *  Accepts strings, {c,t} / {code,t}, or [c,t]. */
const MAX_VIEWED = 3000;
function normViewed(arr) {
  const best = new Map();
  for (const e of Array.isArray(arr) ? arr : []) {
    let c, t;
    if (typeof e === 'string') { c = e; t = 0; }
    else if (Array.isArray(e)) { c = e[0]; t = e[1]; }
    else if (e && typeof e === 'object') { c = e.c || e.code; t = e.t; }
    const k = normCode(c);
    if (k.length < 2 || k.length > 32) continue;
    t = Number(t) || 0;
    if (!best.has(k) || best.get(k) < t) best.set(k, t);
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_VIEWED).map(([c, t]) => ({ c, t }));
}
/** Delta ops (serialized client queue): add [{c,t}], del {code: delAt}, clearAt ms.
 *  Tombstones are time-based so replays / reordering are idempotent. */
function applyViewedOps(cur, ops) {
  if (!ops || typeof ops !== 'object') return normViewed(cur);
  const clearAt = Number(ops.clearAt) || 0;
  const del = ops.del && typeof ops.del === 'object' ? ops.del : {};
  const dm = new Map();
  for (const [k, v] of Object.entries(del)) { const c = normCode(k); if (c) dm.set(c, Number(v) || 0); }
  return normViewed([...normViewed(cur), ...normViewed(ops.add)])
    .filter((e) => e.t > clearAt && !(dm.has(e.c) && e.t <= dm.get(e.c)));
}

function json(res, status, body, extraHeaders = {}) {
  for (const [k, v] of Object.entries({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })) {
    res.setHeader(k, v);
  }
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const limit = 5 * 1024 * 1024;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const h = req.headers.cookie || '';
  const out = {};
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, sessToken) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(sessToken)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_COOKIE_MAX_AGE}`,
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
}

function publicUrl(pathname) {
  return `https://${storeId().toLowerCase()}.public.blob.vercel-storage.com/${pathname}`;
}

async function r2PutObject(pathname, body, { contentType, cacheControlMaxAge } = {}) {
  const cfg = r2Config();
  const headers = {};
  if (contentType) headers['content-type'] = contentType;
  if (cacheControlMaxAge != null) headers['cache-control'] = `max-age=${cacheControlMaxAge}`;
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const { res, buf } = await r2Request(cfg, {
    method: 'PUT',
    key: pathname,
    headers,
    body: payload,
  });
  if (!res.ok) {
    const err = new Error(buf.toString('utf8') || `r2 put ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return { url: null, pathname };
}

async function r2GetObject(pathname) {
  const cfg = r2Config();
  const { res, buf } = await r2Request(cfg, { method: 'GET', key: pathname });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(buf.toString('utf8') || `r2 get ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return buf;
}

async function r2HeadObject(pathname) {
  const cfg = r2Config();
  const { res } = await r2Request(cfg, { method: 'HEAD', key: pathname });
  if (res.status === 404) return false;
  if (!res.ok) {
    const err = new Error(`r2 head ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return true;
}

async function r2DeleteObject(pathname) {
  const cfg = r2Config();
  const { res, buf } = await r2Request(cfg, { method: 'DELETE', key: pathname });
  if (res.status === 404) return;
  if (!res.ok) {
    const err = new Error(buf.toString('utf8') || `r2 del ${res.status}`);
    err.status = res.status;
    throw err;
  }
}

async function r2ListPage(prefix, { maxKeys = 1000, continuationToken } = {}) {
  const cfg = r2Config();
  const query = { 'list-type': '2', prefix, 'max-keys': String(maxKeys) };
  if (continuationToken) query['continuation-token'] = continuationToken;
  const { res, buf } = await r2Request(cfg, { method: 'GET', key: '', query });
  if (!res.ok) {
    const err = new Error(buf.toString('utf8') || `r2 list ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return parseListObjectsXml(buf.toString('utf8'));
}

async function blobPut(pathname, body, { contentType, allowOverwrite = false, cacheControlMaxAge } = {}) {
  if (useR2()) {
    return r2PutObject(pathname, body, { contentType, cacheControlMaxAge });
  }
  const params = new URLSearchParams({ pathname });
  const headers = {
    authorization: `Bearer ${token()}`,
    'x-api-version': BLOB_VER,
    'x-vercel-blob-access': 'public',
    'x-add-random-suffix': '0',
  };
  if (contentType) headers['x-content-type'] = contentType;
  if (allowOverwrite) headers['x-allow-overwrite'] = '1';
  if (cacheControlMaxAge != null) headers['x-cache-control-max-age'] = String(cacheControlMaxAge);
  const res = await fetch(`${BLOB_API}/?${params}`, { method: 'PUT', headers, body });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(text || `blob put ${res.status}`);
    err.status = res.status;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { url: publicUrl(pathname), pathname };
  }
}

/** Authenticated read on R2; Vercel Blob uses public CDN (can lag ~60s on overwrite). */
async function blobGetJsonFresh(pathname) {
  if (useR2()) {
    const buf = await r2GetObject(pathname);
    if (buf == null) return null;
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      const err = new Error('invalid JSON');
      err.status = 500;
      throw err;
    }
  }
  const url = publicUrl(pathname) + `?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`blob get ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function blobListPage(prefix, { limit = 100, cursor } = {}) {
  if (useR2()) {
    const page = await r2ListPage(prefix, {
      maxKeys: limit,
      continuationToken: cursor || undefined,
    });
    return {
      blobs: page.blobs,
      hasMore: page.truncated,
      cursor: page.truncated ? page.nextToken : '',
    };
  }
  const params = new URLSearchParams({ prefix, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`${BLOB_API}?${params}`, {
    headers: {
      authorization: `Bearer ${token()}`,
      'x-api-version': BLOB_VER,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || `blob list ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return {
    blobs: Array.isArray(data.blobs) ? data.blobs : [],
    hasMore: Boolean(data.hasMore),
    cursor: data.cursor || '',
  };
}

async function blobList(prefix) {
  const { blobs } = await blobListPage(prefix, { limit: 100 });
  return blobs;
}

async function blobListAll(prefix) {
  const out = [];
  let cursor = '';
  for (let guard = 0; guard < 50; guard++) {
    const page = await blobListPage(prefix, { limit: 1000, cursor });
    out.push(...page.blobs);
    if (!page.hasMore || !page.cursor) break;
    cursor = page.cursor;
  }
  return out;
}

async function blobDel(urlsOrKeys) {
  const list = Array.isArray(urlsOrKeys) ? urlsOrKeys : [urlsOrKeys];
  if (useR2()) {
    for (const item of list) {
      const key = String(item).startsWith('http') ? pathnameFromBlobUrl(item) : String(item);
      await r2DeleteObject(key);
    }
    return;
  }
  const urls = list.map((item) =>
    String(item).startsWith('http') ? String(item) : publicUrl(String(item)),
  );
  const res = await fetch(`${BLOB_API}/delete`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token()}`,
      'x-api-version': BLOB_VER,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ urls }),
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    const err = new Error(text || `blob del ${res.status}`);
    err.status = res.status;
    throw err;
  }
}

function userPrefix(username) {
  return `users/${username}/`;
}

function userLegacyPath(username) {
  return `users/${username}.json`;
}

function sessionPath(sess) {
  return `sessions/${sess}.json`;
}

function sessionDeadPath(sess) {
  return `sessions/dead/${sess}`;
}

async function loadUser(username) {
  const blobs = await blobList(userPrefix(username));
  if (blobs.length) {
    blobs.sort((a, b) => {
      const ta = new Date(a.uploadedAt || 0).getTime();
      const tb = new Date(b.uploadedAt || 0).getTime();
      return tb - ta;
    });
    const newest = blobs[0];
    return blobGetJsonFresh(newest.pathname);
  }
  // Legacy flat public file from first deploy
  return blobGetJsonFresh(userLegacyPath(username));
}

async function saveUser(username, data) {
  const pathname = `${userPrefix(username)}${Date.now()}-${randToken(4)}.json`;
  const put = await blobPut(pathname, JSON.stringify(data), {
    contentType: 'application/json',
  });
  // Best-effort prune in background — don't delay the response
  Promise.resolve().then(async () => {
    try {
      const blobs = await blobList(userPrefix(username));
      if (blobs.length > 5) {
        blobs.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
        const drop = blobs.slice(5).map((b) => b.pathname || b.url).filter(Boolean);
        if (drop.length) await blobDel(drop);
      }
    } catch (_) {}
  });
  return put;
}

async function createSession(username) {
  const sess = randToken(24);
  // Unique pathname → immediately readable. No exp: session lives until logout.
  await blobPut(
    sessionPath(sess),
    JSON.stringify({ user: username }),
    { contentType: 'application/json' },
  );
  return { token: sess };
}

async function loadSession(sess) {
  if (!sess || !/^[a-f0-9]{32,64}$/.test(sess)) return null;
  // Dead marker is a fresh pathname on logout → consistent
  try {
    if (useR2()) {
      if (await r2HeadObject(sessionDeadPath(sess))) return null;
    } else {
      const deadUrl = publicUrl(sessionDeadPath(sess)) + `?t=${Date.now()}`;
      const dead = await fetch(deadUrl, { cache: 'no-store', method: 'HEAD' });
      if (dead.ok) return null;
    }
  } catch (_) {}
  const data = await blobGetJsonFresh(sessionPath(sess));
  if (!data || !data.user) return null;
  // Ignore legacy exp field so existing logins also stop timing out.
  return data;
}

async function destroySession(sess) {
  if (!sess) return;
  try {
    await blobPut(sessionDeadPath(sess), '1', { contentType: 'text/plain' });
  } catch (_) {}
  try {
    await blobDel(sessionPath(sess));
  } catch (_) {}
}

function getSessionToken(req) {
  const cookies = parseCookies(req);
  if (cookies[COOKIE]) return cookies[COOKIE];
  const auth = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1].trim() : null;
}

async function requireUser(req) {
  const sess = getSessionToken(req);
  const session = await loadSession(sess);
  if (!session) {
    const err = new Error('未登录');
    err.status = 401;
    throw err;
  }
  const user = await loadUser(session.user);
  if (!user) {
    const err = new Error('用户不存在');
    err.status = 401;
    throw err;
  }
  return { username: session.user, user, sess };
}

function profile(username, user) {
  return {
    user: username,
    created: user.created || null,
    follows: Array.isArray(user.follows) ? user.follows : [],
    favorites: Array.isArray(user.favorites) ? user.favorites : [],
    uploads: Array.isArray(user.uploads) ? user.uploads : [],
    dislikes: Array.isArray(user.dislikes) ? user.dislikes : [],
    blocked_actresses: normBlockedActresses(user.blocked_actresses),
    viewed: normViewed(user.viewed),
  };
}

function sameOriginOk(req) {
  // Allow same-origin and missing Origin (curl / server-to-server).
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return true;
  try {
    const o = new URL(origin);
    return o.host === host;
  } catch {
    return false;
  }
}

module.exports = {
  SALT,
  COOKIE,
  MAX_UPLOAD,
  MAX_PER_CODE,
  hashPass,
  randToken,
  safeUser,
  safeCode,
  normCode,
  normDislikes,
  normBlockedActresses,
  normViewed,
  applyViewedOps,
  json,
  readBody,
  setSessionCookie,
  clearSessionCookie,
  blobPut,
  blobGetJsonFresh,
  blobList,
  blobListAll,
  blobDel,
  publicUrl,
  useR2,
  loadUser,
  saveUser,
  createSession,
  loadSession,
  destroySession,
  getSessionToken,
  requireUser,
  profile,
  sameOriginOk,
};

