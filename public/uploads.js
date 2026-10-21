/* Cloud screenshot uploads via /api/upload (stored on Vercel Blob). */
const Uploads = (() => {
  const MAX_BYTES = 3 * 1024 * 1024; // match API limit

  function readFileAsDataURL(file, onPct) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || '')) {
        reject(new Error('仅支持图片文件'));
        return;
      }
      if (file.size > MAX_BYTES) {
        reject(new Error('单张不超过 3MB'));
        return;
      }
      const fr = new FileReader();
      fr.onprogress = (e) => {
        if (e.lengthComputable && onPct) onPct(Math.round((100 * e.loaded) / e.total));
      };
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('读取失败'));
      fr.readAsDataURL(file);
    });
  }

  function applyProfile(profile) {
    if (!profile) return;
    try {
      localStorage.setItem('jav_profile_v1', JSON.stringify(profile));
      if (profile.user) localStorage.setItem('jav_session_v1', profile.user);
      if (Array.isArray(profile.follows)) {
        localStorage.setItem(`jav_u_${profile.user}_follows`, JSON.stringify(profile.follows));
      }
      if (Array.isArray(profile.favorites)) {
        localStorage.setItem(`jav_u_${profile.user}_favorites`, JSON.stringify(profile.favorites));
      }
    } catch (_) {}
  }

  function uploadDataUrl(code, dataUrl, onPct) {
    return new Promise((resolve, reject) => {
      const t = Auth.getToken && Auth.getToken();
      if (!t) {
        reject(new Error('请先登录'));
        return;
      }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Authorization', 'Bearer ' + t);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onPct) onPct(Math.round((100 * e.loaded) / e.total));
      };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error((data && data.error) || ('上传失败 ' + xhr.status)));
      };
      xhr.onerror = () => reject(new Error('网络错误，上传失败'));
      xhr.send(JSON.stringify({ code, dataUrl }));
    });
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    const t = Auth.getToken && Auth.getToken();
    if (t) headers.Authorization = 'Bearer ' + t;
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, Object.assign({}, opts, { headers, credentials: 'same-origin' }));
    let data = null;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) throw new Error((data && data.error) || ('上传失败 ' + res.status));
    return data;
  }

  async function list(user, code) {
    if (!user || !code) return [];
    code = String(code).toUpperCase();
    let uploads = (Auth.uploads && Auth.uploads()) || [];
    // Refresh once if cache empty so reload can see cloud shots
    if (!uploads.length && Auth.getToken && Auth.getToken() && Auth.refresh) {
      try {
        const p = await Auth.refresh();
        if (p && Array.isArray(p.uploads)) uploads = p.uploads;
        else uploads = (Auth.uploads && Auth.uploads()) || [];
      } catch (_) {}
    }
    return uploads
      .filter(u => String(u.code).toUpperCase() === code)
      .sort((a, b) => (a.ts || 0) - (b.ts || 0))
      .map(u => ({
        id: u.id,
        src: u.url || u.src || u.dataUrl,
        url: u.url || u.src || u.dataUrl,
        dataUrl: u.dataUrl,
        kind: 'mine',
        ts: u.ts,
        name: u.name || '',
      }));
  }

  async function addFiles(user, code, fileList, opts = {}) {
    if (!user) throw new Error('请先登录');
    code = String(code || '').toUpperCase();
    const files = [...(fileList || [])].filter(f => /^image\//.test(f.type || ''));
    if (!files.length) throw new Error('请选择图片');
    const onProgress = opts.onProgress || (() => {});
    const total = files.length;
    const added = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const index = i + 1;
      onProgress({
        index, total, done: i, percent: Math.round((100 * i) / total),
        message: `读取 ${index}/${total}…`,
      });
      const dataUrl = await readFileAsDataURL(f, (rp) => {
        const base = (100 * i) / total;
        const slice = 40 / total; // read = 40% of each file slot
        onProgress({
          index, total, done: i,
          percent: Math.round(base + (slice * rp) / 100),
          message: `读取 ${index}/${total} ${rp}%`,
        });
      });
      onProgress({
        index, total, done: i,
        percent: Math.round((100 * i) / total + 40 / total),
        message: `上传 ${index}/${total}…`,
      });
      const data = await uploadDataUrl(code, dataUrl, (up) => {
        const base = (100 * i) / total + 40 / total;
        const slice = 60 / total;
        onProgress({
          index, total, done: i,
          percent: Math.round(base + (slice * up) / 100),
          message: `上传 ${index}/${total} ${up}%`,
        });
      });
      if (data.profile) applyProfile(data.profile);
      if (data.shot) {
        added.push({
          id: data.shot.id,
          src: data.shot.url,
          url: data.shot.url,
          kind: 'mine',
          ts: data.shot.ts,
        });
      }
      onProgress({
        index, total, done: index,
        percent: Math.round((100 * index) / total),
        message: `完成 ${index}/${total}`,
      });
    }
    return added;
  }

  async function remove(id) {
    if (!id) return;
    const data = await api('/api/upload?id=' + encodeURIComponent(id), { method: 'DELETE' });
    if (data.profile) applyProfile(data.profile);
  }

  return { list, addFiles, remove };
})();
