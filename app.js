/* ============================================================
   IMPERIAL — cliente multijugador (Supabase)
   ============================================================ */

const SUPABASE_URL = 'https://qomhtzmjtbfktwnqysqw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvbWh0em1qdGJma3R3bnF5c3F3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNTgyMTYsImV4cCI6MjEwOTczNDIxNn0.rbgS_kHwuw6gToBg4ncX04rCWsP8YNNkqv0uiSamya4';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ------------------------- datos del juego ------------------------- */

const RACES = {
  horda:   { n:'Horda',   e:'🔥', atk:1.25, def:1.0,  gat:0.8, d:'Fuerte en combate, recolecta menos' },
  alianza: { n:'Alianza', e:'🦁', atk:1.0,  def:1.0,  gat:1.0, d:'Balanceada en todo' },
  enanos:  { n:'Enanos',  e:'⛏️', atk:0.8,  def:0.95, gat:1.3, d:'Débiles en combate, recolectan más' }
};
const RES = { food:['🌾','Comida'], wood:['🪵','Madera'], stone:['🪨','Piedra'], gold:['🪙','Oro'] };
const BK = { food:'granja', wood:'aserradero', stone:'cantera', gold:'mina' };
const BLD = {
  granja:['🌾','Granja'], aserradero:['🪵','Aserradero'], cantera:['🪨','Cantera'],
  mina:['🪙','Mina'], cuartel:['🪖','Cuartel'], muralla:['🧱','Muralla']
};
const BLD_DESC = {
  granja:'Produce comida para entrenar tropas y mantener tu ejército.',
  aserradero:'Produce madera para mejorar los edificios de tu ciudad.',
  cantera:'Produce piedra para construir y reforzar tus defensas.',
  mina:'Produce oro para entrenar tropas y comerciar en el mercado.',
  cuartel:'Abarata el entrenamiento y desbloquea tropas de nivel superior.',
  muralla:'Aumenta la defensa de la guarnición en tus fortalezas.'
};
const BLD_MAX = 30;
const BLD_TOTAL_MAX = Object.keys(BLD).length * BLD_MAX;
const TIERS = [
  { k:'t1', lvl:1,  p:1,    cf:5,  cg:3,  e:'🗡️', n:{horda:'Saqueadores',alianza:'Milicia',enanos:'Mineros'} },
  { k:'t2', lvl:4,  p:2.6,  cf:11, cg:7,  e:'⚔️', n:{horda:'Jinetes',alianza:'Soldados',enanos:'Ballesteros'} },
  { k:'t3', lvl:7,  p:6.5,  cf:24, cg:15, e:'🛡️', n:{horda:'Berserkers',alianza:'Caballeros',enanos:'Guardianes'} },
  { k:'t4', lvl:10, p:16,   cf:52, cg:33, e:'👑', n:{horda:'Señores de la Guerra',alianza:'Guardia Real',enanos:'Martilladores'} }
];
const IC = { atk:'⚔️', car:'🚚', ref:'🛡️', ret:'↩️' };
const RT_TABLES = ['event_log','offers','alliances','alliance_members','fort_garrison','marches','building_upgrades'];

/* ------------------------- estado global ------------------------- */

let S = null;
let tab = 'mapa';
let menuOpen = false;
let selR = 0;
let mapZoom = 1;
let mapFocusPending = true;
let admTarget = null;
let authMode = 'login';

let stateAt = 0;
let serverSkew = 0;
let refreshPromise = null;
let refreshTimer = null;
let resolving = false;
let pollCounter = 0;
let channel = null;
let toastTimer = null;

/* ------------------------- utilidades ------------------------- */

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmt(n) { return Math.floor(Number(n) || 0).toLocaleString('es-ES'); }
function kb(n) { return (Number(n) || 0).toFixed(1); }
function tierName(t) { return t.n[S?.me?.race] || t.n.alianza; }
function armyTotal(a) { return TIERS.reduce((x, t) => x + (Number(a?.[t.k]) || 0), 0); }
function armyPower(a) { return TIERS.reduce((x, t) => x + (Number(a?.[t.k]) || 0) * t.p, 0); }
function srvNow() { return Date.now() + serverSkew; }
function remaining(iso) { return Math.max(0, Math.ceil((new Date(iso).getTime() - srvNow()) / 1000)); }
function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
           : `${m}:${String(s).padStart(2, '0')}`;
}
function bldTime(lvl) { return Math.max(30, Math.ceil(30 * Math.pow(lvl, 1.5))); }
function buildFor(k) { return (S?.builds || []).find(x => x.key === k); }
function buildPct(bu) {
  const start = new Date(bu.start_at).getTime();
  const end = new Date(bu.end_at).getTime();
  if (!(end > start)) return 100;
  return Math.max(0, Math.min(100, ((srvNow() - start) / (end - start)) * 100));
}

function toast(msg, type = 'ok') {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3600);
}

/* ------------------------- autenticación ------------------------- */

function showLogin(msg = '') {
  S = null;
  menuOpen = false;
  document.body.classList.add('auth');
  $('nav').style.display = 'none';
  $('nav').classList.remove('open');
  $('top').innerHTML = '';
  $('marches').innerHTML = '';
  $('m').innerHTML = `
  <div class="auth-wrap">
    <div class="auth-hero">
      <div class="crest">⚔️</div>
      <h1>IMPERIAL</h1>
      <p class="mu">Conquista regiones, forja alianzas y domina el mercado.</p>
    </div>
    <div class="card auth-card">
      <div class="tabs">
        <button id="tabLogin" class="on" onclick="setAuthMode('login')">Entrar</button>
        <button id="tabSignup" class="s" onclick="setAuthMode('signup')">Crear cuenta</button>
      </div>
      <div id="authErr" class="err">${msg ? esc(msg) : ''}</div>
      <label for="lu">Usuario</label>
      <input id="lu" autocomplete="username" maxlength="16" placeholder="3-16 letras o números">
      <label for="lp">Contraseña</label>
      <input id="lp" type="password" autocomplete="current-password" placeholder="Mínimo 6 caracteres">
      <div id="raceWrap" style="display:none">
        <label for="lr">Raza</label>
        <select id="lr">${Object.entries(RACES).map(([k,r]) => `<option value="${k}">${r.e} ${r.n} — ${r.d}</option>`).join('')}</select>
      </div>
      <button id="authBtn" class="wide" onclick="submitAuth()">Entrar</button>
      <p class="mu small">Multijugador en línea. Tus amigos entran desde su propio dispositivo con una cuenta.</p>
    </div>
  </div>`;
  setAuthMode(authMode);
}

function setAuthMode(mode) {
  authMode = mode;
  const login = $('tabLogin'), signup = $('tabSignup');
  if (!login || !signup) return;
  login.className = mode === 'login' ? 'on' : 's';
  signup.className = mode === 'signup' ? 'on' : 's';
  $('raceWrap').style.display = mode === 'signup' ? 'block' : 'none';
  $('authBtn').textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
  $('lp').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('authErr').textContent = '';
}

function authError(msg) {
  const el = $('authErr');
  if (el) el.textContent = msg;
}

async function submitAuth() {
  const uname = ($('lu').value || '').trim();
  const pass = $('lp').value || '';
  if (!/^[A-Za-z0-9_]{3,16}$/.test(uname)) return authError('Usuario: 3-16 letras, números o _');
  if (pass.length < 6) return authError('Contraseña: mínimo 6 caracteres');
  const btn = $('authBtn');
  btn.disabled = true;
  btn.textContent = 'Conectando…';
  try {
    if (authMode === 'signup') {
      const { data: avail, error: avErr } = await sb.rpc('username_available', { p_username: uname });
      if (avErr) throw avErr;
      if (!avail) throw new Error('Ese usuario ya existe');
      const email = uname.toLowerCase() + '@imperial.local';
      const { data, error } = await sb.auth.signUp({
        email, password: pass,
        options: { data: { username: uname, race: $('lr').value } }
      });
      if (error) throw error;
      if (!data.session) {
        const r = await sb.auth.signInWithPassword({ email, password: pass });
        if (r.error) throw r.error;
      }
    } else {
      const email = uname.toLowerCase() + '@imperial.local';
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    }
    await enterGame();
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (/Invalid login credentials/i.test(msg)) authError('Usuario o contraseña incorrectos');
    else if (/already registered/i.test(msg)) authError('Ese usuario ya existe');
    else if (/Database error saving new user/i.test(msg)) authError('Ese usuario ya existe');
    else authError(msg);
    btn.disabled = false;
    btn.textContent = authMode === 'login' ? 'Entrar' : 'Crear cuenta';
  }
}

async function enterGame() {
  document.body.classList.remove('auth');
  menuOpen = false;
  $('nav').style.display = '';
  $('nav').classList.remove('open');
  mapFocusPending = true;
  selR = 0;
  admTarget = null;
  await refresh();
  if (!S) { showLogin('No se pudo cargar tu partida.'); return; }
  subscribeRealtime();
  render(true);
}

async function logout() {
  try { await sb.auth.signOut(); } catch (_) {}
  unsubscribeRealtime();
  showLogin();
}

/* ------------------------- datos / realtime ------------------------- */

async function rpc(fn, args, okMsg) {
  try {
    const { error } = await sb.rpc(fn, args || {});
    if (error) throw new Error(error.message || 'Error');
    if (okMsg) toast(okMsg);
    await refresh();
  } catch (e) {
    toast(e.message || 'Error', 'bad');
  }
}

function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const { data, error } = await sb.rpc('get_state');
      if (error) throw new Error(error.message || 'Error');
      S = data;
      stateAt = Date.now();
      serverSkew = new Date(S.server_now).getTime() - Date.now();
      render();
    } catch (e) {
      console.error(e);
      if (/No autenticado|JWT/i.test(String(e.message))) showLogin();
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function refreshSoon(ms = 500) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh(), ms);
}

function subscribeRealtime() {
  unsubscribeRealtime();
  channel = sb.channel('imperial-live');
  RT_TABLES.forEach(t => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => refreshSoon());
  });
  channel.subscribe();
}

function unsubscribeRealtime() {
  if (channel) { try { sb.removeChannel(channel); } catch (_) {} channel = null; }
}

/* ------------------------- render ------------------------- */

function render(force) {
  if (!S) return;
  if (tab === 'admin' && !S.me.is_admin) tab = 'mapa';
  drawTop();
  const tabs = [
    ['mapa','🗺️','Mapa'], ['ranking','🏆','Ranking'], ['edificios','🏗️','Edificios'],
    ['ejercito','🪖','Ejército'], ['alianza','🤝','Alianza'], ['mercado','🏪','Mercado'],
    ...(S.me.is_admin ? [['admin','👑','Admin']] : []),
    ['cuenta','🔑','Cuenta'], ['registro','📜','Registro']
  ];
  $('nav').innerHTML = tabs.map(t =>
    `<button class="${tab === t[0] ? 'on' : ''}" onclick="gotoTab('${t[0]}')"><span class="ni">${t[1]}</span><span>${t[2]}</span></button>`
  ).join('');
  $('nav').classList.toggle('open', menuOpen);

  const active = document.activeElement;
  const typing = active && ['INPUT','SELECT','TEXTAREA'].includes(active.tagName);
  if (!force && typing && ['mercado','alianza','admin','cuenta'].includes(tab)) return;

  const vp = $('mapViewport');
  const mapPos = vp ? { x: vp.scrollLeft, y: vp.scrollTop } : null;

  $('m').innerHTML = view();

  if (tab === 'mapa') {
    requestAnimationFrame(() => {
      const v = $('mapViewport');
      if (!v) return;
      if (mapFocusPending) {
        const w = $('mapWorld');
        const pos = myCityPosition();
        if (w && pos) {
          v.scrollLeft = Math.max(0, w.clientWidth * pos.x / 100 - v.clientWidth / 2);
          v.scrollTop = Math.max(0, w.clientHeight * pos.y / 100 - v.clientHeight / 2);
        }
        mapFocusPending = false;
      } else if (mapPos) {
        v.scrollLeft = mapPos.x;
        v.scrollTop = mapPos.y;
      }
    });
  }
}

function gotoTab(t) {
  if (t === 'mapa' && tab !== 'mapa') mapFocusPending = true;
  tab = t;
  menuOpen = false;
  render(true);
}

function setMenu(open) {
  menuOpen = !!open;
  const nav = $('nav');
  if (nav) nav.classList.toggle('open', menuOpen);
  const btn = document.querySelector('.menu-btn');
  if (btn) {
    btn.classList.toggle('on', menuOpen);
    btn.textContent = menuOpen ? '✕' : '☰';
    btn.setAttribute('aria-expanded', String(menuOpen));
  }
}

function toggleMenu(e) {
  if (e) e.stopPropagation();
  setMenu(!menuOpen);
}

function drawTop() {
  if (!S) { $('top').innerHTML = ''; return; }
  const r = estRes();
  $('top').innerHTML =
    `<button class="menu-btn ${menuOpen ? 'on' : ''}" onclick="toggleMenu(event)" aria-label="Abrir menú" aria-expanded="${menuOpen}">${menuOpen ? '✕' : '☰'}</button>` +
    `<span>${RACES[S.me.race].e} ${esc(S.me.name)}${S.me.is_admin ? ' 👑' : ''}</span>` +
    `<span>🪙 KB <b>${kb(S.me.kb)}</b></span>` +
    `<span title="Puntos de ranking">🏅<b>${fmt(S.me.points || 0)}</b></span>` +
    Object.entries(RES).map(([k, v]) => `<span>${v[0]}<b>${fmt(r[k])}</b></span>`).join('') +
    `<span>🪖<b>${S.me.troops}</b></span>` +
    `<button class="s" onclick="logout()">Salir</button>`;
}

function estRes() {
  const out = { ...S.me.res };
  if (stateAt) {
    const secs = Math.max(0, (Date.now() - stateAt) / 1000);
    for (const k of Object.keys(RES)) {
      out[k] = (Number(out[k]) || 0) + rate(k) * secs;
    }
  }
  return out;
}

function rate(k) {
  return 0.5 * S.me.gat * (1 + 0.15 * ((S.me.buildings[BK[k]] || 1) - 1));
}

function updateTimers() {
  if (!S) return;
  const ms = S.marches || [];
  $('marches').innerHTML = ms.length
    ? ms.map(m => `${m.icon} ${esc(m.label)} · ${remaining(m.end_at)}s`).join('<br>')
    : '';
  const builds = S.builds || [];
  document.querySelectorAll('[data-bld-timer]').forEach(el => {
    const bu = builds.find(x => x.key === el.dataset.bldTimer);
    if (bu) el.textContent = '⏳ ' + fmtTime(remaining(bu.end_at));
  });
  document.querySelectorAll('[data-bld-progress]').forEach(el => {
    const bu = builds.find(x => x.key === el.dataset.bldProgress);
    if (bu) el.style.width = buildPct(bu).toFixed(2) + '%';
  });
}

function view() {
  switch (tab) {
    case 'ranking': return vRanking();
    case 'edificios': return vEd();
    case 'ejercito': return vEj();
    case 'alianza': return vAl();
    case 'mercado': return vMe();
    case 'admin': return vAd();
    case 'cuenta': return vCuenta();
    case 'registro': return vLog();
    default: return vMapa();
  }
}

/* ------------------------- mapa ------------------------- */

function regionCenter(id) {
  return { x: (id % 5) * 20 + 10, y: Math.floor(id / 5) * 25 + 12.5 };
}

function cityPos(p) {
  const rid = p.region_id ?? 0;
  const col = rid % 5, row = Math.floor(rid / 5);
  const slot = Math.min(Math.max(p.slot || 0, 0), 24);
  const gx = slot % 5, gy = Math.floor(slot / 5);
  return { x: col * 20 + (gx + 0.5) * 4, y: row * 25 + (gy + 0.5) * 5 };
}

function myCityPosition() {
  const me = (S.players || []).find(p => p.id === S.me.id);
  return me ? cityPos(me) : regionCenter(S.me.region_id || 0);
}

function mapRoads() {
  let d = '';
  for (let i = 0; i < 20; i++) {
    const c = i % 5, row = Math.floor(i / 5);
    const x = c * 20 + 10, y = row * 25 + 12.5;
    if (c < 4) {
      const x2 = (c + 1) * 20 + 10;
      d += `M${x} ${y} Q${(x + x2) / 2} ${y - 2} ${x2} ${y} `;
    }
    if (row < 3) {
      const y2 = (row + 1) * 25 + 12.5;
      d += `M${x} ${y} Q${x + 2} ${(y + y2) / 2} ${x} ${y2} `;
    }
  }
  // Caminos desde cada ciudad real hasta la fortaleza de su región.
  (S.players || []).forEach(p => {
    const c = cityPos(p), f = regionCenter(p.region_id || 0);
    const dx = f.x - c.x, dy = f.y - c.y, len = Math.hypot(dx, dy) || 1;
    const bend = Math.min(0.6, len * 0.03) * ((Math.round(c.x + c.y) % 2) ? 1 : -1);
    const mx = (c.x + f.x) / 2 - (dy / len) * bend;
    const my = (c.y + f.y) / 2 + (dx / len) * bend;
    d += `M${c.x} ${c.y} Q${mx} ${my} ${f.x} ${f.y} `;
  });
  return `<svg class="map-roads" viewBox="0 0 100 100" preserveAspectRatio="none"><g class="road-shadow"><path d="${d}"/></g><g class="road-line"><path d="${d}"/></g></svg>`;
}

function regionCell(r) {
  const count = (S.players || []).filter(p => p.region_id === r.id).length;
  return `<div class="rc ${r.unl ? '' : 'lock'} ${selR === r.id ? 'sel' : ''}" onclick="selectRegion(${r.id})">
    <span class="ic">${r.fort.owner_name ? '🏰' : r.unl ? '🗺️' : '🔒'}</span>
    <span>${esc(r.name)}</span>
    <small>${r.unl ? count + '/25' : 'bloqueada'}</small>
  </div>`;
}

function fortMarker(r) {
  const p = regionCenter(r.id);
  return `<div class="fort-marker" style="left:${p.x}%;top:${p.y}%"><span>🏰</span><small>${r.fort.owner_name ? esc(r.fort.owner_name) : 'Fortaleza'} · ${esc(r.name)}</small></div>`;
}

function cityDot(p) {
  const c = cityPos(p);
  const rn = (S.regions.find(r => r.id === p.region_id) || {}).name || '';
  return `<div class="city-dot ${p.id === S.me.id ? 'mine' : ''}" style="left:${c.x}%;top:${c.y}%" title="${esc(p.name)} · ${esc(rn)}">
    <span class="city-icon">🏘️</span><span class="city-name">${esc(p.name)}</span>
  </div>`;
}

function attackMarkers() {
  const groups = {};
  (S.marches || []).forEach(m => {
    if (m.region != null && (m.kind === 'attack_fort' || m.kind === 'attack_npc')) {
      if (!groups[m.region]) groups[m.region] = [];
      groups[m.region].push(m);
    }
  });
  return Object.entries(groups).map(([ri, ms]) => {
    const p = regionCenter(Number(ri));
    return ms.map((m, i) => {
      const dx = (i - (ms.length - 1) / 2) * 3;
      return `<div class="attack-marker" style="left:${p.x + dx}%;top:${p.y - 4}%">⚔️<small>${esc(m.player)}</small></div>`;
    }).join('');
  }).join('');
}

function selectRegion(id) {
  selR = id;
  render(true);
}

function setMapZoom(delta) {
  mapZoom = Math.min(2, Math.max(0.6, Math.round((mapZoom + delta) * 10) / 10));
  render(true);
}
function resetMapZoom() { mapZoom = 1; render(true); }

function vMapa() {
  const unlocked = S.regions.filter(r => r.unl).length;
  let h = `<div class="card"><h3>🌍 Mundo · ${unlocked}/20 regiones · ${S.players.length} jugadores</h3>
  <div class="map-tools">
    <button class="s" onclick="setMapZoom(-.2)" aria-label="Alejar mapa">−</button>
    <b style="min-width:48px;text-align:center">${Math.round(mapZoom * 100)}%</b>
    <button class="s" onclick="setMapZoom(.2)" aria-label="Acercar mapa">+</button>
    <button class="s" onclick="resetMapZoom()">Restablecer</button>
  </div>
  <div class="map-viewport" id="mapViewport">
    <div class="wm" id="mapWorld" style="width:${500 * mapZoom}%;height:${500 * mapZoom}%;background-image:url(assets/map.webp)">
      ${mapRoads()}
      <div class="wg">${S.regions.map(regionCell).join('')}</div>
      ${S.regions.map(fortMarker).join('')}
      ${S.players.map(cityDot).join('')}
      ${attackMarkers()}
    </div>
  </div>
  <div class="map-legend">
    <span>🏰 Fortaleza central</span><span>🏘️ Ciudad de jugador</span><span>⚔️ Ataque en curso</span>
  </div></div>`;

  const r = S.regions[selR] || S.regions[0];
  h += `<div class="card"><h3>${esc(r.name)} ${r.unl ? '' : '🔒 Bloqueada'}</h3>`;
  if (!r.unl) return h + `<p class="mu">El administrador aún no desbloquea esta región.</p></div>`;

  const rp = S.players.filter(p => p.region_id === r.id);
  h += `<div class="mu">Jugadores en esta región: ${rp.length}/25 · KB en la fortaleza: ${kb(r.fort.store.kb || 0)}</div>
    <div class="plots">${rp.map(p => `<div class="plot">🏘️ ${esc(p.name)}${p.id === S.me.id ? ' (tú)' : ''}</div>`).join('') || '<span class="mu">Sin jugadores</span>'}</div></div>`;

  h += fortCard(r);
  h += `<div class="card"><h3>👹 NPC</h3>${r.npcs.map(n =>
    `<div class="row"><span>${esc(n.name)} · 🪖${n.t}</span><button onclick="attackNpc(${r.id},${n.id})">${IC.atk} Atacar</button></div>`
  ).join('')}</div>`;
  return h;
}

function fortCard(r) {
  const f = r.fort;
  const gl = f.gar_list || [];
  let h = `<div class="card"><h3>🏰 Fortaleza central</h3>
    <div class="mu">Dueño: ${f.owner_name ? esc(f.owner_name) : 'Sin dueño (NPC 🪖' + f.npc + ')'}</div>
    <div>🛡️ Guarnición: ${gl.map(g => `${esc(g.name)} ${g.troops}${g.army ? ` · ⚔️${fmt(armyPower(g.army))}` : ''}`).join(' · ') || 'vacía'}</div>`;

  if (f.owner && S.me.ally_id === f.owner) {
    h += `<div class="mu" style="margin-top:6px">Reserva: ${Object.entries(RES).map(([k, v]) => v[0] + ' ' + fmt(f.store[k] || 0)).join(' ')} · 🪙 ${kb(f.store.kb || 0)} KB</div>
      <div class="mu">Producción automática: +0.5 de cada recurso por segundo. Los KB se acumulan con el 15% de las ventas del mercado.</div>
      <button onclick="caravan(${r.id})">${IC.car} Enviar caravana a mi ciudad</button><hr>
      ${(S.ally.members || []).map(m => `<div class="row"><span>${esc(m.name)}${m.leader ? ' 👑' : ''} · guarnición ${(f.gar && f.gar[m.name]) || 0}</span><span>${m.id === S.me.id ? `<button class="s" onclick="reinforce(${r.id},10)">${IC.ref} +10</button><button class="s" onclick="withdraw(${r.id},10)">${IC.ret} −10</button>` : ''}</span></div>`).join('')}
      <div class="mu">Los refuerzos usan primero tus tropas de mayor nivel; las retiradas también salen de las de mayor nivel.</div>`;
  } else if (f.owner) {
    h += `<div class="mu" style="margin-top:6px">Fortaleza controlada por otra alianza.</div>`;
    if (S.me.ally_id) h += `<button onclick="attackFort(${r.id})">${IC.atk} Atacar con alianza</button>`;
    else h += `<span class="mu"> Necesitas una alianza para atacar.</span>`;
  } else {
    h += `<div class="mu" style="margin-top:6px">Sin dueño: puedes capturarla con tu alianza.</div>`;
    if (S.me.ally_id) h += `<button onclick="attackFort(${r.id})">${IC.atk} Atacar con alianza</button>`;
    else h += `<span class="mu"> Necesitas una alianza para atacar.</span>`;
  }
  return h + '</div>';
}

/* ------------------------- ranking ------------------------- */

function rankMedal(n) {
  return n === 1 ? '🥇' : n === 2 ? '🥈' : n === 3 ? '🥉' : String(n);
}

function vRanking() {
  const players = [...(S.players || [])].sort((a, b) =>
    (Number(b.points) || 0) - (Number(a.points) || 0) ||
    (Number(b.kb) || 0) - (Number(a.kb) || 0) ||
    String(a.name).localeCompare(String(b.name))
  );
  const myPos = players.findIndex(p => p.id === S.me.id) + 1;

  const groups = {};
  players.forEach(p => {
    if (!p.ally_id) return;
    const key = String(p.ally_id);
    if (!groups[key]) groups[key] = { id: p.ally_id, name: p.ally || 'Alianza', points: 0, members: 0, forts: 0 };
    const g = groups[key];
    g.points += Number(p.points) || 0;
    g.members++;
    if (p.ally) g.name = p.ally;
  });
  Object.values(groups).forEach(g => {
    g.forts = (S.regions || []).filter(r => r.fort && String(r.fort.owner) === String(g.id)).length;
  });
  const allys = Object.values(groups).sort((a, b) =>
    b.points - a.points || b.forts - a.forts || a.name.localeCompare(b.name)
  );
  const myAlly = S.me.ally_id ? allys.find(a => String(a.id) === String(S.me.ally_id)) : null;
  const myAllyPos = myAlly ? allys.indexOf(myAlly) + 1 : 0;

  return `<div class="card"><h3>🏆 Tu posición</h3>
    <div class="row"><span>Jugador</span><b>#${myPos || '—'} de ${players.length} · ${fmt(S.me.points || 0)} pts</b></div>
    ${S.me.ally_id
      ? `<div class="row"><span>Alianza</span><b>${myAlly ? '#' + myAllyPos + ' de ' + allys.length : '—'} · ${myAlly ? fmt(myAlly.points) : 0} pts</b></div>`
      : '<div class="row"><span>Alianza</span><span class="mu">Sin alianza</span></div>'}
    <p class="mu small">Puntos = KB + poder del ejército + 10 por nivel de edificio + poder en fortalezas.</p>
  </div>

  <div class="card"><h3>🏆 Ranking de jugadores</h3>
    <div class="rank-head"><span>#</span><span>Jugador</span><span>Alianza</span><span>Puntos</span></div>
    ${players.map((p, i) => `<div class="rank-row ${p.id === S.me.id ? 'me' : ''}">
      <span class="rank-pos">${rankMedal(i + 1)}</span>
      <span class="rank-name">${(RACES[p.race] || RACES.alianza).e} ${esc(p.name)}${p.admin ? ' 👑' : ''}</span>
      <span class="rank-ally">${p.ally ? esc(p.ally) : '—'}</span>
      <span class="rank-pts"><b>${fmt(p.points || 0)}</b></span>
    </div>`).join('') || '<p class="mu">Sin jugadores.</p>'}
  </div>

  <div class="card"><h3>🛡️ Ranking de alianzas</h3>
    <p class="mu">Se mide por la suma de los puntos de sus miembros.</p>
    <div class="rank-head ally"><span>#</span><span>Alianza</span><span>Miembros</span><span>Fort.</span><span>Puntos</span></div>
    ${allys.map((a, i) => `<div class="rank-row ally ${S.me.ally_id && String(a.id) === String(S.me.ally_id) ? 'me' : ''}">
      <span class="rank-pos">${rankMedal(i + 1)}</span>
      <span class="rank-name">🛡️ ${esc(a.name)}</span>
      <span class="rank-mid rank-members">${a.members}/5</span>
      <span class="rank-mid rank-forts">🏰 ${a.forts}</span>
      <span class="rank-pts"><b>${fmt(a.points)}</b></span>
    </div>`).join('') || '<p class="mu">Todavía no hay alianzas.</p>'}
  </div>`;
}

/* ------------------------- ejército ------------------------- */

function vEj() {
  const q = RACES[S.me.race] || RACES.alianza;
  const b = S.me.buildings;
  const army = S.me.army || {};
  const power = armyPower(army);
  const discount = Math.pow(0.95, b.cuartel - 1);
  const discountPct = Math.round((1 - discount) * 100);

  const rows = TIERS.map(t => {
    const locked = b.cuartel < t.lvl;
    const count = Number(army[t.k]) || 0;
    const cf = Math.ceil(t.cf * discount);
    const cg = Math.ceil(t.cg * discount);
    return `<div class="train-row ${locked ? 'locked' : ''}">
      <div><b>${t.e} ${tierName(t)}</b> <span class="mu">· nv ${t.lvl} · ⚔️ ${t.p} c/u · tienes ${fmt(count)}</span><br>
      <span class="mu">${locked ? `🔒 Requiere cuartel nv ${t.lvl}` : `${cf}🌾 + ${cg}🪙 por unidad`}</span></div>
      <div class="train-actions">${locked ? '' : `<button class="s" onclick="train(10,'${t.k}')">+10</button><button class="s" onclick="train(50,'${t.k}')">+50</button><button class="s" onclick="train(100,'${t.k}')">+100</button>`}</div>
    </div>`;
  }).join('');

  return `<div class="card"><h3>${q.e} ${q.n}</h3><div class="mu">${q.d}</div>
    <div>Ataque ×${q.atk} · Defensa ×${q.def} · Recolección ×${q.gat}</div>
    <div class="mu">Horda: +25% ataque, −20% recolección · Alianza: equilibrada · Enanos: −20% ataque, −5% defensa, +30% recolección.</div>
    <div class="army-summary">Poder del ejército: ⚔️ <b>${fmt(power * q.atk)}</b> · 🛡️ <b>${fmt(power * q.def)}</b></div>
    <p class="mu">Balance: ataque × recolección ≈ 1.0 en todas las razas.</p></div>

  <div class="card"><h3>Entrenar tropas · Cuartel nv ${b.cuartel}</h3>
    <div class="mu">Descuento actual: ${discountPct}%. Subir el cuartel abarata las tropas y desbloquea unidades mejores.</div>
    ${rows}
    <div class="army-summary">Tropas: <b>${fmt(S.me.troops)}</b> · Poder base: <b>${fmt(power)}</b><br>
      <span class="mu">Composición: ${TIERS.filter(t => Number(army[t.k]) > 0).map(t => `${t.e} ${tierName(t)} ${fmt(army[t.k])}`).join(' · ') || 'sin tropas'}</span></div>
    <div class="army-summary"><button class="s" onclick="gotoTab('edificios')">🏗️ Gestionar edificios</button></div>
  </div>

  <div class="card"><h3>Leyenda de movimientos</h3>${IC.atk} Ataque · ${IC.car} Caravana · ${IC.ref} Refuerzos · ${IC.ret} Retirada</div>`;
}

/* ------------------------- edificios ------------------------- */

function bldNow(k, lvl) {
  if (k === 'cuartel') {
    const discount = Math.round((1 - Math.pow(0.95, lvl - 1)) * 100);
    return `${discount}% menos coste · ${TIERS.filter(t => lvl >= t.lvl).length}/4 niveles`;
  }
  if (k === 'muralla') return `+${Math.round((lvl - 1) * 5)}% defensa de fortalezas`;
  return `+${Math.round((lvl - 1) * 15)}% · ${kb(rate(BK[k]) * 60)}/min`;
}

function bldNext(k, lvl) {
  const next = lvl + 1;
  if (k === 'cuartel') {
    const discount = Math.round((1 - Math.pow(0.95, lvl)) * 100);
    return `${discount}% menos coste · ${TIERS.filter(t => next >= t.lvl).length}/4 niveles`;
  }
  if (k === 'muralla') return `+${Math.round(lvl * 5)}% defensa de fortalezas`;
  const nextRate = 0.5 * S.me.gat * (1 + 0.15 * lvl);
  return `+${Math.round(lvl * 15)}% · ${kb(nextRate * 60)}/min`;
}

function vEd() {
  const b = S.me.buildings;
  const builds = S.builds || [];
  const res = estRes();
  const totalLvl = Object.keys(BLD).reduce((n, k) => n + (Number(b[k]) || 1), 0);
  const totalRate = Object.keys(RES).reduce((n, k) => n + rate(k), 0);
  const wallBonus = Math.round(((Number(b.muralla) || 1) - 1) * 5);
  const cuartelLvl = Number(b.cuartel) || 1;

  const prod = Object.entries(RES).map(([k, v]) =>
    `<div class="bld-prod-item"><span>${v[0]} ${v[1]}</span><b>${kb(rate(k) * 60)}/min</b></div>`
  ).join('');

  const cards = Object.entries(BLD).map(([k, v]) => {
    const lvl = Number(b[k]) || 1;
    const max = lvl >= BLD_MAX;
    const bu = buildFor(k);
    const c = bcost(lvl);
    const afford = res.wood >= c.wood && res.stone >= c.stone && res.gold >= c.gold;
    const levelPct = Math.min(100, (lvl / BLD_MAX) * 100);
    const timer = bu ? fmtTime(remaining(bu.end_at)) : '';
    return `<div class="bld-card ${bu ? 'upgrading' : ''}">
      <div class="bld-top">
        <span class="bld-ico">${v[0]}</span>
        <div class="bld-title"><b>${v[1]}</b><span class="badge">${bu ? `Nv ${lvl} → ${bu.to_level}` : `Nv ${lvl}/${BLD_MAX}`}</span></div>
      </div>
      <div class="mu bld-desc">${BLD_DESC[k]}</div>
      <div class="bld-stats">
        <div><span class="mu">Ahora</span><b>${bldNow(k, lvl)}</b></div>
        <div><span class="mu">${bu ? 'En mejora' : max ? 'Nivel máximo' : 'Siguiente nivel'}</span>
          <b>${max ? '—' : bldNext(k, lvl)}</b>
          ${bu ? `<span class="bld-timer" data-bld-timer="${k}">⏳ ${timer}</span>`
               : max ? '' : `<span class="bld-eta">⏱ Tarda ${fmtTime(bldTime(lvl))}</span>`}
        </div>
      </div>
      <div class="bld-bar"><span style="width:${levelPct.toFixed(2)}%"></span></div>
      ${bu ? `<div class="bld-bar work"><span data-bld-progress="${k}" style="width:${buildPct(bu).toFixed(2)}%"></span></div>` : ''}
      <div class="bld-foot">
        <span class="bld-cost">${bu ? '⏳ En obra' : max ? '✅ Completado' : `🪵 ${fmt(c.wood)} · 🪨 ${fmt(c.stone)} · 🪙 ${fmt(c.gold)}`}</span>
        <button ${max || bu || !afford ? 'disabled' : ''} onclick="upgrade('${k}')">${max ? 'MÁX' : bu ? 'En obra' : afford ? 'Mejorar' : 'Faltan recursos'}</button>
      </div>
    </div>`;
  }).join('');

  const unlocks = TIERS.map(t => {
    const done = cuartelLvl >= t.lvl;
    return `<div class="bld-unlock ${done ? 'done' : ''}">
      <span class="bld-unlock-ico">${t.e}</span>
      <div><b>${tierName(t)}</b><span class="mu">Cuartel nivel ${t.lvl}</span></div>
      <span class="badge">${done ? 'Desbloqueado' : 'Bloqueado'}</span>
    </div>`;
  }).join('');

  return `<div class="card"><h3>🏗️ Edificios de la ciudad${builds.length ? ` · ${builds.length} en obra` : ''}</h3>
    <div class="bld-summary">
      <div class="bld-stat"><span>Nivel total</span><b>${totalLvl}/${BLD_TOTAL_MAX}</b></div>
      <div class="bld-stat"><span>Producción total</span><b>${kb(totalRate * 60)}/min</b></div>
      <div class="bld-stat"><span>Cuartel</span><b>Nv ${cuartelLvl}/${BLD_MAX}</b></div>
      <div class="bld-stat"><span>Defensa de muralla</span><b>+${wallBonus}%</b></div>
    </div>
    <div class="bld-prod">${prod}</div>
    <p class="mu small">Las mejoras tardan tiempo y cada nivel tarda más. Se completan aunque estés desconectado y puedes mejorar varios edificios a la vez. La muralla protege la guarnición de las fortalezas; el cuartel abarata y desbloquea tropas.</p>
  </div>

  <div class="bld-grid">${cards}</div>

  <div class="card"><h3>🪖 Desbloqueos del cuartel</h3>${unlocks}</div>`;
}

function bcost(lvl) { return { wood: 80 * lvl, stone: 60 * lvl, gold: 40 * lvl }; }

/* ------------------------- alianza ------------------------- */

function vAl() {
  if (!S.ally) {
    const free = S.players.filter(p => !p.ally_id && p.id !== S.me.id);
    return `<div class="card"><h3>🤝 Crear alianza</h3>
      <input id="an" maxlength="24" placeholder="Nombre de la alianza"><button onclick="createAlly()">Crear</button>
      <p class="mu">Máximo 5 jugadores. Tú serás el líder.</p></div>
      <div class="card"><h3>Jugadores sin alianza</h3>
      ${free.map(p => `<div class="row"><span>${RACES[p.race].e} ${esc(p.name)}</span><span class="mu">pide a un líder que te invite</span></div>`).join('') || '<span class="mu">No hay otros jugadores libres.</span>'}</div>`;
  }

  const a = S.ally;
  const mem = a.members || [];
  const per = Math.floor(100 / Math.max(mem.length, 1));
  let h = `<div class="card"><h3>🤝 ${esc(a.name)} (${mem.length}/5)</h3>` +
    mem.map(m => `<div class="row"><span>${RACES[m.race].e} ${esc(m.name)}${m.leader ? ' 👑' : ''} · 🪖${m.troops}</span>
      <span>${m.id !== S.me.id && a.leader_id === S.me.id ? `<button class="s" onclick="kickMember('${m.id}')">Quitar</button>` : ''}</span></div>`).join('') +
    `<div style="margin-top:8px"><button class="s" onclick="leaveAlly()">Salir de la alianza</button></div></div>`;

  h += `<div class="card"><h3>📦 Arca de la alianza</h3>
    ${Object.entries(RES).map(([k, v]) => v[0] + ' ' + fmt(a.ark[k])).join(' ')}
    <hr>
    <div class="row"><span>Aportar:</span><span>
      <select id="arkRes">${Object.entries(RES).map(([k, v]) => `<option value="${k}">${v[0]} ${v[1]}</option>`).join('')}</select>
      <input id="arkQty" type="number" min="1" placeholder="Cant.">
      <button onclick="depositArk()">Aportar</button></span></div>
    <p class="mu">Reparto por % (debe sumar 100):</p>
    ${mem.map(m => `<div>${esc(m.name)} <input type="number" class="pct" data-pid="${m.id}" value="${m.id === a.leader_id ? 100 - per * (mem.length - 1) : per}" min="0" max="100">%</div>`).join('')}
    ${a.leader_id === S.me.id ? `<button onclick="distributeArk()">Repartir</button>` : '<p class="mu">Solo el líder puede repartir.</p>'}
  </div>`;

  if (mem.length < 5) {
    const free = S.players.filter(p => !p.ally_id);
    h += `<div class="card"><h3>Invitar jugadores</h3>` +
      (free.length ? free.map(p => `<div class="row"><span>${RACES[p.race].e} ${esc(p.name)}</span>
        ${a.leader_id === S.me.id ? `<button class="s" onclick="invitePlayer('${p.id}')">+ Invitar</button>` : '<span class="mu">solo el líder</span>'}</div>`).join('')
        : '<span class="mu">No hay jugadores sin alianza.</span>') + '</div>';
  }
  return h;
}

/* ------------------------- mercado ------------------------- */

function vMe() {
  const offers = S.offers || [];
  return `<div class="card"><h3>🏪 Mercado (todo en KB)</h3>
    <div class="mu">Al vender recibes 80%. 5% admin · 15% a las fortalezas de regiones desbloqueadas.</div>
    <div class="mu">Precios: ${Object.entries(RES).map(([k, v]) => v[0] + Number(S.prices[k]).toFixed(2)).join(' · ')}</div></div>

  <div class="card"><h3>Ofertas</h3>
    ${offers.length ? offers.map(o => `<div class="row"><span>${RES[o.res][0]} ${o.q} × ${o.p} KB <span class="mu">(${esc(o.seller)})</span></span>
      <span>${o.mine ? `<button class="s" onclick="cancelOffer(${o.id})">Cancelar</button>` : `<button onclick="buyOffer(${o.id})">${(o.q * o.p).toFixed(1)} KB</button>`}</span></div>`).join('')
      : '<span class="mu">No hay ofertas. ¡Publica la primera!</span>'}
  </div>

  <div class="card"><h3>Vender</h3>
    <select id="sr">${Object.entries(RES).map(([k, v]) => `<option value="${k}">${v[0]} ${v[1]}</option>`).join('')}</select>
    <input id="sq" type="number" min="1" placeholder="Cant."><input id="sp" type="number" min="0.1" step="0.1" placeholder="KB c/u">
    <button onclick="sellOffer()">Publicar</button>
    <p class="mu">Tus ofertas activas: ${offers.filter(o => o.mine).length}/10</p>
  </div>`;
}

/* ------------------------- admin ------------------------- */

function vAd() {
  if (!S.players.length) return '<div class="card"><h3>👑 Panel admin</h3><p class="mu">Sin jugadores.</p></div>';
  let T = S.players.find(p => p.id === admTarget) || S.players.find(p => p.id === S.me.id) || S.players[0];
  admTarget = T.id;
  const keys = [...Object.keys(RES), 'kb', 'troops'];
  return `<div class="card"><h3>👑 Panel admin</h3>
    <div class="mu">KB del admin (5% del mercado): <b>${kb(S.admin_kb)}</b>${S.admin_kb > 0 ? ' <button class="s" onclick="claimAdminKb()">Cobrar</button>' : ''}</div></div>

  <div class="card"><h3>Cuenta objetivo</h3>
    <select onchange="admTarget=this.value;render(true)">${S.players.map(p => `<option value="${p.id}" ${p.id === T.id ? 'selected' : ''}>${esc(p.name)}${p.admin ? ' 👑' : ''}</option>`).join('')}</select>
    <div class="mu" style="margin-top:6px">${RACES[T.race].e} ${esc(T.name)} · 🪖 ${T.troops} · 🪙 ${kb(T.kb)} KB · región ${(S.regions.find(r => r.id === T.region_id) || {}).name || '—'}</div>
    <div style="margin-top:8px"><button class="${T.admin ? 's' : ''}" onclick="adminSetAdmin('${T.id}', ${!T.admin})">${T.admin ? 'Quitar admin' : 'Nombrar admin'}</button></div>
  </div>

  <div class="card"><h3>Dar / quitar</h3>
    <select id="ar">${keys.map(k => `<option value="${k}">${k === 'kb' ? '🪙 KB' : k === 'troops' ? '🪖 Tropas' : RES[k][0] + ' ' + RES[k][1]}</option>`).join('')}</select>
    <input id="aa" type="number" placeholder="Cant.">
    <button onclick="adminGive(1)">+ Dar</button><button class="s" onclick="adminGive(-1)">− Quitar</button>
    <div class="mu">Solo el admin puede crear KB.</div></div>

  <div class="card"><h3>Regiones</h3>
    ${S.regions.map(r => `<button class="${r.unl ? '' : 's'}" onclick="adminToggleRegion(${r.id})">${r.unl ? '🔓' : '🔒'} ${esc(r.name)}</button>`).join('')}
  </div>`;
}

/* ------------------------- cuenta ------------------------- */

function vCuenta() {
  const r = RACES[S.me.race] || RACES.alianza;
  return `<div class="card"><h3>👤 Mi cuenta</h3>
    <div class="row"><span>Usuario</span><b>${esc(S.me.name)}${S.me.is_admin ? ' 👑' : ''}</b></div>
    <div class="row"><span>Raza</span><span>${r.e} ${r.n}</span></div>
    <div class="row"><span>Región</span><span>${esc((S.regions.find(x => x.id === S.me.region_id) || {}).name || '—')}</span></div>
    <p class="mu small">La contraseña se guarda cifrada en Supabase. Nadie puede verla, ni siquiera el administrador.</p>
  </div>

  <div class="card"><h3>🔑 Cambiar contraseña</h3>
    <label for="pw0">Contraseña actual</label>
    <input id="pw0" type="password" autocomplete="current-password" placeholder="Tu contraseña actual">
    <label for="pw1">Nueva contraseña</label>
    <input id="pw1" type="password" autocomplete="new-password" placeholder="Mínimo 6 caracteres">
    <label for="pw2">Repite la nueva contraseña</label>
    <input id="pw2" type="password" autocomplete="new-password" placeholder="Repite la nueva">
    <button class="wide" onclick="changePassword()">Actualizar contraseña</button>
    <p class="mu small">Si no recuerdas la contraseña actual, pide al administrador que te genere una temporal.</p>
  </div>`;
}

/* ------------------------- registro ------------------------- */

function vLog() {
  const log = S.log || [];
  return `<div class="card log"><h3>Registro</h3>${log.length
    ? log.map(l => `<div><span class="mu">${new Date(l.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span> ${l.icon || ''} ${esc(l.message)}</div>`).join('')
    : '<span class="mu">Sin eventos</span>'}</div>`;
}

/* ------------------------- acciones ------------------------- */

function train(n, tier = 't1') { rpc('train_troops', { p_n: n, p_tier: tier }, 'Tropas entrenadas'); }
function upgrade(k) { rpc('upgrade_building', { p_key: k }, 'Mejora iniciada'); }
function attackNpc(ri, npcId) { rpc('launch_npc_attack', { p_region: ri, p_npc: npcId }, 'Ataque en marcha'); }
function attackFort(ri) { rpc('launch_fort_attack', { p_region: ri }, 'Ataque de alianza en marcha'); }
function reinforce(ri, n) { rpc('reinforce_fort', { p_region: ri, p_n: n }, 'Refuerzos en camino'); }
function withdraw(ri, n) { rpc('withdraw_fort', { p_region: ri, p_n: n }, 'Retirada en camino'); }
function caravan(ri) { rpc('send_caravan', { p_region: ri }, 'Caravana en camino'); }

function sellOffer() {
  const res = $('sr').value;
  const q = Number($('sq').value);
  const p = Number($('sp').value);
  if (!(q > 0) || !(p > 0)) return toast('Datos inválidos', 'bad');
  rpc('sell_offer', { p_res: res, p_qty: q, p_price: p }, 'Oferta publicada');
}
function buyOffer(id) { rpc('buy_offer', { p_id: id }, 'Compra realizada'); }
function cancelOffer(id) { rpc('cancel_offer', { p_id: id }, 'Oferta cancelada'); }

function createAlly() {
  const name = ($('an').value || '').trim();
  if (name.length < 3) return toast('Nombre de 3 a 24 caracteres', 'bad');
  rpc('create_alliance', { p_name: name }, 'Alianza creada');
}
function invitePlayer(id) { rpc('invite_to_alliance', { p_player: id }, 'Jugador invitado'); }
function kickMember(id) { if (confirm('¿Expulsar a este jugador?')) rpc('kick_member', { p_player: id }, 'Jugador expulsado'); }
function leaveAlly() { if (confirm('¿Salir de la alianza?')) rpc('leave_alliance', null, 'Saliste de la alianza'); }

function depositArk() {
  const res = $('arkRes').value;
  const q = Number($('arkQty').value);
  if (!(q > 0)) return toast('Cantidad inválida', 'bad');
  rpc('deposit_ark', { p_res: res, p_qty: q }, 'Aportación realizada');
}
function distributeArk() {
  const pcts = {};
  document.querySelectorAll('.pct').forEach(i => { pcts[i.dataset.pid] = Number(i.value) || 0; });
  const sum = Object.values(pcts).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.01) return toast('Los porcentajes deben sumar 100', 'bad');
  rpc('distribute_ark', { p_pcts: pcts }, 'Arca repartida');
}

function adminGive(sign) {
  const p = admTarget;
  const key = $('ar').value;
  const amount = Number($('aa').value);
  if (!p || !(amount > 0)) return toast('Cantidad inválida', 'bad');
  rpc('admin_give', { p_player: p, p_key: key, p_amount: sign * amount }, 'Ajuste aplicado');
}
function adminToggleRegion(ri) { rpc('admin_toggle_region', { p_region: ri }, 'Región actualizada'); }
function adminSetAdmin(id, val) { rpc('admin_set_admin', { p_player: id, p_value: val }, 'Permisos actualizados'); }
function claimAdminKb() { rpc('admin_claim_kb', null, 'KB del mercado cobrados'); }

async function changePassword() {
  const cur = ($('pw0') && $('pw0').value) || '';
  const npw = ($('pw1') && $('pw1').value) || '';
  const npw2 = ($('pw2') && $('pw2').value) || '';
  if (!cur) return toast('Escribe tu contraseña actual', 'bad');
  if (npw.length < 6) return toast('La nueva contraseña debe tener al menos 6 caracteres', 'bad');
  if (npw !== npw2) return toast('Las contraseñas nuevas no coinciden', 'bad');
  if (cur === npw) return toast('La nueva contraseña debe ser distinta a la actual', 'bad');
  const email = S.me.name.toLowerCase() + '@imperial.local';
  try {
    const { error: loginError } = await sb.auth.signInWithPassword({ email, password: cur });
    if (loginError) throw new Error('La contraseña actual no es correcta');
    const { error } = await sb.auth.updateUser({ password: npw });
    if (error) throw new Error(error.message || 'No se pudo actualizar la contraseña');
    $('pw0').value = '';
    $('pw1').value = '';
    $('pw2').value = '';
    toast('Contraseña actualizada correctamente');
  } catch (e) {
    toast(e.message || 'Error al cambiar la contraseña', 'bad');
  }
}

/* ------------------------- ciclo de vida ------------------------- */

async function resolveDue() {
  if (resolving || !S) return;
  const dueMarches = (S.marches || []).some(m => remaining(m.end_at) <= 0);
  const dueBuilds = (S.builds || []).some(b => remaining(b.end_at) <= 0);
  if (!dueMarches && !dueBuilds) return;
  resolving = true;
  try { if (dueMarches) await sb.rpc('resolve_due_marches'); } catch (_) {}
  resolving = false;
  refresh();
}

function tick() {
  if (!S) return;
  drawTop();
  updateTimers();
  resolveDue();
  if (++pollCounter >= 4) {
    pollCounter = 0;
    if (document.visibilityState === 'visible' && !refreshPromise) refresh();
  }
}

async function boot() {
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S) refresh(); });
  const { data } = await sb.auth.getSession();
  if (data && data.session) {
    await enterGame();
  } else {
    showLogin();
  }
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      unsubscribeRealtime();
      showLogin();
    }
  });
}

document.addEventListener('click', (e) => {
  if (!menuOpen) return;
  if (e.target.closest('#nav') || e.target.closest('.menu-btn')) return;
  setMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menuOpen) setMenu(false);
});

boot();
