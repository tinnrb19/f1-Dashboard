'use strict';
if (window.top !== window.self) { document.documentElement.innerHTML = ''; throw new Error('framed'); }   // กัน clickjacking

/* ------------------------------ config + Supabase (plain fetch, no library) ------------------------------ */
const CFG = window.F1_CLOUD || {};
const READY = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(CFG.url || '') && !!CFG.key && !/YOUR/i.test(CFG.key);
const BASE = READY ? CFG.url.replace(/\/$/, '') : '';
const SKEY = 'f1_admin_session';          // sessionStorage: หายเมื่อปิดแท็บ (ตั้งใจให้ปลอดภัยกว่า localStorage)
const TABS = ['overview', 'live', 'calendar', 'race', 'drivers', 'constructors', 'circuits', 'stats', 'f2', 'f3'];
const LEVELS = ['info', 'success', 'warn', 'alert'];
const MIN_PASSWORD = 10;
const DEFAULT_SETTINGS = {
  siteTitle: 'F1 Live Dashboard', accent: '#F5B700', highlightTeam: '', hiddenTabs: [],
  announcement: { enabled: false, text: '', level: 'info' }
};
let SESSION = null;

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
function httpError(status, msg) { const e = new Error(msg); e.status = status; return e; }
function loadSession() { try { SESSION = JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch (e) { SESSION = null; } }
function saveSession(s) { SESSION = s; try { if (s) sessionStorage.setItem(SKEY, JSON.stringify(s)); else sessionStorage.removeItem(SKEY); } catch (e) {} }

function thaiError(status, data) {
  const code = data && (data.error_code || data.code);
  const msg = (data && (data.msg || data.message || data.error_description || data.error)) || '';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
  if (status === 429 || code === 'over_request_rate_limit') return 'ลองหลายครั้งเกินไป รอสักครู่แล้วลองใหม่';
  if (code === 'same_password') return 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม';
  if (code === 'weak_password') return 'รหัสผ่านใหม่ไม่ปลอดภัยพอ (ลองให้ยาวและสุ่มกว่านี้)';
  if (status === 401 || code === 'PGRST301' || /jwt expired/i.test(msg)) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
  if (status === 403 || code === '42501') return 'ไม่มีสิทธิ์ทำรายการนี้ (บัญชีนี้ไม่ใช่แอดมิน?)';
  return msg || ('HTTP ' + status);
}
async function sb(path, { method = 'GET', body, token, headers = {} } = {}) {
  const h = { apikey: CFG.key, ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const bearer = token || (CFG.key.startsWith('eyJ') ? CFG.key : null);
  if (bearer) h.Authorization = 'Bearer ' + bearer;
  let res;
  try { res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (e) { throw httpError(0, 'เชื่อมต่อ Supabase ไม่ได้ (เช็คอินเทอร์เน็ต / ค่าใน config.js)'); }
  let data = null;
  try { const t = await res.text(); data = t ? JSON.parse(t) : null; } catch (e) {}
  if (!res.ok) throw httpError(res.status, thaiError(res.status, data));
  return data;
}
function toSession(d) {
  return { access_token: d.access_token, refresh_token: d.refresh_token,
    expires_at: d.expires_at || (Math.floor(Date.now() / 1000) + (d.expires_in || 3600)),
    email: d.user && d.user.email, uid: d.user && d.user.id };
}
async function ensureFresh() {
  if (!SESSION) throw httpError(401, 'ยังไม่ได้เข้าสู่ระบบ');
  if (SESSION.expires_at - 60 > Date.now() / 1000) return;
  try { saveSession(toSession(await sb('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: SESSION.refresh_token } }))); }
  catch (e) { saveSession(null); throw httpError(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); }
}
async function authed(path, opts = {}) {
  await ensureFresh();
  try { return await sb(path, { ...opts, token: SESSION.access_token }); }
  catch (e) { if (e.status === 401) saveSession(null); throw e; }
}
async function getCfg(key, fallback) {
  const rows = await authed(`/rest/v1/site_config?key=eq.${encodeURIComponent(key)}&select=value`);
  return rows && rows[0] ? rows[0].value : fallback;
}
async function setCfg(key, value) {
  await authed('/rest/v1/site_config', { method: 'POST', body: { key, value, updated_at: new Date().toISOString() },
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
}
async function audit(action, detail) {
  try { await authed('/rest/v1/audit_log', { method: 'POST', body: { username: SESSION && SESSION.email, action, detail: clean(detail, 300) }, headers: { Prefer: 'return=minimal' } }); } catch (e) {}
}

/* ------------------------------ validation (same rules as before) ------------------------------ */
function validateSettings(b) {
  const accent = clean(b.accent, 7), a = b.announcement || {};
  const s = {
    siteTitle: clean(b.siteTitle, 60) || DEFAULT_SETTINGS.siteTitle,
    accent: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : DEFAULT_SETTINGS.accent,
    highlightTeam: clean(b.highlightTeam, 40),
    hiddenTabs: Array.isArray(b.hiddenTabs) ? [...new Set(b.hiddenTabs.filter((t) => TABS.includes(t) && t !== 'overview'))] : [],
    announcement: { enabled: !!a.enabled, text: clean(a.text, 300), level: LEVELS.includes(a.level) ? a.level : 'info' }
  };
  if (s.announcement.enabled && !s.announcement.text) throw httpError(400, 'เปิดประกาศแล้วต้องกรอกข้อความ');
  return s;
}
function validateNews(b) {
  const title = clean(b.title, 120);
  if (!title) throw httpError(400, 'ต้องมีหัวข้อข่าว');
  return { title, body: clean(b.body, 1500), tag: clean(b.tag, 24) || 'News',
    date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : new Date().toISOString().slice(0, 10), pinned: !!b.pinned };
}
function validateOverride(b) {
  const year = parseInt(b.year, 10);
  if (!(year >= 2000 && year <= 2100)) throw httpError(400, 'ปีไม่ถูกต้อง');
  if (!Array.isArray(b.rows) || b.rows.length > 60) throw httpError(400, 'ตารางต้องมี 1–60 แถว');
  const rows = b.rows.map((r) => ({ driver: clean(r && r.driver, 60), points: Number(r && r.points) }))
    .filter((r) => r.driver && Number.isFinite(r.points) && r.points >= 0 && r.points <= 10000);
  if (!rows.length) throw httpError(400, 'ไม่มีแถวที่ใช้ได้ (ชื่อ + คะแนน)');
  return { year, rows, updatedAt: new Date().toISOString() };
}

/* ------------------------------ admin "API" (same route names the UI already uses) ------------------------------ */
async function doLogin(username, password) {
  if (!READY) throw httpError(503, 'ยังไม่ได้ตั้งค่า config.js (ดู SETUP.md)');
  const email = String(username || '').trim();
  if (!email.includes('@')) throw httpError(400, 'Username คืออีเมลที่สร้างไว้ใน Supabase (เช่น name@gmail.com)');
  let d;
  try { d = await sb('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: String(password || '') } }); }
  catch (e) { await new Promise((r) => setTimeout(r, 600)); throw e; }
  const s = toSession(d);
  const rows = await sb('/rest/v1/admins?select=user_id', { token: s.access_token });
  if (!rows || !rows.length) {
    try { await sb('/auth/v1/logout', { method: 'POST', token: s.access_token }); } catch (e) {}
    throw httpError(403, 'บัญชีนี้ล็อกอินได้ แต่ยังไม่ได้เป็นแอดมิน (ดูขั้นตอนที่ 7 ใน supabase/setup.sql)');
  }
  saveSession(s);
  await audit('login', 'เข้าสู่ระบบสำเร็จ');
  return { ok: true, user: s.email };
}

async function dump() {
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const [cfg, rows, log, user] = await Promise.all([
    authed('/rest/v1/site_config?select=key,value'),
    authed(`/rest/v1/page_stats?select=day,tab,views,visits&day=gte.${since}&order=day.asc&limit=5000`),
    authed('/rest/v1/audit_log?select=ts,username,action,detail&order=ts.desc&limit=500'),
    authed('/auth/v1/user')
  ]);
  const by = {}; (cfg || []).forEach((r) => { by[r.key] = r.value; });
  const stats = {};
  (rows || []).forEach((r) => {
    const s = stats[r.day] || (stats[r.day] = { views: 0, visits: 0, tabs: {} });
    s.views += r.views; s.visits += r.visits; s.tabs[r.tab] = (s.tabs[r.tab] || 0) + r.views;
  });
  const st = by.settings || {};
  return {
    settings: { ...DEFAULT_SETTINGS, ...st, announcement: { ...DEFAULT_SETTINGS.announcement, ...(st.announcement || {}) },
      hiddenTabs: Array.isArray(st.hiddenTabs) ? st.hiddenTabs : [] },
    news: Array.isArray(by.news) ? by.news : [],
    overrides: by.overrides || {},
    stats,
    audit: (log || []).map((a) => ({ ts: a.ts, user: a.username || '-', action: a.action, detail: a.detail || '' })),
    account: { username: user && user.email, lastSignIn: user && user.last_sign_in_at, updatedAt: user && user.updated_at },
    runtime: { tabs: TABS, now: new Date().toISOString(), minPassword: MIN_PASSWORD, backend: BASE.replace('https://', '') }
  };
}

async function adminApi(method, seg, body) {
  const [, a, id] = seg, nowIso = new Date().toISOString();
  if (a === 'dump' && method === 'GET') return dump();
  if (a === 'settings' && method === 'PUT') {
    const s = validateSettings(body || {});
    await setCfg('settings', s);
    await audit('settings_update', `title="${s.siteTitle}" hidden=[${s.hiddenTabs}] banner=${s.announcement.enabled}`);
    return s;
  }
  if (a === 'news') {
    const list = (await getCfg('news', [])) || [];
    if (method === 'POST' && !id) {
      const item = { id: uuid(), ...validateNews(body || {}), createdAt: nowIso };
      list.unshift(item); if (list.length > 200) list.length = 200;
      await setCfg('news', list); await audit('news_create', item.title); return item;
    }
    if (method === 'PUT' && id) {
      const i = list.findIndex((n) => n.id === id);
      if (i < 0) throw httpError(404, 'ไม่พบข่าวนี้');
      list[i] = { ...list[i], ...validateNews(body || {}), updatedAt: nowIso };
      await setCfg('news', list); await audit('news_update', list[i].title); return list[i];
    }
    if (method === 'DELETE' && id) {
      const i = list.findIndex((n) => n.id === id);
      if (i < 0) throw httpError(404, 'ไม่พบข่าวนี้');
      const [gone] = list.splice(i, 1);
      await setCfg('news', list); await audit('news_delete', gone.title); return { ok: true };
    }
    throw httpError(405, 'ไม่รองรับ');
  }
  if (a === 'overrides' && (id === 'f2' || id === 'f3')) {
    const ov = (await getCfg('overrides', {})) || {};
    if (method === 'PUT') { ov[id] = validateOverride(body || {}); await audit('override_set', `${id} ${ov[id].year} (${ov[id].rows.length} แถว)`); }
    else if (method === 'DELETE') { delete ov[id]; await audit('override_clear', id); }
    else throw httpError(405, 'ไม่รองรับ');
    await setCfg('overrides', ov);
    return ov;
  }
  if (a === 'password' && method === 'POST') {
    const cur = String((body || {}).currentPassword || ''), nw = String((body || {}).newPassword || '');
    if (nw.length < MIN_PASSWORD) throw httpError(400, `รหัสผ่านใหม่ต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัวอักษร`);
    if (nw === cur) throw httpError(400, 'รหัสผ่านใหม่ต้องต่างจากรหัสเดิม');
    let d;
    try { d = await sb('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: SESSION.email, password: cur } }); }
    catch (e) {
      if (e.status === 400) { await audit('password_failed', 'รหัสผ่านปัจจุบันไม่ถูกต้อง'); throw httpError(403, 'รหัสผ่านปัจจุบันไม่ถูกต้อง'); }
      throw e;
    }
    const fresh = toSession(d); saveSession(fresh);
    await sb('/auth/v1/user', { method: 'PUT', token: fresh.access_token, body: { password: nw } });
    try { await sb('/auth/v1/logout?scope=others', { method: 'POST', token: fresh.access_token }); } catch (e) {}
    await audit('password_update', 'เปลี่ยนรหัสผ่านแอดมิน');
    return { ok: true };
  }
  if (a === 'revoke' && method === 'POST') {
    await authed('/auth/v1/logout?scope=others', { method: 'POST' });
    await audit('revoke_sessions', 'ออกจากระบบอุปกรณ์อื่นทั้งหมด');
    return { ok: true };
  }
  throw httpError(404, 'ไม่พบ endpoint');
}

async function api(method, path, body) {
  if (path === '/me') {
    loadSession();
    if (!SESSION) throw httpError(401, 'ยังไม่ได้เข้าสู่ระบบ');
    await ensureFresh();
    return { user: SESSION.email };
  }
  if (path === '/login') return doLogin(body && body.username, body && body.password);
  if (path === '/logout') {
    try { if (SESSION) await sb('/auth/v1/logout', { method: 'POST', token: SESSION.access_token }); } catch (e) {}
    saveSession(null); return { ok: true };
  }
  const seg = path.replace(/^\//, '').split('/');
  if (seg[0] === 'admin') return adminApi(method, seg, body);
  throw httpError(404, 'ไม่พบ endpoint');
}

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const TAB_LABELS = { overview:'Overview', live:'Live Timing', calendar:'Calendar', race:'Race Center', drivers:'Drivers', constructors:'Constructors', circuits:'Circuits', stats:'Stats', f2:'F2', f3:'F3' };
const SECTIONS = [['dashboard','แดชบอร์ด'],['settings','ประกาศ & ตั้งค่า'],['news','ข่าว'],['series','F2 / F3'],['security','ความปลอดภัย'],['data','ข้อมูลทั้งหมด']];
let D = null, USER = '', SECTION = 'dashboard', EDITING = null;

function toast(msg, kind = 'good') {
  const t = $('#toast'); t.textContent = msg; t.className = kind; clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}
async function guard(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { if (e.status === 401) { boot(); } else toast(e.message, 'bad'); }
  finally { if (btn) btn.disabled = false; }
}

/* ------------------------------ boot / login ------------------------------ */
async function boot() {
  if (!READY) {
    $('#app').innerHTML = `<div class="login-wrap"><div class="login-card"><div class="brand">F1 <span style="color:var(--yellow)">Admin</span></div>
      <p class="err">ยังไม่ได้ตั้งค่า <code>config.js</code></p>
      <p class="muted">ใส่ Project URL และ anon/publishable key จาก Supabase ลงในไฟล์ config.js แล้วอัปโหลดใหม่ (ดูขั้นตอนใน SETUP.md)</p></div></div>`;
    return;
  }
  try {
    const me = await api('GET', '/me');
    USER = me.user;
    D = await api('GET', '/admin/dump');
    shell();
  } catch (e) {
    if (e.status === 401) loginView();
    else {
      $('#app').innerHTML = `<div class="login-wrap"><div class="login-card"><div class="brand">F1 Admin</div>
        <p class="err">โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}</p>
        <p class="muted">ถ้าเพิ่งตั้งค่า ให้เช็คว่ารัน supabase/setup.sql แล้ว และบัญชีนี้ถูกเพิ่มเป็นแอดมิน</p>
        <button class="btn" id="retry">ลองใหม่</button> <button class="btn ghost" id="to-login">กลับหน้าล็อกอิน</button></div></div>`;
      $('#retry').addEventListener('click', boot);
      $('#to-login').addEventListener('click', () => { saveSession(null); boot(); });
    }
  }
}
function loginView() {
  $('#app').innerHTML = `<div class="login-wrap"><form class="login-card" id="login-form" autocomplete="on">
    <div class="brand">F1 <span style="color:var(--yellow)">Admin</span></div>
    <div class="sub">ระบบหลังบ้าน · เข้าสู่ระบบเพื่อจัดการเว็บไซต์</div>
    <label for="u">Username (อีเมลแอดมิน)</label><input type="text" id="u" name="username" autocomplete="username" required>
    <label for="p">Password</label><input type="password" id="p" name="password" autocomplete="current-password" required>
    <p class="err" id="login-err"></p>
    <button class="btn" style="width:100%" type="submit">เข้าสู่ระบบ</button></form></div>`;
  $('#login-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const btn = $('#login-form button'); btn.disabled = true; $('#login-err').textContent = '';
    api('POST', '/login', { username: $('#u').value, password: $('#p').value })
      .then(boot)
      .catch((e) => { $('#login-err').textContent = e.message; btn.disabled = false; $('#p').value = ''; });
  });
}

/* ------------------------------ shell ------------------------------ */
function shell() {
  $('#app').innerHTML = `
    <header class="bar"><div class="brand">F1 <b>Admin</b></div>
      <div class="who"><span>👤 ${esc(USER)}</span><a class="muted" href="./" target="_blank" rel="noopener">เปิดเว็บ ↗</a>
      <button class="btn ghost sm" id="logout">ออกจากระบบ</button></div></header>
    <nav class="tabs" id="tabs">${SECTIONS.map(([k, l]) => `<button data-s="${k}" class="${k === SECTION ? 'on' : ''}">${l}</button>`).join('')}</nav>
    <main id="view"></main>`;
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-s]'); if (!b) return;
    SECTION = b.dataset.s; EDITING = null;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    render();
  });
  $('#logout').addEventListener('click', () => guard($('#logout'), async () => { await api('POST', '/logout', {}); boot(); }));
  render();
}
async function refresh() { D = await api('GET', '/admin/dump'); render(); }
function render() { ({ dashboard, settings, news, series, security, data })[SECTION](); }
const view = () => $('#view');

/* ------------------------------ dashboard ------------------------------ */
function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    out.push({ day: d, ...(D.stats[d] || { views: 0, visits: 0, tabs: {} }) });
  }
  return out;
}
function dashboard() {
  const days = lastDays(14), all = Object.values(D.stats);
  const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);
  const max = Math.max(1, ...days.map((d) => d.views));
  const tabTotals = {};
  all.forEach((s) => Object.entries(s.tabs || {}).forEach(([t, n]) => { tabTotals[t] = (tabTotals[t] || 0) + n; }));
  const tabRows = Object.entries(tabTotals).sort((a, b) => b[1] - a[1]);
  const lastLogin = D.audit.find((a) => a.action === 'login');
  const s = D.settings;
  view().innerHTML = `
    <div class="grid4">
      <div class="stat"><div class="v">${sum(all, 'visits')}</div><div class="l">การเข้าชม (visits)</div></div>
      <div class="stat"><div class="v">${sum(all, 'views')}</div><div class="l">ยอดเปิดหน้า (views)</div></div>
      <div class="stat"><div class="v">${D.news.length}</div><div class="l">ข่าวทั้งหมด</div></div>
      <div class="stat"><div class="v">${s.hiddenTabs.length}</div><div class="l">แท็บที่ซ่อน</div></div>
    </div>
    <div class="card"><h2>ยอดเปิดหน้า 14 วันล่าสุด <small>ไม่เก็บ IP / ข้อมูลส่วนตัวของผู้เข้าชม</small></h2>
      <div class="chart">${days.map((d) => `<div class="col" title="${esc(d.day)}: ${d.views} views, ${d.visits} visits"><div class="bar" style="height:${Math.round(d.views / max * 100)}%"></div><div class="d">${esc(d.day.slice(5))}</div></div>`).join('')}</div></div>
    <div class="row">
      <div class="card"><h2>หน้าที่คนเปิดมากสุด</h2>${tabRows.length ? `<table><tbody>${tabRows.map(([t, n]) => `<tr><td>${esc(TAB_LABELS[t] || t)}</td><td class="num">${n}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">ยังไม่มีข้อมูล</p>'}</div>
      <div class="card"><h2>สถานะเว็บ</h2><table><tbody>
        <tr><td>ประกาศหน้าเว็บ</td><td class="num"><span class="pill ${s.announcement.enabled ? 'on' : ''}">${s.announcement.enabled ? 'เปิดอยู่' : 'ปิด'}</span></td></tr>
        <tr><td>ชื่อเว็บ</td><td class="num">${esc(s.siteTitle)}</td></tr>
        <tr><td>ทีมที่ไฮไลต์</td><td class="num">${esc(s.highlightTeam || 'Red Bull (ค่าเริ่มต้น)')}</td></tr>
        <tr><td>F2 / F3 กรอกเอง</td><td class="num">${['f2', 'f3'].filter((k) => D.overrides[k]).map((k) => k.toUpperCase()).join(', ') || '-'}</td></tr>
        <tr><td>เข้าสู่ระบบล่าสุด</td><td class="num">${lastLogin ? esc(lastLogin.ts.replace('T', ' ').slice(0, 16)) + ' UTC' : '-'}</td></tr></tbody></table></div>
    </div>
    <div class="card"><h2>กิจกรรมล่าสุด <small>ดูทั้งหมดที่แท็บ "ความปลอดภัย"</small></h2>${auditTable(D.audit.slice(0, 6))}</div>`;
}
function auditTable(rows) {
  if (!rows.length) return '<p class="muted">ยังไม่มีบันทึก</p>';
  return `<div style="overflow:auto"><table><thead><tr><th>เวลา (UTC)</th><th>ผู้ใช้</th><th>การกระทำ</th><th>รายละเอียด</th></tr></thead><tbody>${rows.map((a) =>
    `<tr><td>${esc(a.ts.replace('T', ' ').slice(0, 19))}</td><td>${esc(a.user)}</td><td><span class="pill ${a.action.includes('fail') ? '' : 'on'}">${esc(a.action)}</span></td><td>${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ------------------------------ settings ------------------------------ */
function settings() {
  const s = D.settings;
  view().innerHTML = `<form class="card" id="f-settings"><h2>ประกาศบนหน้าเว็บ</h2>
      <label class="check"><input type="checkbox" id="a-on" ${s.announcement.enabled ? 'checked' : ''}> แสดงประกาศ (banner) ที่ด้านบนของเว็บ</label>
      <label>ข้อความ (ไม่เกิน 300 ตัวอักษร)</label><textarea id="a-text" maxlength="300">${esc(s.announcement.text)}</textarea>
      <label>ระดับ</label><select id="a-level">${[['info', 'ข้อมูล (น้ำเงิน)'], ['success', 'ข่าวดี (เขียว)'], ['warn', 'เตือน (เหลือง)'], ['alert', 'สำคัญ (แดง)']].map(([v, l]) => `<option value="${v}" ${s.announcement.level === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <h2 style="margin-top:22px">ตั้งค่าเว็บ</h2>
      <div class="row"><div><label>ชื่อเว็บ (แสดงบนแท็บเบราว์เซอร์)</label><input type="text" id="s-title" maxlength="60" value="${esc(s.siteTitle)}"></div>
      <div><label>สีหลัก (accent)</label><input type="text" id="s-accent" maxlength="7" value="${esc(s.accent)}" placeholder="#F5B700"></div></div>
      <label>ทีมที่ไฮไลต์ในตาราง (ชื่อทีมตาม API เช่น Ferrari, McLaren — เว้นว่าง = Red Bull)</label><input type="text" id="s-team" maxlength="40" value="${esc(s.highlightTeam)}">
      <label>ซ่อนแท็บเหล่านี้จากผู้เข้าชม</label>
      <div class="row">${D.runtime.tabs.filter((t) => t !== 'overview').map((t) => `<label class="check"><input type="checkbox" class="s-hide" value="${t}" ${s.hiddenTabs.includes(t) ? 'checked' : ''}> ${esc(TAB_LABELS[t] || t)}</label>`).join('')}</div>
      <button class="btn" type="submit">บันทึก</button></form>`;
  $('#f-settings').addEventListener('submit', (ev) => {
    ev.preventDefault();
    guard($('#f-settings .btn'), async () => {
      await api('PUT', '/admin/settings', {
        siteTitle: $('#s-title').value, accent: $('#s-accent').value, highlightTeam: $('#s-team').value,
        hiddenTabs: [...document.querySelectorAll('.s-hide:checked')].map((x) => x.value),
        announcement: { enabled: $('#a-on').checked, text: $('#a-text').value, level: $('#a-level').value }
      });
      toast('บันทึกแล้ว (ผู้เข้าชมเห็นทันทีที่รีเฟรชหน้าเว็บ)'); await refresh();
    });
  });
}

/* ------------------------------ news ------------------------------ */
function news() {
  const e = EDITING ? D.news.find((n) => n.id === EDITING) : null;
  view().innerHTML = `
    <form class="card" id="f-news"><h2>${e ? 'แก้ไขข่าว' : 'เพิ่มข่าว / สถิติ'} <small>แสดงที่หน้า Overview</small></h2>
      <label>หัวข้อ</label><input type="text" id="n-title" maxlength="120" required value="${esc(e ? e.title : '')}">
      <label>รายละเอียด</label><textarea id="n-body" maxlength="1500">${esc(e ? e.body : '')}</textarea>
      <div class="row"><div><label>แท็ก (Race, Driver, Team ...)</label><input type="text" id="n-tag" maxlength="24" value="${esc(e ? e.tag : 'News')}"></div>
      <div><label>วันที่</label><input type="date" id="n-date" value="${esc(e ? e.date : new Date().toISOString().slice(0, 10))}"></div></div>
      <label class="check"><input type="checkbox" id="n-pin" ${e && e.pinned ? 'checked' : ''}> 📌 ปักหมุดไว้บนสุด</label>
      <div class="btns"><button class="btn" type="submit">${e ? 'บันทึกการแก้ไข' : 'เพิ่มข่าว'}</button>${e ? '<button class="btn ghost" type="button" id="n-cancel">ยกเลิก</button>' : ''}</div></form>
    <div class="card"><h2>ข่าวทั้งหมด <small>${D.news.length} รายการ</small></h2>
      ${D.news.length ? `<table><tbody>${D.news.map((n) => `<tr class="news-row"><td><div class="t">${n.pinned ? '📌 ' : ''}${esc(n.title)}</div><div class="b">${esc(n.tag)} · ${esc(n.date)}${n.body ? ' — ' + esc(n.body.slice(0, 110)) + (n.body.length > 110 ? '…' : '') : ''}</div></td>
        <td class="num" style="white-space:nowrap"><button class="btn ghost sm" data-edit="${esc(n.id)}">แก้ไข</button> <button class="btn danger sm" data-del="${esc(n.id)}">ลบ</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">ยังไม่มีข่าว</p>'}</div>`;
  $('#f-news').addEventListener('submit', (ev) => {
    ev.preventDefault();
    guard($('#f-news button[type=submit]'), async () => {
      const body = { title: $('#n-title').value, body: $('#n-body').value, tag: $('#n-tag').value, date: $('#n-date').value, pinned: $('#n-pin').checked };
      if (e) await api('PUT', '/admin/news/' + encodeURIComponent(e.id), body); else await api('POST', '/admin/news', body);
      EDITING = null; toast('บันทึกแล้ว'); await refresh();
    });
  });
  const c = $('#n-cancel'); if (c) c.addEventListener('click', () => { EDITING = null; news(); });
  document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => { EDITING = b.dataset.edit; news(); window.scrollTo({ top: 0 }); }));
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    if (confirm('ลบข่าวนี้?')) guard(b, async () => { await api('DELETE', '/admin/news/' + encodeURIComponent(b.dataset.del)); toast('ลบแล้ว'); await refresh(); });
  }));
}

/* ------------------------------ F2 / F3 override ------------------------------ */
function parseRows(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.*?)[\s,;\t]+(\d+(?:\.\d+)?)$/);
    return m ? { driver: m[1].replace(/[,;\t]+$/, '').trim(), points: Number(m[2]) } : null;
  });
}
function series() {
  const year = new Date().getFullYear();
  view().innerHTML = `<p class="muted" style="margin-top:0">ถ้าตารางที่ดึงจาก Wikipedia ไม่ขึ้นหรือไม่อัปเดต กรอกคะแนนเองที่นี่ได้ ข้อมูลที่กรอกจะถูกใช้แทน (เฉพาะปีที่ระบุ) พิมพ์บรรทัดละ 1 คน: <b>ชื่อ, คะแนน</b></p>` +
    ['f2', 'f3'].map((k) => {
      const ov = D.overrides[k];
      return `<form class="card" data-k="${k}"><h2>Formula ${k.slice(1)} <small>${ov ? 'กรอกเองอยู่ · อัปเดต ' + esc(ov.updatedAt.slice(0, 10)) : 'ใช้ข้อมูลอัตโนมัติ'}</small></h2>
        <div class="row"><div><label>ปี</label><input type="number" class="o-year" min="2000" max="2100" value="${ov ? ov.year : year}"></div><div></div></div>
        <label>ตาราง (ชื่อ, คะแนน)</label><textarea class="o-rows" style="min-height:160px" placeholder="Leonardo Fornaroli, 175&#10;Gabriele Mini, 150">${ov ? esc(ov.rows.map((r) => r.driver + ', ' + r.points).join('\n')) : ''}</textarea>
        <div class="btns"><button class="btn" type="submit">บันทึก</button>${ov ? '<button class="btn danger" type="button" data-clear="' + k + '">ล้าง (กลับไปใช้อัตโนมัติ)</button>' : ''}</div></form>`;
    }).join('');
  document.querySelectorAll('form[data-k]').forEach((f) => f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const k = f.dataset.k, parsed = parseRows($('.o-rows', f).value), bad = parsed.findIndex((r) => !r);
    if (bad >= 0) return toast(`บรรทัดที่ ${bad + 1} รูปแบบไม่ถูกต้อง (ต้องเป็น "ชื่อ, คะแนน")`, 'bad');
    guard($('.btn', f), async () => { await api('PUT', '/admin/overrides/' + k, { year: $('.o-year', f).value, rows: parsed }); toast('บันทึกแล้ว'); await refresh(); });
  }));
  document.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () =>
    confirm('ล้างข้อมูลที่กรอกเอง?') && guard(b, async () => { await api('DELETE', '/admin/overrides/' + b.dataset.clear); toast('ล้างแล้ว'); await refresh(); })));
}

/* ------------------------------ security ------------------------------ */
function security() {
  const a = D.account;
  view().innerHTML = `
    <form class="card" id="f-cred"><h2>เปลี่ยนรหัสผ่าน <small>Username (อีเมล): ${esc(a.username)}</small></h2>
      <label>รหัสผ่านปัจจุบัน *</label><input type="password" id="c-cur" autocomplete="current-password" required>
      <div class="row"><div><label>รหัสผ่านใหม่ (อย่างน้อย ${D.runtime.minPassword} ตัว)</label><input type="password" id="c-new" autocomplete="new-password" required></div>
      <div><label>ยืนยันรหัสผ่านใหม่</label><input type="password" id="c-new2" autocomplete="new-password" required></div></div>
      <p class="muted">เมื่อบันทึก อุปกรณ์อื่นที่ล็อกอินอยู่จะถูกออกจากระบบ · รหัสผ่านเก็บแบบแฮชโดย Supabase</p>
      <p class="muted">จะเปลี่ยน Username (อีเมล) ให้ไปที่ Supabase → Authentication → Users</p>
      <button class="btn" type="submit">บันทึก</button></form>
    <div class="card"><h2>เซสชัน <small>เข้าสู่ระบบล่าสุด: ${esc(a.lastSignIn ? String(a.lastSignIn).replace('T', ' ').slice(0, 16) + ' UTC' : '-')}</small></h2>
      <p class="muted" style="margin-top:0">ออกจากระบบทุกอุปกรณ์ที่เคยล็อกอินไว้ (เหลือเฉพาะเครื่องนี้)</p>
      <button class="btn danger" id="revoke">ออกจากระบบอุปกรณ์อื่นทั้งหมด</button></div>
    <div class="card"><h2>บันทึกกิจกรรม (Audit log) <small>${D.audit.length} รายการล่าสุด</small></h2>${auditTable(D.audit)}
      <p class="muted" style="margin-bottom:0">การล็อกอินที่ผิดพลาดดูได้ที่ Supabase → Authentication → Logs</p></div>`;
  $('#f-cred').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if ($('#c-new').value !== $('#c-new2').value) return toast('รหัสผ่านใหม่ไม่ตรงกัน', 'bad');
    guard($('#f-cred .btn'), async () => {
      await api('POST', '/admin/password', { currentPassword: $('#c-cur').value, newPassword: $('#c-new').value });
      toast('เปลี่ยนรหัสผ่านแล้ว'); await refresh();
    });
  });
  $('#revoke').addEventListener('click', () => confirm('ออกจากระบบอุปกรณ์อื่นทั้งหมด?') && guard($('#revoke'), async () => { await api('POST', '/admin/revoke', {}); toast('เรียบร้อย'); await refresh(); }));
}

/* ------------------------------ raw data ------------------------------ */
function data() {
  const text = JSON.stringify(D, null, 2);
  view().innerHTML = `<div class="card"><h2>ข้อมูลทั้งหมดในระบบ <small>ไม่มีรหัสผ่าน/โทเคนอยู่ในข้อมูลนี้</small></h2>
    <div class="btns" style="margin:0 0 12px"><button class="btn ghost sm" id="dl">⬇ ดาวน์โหลด JSON</button><button class="btn ghost sm" id="cp">คัดลอก</button></div>
    <pre class="raw" id="raw"></pre></div>`;
  $('#raw').textContent = text;
  $('#dl').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'f1-admin-export-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
  });
  $('#cp').addEventListener('click', () => navigator.clipboard.writeText(text).then(() => toast('คัดลอกแล้ว'), () => toast('คัดลอกไม่ได้', 'bad')));
}

boot();
