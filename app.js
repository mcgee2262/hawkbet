/* HawkBet client. Fake credits only. Every balance change and outcome comes from the server (server.js);
   this file only draws the UI and animates results the server already decided. */
(() => {
const $ = (s, el = document) => el.querySelector(s);
const fmt = n => Math.round(n).toLocaleString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- api + session ---------- */
let U = null, INVITE = false, PROPS = [], CFG = null, pending = 0; // pending = payout still being animated, hidden from the balance until it lands
async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify(body || {}) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !/login|register|\/me/.test(path)) { U = null; renderAuth(); }
  if (!r.ok) throw new Error(j.error || 'Something went wrong');
  return j;
}
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2200); }
const showBal = () => { $('#bal').textContent = U ? fmt(U.balance - pending) : '0'; };
const setBal = n => { U.balance = n; showBal(); };
const act = fn => async (...a) => { if (act.busy) return; act.busy = true; try { await fn(...a); } catch (e) { toast(e.message); } finally { act.busy = false; } };

/* ---------- slip math (display only; the server computes real payouts) ---------- */
const POWER = { 2: 3, 3: 5, 4: 10, 5: 20, 6: 37.5 };
const FLEX = { 3: { 3: 2.25 }, 4: { 4: 5 }, 5: { 5: 10 }, 6: { 6: 25 } };
const topPayout = (mode, n) => mode === 'power' ? POWER[n] : FLEX[n] && FLEX[n][n];
const SPORTS = [['All', '🦅'], ['Football', '🏈'], ['Volleyball', '🏐'], ['Field Hockey', '🏑'], ['Flag Football', '🚩']];
const propById = id => PROPS.find(p => String(p.id) === String(id));
const pick = {}; let mode = 'power', entry = 25, slipOpen = false;

/* ---------- router ---------- */
let view = 'board', sport = 'All', stat = 'All', lineTab = 'open', game = 'plinko', nav = 0;
async function go() {
  const my = ++nav; stopGames();
  if (!U) { try { const m = await api('GET', '/me'); U = m.user; INVITE = m.inviteRequired; } catch (e) {} if (my !== nav) return; }
  document.body.classList.toggle('out', !U);
  $('#logout').classList.toggle('hidden', !U); $('#adminLink').classList.toggle('hidden', !(U && U.isAdmin));
  if (!U) return renderAuth();
  $('#logout').textContent = `${U.username} · Log out`; showBal();
  view = location.hash.slice(1) || 'board';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === view));
  const R = { board: renderBoard, arcade: renderArcade, lineups: renderLineups, leaders: renderLeaders, admin: renderAdmin };
  try { await (R[view] || renderBoard)(my); } catch (e) { if (my === nav) $('#app').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  renderSlipBar();
}
window.addEventListener('hashchange', go);
$('#logout').onclick = async () => { await api('POST', '/logout').catch(() => {}); U = null; Object.keys(pick).forEach(k => delete pick[k]); slipOpen = false; $('#slip').classList.add('hidden'); location.hash = ''; go(); };

/* ---------- auth ---------- */
function renderAuth(signup = false) {
  $('#slipbar').classList.add('hidden'); $('#slip').classList.add('hidden'); document.body.classList.add('out'); $('#logout').classList.add('hidden'); $('#adminLink').classList.add('hidden');
  $('#app').innerHTML = `<form class="panel auth" id="af"><h1 style="margin-top:0">${signup ? 'Create account' : 'Log in'}</h1>
    <input name="u" placeholder="Username" autocomplete="username" autocapitalize="none" required>
    <input name="p" type="password" placeholder="Password${signup ? ' (6+ characters)' : ''}" autocomplete="${signup ? 'new-password' : 'current-password'}" required>
    ${signup && INVITE ? '<input name="i" placeholder="Invite code (ask your teacher or club)" autocomplete="off" required>' : ''}
    <div class="err" id="ae"></div><button class="btn" type="submit">${signup ? 'Sign up · get 1,000 Hawk Bucks' : 'Log in'}</button>
    <div class="swap">${signup ? 'Have an account? <a id="sw">Log in</a>' : 'New here? <a id="sw">Create an account</a>'}</div>
    <div class="note" style="text-align:center">Fake credits only. Don't reuse a real password.</div></form>`;
  $('#sw').onclick = () => renderAuth(!signup);
  $('#af').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    try { U = (await api('POST', signup ? '/register' : '/login', { username: f.u.value, password: f.p.value, invite: f.i ? f.i.value : undefined })).user; location.hash = '#board'; go(); }
    catch (er) { $('#ae').textContent = er.message; }
  };
}

/* ---------- board ---------- */
async function loadProps() { PROPS = (await api('GET', '/props')).props; }
async function renderBoard(my) {
  await loadProps(); if (my !== nav) return;
  const live = PROPS.filter(p => p.status === 'open' || p.status === 'locked');
  const types = ['All', ...new Set(live.filter(p => sport === 'All' || p.sport === sport).map(p => p.type))];
  if (!types.includes(stat)) stat = 'All';
  const list = live.filter(p => (sport === 'All' || p.sport === sport) && (stat === 'All' || p.type === stat));
  $('#app').innerHTML = `<h1>Seahawk Picks</h1>
    <div class="sports">${SPORTS.map(([s, i]) => `<button class="sport ${s === sport ? 'on' : ''}" data-sport="${s}"><span>${i}</span>${s}</button>`).join('')}</div>
    <div class="pills">${types.map(t => `<button class="pill ${t === stat ? 'on' : ''}" data-stat="${t}">${t}</button>`).join('')}</div>
    <div class="grid">${list.map(card).join('') || '<div class="empty">No lines right now. Check back before game day.</div>'}</div>`;
}
function card(p) {
  const c = pick[p.id], lock = p.status !== 'open';
  return `<div class="card ${c ? 'sel' : ''} ${lock ? 'locked' : ''}"><span class="lvl">${lock ? '🔒 Locked' : esc(p.lvl)}</span>
    <div class="logo">${esc(p.init)}</div><div class="who">${esc(p.who)}</div><div class="vs">${esc(p.vs)}</div>
    <div class="num">${p.line}</div><div class="stat">${esc(p.stat)}</div>
    <div class="mm"><button class="${c === 'less' ? 'on' : ''}" ${lock ? 'disabled' : ''} data-pick="${p.id}" data-d="less">▼ Less</button><button class="${c === 'more' ? 'on' : ''}" ${lock ? 'disabled' : ''} data-pick="${p.id}" data-d="more">▲ More</button></div></div>`;
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-sport],[data-stat],[data-pick]'); if (!t) return;
  if (t.dataset.sport) { sport = t.dataset.sport; renderBoard(nav); }
  else if (t.dataset.stat) { stat = t.dataset.stat; renderBoard(nav); }
  else {
    const id = t.dataset.pick, d = t.dataset.d;
    if (pick[id] === d) delete pick[id];
    else { if (!pick[id] && Object.keys(pick).length >= 6) return toast('Max 6 picks per slip'); pick[id] = d; }
    renderBoard(nav); renderSlipBar(); if (slipOpen) renderSlip();
  }
});

/* ---------- slip ---------- */
function renderSlipBar() {
  const n = Object.keys(pick).length;
  $('#slipbar').classList.toggle('hidden', !U || !n || slipOpen || view !== 'board');
  $('#slipbtn').textContent = `Open slip · ${n} pick${n === 1 ? '' : 's'}`;
}
$('#slipbtn').onclick = () => { slipOpen = true; renderSlip(); renderSlipBar(); };
function renderSlip() {
  const ids = Object.keys(pick), n = ids.length, el = $('#slip');
  if (!n) { slipOpen = false; el.classList.add('hidden'); renderSlipBar(); return; }
  if (n < 3 && mode === 'flex') mode = 'power';
  const top = topPayout(mode, n), ok = () => n >= 2 && entry >= 1 && entry <= Math.min(1000, U.balance);
  el.classList.remove('hidden');
  el.innerHTML = `<header><h2 style="margin:0">Your slip</h2><button class="x" id="sx">✕</button></header>
    ${ids.map(id => { const p = propById(id); return `<div class="srow"><div><b>${esc(p.who)}</b><small>${esc(p.stat)} · ${esc(p.vs)}</small></div><div class="r"><span class="tag ${pick[id]}">${pick[id] === 'more' ? '▲ More' : '▼ Less'} ${p.line}</span><button class="x" data-rm="${id}">✕</button></div></div>`; }).join('')}
    <div class="seg"><button data-mode="power" class="${mode === 'power' ? 'on' : ''}">Power Play</button><button data-mode="flex" class="${mode === 'flex' ? 'on' : ''}" ${n < 3 ? 'disabled' : ''}>Flex Play</button></div>
    <div class="note" style="margin:-4px 0 8px">${mode === 'power' ? 'Hit every pick to win.' : 'Miss one and still get paid.'}${n < 2 ? ' Pick at least 2.' : ''}</div>
    <div class="entry"><input id="ent" type="number" min="1" max="1000" value="${entry}"><button class="chip" data-e="10">10</button><button class="chip" data-e="25">25</button><button class="chip" data-e="100">100</button></div>
    <div class="pay"><span>To win</span><span>${top ? fmt(entry * top) : '—'} 🪙 ${top ? `(${top}x)` : ''}</span></div>
    <button class="btn" id="place" ${ok() ? '' : 'disabled'}>Place lineup</button>
    <div class="note">Max entry 1,000. Hawk Bucks have no cash value and can't be bought or cashed out.</div>`;
  $('#sx').onclick = () => { slipOpen = false; el.classList.add('hidden'); renderSlipBar(); };
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { delete pick[b.dataset.rm]; if (view === 'board') renderBoard(nav); renderSlip(); renderSlipBar(); });
  el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if (!b.disabled) { mode = b.dataset.mode; renderSlip(); } });
  el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { entry = +b.dataset.e; renderSlip(); });
  $('#ent').oninput = e => { entry = Math.max(0, Math.floor(+e.target.value || 0)); const t = topPayout(mode, n); $('.pay span:last-child', el).textContent = t ? `${fmt(entry * t)} 🪙 (${t}x)` : '—'; $('#place').disabled = !ok(); };
  $('#place').onclick = act(async () => {
    const r = await api('POST', '/slips', { mode, entry, picks: ids.map(id => ({ propId: Number(id), dir: pick[id] })) });
    setBal(r.balance); ids.forEach(id => delete pick[id]);
    slipOpen = false; el.classList.add('hidden'); toast('Lineup placed – good luck!'); location.hash = '#lineups';
  });
}

/* ---------- lineups ---------- */
async function renderLineups(my) {
  const { slips } = await api('GET', '/slips'); if (my !== nav) return;
  const open = slips.filter(s => s.status === 'open'), done = slips.filter(s => s.status !== 'open'), list = lineTab === 'open' ? open : done;
  const label = s => s.status === 'open' ? 'Pending' : s.status === 'won' ? `+${fmt(s.payout - s.entry)} 🪙 (${s.mult}x)` : s.status === 'void' ? 'Refunded' : 'Lost';
  $('#app').innerHTML = `<h1>My Lineups</h1>
    <div class="sub"><button class="pill ${lineTab === 'open' ? 'on' : ''}" data-lt="open">Open (${open.length})</button><button class="pill ${lineTab === 'done' ? 'on' : ''}" data-lt="done">Settled (${done.length})</button>
    ${U.balance < 100 ? '<button class="pill" id="claim">🎁 Claim +100 top-up</button>' : ''}</div>
    ${list.map(s => `<div class="panel lineup"><div class="hd"><span>${s.picks.length}-pick ${s.mode === 'power' ? 'Power' : 'Flex'} · ${fmt(s.entry)} 🪙</span>
      <span class="${s.status === 'won' ? 'win' : s.status === 'lost' ? 'lose' : s.status === 'void' ? 'push' : ''}">${label(s)}</span></div>
      ${s.picks.map(k => `<div class="srow"><div><b>${esc(k.who)}</b><small>${esc(k.stat)}</small></div><div class="r">${k.actual != null ? `<span class="${k.res || ''}">${k.actual}${k.res ? ' · ' + k.res.toUpperCase() : ''}</span>` : ''}<span class="tag ${k.dir}">${k.dir === 'more' ? '▲' : '▼'} ${k.line}</span></div></div>`).join('')}</div>`).join('') || `<div class="empty">${lineTab === 'open' ? 'No open lineups. Head to Picks to build one.' : 'Nothing settled yet.'}</div>`}`;
  document.querySelectorAll('[data-lt]').forEach(b => b.onclick = () => { lineTab = b.dataset.lt; renderLineups(nav); });
  const c = $('#claim'); if (c) c.onclick = act(async () => { setBal((await api('POST', '/claim')).balance); toast('+100 Hawk Bucks'); renderLineups(nav); });
}

/* ---------- leaderboard ---------- */
async function renderLeaders(my) {
  const r = await api('GET', '/leaderboard'); if (my !== nav) return;
  const inTop = r.top.some(x => x.username === r.me.username);
  $('#app').innerHTML = `<h1>Leaderboard</h1><div class="panel"><table class="lb"><tr><th>#</th><th>Player</th><th>Hawk Bucks</th></tr>
    ${r.top.map((x, i) => `<tr class="${x.username === r.me.username ? 'me' : ''}"><td>${i + 1}</td><td>${esc(x.username)}</td><td>${fmt(x.balance)} 🪙</td></tr>`).join('')}
    ${inTop ? '' : `<tr class="me"><td>${r.me.rank}</td><td>${esc(r.me.username)}</td><td>${fmt(r.me.balance)} 🪙</td></tr>`}</table></div>`;
}

/* ---------- admin ---------- */
async function renderAdmin(my) {
  if (!U.isAdmin) { location.hash = '#board'; return; }
  await loadProps(); if (my !== nav) return;
  $('#app').innerHTML = `<h1>Admin</h1><div class="panel adm"><h2>Add a line</h2><form id="pf" class="addf">
      <select name="sport"><option>Football</option><option>Volleyball</option><option>Field Hockey</option><option>Flag Football</option></select>
      <input name="who" placeholder="Team (SL Varsity)" required><input name="lvl" placeholder="Level (Varsity)"><input name="vs" placeholder="vs Westfield · Fri 7 PM · Home">
      <input name="stat" placeholder="Stat (Points scored)" required><input name="type" placeholder="Filter (Points)"><input name="line" type="number" step="0.5" placeholder="Line (34.5)" required>
      <button class="btn" type="submit">Add line</button></form></div>
    <div class="panel adm" style="margin-top:14px"><h2>Lines</h2>${PROPS.map(p => `<div class="row"><div class="g"><b>${esc(p.who)}</b> · ${esc(p.stat)} <b>${p.line}</b><br><small style="color:var(--mut)">${esc(p.vs)}</small></div>
      <span class="st ${p.status}">${p.status}${p.status === 'graded' ? ' · ' + p.actual : ''}</span>
      ${p.status === 'open' ? `<button class="pill" data-ad="lock" data-id="${p.id}">Lock</button>` : ''}
      ${p.status === 'open' || p.status === 'locked' ? `<input type="number" step="any" placeholder="Result" id="r${p.id}"><button class="pill" data-ad="grade" data-id="${p.id}">Grade</button><button class="pill" data-ad="void" data-id="${p.id}">Void</button>` : ''}</div>`).join('')}
    <div class="note">Locking stops new picks. Grading settles every slip that depends on the line and pays winners instantly. Void refunds picks on a cancelled game.</div></div>`;
  $('#pf').onsubmit = act(async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.line = Number(f.line); await api('POST', '/admin/props', f); toast('Line added'); renderAdmin(nav); });
  $('#pf').addEventListener('submit', e => e.preventDefault());
  document.querySelectorAll('[data-ad]').forEach(b => b.onclick = act(async () => {
    const id = Number(b.dataset.id), k = b.dataset.ad;
    if (k === 'grade') { const v = $('#r' + id).value; await api('POST', '/admin/grade', { propId: id, actual: v === '' ? null : Number(v) }); }
    else await api('POST', '/admin/' + k, { propId: id });
    toast('Done'); renderAdmin(nav);
  }));
}

/* ---------- arcade ---------- */
let stopFns = [];
function stopGames() { stopFns.forEach(f => f()); stopFns = []; if (pending) { pending = 0; showBal(); } }
const GAMES = [['plinko', 'Hawk Drop'], ['mines', 'Locker Hunt'], ['cross', 'Seahawk Crossing']];
async function renderArcade(my) {
  if (!CFG) CFG = await api('GET', '/arcade/config'); if (my !== nav) return;
  $('#app').innerHTML = `<h1>Seahawk Arcade</h1><div class="sub">${GAMES.map(([k, n]) => `<button class="pill ${k === game ? 'on' : ''}" data-g="${k}">${n}</button>`).join('')}</div><div id="gm"></div>`;
  document.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { game = b.dataset.g; go(); });
  await ({ plinko, mines, cross }[game])($('#gm'), my);
}
const betBox = (v = 10) => `<label>Bet (Hawk Bucks, max ${CFG.maxBet})</label><input id="bet" type="number" min="1" max="${CFG.maxBet}" value="${v}">`;
const readBet = () => Math.floor(+$('#bet').value || 0);

/* Plinko: Hawk Drop. The server drops the ball; we animate the path it sends back. */
async function plinko(root, my) {
  let rows = 12, risk = 'med', balls = [], flash = {}, raf, M = null;
  const tables = {};
  root.innerHTML = `<div class="game"><div class="panel ctrl">${betBox()}
    <label>Risk</label><div class="seg" id="risk"><button data-r="low">Low</button><button data-r="med" class="on">Med</button><button data-r="high">High</button></div>
    <label>Rows: <b id="rv">12</b></label><input id="rows" type="range" min="8" max="16" value="12" style="width:100%">
    <div style="height:14px"></div><button class="btn" id="drop">Drop ball</button><div class="res" id="res"></div>
    <div class="note">The server picks where the ball lands, then we play it back. Edge slots pay big, the middle pays little.</div></div>
    <div class="panel stage"><canvas id="cv"></canvas></div></div>`;
  const cv = $('#cv'), ctx = cv.getContext('2d'), W = 640, top = 40, rh = 28; let sp, H;
  async function relayout() {
    const key = rows + risk;
    if (!tables[key]) tables[key] = (await api('GET', `/arcade/plinko-table?rows=${rows}&risk=${risk}`)).mults;
    if (key !== rows + risk) return; M = tables[key];
    sp = Math.min(36, 580 / (rows + 2)); H = top + rows * rh + 70;
    const d = devicePixelRatio || 1; cv.width = W * d; cv.height = H * d; cv.style.width = '100%'; cv.style.maxWidth = W + 'px'; cv.style.aspectRatio = `${W}/${H}`; ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  const px = (r, k) => W / 2 + (k - r / 2) * sp;
  function draw(now) {
    raf = requestAnimationFrame(draw); if (!M) return;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#2f6bff';
    for (let i = 0; i < rows; i++) for (let j = 0; j < i + 3; j++) { ctx.beginPath(); ctx.arc(W / 2 + (j - (i + 2) / 2) * sp, top + i * rh, 3.2, 0, 7); ctx.fill(); }
    const y = top + rows * rh + 22, w = sp * 0.86;
    M.forEach((m, k) => {
      const x = px(rows, k), f = flash[k] && now - flash[k] < 400 ? 1 - (now - flash[k]) / 400 : 0;
      ctx.fillStyle = m >= 5 ? '#ffc542' : m >= 1 ? '#12c26a' : '#2a3a4d'; ctx.globalAlpha = 0.55 + f * 0.45;
      ctx.beginPath(); ctx.roundRect(x - w / 2, y - 12 + f * 4, w, 26, 6); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = m >= 1 ? '#00110a' : '#cfe0f3'; ctx.font = `700 ${Math.min(11, sp * 0.3)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText((m >= 10 ? m.toFixed(0) : m.toFixed(1)) + 'x', x, y + 5);
    });
    balls.forEach(b => {
      const t = Math.max(0, Math.min((now - b.t0) / 120, b.pts.length - 1)), i = Math.floor(t), f = t - i;
      if (t >= b.pts.length - 1 && !b.done) { b.done = true; flash[b.k] = now; land(b); }
      const a = b.pts[i], c = b.pts[Math.min(i + 1, b.pts.length - 1)], x = a[0] + (c[0] - a[0]) * f, yy = a[1] + (c[1] - a[1]) * f - Math.sin(f * Math.PI) * 7;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, yy, 6, 0, 7); ctx.fill(); ctx.fillStyle = '#12c26a'; ctx.beginPath(); ctx.arc(x, yy, 3, 0, 7); ctx.fill();
    });
    balls = balls.filter(b => !b.done || now - b.t0 < b.pts.length * 120 + 50);
  }
  function land(b) {
    pending = Math.max(0, pending - b.payout); showBal();
    $('#res').innerHTML = `<span class="${b.mult >= 1 ? 'win' : 'lose'}">${b.mult.toFixed(2)}x · ${b.payout - b.bet >= 0 ? '+' : ''}${fmt(b.payout - b.bet)} 🪙</span>`;
  }
  $('#drop').onclick = act(async () => {
    const r = await api('POST', '/arcade/plinko', { bet: readBet(), rows, risk });
    pending += r.payout; setBal(r.balance); // balance already includes the payout; hold it back until the ball lands
    let k = 0; const pts = [[W / 2, top - 26]];
    r.path.forEach((right, i) => { pts.push([px(i, k), top + i * rh]); k += right; });
    pts.push([px(rows, k), top + rows * rh + 22]);
    balls.push({ pts, k: r.k, bet: r.bet, payout: r.payout, mult: r.mult, t0: performance.now(), done: false });
  });
  $('#risk').onclick = e => { const r = e.target.dataset.r; if (!r) return; risk = r; document.querySelectorAll('#risk button').forEach(b => b.classList.toggle('on', b.dataset.r === r)); relayout().catch(x => toast(x.message)); };
  $('#rows').oninput = e => { rows = +e.target.value; $('#rv').textContent = rows; relayout().catch(x => toast(x.message)); };
  await relayout(); if (my !== nav) return;
  raf = requestAnimationFrame(draw); stopFns.push(() => cancelAnimationFrame(raf));
}

/* Mines: Locker Hunt. Mine positions never leave the server until the round ends. */
async function mines(root, my) {
  let st = null, nm = 3;
  root.innerHTML = `<div class="game"><div class="panel ctrl">${betBox()}
    <label>Hall monitors hidden: <b id="mv">3</b></label><input id="mn" type="range" min="1" max="24" value="3" style="width:100%">
    <div style="height:14px"></div><button class="btn" id="start">Start game</button>
    <button class="btn gold hidden" id="cash" style="margin-top:8px"></button><div class="res" id="res"></div>
    <div class="note">Open lockers to find Hawk Bucks. Hit a hall monitor and you lose the bet. Cash out any time.</div></div>
    <div class="panel stage"><div class="mult" id="mult">—</div><div class="lockers" id="lk"></div></div></div>`;
  function paint(reveal) {
    $('#lk').innerHTML = Array.from({ length: 25 }, (_, i) => {
      const open = st && st.opened.has(i), mine = st && st.mines && st.mines.has(i);
      const cls = open ? 'open' : (reveal && mine) ? 'bad' + (st.hit === i ? '' : ' dim') : reveal ? 'dim' : '';
      return `<button class="lk ${cls}" data-i="${i}" ${!st || !st.live || open ? 'disabled' : ''}>${open ? '🦅' : (reveal && mine) ? '📋' : ''}</button>`;
    }).join('');
    $('#mult').textContent = st ? st.mult.toFixed(2) + 'x' : '—';
    const cash = $('#cash'); cash.classList.toggle('hidden', !(st && st.live && st.opened.size > 0)); if (st) cash.textContent = `Cash out ${fmt(st.bet * st.mult)} 🪙`;
    $('#start').disabled = !!(st && st.live); $('#mn').disabled = !!(st && st.live);
  }
  function finish(r, win) {
    if (r.mines) st.mines = new Set(r.mines); st.live = false; setBal(r.balance); paint(true);
    $('#res').innerHTML = win ? `<span class="win">Cashed out +${fmt(r.payout - st.bet)} 🪙</span>` : `<span class="lose">Hall monitor! −${fmt(st.bet)} 🪙</span>`;
  }
  const a = (await api('GET', '/arcade/active?game=mines')).round; if (my !== nav) return;
  if (a) { st = { bet: a.bet, nm: a.m, opened: new Set(a.opened), mult: a.mult, live: true }; nm = a.m; $('#mn').value = nm; $('#mv').textContent = nm; $('#res').textContent = 'Round restored'; }
  $('#mn').oninput = e => { nm = +e.target.value; $('#mv').textContent = nm; };
  $('#start').onclick = act(async () => {
    const r = await api('POST', '/arcade/mines/start', { bet: readBet(), mines: nm }); setBal(r.balance);
    st = { bet: r.bet, nm, opened: new Set(), mult: 0.99, live: true }; $('#res').textContent = ''; paint();
  });
  $('#lk').onclick = act(async e => {
    const b = e.target.closest('.lk'); if (!b || !st || !st.live) return; const i = +b.dataset.i;
    const r = await api('POST', '/arcade/mines/reveal', { i });
    if (r.bust) { st.hit = i; return finish(r, false); }
    st.opened = new Set(r.opened); st.mult = r.mult; if (r.cashed) return finish(r, true); paint();
  });
  $('#cash').onclick = act(async () => { if (st && st.live) { const r = await api('POST', '/arcade/mines/cashout'); st.mult = r.mult; finish(r, true); } });
  paint();
}

/* Chicken cross: Seahawk Crossing. The server decides which lane gets you; it only says so when you step there. */
async function cross(root, my) {
  let d = 'med', st = null;
  root.innerHTML = `<div class="game"><div class="panel ctrl">${betBox()}
    <label>Difficulty</label><div class="seg" id="df" style="grid-template-columns:1fr 1fr"><button data-d="easy">Easy</button><button data-d="med" class="on">Medium</button><button data-d="hard">Hard</button><button data-d="extreme">Extreme</button></div>
    <div style="height:14px"></div><button class="btn" id="start">Start crossing</button>
    <button class="btn hidden" id="go" style="margin-top:8px">Next lane</button>
    <button class="btn gold hidden" id="cash" style="margin-top:8px"></button><div class="res" id="res"></div>
    <div class="note">Each lane survived raises your multiplier. Get hit and you lose the bet.</div></div>
    <div class="panel stage"><div class="mult" id="mult">—</div><div class="road" id="road"></div><div class="curb">🏫 South Lakes Dr → get to the stadium 🏟️</div></div></div>`;
  const mults = () => CFG.cross[d], at = () => st ? st.at : 0, multNow = () => at() ? mults()[at() - 1] : 0.99;
  function paint() {
    const a = at();
    $('#road').innerHTML = `<div class="lane" style="background:none;border:0;min-width:50px"><span class="hawk">${a === 0 ? '🦅' : ''}</span></div>` + mults().map((m, i) => {
      const n = i + 1, done = a >= n && !(st && st.hitLane === n), hit = st && st.hitLane === n;
      const em = hit ? '💥' : (st && a === n && st.live ? '🦅' : done ? '✔' : n % 2 ? '🚌' : '🚗');
      return `<div class="lane ${done ? 'done' : ''} ${hit ? 'hit' : ''}"><span class="m">${m.toFixed(2)}x</span><span class="em">${em}</span></div>`;
    }).join('');
    $('#mult').textContent = st ? multNow().toFixed(2) + 'x' : '—';
    const live = st && st.live;
    $('#go').classList.toggle('hidden', !live); $('#cash').classList.toggle('hidden', !(live && a > 0)); $('#start').disabled = !!live;
    document.querySelectorAll('#df button').forEach(b => b.disabled = !!live);
    if (st) $('#cash').textContent = `Cash out ${fmt(st.bet * multNow())} 🪙`;
    if (live) { const r = $('#road'), el = r.children[a + 1] || r.lastChild; el && el.scrollIntoView({ inline: 'center', block: 'nearest' }); }
  }
  function finish(r, win) {
    st.live = false; setBal(r.balance); paint();
    $('#res').innerHTML = win ? `<span class="win">Cashed out +${fmt(r.payout - st.bet)} 🪙</span>` : `<span class="lose">Splat! −${fmt(st.bet)} 🪙</span>`;
  }
  const a = (await api('GET', '/arcade/active?game=cross')).round; if (my !== nav) return;
  if (a) { d = a.diff; st = { bet: a.bet, at: a.at, live: true }; document.querySelectorAll('#df button').forEach(b => b.classList.toggle('on', b.dataset.d === d)); $('#res').textContent = 'Round restored'; }
  $('#df').onclick = e => { const x = e.target.dataset.d; if (!x || (st && st.live)) return; d = x; document.querySelectorAll('#df button').forEach(b => b.classList.toggle('on', b.dataset.d === x)); paint(); };
  $('#start').onclick = act(async () => {
    const r = await api('POST', '/arcade/cross/start', { bet: readBet(), diff: d }); setBal(r.balance);
    st = { bet: r.bet, at: 0, live: true }; $('#res').textContent = ''; paint();
  });
  $('#go').onclick = act(async () => {
    if (!st || !st.live) return; const r = await api('POST', '/arcade/cross/step');
    if (r.hit) { st.at = r.lane; st.hitLane = r.lane; return finish(r, false); }
    st.at = r.at; if (r.cashed) return finish(r, true); paint();
  });
  $('#cash').onclick = act(async () => { if (st && st.live) finish(await api('POST', '/arcade/cross/cashout'), true); });
  paint();
}

go();
})();
