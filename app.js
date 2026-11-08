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
const EFF = {
  granja:'+15% comida/nv', aserradero:'+15% madera/nv', cantera:'+15% piedra/nv',
  mina:'+15% oro/nv', cuartel:'−5% coste tropas/nv', muralla:'+5% defensa guarnición/nv'
};
const IC = { atk:'⚔️', car:'🚚', ref:'🛡️', ret:'↩️' };
const RT_TABLES = ['event_log','offers','alliances','alliance_members','fort_garrison','marches'];

/* ------------------------- estado global ------------------------- */

let S = null;
let tab = 'mapa';
let selR = 0;
let mapZoom = 1;
let mapFocusPending = true;
let admTarget = null;
let authMode = 'login';

let stateAt = 0;
let serverSkew = 0;
let refreshing = false;
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
function srvNow() { return Date.now() + serverSkew; }
function remaining(iso) { return Math.max(0, Math.ceil((new Date(iso).getTime() - srvNow()) / 1000)); }

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
  document.body.classList.add('auth');
  $('nav').style.display = 'none';
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
  $('nav').style.display = 'flex';
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

async function refresh() {
  if (refreshing) return;
  refreshing = true;
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
    refreshing = false;
  }
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
    ['mapa','🗺️','Mapa'], ['ejercito','🪖','Ejército'], ['alianza','🤝','Alianza'],
    ['mercado','🏪','Mercado'], ...(S.me.is_admin ? [['admin','👑','Admin']] : []), ['registro','📜','Registro']
  ];
  $('nav').innerHTML = tabs.map(t =>
    `<button class="${tab === t[0] ? 'on' : ''}" onclick="gotoTab('${t[0]}')">${t[1]}<br>${t[2]}</button>`
  ).join('');

  const active = document.activeElement;
  const typing = active && ['INPUT','SELECT','TEXTAREA'].includes(active.tagName);
  if (!force && typing && ['mercado','alianza','admin'].includes(tab)) return;

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
  render(true);
}

function drawTop() {
  if (!S) { $('top').innerHTML = ''; return; }
  const r = estRes();
  $('top').innerHTML =
    `<span>${RACES[S.me.race].e} ${esc(S.me.name)}${S.me.is_admin ? ' 👑' : ''}</span>` +
    `<span>🪙 KB <b>${kb(S.me.kb)}</b></span>` +
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
}

function view() {
  switch (tab) {
    case 'ejercito': return vEj();
    case 'alianza': return vAl();
    case 'mercado': return vMe();
    case 'admin': return vAd();
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
      ${S.regions.map(regionCell).join('')}
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
    <div>🛡️ Guarnición: ${gl.map(g => `${esc(g.name)} ${g.troops}`).join(' · ') || 'vacía'}</div>`;

  if (f.owner && S.me.ally_id === f.owner) {
    h += `<div class="mu" style="margin-top:6px">Reserva: ${Object.entries(RES).map(([k, v]) => v[0] + ' ' + fmt(f.store[k] || 0)).join(' ')} · 🪙 ${kb(f.store.kb || 0)} KB</div>
      <div class="mu">Producción automática: +0.5 de cada recurso por segundo. Los KB se acumulan con el 15% de las ventas del mercado.</div>
      <button onclick="caravan(${r.id})">${IC.car} Enviar caravana a mi ciudad</button><hr>
      ${(S.ally.members || []).map(m => `<div class="row"><span>${esc(m.name)}${m.leader ? ' 👑' : ''} · guarnición ${(f.gar && f.gar[m.name]) || 0}</span><span>${m.id === S.me.id ? `<button class="s" onclick="reinforce(${r.id},10)">${IC.ref} +10</button><button class="s" onclick="withdraw(${r.id},10)">${IC.ret} −10</button>` : ''}</span></div>`).join('')}`;
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

/* ------------------------- ejército ------------------------- */

function vEj() {
  const q = RACES[S.me.race];
  const b = S.me.buildings;
  const d = 1 - 0.05 * (b.cuartel - 1);
  return `<div class="card"><h3>${q.e} ${q.n}</h3><div class="mu">${q.d}</div>
    <div>Ataque ×${q.atk} · Defensa ×${q.def} · Recolección ×${q.gat}</div>
    <p class="mu">Balance: ataque × recolección ≈ 1.0 en todas las razas.</p></div>

  <div class="card"><h3>Entrenar tropas</h3>
    <div class="mu">Cada tropa: ${Math.ceil(5 * d)}🌾 + ${Math.ceil(3 * d)}🪙 (descuento por cuartel).</div>
    <button onclick="train(10)">+10</button><button onclick="train(50)">+50</button><button onclick="train(100)">+100</button>
    <div style="margin-top:6px">Tropas: <b>${S.me.troops}</b></div></div>

  <div class="card"><h3>🏗️ Edificios</h3>
    ${Object.entries(BLD).map(([k, v]) => {
      const lvl = b[k];
      const c = bcost(lvl);
      return `<div class="row"><span>${v[0]} ${v[1]} <b>nv ${lvl}</b><br><span class="mu">${EFF[k]}</span></span>
        <span class="mu" style="text-align:right">${lvl >= 10 ? 'MÁX' : `🪵${c.wood} 🪨${c.stone} 🪙${c.gold}`}<br>
        <button ${lvl >= 10 ? 'disabled' : ''} onclick="upgrade('${k}')">Mejorar</button></span></div>`;
    }).join('')}</div>

  <div class="card"><h3>Leyenda de movimientos</h3>${IC.atk} Ataque · ${IC.car} Caravana · ${IC.ref} Refuerzos · ${IC.ret} Retirada</div>`;
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

/* ------------------------- registro ------------------------- */

function vLog() {
  const log = S.log || [];
  return `<div class="card log"><h3>Registro</h3>${log.length
    ? log.map(l => `<div><span class="mu">${new Date(l.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span> ${l.icon || ''} ${esc(l.message)}</div>`).join('')
    : '<span class="mu">Sin eventos</span>'}</div>`;
}

/* ------------------------- acciones ------------------------- */

function train(n) { rpc('train_troops', { p_n: n }, 'Tropas entrenadas'); }
function upgrade(k) { rpc('upgrade_building', { p_key: k }, 'Edificio mejorado'); }
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

/* ------------------------- ciclo de vida ------------------------- */

async function resolveDue() {
  if (resolving || !S) return;
  if (!(S.marches || []).some(m => remaining(m.end_at) <= 0)) return;
  resolving = true;
  try { await sb.rpc('resolve_due_marches'); } catch (_) {}
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
    if (document.visibilityState === 'visible' && !refreshing) refresh();
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

boot();
