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
  if (method === 'POST' && path.startsWith('/arcade/')) {
    if (typeof j.payout === 'number') lastRes = { game: path.split('/')[2], mult: j.mult, payout: j.payout, bet: j.bet ?? j.total ?? (j.mult ? j.payout / j.mult : 0) };
    if (/\/start$|^\/arcade\/(plinko|dice|limbo|slots|roulette)$/.test(path)) sfx.play('start');
    else if (/cashout$/.test(path)) sfx.play('cash');
    else if (/mines\/reveal|cross\/step/.test(path) && !j.bust && !j.hit && !j.cashed) sfx.play('reveal');
  }
  return j;
}
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2200); }
/* ---------- effects: confetti, shake, count-up balance ---------- */
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
/* ---------- Luck Lab themes (cosmetic only: confetti look and win chimes) ---------- */
const LUCK = [ // [level, emoji, name, what changes]
  ['normal', '⚪', 'Normal', 'Standard HawkBet celebrations. The default.'],
  [1, '⚡', 'Chaos Mode', 'Stormy purple sparks, light confetti, a thunder thud on wins.'],
  [2, '⛈️', 'Thunderstorm', 'Dark storm colors with lightning-bolt confetti.'],
  [3, '🌧️', 'Rainy Day', 'Cool blue drizzle confetti.'],
  [4, '☁️', 'Cloudy', 'Soft gray-blue confetti and calm sounds.'],
  [5, '⚖️', 'Balanced', 'Even South Lakes green and blue.'],
  [6, '☀️', 'Sunny', 'Bright yellow and green confetti.'],
  [7, '🌅', 'Golden Hour', 'Warm gold and orange confetti.'],
  [8, '🍀', 'Four-Leaf', 'Clover confetti joins the party.'],
  [9, '🌈', 'Rainbow', 'Full-rainbow confetti.'],
  [10, '✨', 'Lucky Vibes', 'Max confetti, clovers and sparkles, plus a lucky chime on wins.'],
  ['x2', '🔥', 'Super Luck ×2', 'Your chance to LOSE is cut in half. Payouts stay normal. Orange fire confetti.'],
  ['x5', '⚡', 'Super Luck ×5', 'Your chance to LOSE is divided by 5. Payouts stay normal. Electric gold and diamonds.'],
  ['x10', '💎', 'Super Luck ×10', 'Your chance to LOSE is divided by 10. Payouts stay normal. Diamonds, crowns and a confetti storm.'],
];
const LUCK_FX = {
  normal: { c: ['#12c26a', '#16e0c0', '#2f6bff', '#ffc542', '#ffffff', '#5b8cff'], e: [], m: 1 },
  1: { c: ['#7b3cff', '#ff4d5e', '#3a2a5a', '#b388ff'], e: ['⚡'] }, 2: { c: ['#3a3f58', '#7b3cff', '#8fa3c7', '#ffe08a'], e: ['⚡', '🌩️'] },
  3: { c: ['#5b8cff', '#8fb0ff', '#2f6bff', '#cfe0f3'], e: ['💧'] }, 4: { c: ['#8fa3c7', '#cfd8e3', '#5b8cff', '#ffffff'], e: ['☁️'] },
  5: { c: ['#12c26a', '#2f6bff', '#16e0c0', '#5b8cff'], e: [] }, 6: { c: ['#ffe08a', '#12c26a', '#ffc542', '#9ff5c8'], e: ['☀️'] },
  7: { c: ['#ffc542', '#f5a623', '#ff9f1a', '#ffe08a'], e: ['🌟'] }, 8: { c: ['#12c26a', '#0a8f4e', '#ffc542', '#9ff5c8'], e: ['🍀'] },
  9: { c: ['#ff4d5e', '#ff9f1a', '#ffe08a', '#12c26a', '#2f6bff', '#7b3cff'], e: ['🌈'] }, 10: { c: ['#ffc542', '#12c26a', '#ffe08a', '#16e0c0', '#ffffff'], e: ['🍀', '✨'] },
  x2: { c: ['#ff9f1a', '#ff4d5e', '#ffc542', '#ffe08a'], e: ['🔥'], m: 1.8 }, x5: { c: ['#ffe08a', '#16e0c0', '#5b8cff', '#ffffff'], e: ['⚡', '💎'], m: 2.4 },
  x10: { c: ['#ffc542', '#ff4fd8', '#16e0c0', '#7b3cff', '#ffffff', '#ff4d5e'], e: ['💎', '👑', '✨'], m: 3.2 },
};
const luckLevel = () => (U && U.luck) || 'normal';
const luckFx = () => { const l = luckLevel(), t = LUCK_FX[l] || LUCK_FX.normal; return { ...t, m: t.m || (l === 'normal' ? 1 : 0.5 + l * 0.1) }; }; // confetti amount: 0.6x at 1 … 1.5x at 10, 1.8x–3.2x for Super Luck
const isSuper = () => String(luckLevel())[0] === 'x';
const luckEntry = () => LUCK.find(x => String(x[0]) === String(luckLevel())) || LUCK[0];
const luckK = () => { const l = luckLevel(); return l === 'normal' ? 1 : isSuper() ? +String(l).slice(1) : Math.round((0.5 + 0.1 * l) * 10) / 10; }; // mirrors the server; the server decides
const luckBadge = () => { const [lv, e, name] = luckEntry(); return lv === 'normal' ? `${e} Luck: Normal · standard odds` : isSuper() ? `${e} ${name} · lose chance ÷${luckK()}` : `${e} Luck: ${name} (${lv}) · win chance ×${luckK()}`; };
const pct = p => Math.round(p * 100) + '%';
const luckLine = what => CFG.luck.sup ? `<div class="lucknote super">🔥 Super Luck ×${CFG.luck.k}: your chance to lose is divided by ${CFG.luck.k}, payouts stay normal.</div>` : CFG.luck.k === 1 ? '' : `<div class="lucknote">🍀 Luck ×${CFG.luck.k}: ${what}</div>`;

/* ---------- sound: tiny Web Audio synth, no files. Silent until the first tap or key press. ---------- */
const sfx = (() => {
  let ac = null, out = null, on = true;
  try { on = localStorage.getItem('hb.sound') !== 'off'; } catch (e) {}
  function unlock() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); const lim = ac.createDynamicsCompressor(); lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 8; lim.attack.value = 0.003; lim.release.value = 0.15; out = ac.createGain(); out.gain.value = 1.9; out.connect(lim); lim.connect(ac.destination); } catch (e) { return; } }
    if (ac.state === 'suspended') ac.resume();
  }
  addEventListener('pointerdown', unlock, true); addEventListener('keydown', unlock, true);
  function tone(f, t = 0, d = 0.12, type = 'sine', g = 0.08, f2) {
    const o = ac.createOscillator(), a = ac.createGain(), s = ac.currentTime + t;
    o.type = type; o.frequency.setValueAtTime(f, s); if (f2) o.frequency.exponentialRampToValueAtTime(f2, s + d);
    a.gain.setValueAtTime(0.0001, s); a.gain.exponentialRampToValueAtTime(g, s + 0.012); a.gain.exponentialRampToValueAtTime(0.0001, s + d);
    o.connect(a); a.connect(out); o.start(s); o.stop(s + d + 0.03);
  }
  const notes = (fs, step, d, type, g) => fs.forEach((f, k) => tone(f, k * step, d, type, g));
  function flavor() { const l = luckLevel(); if (l !== 'normal' && l <= 2) tone(120, 0, 0.25, 'sine', 0.08, 70); if (l >= 8) { tone(2093, 0.3, 0.35, 'sine', 0.035); tone(2637, 0.38, 0.35, 'sine', 0.03); } }
  const S = {
    tap: () => tone(620, 0, 0.05, 'triangle', 0.04),
    flip: () => tone(1100, 0, 0.06, 'triangle', 0.05, 1400),
    start: () => notes([440, 660], 0.07, 0.1, 'triangle', 0.05),
    reveal: () => tone(880, 0, 0.11, 'sine', 0.06, 1320),
    streak: () => notes([660, 990], 0.06, 0.1, 'square', 0.025),
    miss: () => tone(300, 0, 0.14, 'triangle', 0.045, 210),
    win: () => { notes([523, 659, 784], 0.08, 0.16, 'triangle', 0.06); flavor(); },
    big: () => { notes([523, 659, 784, 1047], 0.08, 0.2, 'triangle', 0.065); tone(1568, 0.36, 0.4, 'sine', 0.04); flavor(); },
    lose: () => tone(330, 0, 0.3, 'sine', 0.055, 175),
    cash: () => { tone(988, 0, 0.07, 'square', 0.03); tone(1319, 0.07, 0.2, 'square', 0.03); },
    pb: () => notes([392, 523, 659, 784, 1047], 0.09, 0.22, 'triangle', 0.06),
    error: () => { tone(220, 0, 0.1, 'square', 0.03); tone(185, 0.11, 0.14, 'square', 0.03); },
    bell: () => { tone(1568, 0, 0.7, 'sine', 0.08); tone(2349, 0, 0.5, 'sine', 0.03); tone(1568, 0.12, 0.5, 'sine', 0.05); },
    clunk: () => { tone(160, 0, 0.14, 'sine', 0.13, 62); tone(95, 0.01, 0.12, 'triangle', 0.08); },
    ratchet: () => [0, 0.05, 0.1, 0.15, 0.2].forEach((t, k) => tone(700 + k * 90, t, 0.035, 'square', 0.04)),
    lever: () => tone(380, 0, 0.3, 'sawtooth', 0.04, 130),
    coin: () => { tone(1568, 0, 0.06, 'square', 0.035); tone(2093, 0.06, 0.2, 'square', 0.035); },
    jackpot: () => { notes([523, 659, 784, 1047, 1319, 1568, 2093, 2637], 0.07, 0.26, 'triangle', 0.075); tone(262, 0, 1.1, 'sawtooth', 0.035); tone(2093, 0.6, 0.8, 'sine', 0.05); },
  };
  return {
    play(name) { if (!on || !ac || ac.state !== 'running' || !S[name]) return; try { S[name](); } catch (e) {} },
    get on() { return on; },
    toggle() { on = !on; try { localStorage.setItem('hb.sound', on ? 'on' : 'off'); } catch (e) {} if (on) { unlock(); setTimeout(() => this.play('tap'), 30); } return on; },
  };
})();
document.addEventListener('click', e => { if (e.target.closest('button:not(:disabled),.tabs a,a.pill')) sfx.play('tap'); });

/* ---------- personal bests (from the server's own round history) ---------- */
let STATS = { best: {}, recent: [] }, lastRes = null;
function bestText(id) { const b = STATS.best[id]; return !b ? '' : b.score != null ? `${fmt(b.score)} pts` : `${b.mult.toFixed(2)}x`; }
function paintPB() {
  const el = $('#pb'); if (!el) return; const b = STATS.best[game];
  el.innerHTML = b ? `🏆 Your best: <b>${bestText(game)}</b>${b.win ? ` · biggest win +${fmt(b.win)} 🪙` : ''}` : '🏆 No personal best yet – go set one';
}
function checkPB() { // called when a win celebration plays; lastRes is the server's settled result
  const r = lastRes; lastRes = null; if (!r || !(r.payout > r.bet) || !r.mult) return;
  const b = STATS.best[r.game] || {}; if (b.mult && r.mult <= b.mult) return;
  STATS.best[r.game] = { mult: r.mult, win: Math.max(b.win || 0, r.payout - r.bet) }; paintPB();
  if (b.mult) setTimeout(() => { toast(`🏆 New personal best: ${r.mult.toFixed(2)}x!`); sfx.play('pb'); fx.bump($('#pb')); }, 650);
}
const fx = (() => {
  const cv = $('#fx'), ctx = cv.getContext('2d'); let parts = [], raf = 0;
  const COLORS = ['#12c26a', '#16e0c0', '#2f6bff', '#ffc542', '#ffffff', '#5b8cff'];
  function size() { const d = devicePixelRatio || 1; cv.width = innerWidth * d; cv.height = innerHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
  addEventListener('resize', size); size();
  function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(p => p.life > 0);
    for (const p of parts) {
      p.vy += 0.25; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life--;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.life / 30); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      if (p.e) { ctx.font = '20px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(p.e, 0, 0); } else { ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
      ctx.restore();
    }
    raf = parts.length ? requestAnimationFrame(tick) : 0;
  }
  function burst(n = 120, x = innerWidth / 2, y = innerHeight / 3) {
    if (calm) return;
    const t = luckFx(); n = Math.round(n * t.m);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 9; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5, r: Math.random() * 6, vr: (Math.random() - .5) * .4, w: 6 + Math.random() * 6, h: 4 + Math.random() * 4, c: t.c[i % t.c.length], e: t.e.length && i % 5 === 0 ? t.e[i % t.e.length] : '', life: 80 + Math.random() * 50 }); }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  const pulse = (el, cls, ms = 800) => { if (!el || calm) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };
  return {
    burst,
    win(big) { burst(big ? 220 : 90); pulse($('.stage') || $('#app'), 'flash-win'); sfx.play(big ? 'big' : 'win'); checkPB(); },
    lose() { pulse($('.stage') || $('#app'), 'shake', 500); sfx.play('lose'); },
    bump(el) { pulse(el, 'bump', 400); },
  };
})();
let shownBal = null;
const showBal = () => {
  const el = $('#bal'), target = U ? U.balance - pending : 0, from = shownBal ?? target; shownBal = target;
  if (from === target || calm) { el.textContent = fmt(target); return; }
  const box = $('#balbox'); box.classList.remove('up', 'down'); void box.offsetWidth; box.classList.add(target > from ? 'up' : 'down');
  const t0 = performance.now(), step = t => { const k = Math.min(1, (t - t0) / 500), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (target - from) * e); if (k < 1 && shownBal === target) requestAnimationFrame(step); };
  requestAnimationFrame(step);
};
const setBal = n => { U.balance = n; showBal(); };
const act = fn => async (...a) => { if (act.busy) return; act.busy = true; try { await fn(...a); } catch (e) { toast(e.message); sfx.play('error'); } finally { act.busy = false; } };

/* ---------- slip math (display only; the server computes real payouts) ---------- */
const POWER = { 2: 3, 3: 5, 4: 10, 5: 20, 6: 37.5 };
const FLEX = { 3: { 3: 2.25 }, 4: { 4: 5 }, 5: { 5: 10 }, 6: { 6: 25 } };
const topPayout = (mode, n) => mode === 'power' ? POWER[n] : FLEX[n] && FLEX[n][n];
const SPORTS = [['All', '🦅'], ['Football', '🏈'], ['Volleyball', '🏐'], ['Field Hockey', '🏑'], ['Flag Football', '🚩']];
const propById = id => PROPS.find(p => String(p.id) === String(id));
const pick = {}; let mode = 'power', entry = 25, slipOpen = false;

/* ---------- router ---------- */
let view = 'home', sport = 'All', stat = 'All', lineTab = 'open', game = 'plinko', nav = 0;
async function go() {
  const my = ++nav; stopGames();
  if (!U) { try { const m = await api('GET', '/me'); U = m.user; INVITE = m.inviteRequired; } catch (e) {} if (my !== nav) return; }
  document.body.classList.toggle('out', !U);
  $('#logout').classList.toggle('hidden', !U); $('#adminLink').classList.toggle('hidden', !(U && U.isAdmin));
  if (!U) return renderAuth();
  $('#logout').textContent = `${U.username} · Log out`; showBal();
  view = location.hash.slice(1) || 'home';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === view));
  const R = { home: renderHome, board: renderBoard, arcade: renderArcade, lineups: renderLineups, leaders: renderLeaders, admin: renderAdmin, bank: renderBank, luck: renderLuck };
  try { await (R[view] || renderHome)(my); } catch (e) { if (my === nav) $('#app').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  renderSlipBar();
}
window.addEventListener('hashchange', go);
const paintSound = () => { const b = $('#sound'); b.textContent = sfx.on ? '🔊' : '🔇'; b.setAttribute('aria-pressed', String(sfx.on)); b.setAttribute('aria-label', sfx.on ? 'Sound on' : 'Sound off'); };
$('#sound').onclick = () => { sfx.toggle(); paintSound(); toast(sfx.on ? '🔊 Sound on' : '🔇 Sound off'); }; paintSound();
$('#logout').onclick = async () => { await api('POST', '/logout').catch(() => {}); U = null; CFG = null; Object.keys(pick).forEach(k => delete pick[k]); slipOpen = false; $('#slip').classList.add('hidden'); location.hash = ''; go(); };

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
    try { U = (await api('POST', signup ? '/register' : '/login', { username: f.u.value, password: f.p.value, invite: f.i ? f.i.value : undefined })).user; location.hash = '#home'; go(); }
    catch (er) { $('#ae').textContent = er.message; }
  };
}

/* ---------- board ---------- */
async function loadProps() { PROPS = (await api('GET', '/props')).props; }
async function renderBoard(my, keep) {
  await loadProps(); if (my !== nav) return;
  const live = PROPS.filter(p => p.status === 'open' || p.status === 'locked');
  const types = ['All', ...new Set(live.filter(p => sport === 'All' || p.sport === sport).map(p => p.type))];
  if (!types.includes(stat)) stat = 'All';
  const list = live.filter(p => (sport === 'All' || p.sport === sport) && (stat === 'All' || p.type === stat));
  if (!keep || !$('#picksArea')) $('#app').innerHTML = '<div id="picksArea"></div>';
  $('#picksArea').innerHTML = `<h1>Seahawk Picks</h1>
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
  if (t.dataset.sport) { sport = t.dataset.sport; renderBoard(nav, true); }
  else if (t.dataset.stat) { stat = t.dataset.stat; renderBoard(nav, true); }
  else {
    const id = t.dataset.pick, d = t.dataset.d;
    if (pick[id] === d) delete pick[id];
    else { if (!pick[id] && Object.keys(pick).length >= 6) return toast('Max 6 picks per slip'); pick[id] = d; }
    renderBoard(nav, true); renderSlipBar(); if (slipOpen) renderSlip();
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
  const top = topPayout(mode, n), ok = () => n >= 2 && entry >= 1 && entry <= U.balance;
  el.classList.remove('hidden');
  el.innerHTML = `<header><h2 style="margin:0">Your slip</h2><button class="x" id="sx">✕</button></header>
    ${ids.map(id => { const p = propById(id); return `<div class="srow"><div><b>${esc(p.who)}</b><small>${esc(p.stat)} · ${esc(p.vs)}</small></div><div class="r"><span class="tag ${pick[id]}">${pick[id] === 'more' ? '▲ More' : '▼ Less'} ${p.line}</span><button class="x" data-rm="${id}">✕</button></div></div>`; }).join('')}
    <div class="seg"><button data-mode="power" class="${mode === 'power' ? 'on' : ''}">Power Play</button><button data-mode="flex" class="${mode === 'flex' ? 'on' : ''}" ${n < 3 ? 'disabled' : ''}>Flex Play</button></div>
    <div class="note" style="margin:-4px 0 8px">${mode === 'power' ? 'Hit every pick to win.' : 'Miss one and still get paid.'}${n < 2 ? ' Pick at least 2.' : ''}</div>
    <div class="entry"><input id="ent" type="number" min="1" value="${entry}"><button class="chip" data-e="10">10</button><button class="chip" data-e="25">25</button><button class="chip" data-e="100">100</button></div>
    <div class="pay"><span>To win</span><span>${top ? fmt(entry * top) : '—'} 🪙 ${top ? `(${top}x)` : ''}</span></div>
    <button class="btn" id="place" ${ok() ? '' : 'disabled'}>Place lineup</button>
    <div class="note">No entry limit beyond your balance. Hawk Bucks have no cash value and can't be bought or cashed out.</div>`;
  $('#sx').onclick = () => { slipOpen = false; el.classList.add('hidden'); renderSlipBar(); };
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { delete pick[b.dataset.rm]; if (view === 'board') renderBoard(nav, true); renderSlip(); renderSlipBar(); });
  el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if (!b.disabled) { mode = b.dataset.mode; renderSlip(); } });
  el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { entry = +b.dataset.e; renderSlip(); });
  $('#ent').oninput = e => { entry = Math.max(0, Math.floor(+e.target.value || 0)); const t = topPayout(mode, n); $('.pay span:last-child', el).textContent = t ? `${fmt(entry * t)} 🪙 (${t}x)` : '—'; $('#place').disabled = !ok(); };
  $('#place').onclick = act(async () => {
    const r = await api('POST', '/slips', { mode, entry, picks: ids.map(id => ({ propId: Number(id), dir: pick[id] })) });
    setBal(r.balance); ids.forEach(id => delete pick[id]);
    slipOpen = false; el.classList.add('hidden'); toast('Lineup placed – good luck!'); fx.burst(70); location.hash = '#lineups';
  });
}

/* ---------- lineups ---------- */
async function renderLineups(my) {
  const { slips } = await api('GET', '/slips'); if (my !== nav) return;
  const open = slips.filter(s => s.status === 'open'), done = slips.filter(s => s.status !== 'open'), list = lineTab === 'open' ? open : done;
  const label = s => s.status === 'open' ? 'Pending' : s.status === 'won' ? `+${fmt(s.payout - s.entry)} 🪙 (${s.mult}x)` : s.status === 'void' ? 'Refunded' : 'Lost';
  $('#app').innerHTML = `<h1>My Lineups</h1>
    <div class="sub"><button class="pill ${lineTab === 'open' ? 'on' : ''}" data-lt="open">Open (${open.length})</button><button class="pill ${lineTab === 'done' ? 'on' : ''}" data-lt="done">Settled (${done.length})</button>
    ${U.balance < 100 ? '<a class="pill" href="#bank">🏦 Add Hawk Bucks</a>' : ''}</div>
    ${list.map(s => `<div class="panel lineup"><div class="hd"><span>${s.picks.length}-pick ${s.mode === 'power' ? 'Power' : 'Flex'} · ${fmt(s.entry)} 🪙</span>
      <span class="${s.status === 'won' ? 'win' : s.status === 'lost' ? 'lose' : s.status === 'void' ? 'push' : ''}">${label(s)}</span></div>
      ${s.picks.map(k => `<div class="srow"><div><b>${esc(k.who)}</b><small>${esc(k.stat)}</small></div><div class="r">${k.actual != null ? `<span class="${k.res || ''}">${k.actual}${k.res ? ' · ' + k.res.toUpperCase() : ''}</span>` : ''}<span class="tag ${k.dir}">${k.dir === 'more' ? '▲' : '▼'} ${k.line}</span></div></div>`).join('')}</div>`).join('') || `<div class="empty">${lineTab === 'open' ? 'No open lineups. Head to Picks to build one.' : 'Nothing settled yet.'}</div>`}`;
  document.querySelectorAll('[data-lt]').forEach(b => b.onclick = () => { lineTab = b.dataset.lt; renderLineups(nav); });
}

/* ---------- leaderboard ---------- */
async function renderLeaders(my) {
  const r = await api('GET', '/leaderboard'); if (my !== nav) return;
  const inTop = r.top.some(x => x.username === r.me.username);
  const net = n => `<span class="${n > 0 ? 'win' : n < 0 ? 'lose' : ''}">${n > 0 ? '+' : ''}${fmt(n)}</span>`;
  const row = (x, rank) => `<tr class="${x.username === r.me.username ? 'me' : ''}"><td>${rank}</td><td>${esc(x.username)}</td><td class="mutecell">${fmt(x.balance)}</td><td>${net(x.net)} 🪙</td></tr>`;
  $('#app').innerHTML = `<h1>Leaderboard</h1><div class="panel"><table class="lb"><tr><th>#</th><th>Player</th><th>Balance</th><th>Net winnings</th></tr>
    ${r.top.map((x, i) => row(x, i + 1)).join('')}${inTop ? '' : row(r.me, r.me.rank)}</table>
    <div class="note">Ranked by net winnings: balance minus the starting 1,000 and anything added at the Bank.</div></div>`;
}

/* ---------- admin ---------- */
async function renderAdmin(my) {
  if (!U.isAdmin) { location.hash = '#home'; return; }
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
const GAMES = [['plinko', '🔵 Hawk Drop'], ['mines', '🔐 Locker Hunt'], ['cross', '🚌 Seahawk Crossing'], ['flip', '🪙 Heads or Tails'], ['dice', '🎲 Scoreboard Roll'], ['limbo', '🏈 Hail Mary'], ['slots', '🎰 Seahawk Slots'], ['roulette', '🎡 Lakes Roulette'], ['rps', '✊ Hallway RPS'], ['bj', '🃏 Hawk 21'], ['rocket', '🚀 Seahawk Launch'], ['bell', '🔔 Bell Rush'], ['memory', '🧠 Classroom Memory'], ['trivia', '❓ Seahawk Trivia']];
const GAME_FNS = { plinko, mines, cross, flip, dice, limbo, slots, roulette, rps, bj, rocket, bell, memory, trivia }; // every game that can launch
const CATS = [['all', 'All'], ['featured', '⭐ Featured'], ['recent', '🕘 Recent'], ['classic', '🎰 Classic'], ['skill', '🧠 Skill']];
const SKILL_IDS = new Set(['bell', 'memory', 'trivia']);
let arcCat = 'all';
async function renderArcade(my) {
  if (!CFG || CFG.user !== U.username) CFG = { ...(await api('GET', '/arcade/config')), user: U.username };
  STATS = await api('GET', '/arcade/stats').catch(() => STATS); if (my !== nav) return;
  const list = gameList(), byId = Object.fromEntries(list.map(g => [g.id, g]));
  const week = Math.floor((Date.now() / 864e5 + 4) / 7), featured = [...new Set([0, 1, 2].map(k => list[(week * 3 + k * 5) % list.length]))]; // rotates every Monday
  const shown = { all: list, featured, recent: STATS.recent.map(id => byId[id]).filter(Boolean), classic: list.filter(g => !SKILL_IDS.has(g.id)), skill: list.filter(g => SKILL_IDS.has(g.id)) }[arcCat] || list;
  const cur = byId[game] || list[0];
  $('#app').innerHTML = `<div class="archead"><h1>Seahawk Arcade</h1><a class="luckchip" href="#luck">${luckBadge()}</a></div>
    <div class="pills cats" role="group" aria-label="Filter games">${CATS.map(([k, l]) => `<button class="pill ${k === arcCat ? 'on' : ''}" data-cat="${k}" aria-pressed="${k === arcCat}">${l}</button>`).join('')}</div>
    <div class="gstrip">${shown.map(g => `<button class="gtile ${g.id === game ? 'on' : ''}" data-g="${g.id}" aria-label="${esc(g.title)}"><span>${esc(g.emoji)}</span><b>${esc(g.title)}</b><small>${esc(bestText(g.id) ? '🏆 ' + bestText(g.id) : g.tag)}</small></button>`).join('') || '<div class="mutecell gempty">Nothing here yet – play a game first!</div>'}</div>
    <div class="gamehead"><span class="ge">${esc(cur.emoji)}</span><div class="gt"><h2>${esc(cur.title)}</h2><small>${esc(cur.desc)}</small></div><div class="pbbar" id="pb"></div></div>
    <div id="gm"></div>
    <div class="arcfoot">🎟️ Hawk Bucks are pretend: no money, no prizes, nothing to cash out.</div>`;
  document.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { game = b.dataset.g; go(); });
  document.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { arcCat = b.dataset.cat; go(); });
  const on = $('.gtile.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  paintPB();
  await (GAME_FNS[game] || plinko)($('#gm'), my);
  if (my === nav) bindKeys(game);
}
// Each key lists buttons to try in order; the first visible, enabled one gets pressed. "last:" repeats your last pick.
const ANS = Object.fromEntries([...'1234'].map((k, i) => [k, [`.tbtn[data-c="${i}"]`]]).concat([...'abcd'].map((k, i) => [k, [`.tbtn[data-c="${i}"]`]])));
const GAME_KEYS = {
  plinko: { Space: ['#drop'], hint: 'Space drop a ball' },
  mines: { Space: ['#start', '#cash'], r: ['#rand'], hint: 'Space start / cash out · R random locker · hold and drag to open many' },
  cross: { Space: ['#start', '#go'], c: ['#cash'], hint: 'Space start / next lane · C cash out' },
  flip: { Space: ['#start', 'last:[data-call]'], h: ['[data-call="heads"]'], t: ['[data-call="tails"]'], c: ['#cash'], hint: 'Space start / repeat last call · H heads · T tails · C cash out' },
  dice: { Space: ['#roll'], u: ['#ouflip'], a: ['#auto'], hint: 'Space roll · U over/under · A auto-roll ×10' },
  limbo: { Space: ['#throw'], hint: 'Space throw' },
  slots: { Space: ['#spin'], a: ['#auto'], hint: 'Space pulls the lever · A auto-spin ×10 · or drag the lever down' },
  roulette: { Space: ['#spin'], x: ['#clr'], hint: 'Space spin · X clear chips' },
  rps: { Space: ['#start', 'last:[data-t]'], r: ['[data-t="rock"]'], p: ['[data-t="paper"]'], s: ['[data-t="scissors"]'], c: ['#cash'], hint: 'Space start / repeat last throw · R rock · P paper · S scissors · C cash out' },
  bj: { Space: ['#deal', '#hit'], h: ['#hit'], s: ['#stand'], d: ['#dbl'], hint: 'Space deal / hit · H hit · S stand · D double' },
  rocket: { Space: ['#launch', '#cash'], hint: 'Space launches · Space again while flying = CASH OUT' },
  bell: { Space: ['#pad', '#start'], hint: 'Space start / tap the bell' },
  memory: { Space: ['#start'], hint: 'Space start · Tab + Enter flips a card' },
  trivia: { Space: ['#start'], ...ANS, hint: 'Space start · 1–4 or A–D answer' },
};
const usable = el => el && !el.disabled && !el.closest('.hidden') && el.offsetParent !== null;
function bindKeys(id) {
  const map = GAME_KEYS[id], root = $('#gm'); if (!map || !root) return;
  const last = {};
  root.addEventListener('click', e => { const b = e.target.closest('[data-call],[data-t]'); if (b) last[b.dataset.call ? '[data-call]' : '[data-t]'] = b; });
  const ctrl = root.querySelector('.ctrl'); if (ctrl) ctrl.insertAdjacentHTML('beforeend', `<div class="keyhint">⌨️ ${esc(map.hint)}</div>`);
  const h = e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !root.isConnected) return;
    const k = e.code === 'Space' ? 'Space' : e.key.toLowerCase(), t = e.target;
    if (t.matches && t.matches('input,textarea,select') && k !== 'Space') return; // let people type in the bet box
    if (t.matches && t.matches('input:not([type=number]),textarea')) return;
    const list = map[k]; if (!list || k === 'hint') return;
    for (const sel of list) {
      const el = sel.startsWith('last:') ? (usable(last[sel.slice(5)]) ? last[sel.slice(5)] : root.querySelector(sel.slice(5))) : root.querySelector(sel);
      if (usable(el)) {
        e.preventDefault(); if (t instanceof HTMLElement && t.matches('button')) t.blur(); // stop the focused button from also firing
        el.click(); el.classList.add('pressed'); setTimeout(() => el.classList.remove('pressed'), 150); return;
      }
    }
    if (k === 'Space') e.preventDefault(); // never scroll the page from inside a game
  };
  document.addEventListener('keydown', h); stopFns.push(() => document.removeEventListener('keydown', h));
}
const betBox = (v = 10) => `<label>Bet (Hawk Bucks, no limit)</label><div class="betrow"><input id="bet" type="number" min="1" value="${v}"><button class="chip" data-bq="half" title="Half">½</button><button class="chip" data-bq="double" title="Double">2×</button><button class="chip" data-bq="max" title="Bet everything">Max</button></div>`;
document.addEventListener('click', e => { // ½ / 2× / Max quick-bet buttons
  const b = e.target.closest('[data-bq]'), inp = $('#bet'); if (!b || !inp || !U) return;
  const v = Math.floor(+inp.value || 0), q = b.dataset.bq;
  inp.value = Math.max(1, Math.min(U.balance, q === 'half' ? Math.floor(v / 2) : q === 'double' ? v * 2 : U.balance));
});
const readBet = () => Math.floor(+$('#bet').value || 0);

/* ---------- game showcase: covers + reusable carousel ---------- */
// Copy and artwork per game. The list itself comes from GAMES, filtered to games that actually launch (GAME_FNS).
const GAME_INFO = {
  plinko: { tag: 'Instant', desc: "Drop the ball, pray to the pegs. Like dropping your phone off the bleachers, except sometimes it pays." },
  mines: { tag: 'Cash out anytime', desc: 'Open lockers, find Hawk Bucks, dodge the hall monitor. Greed is how you get a tardy slip.' },
  cross: { tag: 'Cash out anytime', desc: 'Hop your Seahawk across South Lakes Dr at dismissal. The buses do not stop. They have never stopped.' },
  flip: { tag: 'Streak', desc: 'Heads or tails on a South Lakes coin. Call it right and double up. Ten in a row and they name a hallway after you.' },
  dice: { tag: 'Instant', desc: 'Pick a number and beat the scoreboard. Basically a pop quiz, but you choose the odds.' },
  limbo: { tag: 'Instant', desc: 'Set a target and let the QB air it out. Pure 4th-and-long energy.' },
  slots: { tag: 'Jackpot', desc: 'Three trophies is the state champs jackpot. Three hall passes is still technically a win.' },
  roulette: { tag: 'Table game', desc: 'Green, blue or the golden zero. Spin it like it’s the last day of finals.' },
  rps: { tag: 'Streak', desc: 'Throw hands with a Concorde District rival. Westfield has been practicing in the mirror.' },
  bj: { tag: 'Table game', desc: 'Beat Coach to 21. Coach stands on 17 and refuses to explain why.' },
  rocket: { tag: 'Crash', desc: 'The Seahawk’s science-fair rocket climbs and climbs. Cash out before it takes out the bleachers.' },
  bell: { tag: 'Reaction', desc: 'The bell rings, you move. Like 7th period, but now it’s a competition.' },
  memory: { tag: 'Memory', desc: 'Match the classroom cards fast. Easier than remembering your locker combo.' },
  trivia: { tag: 'Trivia', desc: 'Seven questions, twenty seconds each. Finally, a quiz where speed counts.' },
};
let artSeq = 0;
function cover(id, emoji) { // returns an inline SVG; u keeps gradient ids unique when a cover appears twice on the page
  const u = 'c' + (++artSeq), W = 800, H = 450;
  const bg = (a, b, cx = '72%') => `<defs><radialGradient id="${u}b" cx="${cx}" cy="40%" r="85%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>
    <linearGradient id="${u}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#f5a623"/></linearGradient>
    <filter id="${u}f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter></defs><rect width="${W}" height="${H}" fill="url(#${u}b)"/>`;
  const em = (x, y, s, e, extra = '') => `<text x="${x}" y="${y}" font-size="${s}" text-anchor="middle" dominant-baseline="central" ${extra}>${e}</text>`;
  const logo = (x, y, s) => `<image href="logo.svg" x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}"/>`;
  let a = '';
  switch (id) {
    case 'plinko': {
      a = bg('#173f8f', '#05080d');
      for (let r = 0; r < 8; r++) for (let j = 0; j < r + 3; j++) a += `<circle cx="${590 + (j - (r + 2) / 2) * 36}" cy="${70 + r * 38}" r="5" fill="#5b8cff"/>`;
      ['#ffc542', '#12c26a', '#12c26a', '#2a3a4d', '#2a3a4d', '#2a3a4d', '#12c26a', '#12c26a', '#ffc542'].forEach((c, k) => a += `<rect x="${590 + (k - 4) * 36 - 15}" y="372" width="30" height="22" rx="5" fill="${c}"/>`);
      [[572, 104], [626, 218], [554, 300]].forEach(([x, y]) => a += `<circle cx="${x}" cy="${y}" r="16" fill="#12c26a" filter="url(#${u}f)"/><circle cx="${x}" cy="${y}" r="10" fill="#fff"/><circle cx="${x}" cy="${y}" r="5" fill="#12c26a"/>`);
      break;
    }
    case 'mines': {
      a = bg('#0f4a2e', '#04070a');
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
        const x = 440 + c * 88, y = 70 + r * 110, k = r * 4 + c, open = k === 5 || k === 2, bad = k === 10;
        a += `<rect x="${x}" y="${y}" width="76" height="98" rx="10" fill="${open ? '#0f2a1e' : bad ? '#3a1018' : '#1b4fd8'}" stroke="${open ? '#12c26a' : bad ? '#ff4d5e' : '#5b8cff'}" stroke-width="3"/>`;
        a += open ? em(x + 38, y + 49, 40, '🦅') : bad ? em(x + 38, y + 49, 40, '📋') : `<rect x="${x + 34}" y="${y + 30}" width="8" height="38" rx="3" fill="#ffffff44"/>`;
      }
      a += `<rect x="527" y="180" width="76" height="98" rx="10" fill="none" stroke="#12c26a" stroke-width="6" filter="url(#${u}f)"/>`;
      break;
    }
    case 'cross': {
      a = bg('#2c3644', '#07090c');
      for (let k = 0; k < 6; k++) { const x = 360 + k * 74; a += `<rect x="${x}" y="0" width="70" height="450" fill="#1a222c"/>`; for (let y = 0; y < 450; y += 46) a += `<rect x="${x + 33}" y="${y}" width="4" height="24" fill="#ffffff30"/>`; }
      a += em(434, 150, 64, '🚌') + em(582, 300, 56, '🚗') + em(730, 120, 64, '🚌') + em(508, 250, 62, '🦅') + em(656, 380, 44, '💥', 'opacity=".9"');
      [[434, '1.21x'], [508, '1.47x'], [582, '1.79x'], [656, '2.18x']].forEach(([x, t]) => a += `<text x="${x}" y="40" fill="#19e58a" font-weight="800" font-size="18" text-anchor="middle">${t}</text>`);
      break;
    }
    case 'flip': {
      a = bg('#4a3305', '#06080b', '70%');
      a += `<ellipse cx="660" cy="300" rx="60" ry="130" fill="#b26b00" transform="rotate(25 660 300)" opacity=".6"/>`;
      a += `<circle cx="580" cy="220" r="160" fill="#ffc542" filter="url(#${u}f)" opacity=".5"/><circle cx="580" cy="220" r="150" fill="url(#${u}g)"/><circle cx="580" cy="220" r="126" fill="#0a8f4e" stroke="#06582f" stroke-width="6"/>` + logo(580, 220, 170);
      [[400, 90], [760, 60], [740, 380], [430, 380]].forEach(([x, y]) => a += em(x, y, 28, '✨'));
      break;
    }
    case 'dice': {
      a = bg('#3a1c00', '#04070a');
      a += `<rect x="410" y="60" width="350" height="170" rx="16" fill="#05080b" stroke="#2a3a4d" stroke-width="6"/><text x="585" y="96" fill="#ffc542" font-size="16" font-weight="800" letter-spacing="4" text-anchor="middle">SEAHAWKS · HOME</text>`;
      a += `<text x="585" y="180" fill="#ff9f1a" font-family="ui-monospace,Menlo,monospace" font-size="84" font-weight="800" text-anchor="middle" filter="url(#${u}f)">73.41</text><text x="585" y="180" fill="#ffb347" font-family="ui-monospace,Menlo,monospace" font-size="84" font-weight="800" text-anchor="middle">73.41</text>`;
      const die = (x, y, rot, pips) => `<g transform="rotate(${rot} ${x + 55} ${y + 55})"><rect x="${x}" y="${y}" width="110" height="110" rx="20" fill="#fff"/>${pips.map(([px, py]) => `<circle cx="${x + px}" cy="${y + py}" r="11" fill="${rot > 0 ? '#1b4fd8' : '#0a8f4e'}"/>`).join('')}</g>`;
      a += die(470, 270, -14, [[28, 28], [55, 55], [82, 82]]) + die(620, 262, 12, [[28, 28], [82, 28], [28, 82], [82, 82], [55, 55]]);
      break;
    }
    case 'limbo': {
      a = bg('#0f7a42', '#032414', '60%');
      for (let k = 0; k < 9; k++) a += `<rect x="${k * 100}" y="0" width="3" height="450" fill="#ffffff2a"/><text x="${k * 100 + 12}" y="430" fill="#ffffff55" font-weight="800" font-size="20">${[10, 20, 30, 40, 50, 40, 30, 20, 10][k]}</text>`;
      a += `<path d="M380 400 Q 560 -40 760 170" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="10 12" opacity=".8"/>` + em(760, 170, 70, '🏈', 'transform="rotate(30 760 170)"');
      a += `<text x="610" y="320" fill="url(#${u}g)" font-size="90" font-weight="900" text-anchor="middle" filter="url(#${u}f)" opacity=".6">100x</text><text x="610" y="320" fill="url(#${u}g)" font-size="90" font-weight="900" text-anchor="middle">100x</text>`;
      break;
    }
    case 'slots': {
      a = bg('#3a1668', '#05070d', '66%');
      a += `<rect x="404" y="40" width="350" height="76" rx="14" fill="#1a0d3a" stroke="url(#${u}g)" stroke-width="4"/><text x="579" y="92" fill="url(#${u}g)" font-size="42" font-weight="900" letter-spacing="3" text-anchor="middle">SEAHAWK SLOTS</text>`;
      for (let k = 0; k < 14; k++) a += `<circle cx="${420 + k * 25}" cy="52" r="4" fill="${k % 2 ? '#ffe08a' : '#ff4fd8'}"/>`;
      a += `<rect x="404" y="124" width="350" height="284" rx="22" fill="url(#${u}g)"/><rect x="420" y="140" width="318" height="252" rx="12" fill="#06070d"/>`;
      const sy = [['🏈', '🦅', '🏆'], ['🚌', '🦅', '🏐'], ['🏀', '🦅', '📋']], tc = { '🏈': '#b2561a', '🦅': '#12a05c', '🏆': '#d4a017', '🚌': '#e0b400', '🏐': '#2f6bff', '🏀': '#e0701a', '📋': '#c2399e' };
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const x = 428 + c * 102, y = 148 + r * 80, e = sy[r][c]; a += `<rect x="${x}" y="${y}" width="96" height="74" rx="10" fill="${tc[e]}" ${c === 1 ? 'stroke="#fff" stroke-width="4"' : ''}/>` + em(x + 48, y + 38, 46, e); }
      a += `<path d="M436 186 H730" stroke="#ffe08a" stroke-width="7" stroke-linecap="round" filter="url(#${u}f)"/><path d="M436 186 H730" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
      a += `<line x1="776" y1="330" x2="782" y2="200" stroke="#cfd8e3" stroke-width="10" stroke-linecap="round"/><circle cx="782" cy="190" r="22" fill="#ff3b4e" stroke="#fff" stroke-width="3"/><circle cx="775" cy="182" r="6" fill="#ffffff99"/>`;
      [[420, 70], [770, 150], [400, 420], [760, 430]].forEach(([x, y]) => a += em(x, y, 26, '🪙'));
      break;
    }
    case 'roulette': {
      a = bg('#0b2a6b', '#04070a');
      const cx = 590, cy = 225, R = 180, seg = Math.PI * 2 / 37, C = { green: '#0f9d58', blue: '#1b4fd8', gold: '#f5a623' };
      a += `<circle cx="${cx}" cy="${cy}" r="${R + 16}" fill="url(#${u}g)"/>`;
      WHEEL.forEach((n, i) => { const t0 = i * seg - Math.PI / 2, t1 = t0 + seg;
        a += `<path d="M${cx} ${cy}L${cx + R * Math.cos(t0)} ${cy + R * Math.sin(t0)}A${R} ${R} 0 0 1 ${cx + R * Math.cos(t1)} ${cy + R * Math.sin(t1)}Z" fill="${C[rcol(n)]}"/>`; });
      a += `<circle cx="${cx}" cy="${cy}" r="62" fill="#05080b" stroke="url(#${u}g)" stroke-width="5"/>` + logo(cx, cy, 90) + `<circle cx="${cx + 120}" cy="${cy - 90}" r="11" fill="#fff"/>`;
      break;
    }
    case 'rps': {
      a = bg('#2a1260', '#05070b');
      a += em(470, 230, 150, '✊', 'transform="translate(940 0) scale(-1 1)"') + em(700, 230, 150, '✌️');
      a += `<text x="585" y="240" fill="url(#${u}g)" font-size="70" font-weight="900" text-anchor="middle" filter="url(#${u}f)">VS</text><text x="585" y="240" fill="url(#${u}g)" font-size="70" font-weight="900" text-anchor="middle">VS</text>`;
      a += `<text x="470" y="380" fill="#9ff5c8" font-weight="800" font-size="22" text-anchor="middle">SOUTH LAKES</text><text x="700" y="380" fill="#ff9aa4" font-weight="800" font-size="22" text-anchor="middle">RIVAL</text>`;
      break;
    }
    case 'bj': {
      a = bg('#13894c', '#04200f', '62%');
      const pc = (x, y, rot, r, s, col) => `<g transform="rotate(${rot} ${x + 70} ${y + 100})"><rect x="${x}" y="${y}" width="140" height="200" rx="14" fill="#fff" stroke="#00000022"/><text x="${x + 16}" y="${y + 44}" fill="${col}" font-size="38" font-weight="900">${r}</text><text x="${x + 70}" y="${y + 120}" fill="${col}" font-size="72" text-anchor="middle">${s}</text></g>`;
      a += pc(470, 110, -12, 'A', '♠', '#0f3fb5') + pc(580, 100, 10, 'K', '♥', '#0a8f4e');
      [[450, 360, '#1b4fd8'], [500, 372, '#f5a623'], [700, 360, '#0a8f4e']].forEach(([x, y, c]) => { for (let k = 0; k < 4; k++) a += `<ellipse cx="${x}" cy="${y - k * 10}" rx="34" ry="12" fill="${c}" stroke="#fff" stroke-width="3" stroke-dasharray="8 6"/>`; });
      a += `<text x="740" y="70" fill="#ffe08a" font-size="34" font-weight="900" text-anchor="end">21</text>`;
      break;
    }
    case 'rocket': {
      a = bg('#1d1060', '#03040a', '70%');
      for (let k = 0; k < 40; k++) a += `<circle cx="${380 + (k * 97) % 420}" cy="${(k * 53) % 450}" r="${1 + (k % 3)}" fill="#ffffff${k % 2 ? '99' : '55'}"/>`;
      a += `<path d="M380 420 Q 560 400 740 80" fill="none" stroke="url(#${u}g)" stroke-width="10" stroke-linecap="round" filter="url(#${u}f)" opacity=".7"/><path d="M380 420 Q 560 400 740 80" fill="none" stroke="#19e58a" stroke-width="6" stroke-linecap="round"/>`;
      a += em(740, 80, 84, '🚀') + `<text x="560" y="250" fill="url(#${u}g)" font-size="96" font-weight="900" text-anchor="middle" filter="url(#${u}f)" opacity=".55">12.4x</text><text x="560" y="250" fill="url(#${u}g)" font-size="96" font-weight="900" text-anchor="middle">12.4x</text>`;
      break;
    }
    case 'bell': {
      a = bg('#3a2a05', '#05080b', '70%');
      for (let k = 0; k < 6; k++) a += `<rect x="${400 + k * 70}" y="40" width="62" height="370" rx="6" fill="#16337f" stroke="#2f6bff" stroke-width="2" opacity=".55"/><rect x="${428 + k * 70}" y="170" width="6" height="40" rx="2" fill="#ffffff44"/>`;
      a += `<circle cx="590" cy="215" r="150" fill="#ffc542" opacity=".25" filter="url(#${u}f)"/>` + em(590, 215, 200, '🔔', 'transform="rotate(-12 590 215)"');
      [[400, 120, 470, 160], [380, 230, 455, 230], [400, 330, 470, 290], [780, 120, 710, 160], [800, 230, 725, 230], [780, 330, 710, 290]].forEach(([x1, y1, x2, y2]) => a += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="url(#${u}g)" stroke-width="8" stroke-linecap="round"/>`);
      a += `<text x="590" y="420" fill="#ffe08a" font-size="44" font-weight="900" letter-spacing="8" text-anchor="middle">RING!</text>`;
      break;
    }
    case 'memory': {
      a = bg('#24125a', '#05070b');
      const ic = ['🦅', '📚', '🍕', '🦅', '🔔', '🎒'];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
        const x = 430 + c * 88, y = 60 + r * 115, k = r * 4 + c, up = [0, 5, 6, 9].includes(k);
        a += up ? `<rect x="${x}" y="${y}" width="76" height="100" rx="12" fill="#f3f6fa" stroke="${k === 0 || k === 9 ? '#12c26a' : '#ffffff'}" stroke-width="4"/>` + em(x + 38, y + 50, 44, ic[[0, 5, 6, 9].indexOf(k) % ic.length] || '🦅')
          : `<rect x="${x}" y="${y}" width="76" height="100" rx="12" fill="#1b4fd8" stroke="#5b8cff" stroke-width="3"/>` + logo(x + 38, y + 50, 46);
      }
      a += `<rect x="426" y="56" width="84" height="108" rx="14" fill="none" stroke="#12c26a" stroke-width="6" filter="url(#${u}f)"/>`;
      break;
    }
    case 'trivia': {
      a = bg('#0b3a22', '#05080b', '68%');
      a += `<rect x="410" y="50" width="360" height="250" rx="12" fill="#7a4a1c"/><rect x="424" y="64" width="332" height="222" rx="6" fill="#163d2a"/>`;
      a += `<text x="590" y="225" fill="url(#${u}g)" font-size="190" font-weight="900" text-anchor="middle" filter="url(#${u}f)" opacity=".5">?</text><text x="590" y="225" fill="url(#${u}g)" font-size="190" font-weight="900" text-anchor="middle">?</text>`;
      ['A', 'B', 'C', 'D'].forEach((l, k) => a += `<circle cx="${470 + k * 80}" cy="360" r="30" fill="${k === 2 ? '#12c26a' : '#1b4fd8'}" stroke="#fff" stroke-width="3"/><text x="${470 + k * 80}" y="372" fill="#fff" font-size="32" font-weight="900" text-anchor="middle">${l}</text>`);
      a += `<text x="452" y="104" fill="#ffffff88" font-size="20" font-family="ui-monospace,monospace">Q7 / 7</text>`;
      break;
    }
    default: a = bg('#1b4fd8', '#05080b') + em(590, 225, 180, emoji || '🎮');
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${a}</svg>`;
}
const gameList = () => GAMES.filter(([id]) => GAME_FNS[id]).map(([id, label]) => {
  const [emoji, ...rest] = label.split(' '), info = GAME_INFO[id] || {};
  return { id, emoji, title: rest.join(' '), tag: info.tag || 'Arcade', desc: info.desc || 'A fresh game in the Seahawk Arcade.' };
});
function openGame(id) { game = id; if (location.hash === '#arcade') go(); else location.hash = '#arcade'; }

/* Reusable carousel. items: [{id,title,tag,desc,art}]. Returns a cleanup function that clears timers and listeners. */
function carousel(root, items, { interval = 5000, label = 'Featured', onPlay } = {}) {
  const n = items.length; let i = 0, timer = 0, hover = false, focus = false, sx = null;
  const auto = !calm && n > 1;
  root.innerHTML = `<div class="car" role="region" aria-roledescription="carousel" aria-label="${esc(label)}" tabindex="0">
    <div class="car-stage">${items.map((g, k) => `<article class="car-slide ${k ? '' : 'on'}" role="group" aria-roledescription="slide" aria-label="${k + 1} of ${n}: ${esc(g.title)}" ${k ? 'aria-hidden="true" inert' : ''}>
      <div class="car-art">${g.art}</div><div class="car-shade"></div>
      <div class="car-copy"><span class="car-tag">${esc(g.emoji)} ${esc(g.tag)}</span><h2>${esc(g.title)}</h2><p>${esc(g.desc)}</p>
      <button class="btn car-play" data-car-play="${g.id}">▶ Play</button></div></article>`).join('')}</div>
    ${n > 1 ? `<button class="car-arrow prev" aria-label="Previous game">‹</button><button class="car-arrow next" aria-label="Next game">›</button>
    <div class="car-dots">${items.map((g, k) => `<button class="car-dot ${k ? '' : 'on'}" data-dot="${k}" aria-label="Show ${esc(g.title)}" ${k ? '' : 'aria-current="true"'}></button>`).join('')}</div>` : ''}
    ${auto ? '<div class="car-bar"><i></i></div>' : ''}<div class="sr-only" aria-live="polite" id="carLive"></div></div>`;
  const car = root.firstElementChild, slides = [...car.querySelectorAll('.car-slide')], dots = [...car.querySelectorAll('.car-dot')], bar = car.querySelector('.car-bar i');
  const paused = () => hover || focus || document.hidden;
  function arm() { // (re)start the countdown; called after every move so manual navigation resets the timer
    clearTimeout(timer); timer = 0;
    if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = `carBar ${interval}ms linear forwards`; bar.style.animationPlayState = paused() ? 'paused' : 'running'; }
    if (auto && !paused()) timer = setTimeout(() => go1(i + 1, 1, false), interval);
  }
  function go1(to, dir, manual) {
    const next = (to + n) % n; if (next === i) return arm();
    const out = slides[i], inn = slides[next];
    inn.style.transition = 'none'; inn.style.setProperty('--x', `${dir * 6}%`); void inn.offsetWidth; inn.style.transition = '';
    out.style.setProperty('--x', `${-dir * 6}%`);
    out.classList.remove('on'); out.setAttribute('aria-hidden', 'true'); out.inert = true;
    inn.classList.add('on'); inn.removeAttribute('aria-hidden'); inn.inert = false; inn.style.setProperty('--x', '0%');
    dots.forEach((d, k) => { d.classList.toggle('on', k === next); k === next ? d.setAttribute('aria-current', 'true') : d.removeAttribute('aria-current'); });
    i = next; if (manual) car.querySelector('#carLive').textContent = `${items[i].title}, ${i + 1} of ${n}`;
    arm();
  }
  const prev = () => go1(i - 1, -1, true), next = () => go1(i + 1, 1, true);
  car.addEventListener('click', e => {
    const t = e.target.closest('.car-arrow,.car-dot,[data-car-play]'); if (!t) return;
    if (t.dataset.carPlay) return onPlay && onPlay(t.dataset.carPlay);
    if (t.classList.contains('prev')) prev(); else if (t.classList.contains('next')) next(); else { const k = +t.dataset.dot; go1(k, k > i ? 1 : -1, true); }
  });
  car.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); } else if (e.key === 'ArrowRight') { e.preventDefault(); next(); } });
  car.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { hover = true; arm(); } });
  car.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { hover = false; arm(); } });
  car.addEventListener('focusin', () => { focus = true; arm(); });
  car.addEventListener('focusout', e => { if (!car.contains(e.relatedTarget)) { focus = false; arm(); } });
  car.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  car.addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 40) dx < 0 ? next() : prev(); });
  const vis = () => arm(); document.addEventListener('visibilitychange', vis);
  arm();
  return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', vis); };
}
const NEW_GAMES = new Set(['rocket', 'bell', 'memory', 'trivia']);
const gameLabel = id => (GAMES.find(([k]) => k === id) || [id, id])[1];
function mountShowcase(el) {
  const list = gameList();
  el.innerHTML = `<div id="carHost"></div><section class="allg" aria-labelledby="allgH"><h2 id="allgH">🎰 HawkBet Originals</h2>
    <div class="allgames orig">${list.map(g => `<button class="gcard" data-car-play="${g.id}" aria-label="Play ${esc(g.title)}">${NEW_GAMES.has(g.id) ? '<i class="newb">NEW</i>' : ''}<div class="gthumb">${cover(g.id, g.emoji)}</div><b>${esc(g.title)}</b><small>${esc(g.tag)}</small></button>`).join('')}</div></section>`;
  el.querySelector('.allgames').addEventListener('click', e => { const b = e.target.closest('[data-car-play]'); if (b) openGame(b.dataset.carPlay); });
  el.querySelectorAll('.gcard').forEach(c => { // tilt toward the pointer
    c.addEventListener('pointermove', e => { if (calm || e.pointerType !== 'mouse') return; const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; c.style.transform = `perspective(600px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-4px)`; });
    c.addEventListener('pointerleave', () => { c.style.transform = ''; });
  });
  stopFns.push(carousel(el.querySelector('#carHost'), list.map(g => ({ ...g, art: cover(g.id, g.emoji) })), { label: 'Featured games', onPlay: openGame }));
}

/* ---------- Home: the casino lobby ---------- */
async function renderHome(my) {
  const feed = await api('GET', '/feed').catch(() => ({ bets: [], big: [], stats: { players: 0, rounds: 0, biggest: 0 } })); if (my !== nav) return;
  const ago = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago'; };
  const betRow = b => `<div class="lbrow"><span class="g">${esc(gameLabel(b.game))}</span><span class="u">${esc(b.username)}</span><span class="b">${fmt(b.bet)} 🪙</span><span class="m ${b.payout > b.bet ? 'win' : 'lose'}">${b.payout ? b.mult.toFixed(2) + 'x' : '0.00x'}</span><span class="p ${b.payout > b.bet ? 'win' : 'lose'}">${b.payout > b.bet ? '+' : '−'}${fmt(Math.abs(b.payout - b.bet))}</span></div>`;
  const ticker = feed.big.length ? feed.big.concat(feed.big).map(b => `<span>🔥 <b>${esc(b.username)}</b> hit <b class="win">${b.mult.toFixed(2)}x</b> on ${esc(gameLabel(b.game))} <b class="win">+${fmt(b.payout - b.bet)} 🪙</b></span>`).join('') : '';
  $('#app').innerHTML = `<section class="hero"><div class="heroin"><div><small>Welcome back</small><h1>${esc(U.username)}</h1></div>
      <div class="herobal"><small>Your balance</small><b>${fmt(U.balance)}</b><span>Hawk Bucks</span></div>
      <div class="heroact"><a class="btn gold" href="#arcade">🎰 Play now</a><a class="btn alt" href="#bank">🏦 Bank</a><a class="btn alt" href="#luck">🍀 Luck Lab</a></div></div></section>
    ${ticker ? `<div class="marq" aria-label="Recent big wins"><div class="marqin">${ticker}</div></div>` : ''}
    <div class="statbar"><div><b>${fmt(feed.stats.players)}</b><small>Players</small></div><div><b>${fmt(feed.stats.rounds)}</b><small>Rounds played</small></div><div><b>${feed.stats.biggest ? feed.stats.biggest.toFixed(1) + 'x' : '–'}</b><small>Biggest multiplier</small></div></div>
    <div id="showcase"></div>
    <div class="lobby2"><section class="panel livepanel"><h2><span class="livedot"></span> Live bets</h2><div class="lbhead"><span>Game</span><span>Player</span><span>Bet</span><span>Payout</span><span>Profit</span></div><div id="lbrows">${feed.bets.map(betRow).join('') || '<div class="mutecell gempty">No bets yet – be the first!</div>'}</div></section>
      <section class="panel livepanel"><h2>🏆 Big wins this week</h2>${feed.big.map(b => `<div class="bigwin"><div><b>${esc(b.username)}</b><small>${esc(gameLabel(b.game))} · ${fmt(b.bet)} 🪙 bet</small></div><div class="win"><b>${b.mult.toFixed(2)}x</b><small>+${fmt(b.payout - b.bet)} 🪙</small></div></div>`).join('') || '<div class="mutecell gempty">Win 5x or more to show up here.</div>'}</section></div>
    <div class="arcfoot">🎟️ Hawk Bucks are pretend: no money, no prizes, nothing to cash out. Not affiliated with South Lakes HS or FCPS.</div>`;
  mountShowcase($('#showcase'));
  const t = setInterval(async () => { if (view !== 'home' || !$('#lbrows')) return clearInterval(t); try { const f = await api('GET', '/feed'); if ($('#lbrows') && f.bets.length) $('#lbrows').innerHTML = f.bets.map(betRow).join(''); } catch (e) {} }, 6000);
  stopFns.push(() => clearInterval(t));
}

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
    if (b.mult >= 2) fx.win(b.mult >= 5);
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

/* Mines: Locker Hunt. Mine positions never leave the server until the round ends.
   Press and drag across lockers to open a bunch at once; a queue sends them to the server one at a time, in order. */
async function mines(root, my) {
  let st = null, nm = 3, queue = [], running = false, dragging = false, seen = new Set();
  root.innerHTML = `<div class="game"><div class="panel ctrl">${betBox()}
    <label>Hall monitors hidden: <b id="mv">3</b></label><input id="mn" type="range" min="1" max="24" value="3" style="width:100%">
    <div style="height:14px"></div><button class="btn bjbig" id="start">🔐 Start game <kbd>Space</kbd></button>
    <div class="duo hidden" id="mact"><button class="btn blue" id="rand">🎲 Random pick <kbd>R</kbd></button><button class="btn gold" id="cash"></button></div><div class="res" id="res"></div>
    <div class="note">Open lockers to find Hawk Bucks. <b>Press and drag across several lockers</b> to open them all in one sweep. Hit a hall monitor and you lose the bet. Cash out any time.</div></div>
    <div class="panel stage"><div class="mult" id="mult">—</div><div class="lockers" id="lk"></div><div class="dragtip">👆 Hold and drag across lockers</div></div></div>`;
  function paint(reveal) {
    $('#lk').innerHTML = Array.from({ length: 25 }, (_, i) => {
      const open = st && st.opened.has(i), mine = st && st.mines && st.mines.has(i), pend = st && st.pending && st.pending.has(i);
      const cls = open ? 'open' : (reveal && mine) ? 'bad' + (st.hit === i ? '' : ' dim') : reveal ? 'dim' : pend ? 'pend' : '';
      return `<button class="lk ${cls}" data-i="${i}" ${!st || !st.live || open ? 'disabled' : ''}>${open ? '🦅' : (reveal && mine) ? '📋' : ''}</button>`;
    }).join('');
    $('#mult').textContent = st ? st.mult.toFixed(2) + 'x' : '—';
    const live = st && st.live;
    $('#mact').classList.toggle('hidden', !live); $('#start').classList.toggle('hidden', !!live);
    const cash = $('#cash'); cash.disabled = !(live && st.opened.size > 0); if (st) cash.textContent = `💰 Cash out ${fmt(st.bet * st.mult)} 🪙`;
    $('#mn').disabled = !!live;
  }
  function finish(r, win) {
    queue.length = 0; if (r.mines) st.mines = new Set(r.mines); st.live = false; st.pending = new Set(); setBal(r.balance); paint(true);
    $('#res').innerHTML = win ? `<span class="win">Cashed out +${fmt(r.payout - st.bet)} 🪙</span>` : `<span class="lose">Hall monitor! −${fmt(st.bet)} 🪙</span>`;
    win ? fx.win(st.mult >= 3) : fx.lose();
  }
  async function pump() { // opens queued lockers one by one; stops the moment the round ends
    if (running) return; running = true;
    try {
      while (queue.length && st && st.live && root.isConnected) {
        const i = queue.shift(); st.pending.delete(i); if (st.opened.has(i)) continue;
        const r = await api('POST', '/arcade/mines/reveal', { i }); if (!root.isConnected) return setBal(r.balance);
        if (r.bust) { st.hit = i; return finish(r, false); }
        st.opened = new Set(r.opened); st.mult = r.mult; if (r.cashed) return finish(r, true);
        paint(); fx.bump($('#mult'));
      }
    } catch (e) { queue.length = 0; if (st) st.pending = new Set(); toast(e.message); sfx.play('error'); paint(); }
    finally { running = false; }
  }
  const enqueue = i => { if (!st || !st.live || st.opened.has(i) || st.pending.has(i)) return; st.pending.add(i); queue.push(i); const el = $(`.lk[data-i="${i}"]`); if (el) el.classList.add('pend'); sfx.play('flip'); pump(); };
  const a = (await api('GET', '/arcade/active?game=mines')).round; if (my !== nav) return;
  if (a) { st = { bet: a.bet, nm: a.m, opened: new Set(a.opened), mult: a.mult, live: true, pending: new Set() }; nm = a.m; $('#mn').value = nm; $('#mv').textContent = nm; $('#res').textContent = 'Round restored'; }
  $('#mn').oninput = e => { nm = +e.target.value; $('#mv').textContent = nm; };
  $('#start').onclick = act(async () => {
    const r = await api('POST', '/arcade/mines/start', { bet: readBet(), mines: nm }); setBal(r.balance);
    st = { bet: r.bet, nm, opened: new Set(), mult: 0.99, live: true, pending: new Set() }; queue.length = 0; $('#res').textContent = ''; paint();
  });
  const lk = $('#lk');
  lk.addEventListener('pointerdown', e => {
    const b = e.target.closest('.lk'); if (!b || !st || !st.live) return;
    dragging = true; seen = new Set([+b.dataset.i]); try { b.releasePointerCapture(e.pointerId); } catch (x) {}
    enqueue(+b.dataset.i); e.preventDefault();
  });
  lk.addEventListener('pointermove', e => {
    if (!dragging) return; const b = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lk');
    if (b && lk.contains(b) && !b.disabled && !seen.has(+b.dataset.i)) { seen.add(+b.dataset.i); enqueue(+b.dataset.i); }
  });
  const stop = () => { dragging = false; };
  addEventListener('pointerup', stop); addEventListener('pointercancel', stop); stopFns.push(() => { removeEventListener('pointerup', stop); removeEventListener('pointercancel', stop); queue.length = 0; });
  lk.addEventListener('click', e => { if (e.detail === 0) { const b = e.target.closest('.lk'); if (b) enqueue(+b.dataset.i); } }); // keyboard (Enter / Space on a focused locker)
  $('#rand').onclick = () => { const free = [...Array(25).keys()].filter(i => st && !st.opened.has(i) && !st.pending.has(i)); if (free.length) enqueue(free[Math.floor(Math.random() * free.length)]); };
  $('#cash').onclick = act(async () => {
    if (!st || !st.live) return; queue.length = 0; st.pending = new Set(); while (running) await wait(25);
    const r = await api('POST', '/arcade/mines/cashout'); st.mult = r.mult; finish(r, true);
  });
  paint();
}

/* Chicken cross: Seahawk Crossing. The server decides which lane gets you; it only says so when you step there. */
async function cross(root, my) {
  let d = 'med', st = null;
  root.innerHTML = `<div class="game"><div class="panel ctrl">${betBox()}
    <label>Difficulty</label><div class="seg" id="df" style="grid-template-columns:1fr 1fr"><button data-d="easy">Easy</button><button data-d="med" class="on">Medium</button><button data-d="hard">Hard</button><button data-d="extreme">Extreme</button></div>
    <div class="res" id="res"></div>
    <div class="note">Hop your Seahawk across the road one lane at a time. Each lane survived raises your multiplier. Get hit and you lose the bet.</div>${luckLine('fewer buses hit you, lane multipliers are smaller.')}</div>
    <div class="panel stage"><div class="mult" id="mult">—</div><div class="road" id="road"></div>
      <div class="xacts"><button class="btn bjbig" id="start">🏫 Start crossing <kbd>Space</kbd></button>
        <button class="btn xhop hidden" id="go"><span>🦅</span>HOP!<kbd>Space</kbd></button><button class="btn gold xcash hidden" id="cash"><span>💰</span><b id="cashtxt">Cash out</b><kbd>C</kbd></button></div>
      <div class="curb">🏫 South Lakes Dr → get to the stadium 🏟️</div></div></div>`;
  const mults = () => CFG.cross[d], at = () => st ? st.at : 0, multNow = () => at() ? mults()[at() - 1] : 0.99, road = $('#road');
  function build() { // build the road once so the hawk can glide between lanes
    road.innerHTML = `<div class="lane edge"><span class="em">🏫</span><span class="m">START</span></div>` + mults().map((m, i) => `<div class="lane" data-n="${i + 1}"><span class="m">${m.toFixed(2)}x</span><span class="veh ${i % 2 ? 'up' : 'down'}" style="animation-delay:${-(i * 0.7) % 3}s;animation-duration:${2.2 + (i % 4) * 0.5}s">${i % 3 === 0 ? '🚌' : i % 3 === 1 ? '🚗' : '🚕'}</span></div>`).join('') + `<div class="lane edge"><span class="em">🏟️</span><span class="m">WIN</span></div><img class="xhawk" id="xh" src="hawk.svg" alt="Seahawk">`;
  }
  function placeHawk(n, animate = true) {
    const lane = road.children[Math.min(n, mults().length + 1)], h = $('#xh'); if (!lane || !h) return;
    const x = lane.offsetLeft + lane.offsetWidth / 2 - h.offsetWidth / 2;
    if (!animate) h.style.transition = 'none'; h.style.left = x + 'px'; if (!animate) { void h.offsetWidth; h.style.transition = ''; }
    else { h.classList.remove('hop'); void h.offsetWidth; h.classList.add('hop'); }
    if (road.scrollTo) road.scrollTo({ left: Math.max(0, x - road.clientWidth / 2 + 40), behavior: animate && !calm ? 'smooth' : 'auto' });
  }
  function paint(animate = true) {
    const a = at(), hit = st && st.hitLane;
    [...road.querySelectorAll('.lane[data-n]')].forEach(l => { const n = +l.dataset.n; l.classList.toggle('done', a >= n && hit !== n); l.classList.toggle('hit', hit === n); l.classList.toggle('next', !!(st && st.live && n === a + 1)); });
    $('#mult').textContent = st ? multNow().toFixed(2) + 'x' : '—';
    const live = st && st.live;
    $('#start').classList.toggle('hidden', !!live); $('#go').classList.toggle('hidden', !live); $('#cash').classList.toggle('hidden', !live); $('#cash').disabled = !(live && a > 0);
    $('#cashtxt').textContent = live && a > 0 ? `Cash out ${fmt(st.bet * multNow())} 🪙` : 'Cash out';
    document.querySelectorAll('#df button').forEach(b => b.disabled = !!live);
    placeHawk(hit || a, animate);
  }
  function finish(r, win) {
    st.live = false; setBal(r.balance); const xh = $('#xh');
    if (!win) { road.classList.add('crash'); xh.classList.add('splat'); setTimeout(() => road.classList.remove('crash'), 700); }
    else { xh.classList.add('cheer'); setTimeout(() => xh.classList.remove('cheer'), 900); }
    paint(false);
    $('#res').innerHTML = win ? `<span class="win">Cashed out +${fmt(r.payout - st.bet)} 🪙</span>` : `<span class="lose">Splat! −${fmt(st.bet)} 🪙</span>`;
    win ? fx.win(r.payout >= st.bet * 3) : fx.lose();
  }
  build();
  const a = (await api('GET', '/arcade/active?game=cross')).round; if (my !== nav) return;
  if (a) { d = a.diff; st = { bet: a.bet, at: a.at, live: true }; document.querySelectorAll('#df button').forEach(b => b.classList.toggle('on', b.dataset.d === d)); build(); $('#res').textContent = 'Round restored'; }
  $('#df').onclick = e => { const x = e.target.dataset.d; if (!x || (st && st.live)) return; d = x; document.querySelectorAll('#df button').forEach(b => b.classList.toggle('on', b.dataset.d === x)); build(); paint(false); };
  $('#start').onclick = act(async () => {
    const r = await api('POST', '/arcade/cross/start', { bet: readBet(), diff: d }); setBal(r.balance);
    st = { bet: r.bet, at: 0, live: true }; $('#res').textContent = ''; $('#xh').classList.remove('splat'); build(); paint(false);
  });
  $('#go').onclick = act(async () => {
    if (!st || !st.live) return; const r = await api('POST', '/arcade/cross/step'); sfx.play('flip');
    if (r.hit) { st.at = r.lane; st.hitLane = r.lane; placeHawk(r.lane); await wait(calm ? 0 : 420); if (!root.isConnected) return setBal(r.balance); return finish(r, false); }
    st.at = r.at; if (r.cashed) { placeHawk(r.at); await wait(calm ? 0 : 420); if (!root.isConnected) return setBal(r.balance); return finish(r, true); }
    paint(); fx.bump($('#mult'));
  });
  $('#cash').onclick = act(async () => { if (st && st.live && st.at > 0) finish(await api('POST', '/arcade/cross/cashout'), true); });
  addEventListener('resize', () => placeHawk(st ? (st.hitLane || st.at) : 0, false)); setTimeout(() => placeHawk(st ? st.at : 0, false), 60);
  paint(false);
}

/* ---------- more arcade games (server decides; we animate) ---------- */
const EMO = { trophy: '🏆', hawk: '🦅', football: '🏈', volley: '🏐', bball: '🏀', bus: '🚌', pass: '📋' };
const wait = ms => new Promise(r => setTimeout(r, ms));
const resMsg = (win, html) => { $('#res').innerHTML = `<span class="${win ? 'win' : 'lose'}">${html}</span>`; };
function settleShot(r, big) { // one-shot games: reveal the balance only after the animation
  setBal(r.balance);
  if (r.payout > r.bet) { resMsg(true, `${r.mult.toFixed(2)}x · +${fmt(r.payout - r.bet)} 🪙`); fx.win(big); }
  else if (r.payout === r.bet) resMsg(true, 'Push · bet back');
  else { resMsg(false, `−${fmt(r.bet - r.payout)} 🪙`); fx.lose(); }
}
function streakFx(n) { sfx.play('streak'); if ([3, 5, 8].includes(n)) { toast(`🔥 ${n} in a row!`); fx.burst(40); } }
const gameShell = (ctrl, stage, cls = '') => `<div class="game ${cls}"><div class="panel ctrl">${ctrl}<div class="res" id="res"></div></div><div class="panel stage">${stage}</div></div>`;

/* Heads or Tails: a South Lakes coin (hawk portrait on heads, the school shield on tails). */
const coinFace = kind => {
  const id = 'cf' + kind, heads = kind === 'heads';
  const top = heads ? 'IN SEAHAWKS WE TRUST' : 'SOUTH LAKES HIGH SCHOOL', bot = heads ? '★ LIBERTY ★ 2026 ★' : '★ RESTON · VIRGINIA ★';
  return `<svg viewBox="0 0 200 200" aria-hidden="true"><defs><radialGradient id="${id}g" cx="35%" cy="28%"><stop offset="0" stop-color="#fff6c0"/><stop offset=".45" stop-color="#f6c744"/><stop offset="1" stop-color="#a86a00"/></radialGradient>
    <path id="${id}t" d="M 24 100 A 76 76 0 0 1 176 100"/><path id="${id}b" d="M 16 100 A 84 84 0 0 0 184 100"/></defs>
    <circle cx="100" cy="100" r="97" fill="url(#${id}g)" stroke="#7a4a00" stroke-width="4"/>
    <circle cx="100" cy="100" r="92" fill="none" stroke="#7a4a0088" stroke-width="3" stroke-dasharray="1.6 3.2"/>
    <circle cx="100" cy="100" r="62" fill="none" stroke="#fff6c099" stroke-width="2"/><circle cx="100" cy="100" r="60" fill="none" stroke="#7a4a0066" stroke-width="1.5"/>
    <text font-size="14.5" font-weight="900" fill="#5b3600" letter-spacing="2.2" font-family="Georgia,serif" text-anchor="middle"><textPath href="#${id}t" startOffset="50%">${top}</textPath></text>
    <text font-size="12" font-weight="900" fill="#5b3600" letter-spacing="2" font-family="Georgia,serif" text-anchor="middle"><textPath href="#${id}b" startOffset="50%" dominant-baseline="hanging">${bot}</textPath></text>
    <image href="${heads ? 'hawk.svg' : 'logo.svg'}" x="${heads ? 56 : 62}" y="${heads ? 52 : 58}" width="${heads ? 92 : 76}" height="${heads ? 92 : 76}" style="filter:sepia(1) saturate(2.2) hue-rotate(-12deg) brightness(.52) contrast(1.35) drop-shadow(0 1px 0 #fff8)"/>
    ${heads ? '' : '<text x="100" y="152" font-size="12" font-weight="900" fill="#5b3600" font-family="Georgia,serif" text-anchor="middle" letter-spacing="3">SEAHAWKS</text>'}
    <ellipse cx="68" cy="40" rx="34" ry="14" fill="#ffffff55" transform="rotate(-28 68 40)"/></svg>`;
};
async function flip(root, my) {
  let st = null, rot = 0;
  root.innerHTML = gameShell(`${betBox()}<div style="height:14px"></div><button class="btn bjbig" id="start">🪙 Start a streak <kbd>Space</kbd></button>
    <div class="duo hidden" id="calls"><button class="btn blue bjbig" data-call="heads">HEADS<kbd>H</kbd></button><button class="btn blue bjbig" data-call="tails">TAILS<kbd>T</kbd></button></div>
    <button class="btn gold hidden" id="cash" style="margin-top:8px"></button>
    <div class="note">Call the flip. Win chance per call: <b>${pct(CFG.luck.flipP)}</b>. The first right call pays <b>${(0.99 / CFG.luck.flipPay).toFixed(2)}x</b> and each one after multiplies it by ${(1 / CFG.luck.flipPay).toFixed(2)}, up to ${CFG.flipMax} in a row. One miss and it's gone.</div>${luckLine('you win more calls, each pays less.')}`,
    `<div class="mult" id="mult">—</div><div class="flipcoin" id="coin"><div class="face front">${coinFace('heads')}</div><div class="face back">${coinFace('tails')}</div></div><div class="pips" id="pips"></div>`);
  function paint() {
    const live = st && st.live;
    $('#start').classList.toggle('hidden', !!live); $('#calls').classList.toggle('hidden', !live);
    $('#cash').classList.toggle('hidden', !(live && st.streak)); if (st) $('#cash').textContent = `💰 Cash out ${fmt(st.bet * st.mult)} 🪙`;
    $('#mult').textContent = st && st.streak ? st.mult.toFixed(2) + 'x' : live ? 'Heads or tails?' : '—';
    $('#pips').innerHTML = Array.from({ length: CFG.flipMax }, (_, i) => `<i class="${st && i < st.streak ? 'on' : ''}"></i>`).join('');
  }
  const a = (await api('GET', '/arcade/active?game=flip')).round; if (my !== nav) return;
  if (a) { st = { bet: a.bet, streak: a.streak, mult: a.mult, live: true }; $('#res').textContent = 'Streak restored'; }
  $('#start').onclick = act(async () => { const r = await api('POST', '/arcade/flip/start', { bet: readBet() }); setBal(r.balance); st = { bet: r.bet, streak: 0, mult: 0, live: true }; $('#res').textContent = ''; paint(); });
  root.querySelectorAll('[data-call]').forEach(b => b.onclick = act(async () => {
    const r = await api('POST', '/arcade/flip/call', { call: b.dataset.call });
    $('#coin').classList.add('tossing'); rot = Math.ceil((rot + 1800) / 360) * 360 + (r.side === 'tails' ? 180 : 0); $('#coin').style.transform = `rotateY(${rot}deg)`;
    if (!calm) for (let i = 0; i < 6; i++) { sfx.play('flip'); await wait(170); }
    $('#coin').classList.remove('tossing');
    if (!root.isConnected) return setBal(r.balance); // player switched games mid-animation
    const name = r.side === 'heads' ? 'Heads' : 'Tails';
    if (r.lost) { st.live = false; setBal(r.balance); resMsg(false, `It landed ${name} · −${fmt(st.bet)} 🪙`); fx.lose(); }
    else { st.streak = r.streak; st.mult = r.mult; fx.bump($('#mult'));
      if (r.cashed) { st.live = false; setBal(r.balance); resMsg(true, `Perfect ${r.streak}! +${fmt(r.payout - st.bet)} 🪙`); fx.win(true); } else { resMsg(true, `${name}! Streak ${r.streak}`); streakFx(r.streak); } }
    paint();
  }));
  $('#cash').onclick = act(async () => { const r = await api('POST', '/arcade/flip/cashout'); st.live = false; setBal(r.balance); resMsg(true, `Cashed out +${fmt(r.payout - st.bet)} 🪙`); fx.win(r.mult >= 4); paint(); });
  paint();
}

/* Dice: Scoreboard Roll. Stake-style: drag the big slider, the green zone is where you win, the roll lands on the bar. */
async function dice(root) {
  let target = 50, over = true, autoRun = false, rolling = false, hist = [];
  const L = CFG.luck, c2 = x => Math.round(Math.min(98, Math.max(2, x)) * 100) / 100;
  root.innerHTML = gameShell(`${betBox()}
    <button class="btn bjbig" id="roll">🎲 Roll dice <kbd>Space</kbd></button>
    <div class="duo"><button class="btn alt" id="ouflip">⇄ Roll <b id="oulab">Over</b> <kbd>U</kbd></button><button class="btn alt" id="auto">⚡ Auto ×10 <kbd>A</kbd></button></div>
    <div class="stats3"><div><small>Multiplier</small><b id="py">–</b></div><div><small>Roll <span id="oul2">over</span></small><input id="tgn" type="number" min="2" max="98" step="0.01" value="50"></div><div><small>Win chance</small><b id="wc">–</b></div></div>
    <div class="note">Drag the slider (or type a number) to set your target. The <b>green zone</b> wins. Smaller zone = bigger payout.</div>${luckLine('your green win zone is resized, payouts adjust to match.')}`,
    `<div class="dstage"><div class="dnum" id="dnum">50.00</div>
      <div class="dbar" id="dbar"><div class="dz lose" id="dzl"></div><div class="dz win" id="dzw"></div><input type="range" id="tg" class="dslider" min="2" max="98" step="0.01" value="50" aria-label="Dice target"><div class="dmark hidden" id="dmark"><span id="dmv"></span></div></div>
      <div class="dticks"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div><div class="dhist" id="dh" aria-label="Recent rolls"></div></div>`);
  const pos = v => `calc(17px + (100% - 34px) * ${v / 100})`;
  function geom() { // [win chance %, win zone edge, payout]
    const z0 = over ? 100 - target : target, zone = c2(L.sup ? 100 - (100 - z0) / L.k : z0 * L.k), edge = over ? 100 - zone : zone, zonePay = c2(z0 * L.pk);
    return { zone, edge, pays: 0.99 / (zonePay / 100) };
  }
  function paint() {
    const g = geom(); $('#py').textContent = g.pays.toFixed(g.pays >= 100 ? 0 : 2) + 'x'; $('#wc').textContent = g.zone.toFixed(2) + '%';
    $('#oulab').textContent = over ? 'Over' : 'Under'; $('#oul2').textContent = over ? 'over' : 'under';
    const lose = $('#dzl'), win = $('#dzw');
    if (over) { lose.style.cssText = `left:0;width:${pos(g.edge)}`; win.style.cssText = `left:${pos(g.edge)};right:0`; } else { win.style.cssText = `left:0;width:${pos(g.edge)}`; lose.style.cssText = `left:${pos(g.edge)};right:0`; }
    $('#tg').value = target; if (document.activeElement !== $('#tgn')) $('#tgn').value = target;
    $('#tg').style.setProperty('--fill', ((target - 2) / 96 * 100) + '%');
  }
  const setTarget = v => { target = Math.round(Math.min(98, Math.max(2, +v || 50)) * 100) / 100; paint(); };
  $('#tg').oninput = e => setTarget(e.target.value); $('#tgn').oninput = e => { if (e.target.value !== '') setTarget(e.target.value); }; $('#tgn').onblur = () => paint();
  const flipOU = () => { over = !over; paint(); sfx.play('tap'); }; $('#ouflip').onclick = flipOU;
  function pill() { $('#dh').innerHTML = hist.slice(0, 14).map(h => `<span class="${h.win ? 'good' : 'bad'}">${h.roll.toFixed(2)}</span>`).join(''); }
  async function doRoll() {
    if (rolling) return false; rolling = true; $('#roll').disabled = true;
    try {
      const r = await api('POST', '/arcade/dice', { bet: readBet(), target, over }), num = $('#dnum'), mk = $('#dmark'), bar = $('#dbar');
      $('#res').textContent = ''; num.className = 'dnum rolling'; mk.className = 'dmark scan'; bar.classList.remove('flash-g', 'flash-r');
      const steps = calm ? 0 : 16;
      for (let i = 0; i < steps; i++) { const v = Math.random() * 100; num.textContent = v.toFixed(2); mk.style.left = pos(v); $('#dmv').textContent = ''; if (i % 2) sfx.play('tap'); await wait(38 + i * 6); }
      if (!root.isConnected) { setBal(r.balance); return false; }
      num.textContent = r.roll.toFixed(2); num.className = 'dnum ' + (r.win ? 'good' : 'bad'); mk.style.left = pos(r.roll); mk.className = 'dmark land ' + (r.win ? 'good' : 'bad'); $('#dmv').textContent = r.roll.toFixed(2);
      bar.classList.add(r.win ? 'flash-g' : 'flash-r'); hist.unshift(r); pill();
      settleShot(r, r.mult >= 5); if (r.win) fx.bump(num);
      return true;
    } finally { rolling = false; if (root.isConnected) $('#roll').disabled = autoRun; }
  }
  $('#roll').onclick = act(doRoll);
  async function toggleAuto() {
    if (autoRun) { autoRun = false; $('#auto').innerHTML = '⚡ Auto ×10 <kbd>A</kbd>'; $('#roll').disabled = rolling; return; }
    autoRun = true; $('#roll').disabled = true;
    for (let n = 10; n > 0 && autoRun && root.isConnected; n--) {
      $('#auto').innerHTML = `⏹ Stop (${n} left) <kbd>A</kbd>`;
      try { if (!(await doRoll())) break; } catch (e) { toast(e.message); sfx.play('error'); break; }
      await wait(calm ? 100 : 380);
    }
    autoRun = false; if (root.isConnected) { $('#auto').innerHTML = '⚡ Auto ×10 <kbd>A</kbd>'; $('#roll').disabled = false; }
  }
  $('#auto').onclick = toggleAuto; stopFns.push(() => { autoRun = false; });
  paint(); pill();
}

/* Limbo: Hail Mary */
async function limbo(root) {
  root.innerHTML = gameShell(`${betBox()}
    <label>Target distance (min ${(Math.ceil(1.01 * CFG.luck.k * 100) / 100).toFixed(2)}x)</label><input id="tgt" type="number" min="${Math.ceil(1.01 * CFG.luck.k * 100) / 100}" max="1000" step="0.01" value="${Math.max(2, Math.ceil(1.01 * CFG.luck.k * 100) / 100).toFixed(2)}">
    <div class="stats"><div><small>Win chance</small><b id="wc"></b></div><div><small>Pays</small><b id="py"></b></div></div>
    <button class="btn" id="throw">Throw it 🏈</button><div class="note">The QB airs it out. If the throw goes at least as far as your target, you win.</div>${luckLine('throws fly farther, a win pays target ÷ ' + CFG.luck.k + '.')}`,
    `<div class="mult" id="mult">1.00x</div><div class="field"><div class="ball" id="ball">🏈</div><div class="goal" id="goal"></div></div><div class="curb">🏟️ South Lakes Stadium</div>`);
  const tgt = () => Math.max(Math.ceil(1.01 * CFG.luck.k * 100) / 100, Math.min(1000, +$('#tgt').value || 2));
  const paint = () => { const t = tgt(), k = CFG.luck.k; $('#wc').textContent = Math.min(99, 99 * k / t).toFixed(2) + '%'; $('#py').textContent = (t / k).toFixed(2) + 'x'; $('#goal').style.left = Math.min(92, 8 + Math.log(t) / Math.log(1000) * 84) + '%'; };
  $('#tgt').oninput = paint;
  $('#throw').onclick = act(async () => {
    const t = tgt(), r = await api('POST', '/arcade/limbo', { bet: readBet(), target: t }), m = $('#mult'), ball = $('#ball');
    $('#res').textContent = ''; m.classList.remove('lost');
    const end = Math.min(r.crash, 1000), t0 = performance.now(), dur = calm ? 0 : 900;
    // timer-driven (not requestAnimationFrame) so the throw always finishes, even in a background tab
    await new Promise(done => { const step = () => { const k = dur ? Math.min(1, (performance.now() - t0) / dur) : 1, v = Math.exp(Math.log(end) * k);
      m.textContent = v.toFixed(2) + 'x'; ball.style.left = Math.min(92, 8 + Math.log(v) / Math.log(1000) * 84) + '%'; ball.style.bottom = 20 + Math.sin(k * Math.PI) * 60 + 'px';
      k < 1 ? setTimeout(step, 16) : done(); }; step(); });
    if (!root.isConnected) return setBal(r.balance); // player switched games mid-animation
    m.textContent = r.crash.toFixed(2) + 'x'; if (!r.win) m.classList.add('lost');
    settleShot(r, r.target >= 5);
  });
  paint();
}

/* Slots: Seahawk Slots. 3x3 reels, 5 paylines, wild hawk, pull-down lever. The server deals the grid; we animate it. */
const SLOT_COLORS = ['#ffe08a', '#19e58a', '#5b8cff', '#ff4fd8', '#ff9f1a']; // payline colors
async function slots(root, my) {
  const keys = Object.keys(EMO), pays = CFG.slots.pays, LINES = CFG.slots.lines;
  let spinning = false, autoRun = false, recent = [];
  const bulbs = Array.from({ length: 22 }, (_, k) => `<i style="--k:${k}"></i>`).join('');
  const symTile = k => `<div class="stile s-${k}" data-k="${k}"><span>${EMO[k]}</span>${k === 'hawk' ? '<em>WILD</em>' : ''}</div>`;
  const start = [['pass', 'volley', 'bus'], ['hawk', 'trophy', 'bball'], ['bus', 'football', 'pass']]; // column 0..2, top→bottom (no accidental wins)
  root.innerHTML = gameShell(`${betBox()}
    <div class="stats"><div><small>Bet per line</small><b id="perline">–</b></div><div><small>Paylines</small><b>5</b></div></div>
    <button class="btn bjbig" id="spin">🎰 Pull the lever <kbd>Space</kbd></button>
    <div class="duo"><button class="btn alt" id="auto">⚡ Auto ×10 <kbd>A</kbd></button><button class="btn alt" id="turbo" aria-pressed="false">🚀 Turbo</button></div>
    <div class="paytable">${['trophy', 'hawk', 'football', 'volley', 'bball', 'bus', 'pass'].map(k => `<div><span>${EMO[k].repeat(3)}</span><b>${+(pays[k] / 5).toFixed(2)}x</b></div>`).join('')}
      <div class="ptnote"><span>🦅 is <b>WILD</b></span><b>fills in for anything but 🏆</b></div></div>
    <div class="note">Your bet is split across <b>5 paylines</b> (3 rows + 2 diagonals). Three matching symbols on a line win, and wins on several lines add up. Pays shown are for one line, as a multiple of your whole bet. Drag the lever down, press Space, or tap the lever.</div>`,
    `<div class="slotm" id="slotm"><div class="smarq"><div class="sbulbs">${bulbs}</div><h3>SEAHAWK <b>SLOTS</b></h3><div class="sjack">🏆 JACKPOT ${pays.trophy / 5}x</div></div>
      <div class="scab"><div class="swin" id="swin"><div class="sreels" id="sreels">${[0, 1, 2].map(c => `<div class="sreel" data-c="${c}"><div class="sstrip">${start[c].map(symTile).join('')}</div></div>`).join('')}</div>
          <svg class="slines" viewBox="0 0 3 3" preserveAspectRatio="none" aria-hidden="true">${LINES.map((L, i) => `<polyline id="pl${i}" points="${L.map((r, c) => `${c + .5},${r + .5}`).join(' ')}" stroke="${SLOT_COLORS[i]}"/>`).join('')}</svg>
          <div class="swinfx" id="swinfx"><div class="sbanner" id="sbn"></div></div></div>
        <div class="shandle" id="shandle"><div class="hbase"></div><div class="harm" id="harm"><div class="hrod"></div><button class="hball" id="hball" aria-label="Pull the lever to spin"></button></div><div class="hhint">PULL ↓</div></div></div>
      <div class="slast" id="slast" aria-label="Recent spins"></div></div>`, 'wide2');
  const reels = [...root.querySelectorAll('.sreel')], strips = reels.map(r => r.firstElementChild), slotm = $('#slotm'), harm = $('#harm'), lever = $('#shandle');
  const tileH = () => reels[0].clientHeight / 3, rnd = () => keys[Math.floor(Math.random() * keys.length)];
  const perLineTxt = () => { const v = readBet() / 5; return v % 1 ? v.toFixed(1) : String(v); };
  $('#bet').addEventListener('input', () => { $('#perline').textContent = perLineTxt(); }); $('#perline').textContent = perLineTxt();
  const pills = () => { $('#slast').innerHTML = recent.slice(0, 12).map(m => `<span class="${m >= 5 ? 'gold' : m >= 1 ? 'good' : m > 0 ? 'meh' : 'bad'}">${m ? m.toFixed(2) + 'x' : '0x'}</span>`).join(''); };
  const setReel = (c, syms) => { strips[c].style.transition = 'none'; strips[c].style.transform = 'translateY(0)'; strips[c].innerHTML = syms.map(symTile).join(''); };
  const curCol = c => [...strips[c].children].map(e => e.dataset.k).slice(0, 3);
  async function spinReel(c, final3, dur) { // symbols scroll DOWN: new ones enter at the top and settle with a little overshoot
    const cur = curCol(c), filler = Array.from({ length: 12 + c * 5 + Math.round(dur / 320) }, rnd), seq = [...final3, ...filler, ...cur], t = tileH();
    strips[c].innerHTML = seq.map(symTile).join(''); strips[c].style.transition = 'none'; strips[c].style.transform = `translateY(${-(seq.length - 3) * t}px)`; void strips[c].offsetWidth;
    reels[c].classList.add('blur'); strips[c].style.transition = `transform ${dur}ms cubic-bezier(.15,.8,.22,1.07)`; strips[c].style.transform = 'translateY(0)';
    await wait(dur); reels[c].classList.remove('blur'); setReel(c, final3); reels[c].classList.add('thud'); setTimeout(() => reels[c].classList.remove('thud'), 260);
  }
  function coinRain(n) { if (calm) return; const fxl = $('#swinfx'); for (let i = 0; i < n; i++) { const e = document.createElement('i'); e.className = 'coinf'; e.textContent = '🪙'; e.style.cssText = `left:${Math.random() * 96}%;animation-delay:${Math.random() * .8}s;animation-duration:${1 + Math.random() * 1.1}s;font-size:${18 + Math.random() * 16}px`; fxl.appendChild(e); setTimeout(() => e.remove(), 2400); } }
  function clearHits() { root.querySelectorAll('.stile.hit,.stile.dim').forEach(e => e.classList.remove('hit', 'dim')); root.querySelectorAll('.slines polyline').forEach(p => p.classList.remove('on')); $('#sbn').className = 'sbanner'; $('#sbn').innerHTML = ''; slotm.classList.remove('frenzy', 'won'); }
  function tease(grid) { // does any line look like it could still be completed by the last reel?
    return LINES.some(L => { const a = grid[L[0]][0], b = grid[L[1]][1]; return (a === b && a !== 'trophy') || (a === 'hawk' && b !== 'trophy') || (b === 'hawk' && a !== 'trophy') || (a === 'trophy' && b === 'trophy'); });
  }
  async function playSpin(r) {
    const speed = $('#turbo').getAttribute('aria-pressed') === 'true' || autoRun ? 0.55 : 1, grid = r.grid, col = c => [0, 1, 2].map(row => grid[row][c]);
    const teasing = !calm && tease(grid) && speed === 1;
    slotm.classList.add('spinning'); if (teasing) slotm.classList.add('hot');
    const tick = setInterval(() => sfx.play('flip'), 95);
    const durs = [1000, 1450, teasing ? 3000 : 1900].map(d => calm ? 80 : d * speed);
    const jobs = [0, 1, 2].map(c => spinReel(c, col(c), durs[c]).then(() => { sfx.play('clunk'); if (c === 1 && teasing) { reels[2].classList.add('tease'); sfx.play('streak'); } }));
    await Promise.all(jobs); clearInterval(tick); reels[2].classList.remove('tease'); slotm.classList.remove('spinning', 'hot');
  }
  async function celebrate(r) {
    const wins = r.wins, m = r.mult, jack = wins.some(w => w.sym === 'trophy'), tier = jack ? 'jackpot' : m >= 80 ? 'mega' : m >= 20 ? 'big' : m >= 5 ? 'nice' : m >= 1 ? 'win' : 'small';
    wins.forEach(w => { $('#pl' + w.line).classList.add('on'); w.cells.forEach(([row, c]) => { const t = reels[c].children[row]; if (t) t.classList.add('hit'); }); });
    root.querySelectorAll('.stile:not(.hit)').forEach(e => e.classList.add('dim')); slotm.classList.add('won');
    const label = { jackpot: '🏆 STATE CHAMPS<br>JACKPOT 🏆', mega: 'MEGA WIN', big: 'BIG WIN', nice: 'NICE WIN', win: 'WIN' }[tier];
    if (label) { $('#sbn').className = 'sbanner show ' + tier; $('#sbn').innerHTML = `<small>${wins.length} line${wins.length > 1 ? 's' : ''}</small><b>${label}</b><strong id="sbamt">0</strong><span>🪙</span>`; countUp($('#sbamt'), r.payout, calm ? 0 : 1100); }
    coinRain({ jackpot: 90, mega: 60, big: 40, nice: 24, win: 14, small: 6 }[tier]);
    if (tier === 'jackpot') { slotm.classList.add('frenzy'); sfx.play('jackpot'); fx.burst(320); setTimeout(() => fx.burst(220), 700); }
    else if (tier === 'mega' || tier === 'big') { slotm.classList.add('frenzy'); fx.win(true); sfx.play('big'); }
    else if (tier === 'nice') { fx.win(true); } else if (tier === 'win') { fx.win(false); } else sfx.play('coin');
    wins.forEach((w, i) => setTimeout(() => sfx.play('coin'), 120 + i * 140));
    return { tier, hold: { jackpot: 4200, mega: 3000, big: 2400, nice: 1800, win: 1400, small: 700 }[tier] };
  }
  async function spin() { // called once the lever has been pulled
    if (spinning) return false; spinning = true; lever.classList.add('locked'); $('#spin').disabled = true;
    let ok = false;
    try {
      clearHits(); $('#res').textContent = '';
      const r = await api('POST', '/arcade/slots', { bet: readBet() });
      U.balance = r.balance; pending += r.payout; showBal(); // the bet leaves now; winnings appear when the reels stop
      await playSpin(r); if (!root.isConnected) { pending = 0; return setBal(r.balance); }
      recent.unshift(r.mult); pills();
      let hold = 600;
      if (r.payout > 0) { const c = await celebrate(r); hold = c.hold; resMsg(r.payout >= r.bet, `${r.mult.toFixed(2)}x · ${r.payout >= r.bet ? '+' : '−'}${fmt(Math.abs(r.payout - r.bet))} 🪙`); }
      else { resMsg(false, `No win · −${fmt(r.bet)} 🪙`); fx.lose(); }
      pending = Math.max(0, pending - r.payout); showBal(); ok = true;
      if (!autoRun) await wait(calm ? 0 : Math.min(hold, 800)); else await wait(calm ? 0 : hold);
      if (!autoRun) setTimeout(() => { if (!spinning) clearHits(); }, 2500);
    } catch (e) { toast(e.message); sfx.play('error'); }
    finally { spinning = false; if (root.isConnected) { lever.classList.remove('locked'); $('#spin').disabled = autoRun; } }
    return ok;
  }
  /* ---- the lever ---- */
  const setArm = (deg, ms, ease) => { harm.style.transition = ms ? `transform ${ms}ms ${ease || 'ease-in'}` : 'none'; harm.style.transform = `rotate(${deg}deg)`; };
  const REST = 0, CATCH = 130, FULL = 162;
  async function pullAuto() { // what Space / the Spin button do: the lever pulls itself
    if (spinning || lever.classList.contains('busy')) return false; lever.classList.add('busy');
    sfx.play('lever'); setArm(FULL, calm ? 0 : 300, 'cubic-bezier(.4,0,.8,.6)'); await wait(calm ? 0 : 310); sfx.play('ratchet');
    setArm(REST, calm ? 0 : 650, 'cubic-bezier(.3,1.6,.5,1)'); lever.classList.remove('busy'); return spin();
  }
  const ball = $('#hball'); let drag = null;
  ball.addEventListener('pointerdown', e => {
    if (spinning || lever.classList.contains('busy')) return; const b = $('.hbase', lever).getBoundingClientRect();
    drag = { cx: b.x + b.width / 2, cy: b.y + b.height / 2, max: 0, caught: false }; try { ball.setPointerCapture(e.pointerId); } catch (x) {} lever.classList.add('dragging'); e.preventDefault();
  });
  ball.addEventListener('pointermove', e => {
    if (!drag || drag.caught) return; let a = Math.atan2(e.clientX - drag.cx, -(e.clientY - drag.cy)) * 180 / Math.PI; if (a < 0) a = a < -90 ? FULL : 0; a = Math.min(FULL, a); drag.max = Math.max(drag.max, a);
    setArm(a, 0); if (a >= CATCH) { drag.caught = true; sfx.play('ratchet'); setArm(FULL, 70); setTimeout(() => { setArm(REST, calm ? 0 : 650, 'cubic-bezier(.3,1.6,.5,1)'); spin(); }, 90); }
  });
  const release = () => { if (!drag) return; const d = drag; drag = null; lever.classList.remove('dragging'); if (d.caught) return; if (d.max < 8) pullAuto(); else setArm(REST, 450, 'cubic-bezier(.3,1.6,.5,1)'); };
  ball.addEventListener('pointerup', release); ball.addEventListener('pointercancel', release);
  ball.addEventListener('click', e => { if (e.detail === 0) pullAuto(); }); // keyboard Enter on the focused lever
  $('#spin').onclick = () => { pullAuto(); };
  $('#turbo').onclick = () => { const on = $('#turbo').getAttribute('aria-pressed') !== 'true'; $('#turbo').setAttribute('aria-pressed', on); $('#turbo').classList.toggle('on', on); };
  async function toggleAuto() {
    if (autoRun) { autoRun = false; $('#auto').innerHTML = '⚡ Auto ×10 <kbd>A</kbd>'; return; }
    autoRun = true; $('#spin').disabled = true;
    for (let n = 10; n > 0 && autoRun && root.isConnected; n--) {
      $('#auto').innerHTML = `⏹ Stop (${n} left) <kbd>A</kbd>`;
      if (!(await pullAuto())) break; await wait(calm ? 0 : 250);
    }
    autoRun = false; if (root.isConnected) { $('#auto').innerHTML = '⚡ Auto ×10 <kbd>A</kbd>'; if (!spinning) $('#spin').disabled = false; }
  }
  $('#auto').onclick = toggleAuto; stopFns.push(() => { autoRun = false; });
  pills();
}

/* Roulette: Lakes Roulette */
const RA = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]), rcol = n => n === 0 ? 'gold' : RA.has(n) ? 'green' : 'blue';
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
async function roulette(root) {
  let chip = 5, bets = {}, rot = 0, ball = 0; const seg = 360 / 37, C = { green: '#0f9d58', blue: '#1b4fd8', gold: '#f5a623' };
  const OUT = [['color', 'green', 'Green'], ['color', 'blue', 'Blue'], ['parity', 'odd', 'Odd'], ['parity', 'even', 'Even'], ['half', 'low', '1–18'], ['half', 'high', '19–36'], ['dozen', 1, '1st 12'], ['dozen', 2, '2nd 12'], ['dozen', 3, '3rd 12']];
  root.innerHTML = gameShell(`<label>Chip</label><div class="chips" id="chips">${[1, 5, 10, 25, 100, 500].map(c => `<button class="chipb ${c === chip ? 'on' : ''}" data-c="${c}">${c}</button>`).join('')}</div>
    <div class="rtable"><button class="rc gold" data-b="num:0">0</button><div class="rgrid">${Array.from({ length: 36 }, (_, i) => `<button class="rc ${rcol(i + 1)}" data-b="num:${i + 1}">${i + 1}</button>`).join('')}</div>
    <div class="rout">${OUT.map(([t, v, l]) => `<button class="rc out ${t === 'color' ? v : ''}" data-b="${t}:${v}">${l}</button>`).join('')}</div></div>
    <div class="stats"><div><small>Total bet</small><b id="tot">0</b></div><div><small>Your balance</small><b>${fmt(U.balance)}</b></div></div>
    <div class="duo"><button class="btn alt" id="clr">Clear <kbd>X</kbd></button><button class="btn bjbig" id="spin">🎡 Spin <kbd>Space</kbd></button></div>`,
    `<div class="wheelwrap big"><div class="pointer">▼</div><div class="wheel" id="wh" style="background:conic-gradient(${WHEEL.map((n, i) => `${C[rcol(n)]} ${i * seg}deg ${(i + 1) * seg}deg`).join(',')})"><div class="wnums" id="wnums"></div><div class="wring"></div></div>
      <div class="ballwrap" id="ballwrap"><i class="rball"></i></div><div class="hub" id="hub"><img src="logo.svg" alt=""></div></div>
    <div class="rhist" id="rhist"></div>`, 'wide');
  const total = () => Object.values(bets).reduce((a, b) => a + b, 0), hist = [];
  function numbers() { // number labels around the rim, sized to the wheel
    const w = $('#wh').clientWidth || 400, R = w * 0.42;
    $('#wnums').innerHTML = WHEEL.map((n, i) => `<span class="${rcol(n)}" style="transform:rotate(${(i + 0.5) * seg}deg) translateY(${-R}px);font-size:${Math.max(9, w * 0.034)}px">${n}</span>`).join('');
  }
  function paint() {
    root.querySelectorAll('[data-b]').forEach(b => { const v = bets[b.dataset.b]; b.dataset.amt = v || ''; b.classList.toggle('bet', !!v); });
    $('#tot').textContent = fmt(total());
  }
  const pills = () => { $('#rhist').innerHTML = hist.slice(0, 14).map(n => `<span class="${rcol(n)}">${n}</span>`).join(''); };
  $('#chips').onclick = e => { const c = e.target.dataset.c; if (!c) return; chip = +c; root.querySelectorAll('.chipb').forEach(b => b.classList.toggle('on', b.dataset.c === c)); };
  root.querySelector('.rtable').onclick = e => { const b = e.target.closest('[data-b]'); if (!b) return; if (total() + chip > U.balance) return toast('Not enough Hawk Bucks for that chip'); bets[b.dataset.b] = (bets[b.dataset.b] || 0) + chip; sfx.play('flip'); paint(); };
  $('#clr').onclick = () => { bets = {}; paint(); };
  $('#spin').onclick = act(async () => {
    if (!total()) return toast('Tap the table to place chips');
    const list = Object.entries(bets).map(([k, amount]) => { const [type, v] = k.split(':'); return { type, value: type === 'color' || type === 'parity' || type === 'half' ? v : +v, amount }; });
    const r = await api('POST', '/arcade/roulette', { bets: list }); $('#res').textContent = '';
    const i = WHEEL.indexOf(r.n); rot = Math.ceil((rot + 2160) / 360) * 360 + (360 - (i + 0.5) * seg); ball = Math.ceil((ball + 2880) / 360) * 360;
    $('#hub').innerHTML = '<img src="logo.svg" alt="">'; $('#wh').style.transform = `rotate(${rot}deg)`; $('#ballwrap').style.transform = `rotate(${-ball}deg)`; $('#wh').classList.add('spinning');
    if (!calm) for (let t = 0; t < 14; t++) { sfx.play('tap'); await wait(80 + t * 25); }
    $('#wh').classList.remove('spinning');
    if (!root.isConnected) return setBal(r.balance); // player switched games mid-animation
    $('#hub').innerHTML = `<b class="${r.color}">${r.n}</b>`; fx.bump($('#hub')); hist.unshift(r.n); pills();
    settleShot(r, r.mult >= 10);
  });
  paint(); requestAnimationFrame(numbers); addEventListener('resize', numbers); stopFns.push(() => removeEventListener('resize', numbers));
}

/* Rock paper scissors: Hallway RPS */
async function rps(root, my) {
  const H = { rock: '✊', paper: '✋', scissors: '✌️' }; let st = null;
  root.innerHTML = gameShell(`${betBox()}<div style="height:14px"></div><button class="btn" id="start">Step into the hallway</button>
    <div class="trio hidden" id="throws">${Object.entries(H).map(([k, e]) => `<button class="btn blue" data-t="${k}">${e}</button>`).join('')}</div>
    <button class="btn gold hidden" id="cash" style="margin-top:8px"></button>
    <div class="note">Beat a Concorde District rival. 1 in 3 throws ties and replays; otherwise you win <b>${pct(CFG.luck.rpsP)}</b> of the time. First win pays <b>${(0.98 / CFG.luck.rpsP).toFixed(2)}x</b>, each one after ×${(1 / CFG.luck.rpsP).toFixed(2)}. Up to ${CFG.rpsMax} in a row.</div>${luckLine('rivals lose more often, wins pay less.')}`,
    `<div class="mult" id="mult">—</div><div class="vs"><div><div class="hand" id="me">✊</div><small>South Lakes</small></div><b>VS</b><div><div class="hand flip" id="them">✊</div><small id="rival">Rival</small></div></div><div class="pips" id="pips"></div>`);
  function paint() {
    const live = st && st.live;
    $('#start').classList.toggle('hidden', !!live); $('#throws').classList.toggle('hidden', !live);
    $('#cash').classList.toggle('hidden', !(live && st.streak)); if (st) $('#cash').textContent = `Cash out ${fmt(st.bet * st.mult)} 🪙`;
    $('#mult').textContent = st && st.streak ? st.mult.toFixed(2) + 'x' : live ? 'Throw!' : '—';
    $('#pips').innerHTML = Array.from({ length: CFG.rpsMax }, (_, i) => `<i class="${st && i < st.streak ? 'on' : ''}"></i>`).join('');
  }
  const a = (await api('GET', '/arcade/active?game=rps')).round; if (my !== nav) return;
  if (a) { st = { bet: a.bet, streak: a.streak, mult: a.mult, live: true }; $('#res').textContent = 'Streak restored'; }
  $('#start').onclick = act(async () => { const r = await api('POST', '/arcade/rps/start', { bet: readBet() }); setBal(r.balance); st = { bet: r.bet, streak: 0, mult: 0, live: true }; $('#res').textContent = ''; paint(); });
  root.querySelectorAll('[data-t]').forEach(b => b.onclick = act(async () => {
    const r = await api('POST', '/arcade/rps/throw', { throw: b.dataset.t }), me = $('#me'), them = $('#them');
    $('#rival').textContent = r.rival; me.textContent = them.textContent = '✊'; me.classList.add('pump'); them.classList.add('pump');
    await wait(calm ? 0 : 900); me.classList.remove('pump'); them.classList.remove('pump');
    if (!root.isConnected) return setBal(r.balance); // player switched games mid-animation
    me.textContent = H[r.me]; them.textContent = H[r.them];
    if (r.tie) resMsg(true, `Tie with ${esc(r.rival)} – go again`);
    else if (r.lost) { st.live = false; setBal(r.balance); resMsg(false, `${esc(r.rival)} wins · −${fmt(st.bet)} 🪙`); fx.lose(); }
    else { st.streak = r.streak; st.mult = r.mult; fx.bump($('#mult'));
      if (r.cashed) { st.live = false; setBal(r.balance); resMsg(true, `Undefeated! +${fmt(r.payout - st.bet)} 🪙`); fx.win(true); } else { resMsg(true, `Beat ${esc(r.rival)}! Streak ${r.streak}`); streakFx(r.streak); } }
    paint();
  }));
  $('#cash').onclick = act(async () => { const r = await api('POST', '/arcade/rps/cashout'); st.live = false; setBal(r.balance); resMsg(true, `Cashed out +${fmt(r.payout - st.bet)} 🪙`); fx.win(r.mult >= 4); paint(); });
  paint();
}

/* Blackjack: Hawk 21 */
async function bj(root, my) {
  const RK = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }, SU = ['♠', '♥', '♦', '♣']; let v = null, shown = { player: 0, dealer: 0 };
  root.innerHTML = gameShell(`${betBox()}<div style="height:14px"></div><button class="btn bjbig" id="deal">🃏 Deal <kbd>Space</kbd></button>
    <div class="note">Beat Coach to 21. Blackjack pays 3:2, Coach stands on 17, and you can double on your first two cards.</div>`,
    `<div class="felt"><div class="who2">Coach <b id="dt"></b></div><div class="hand2" id="dealer"></div><div class="feltlogo"><img src="logo.svg" alt="">HAWK 21</div><div class="hand2" id="player"></div><div class="who2">You <b id="pt"></b></div></div>
    <div class="bjacts hidden" id="acts"><button class="btn blue" id="hit"><span>👊</span>Hit<kbd>H</kbd></button><button class="btn" id="stand"><span>✋</span>Stand<kbd>S</kbd></button><button class="btn gold" id="dbl"><span>💰</span>Double<kbd>D</kbd></button></div>
    <button class="btn bjbig bjdeal2 hidden" id="deal2">🃏 Deal again <kbd>Space</kbd></button>`);
  const cardHtml = (c, i, isNew, hidden) => hidden ? `<div class="pc back ${isNew ? 'new' : ''}" style="--d:${i * 0.12}s"><img src="logo.svg" alt=""></div>`
    : `<div class="pc s${c.s} ${isNew ? 'new' : ''}" style="--d:${i * 0.12}s"><b>${RK[c.r] || c.r}</b><span>${SU[c.s]}</span></div>`;
  function paint(fresh) {
    if (fresh) shown = { player: 0, dealer: 0 };
    const live = v && !v.done, pl = v ? v.player : [], dl = v ? (v.done ? v.dealer : [v.dealer[0], null]) : [];
    $('#player').innerHTML = pl.map((c, i) => cardHtml(c, i - shown.player, i >= shown.player)).join('');
    $('#dealer').innerHTML = dl.map((c, i) => cardHtml(c, i - shown.dealer, i >= shown.dealer || (v.done && i === 1), !c)).join('');
    shown = { player: pl.length, dealer: v && v.done ? dl.length : 1 };
    $('#pt').textContent = v ? v.pt : ''; $('#dt').textContent = v ? (v.done ? v.dt : v.dt + ' + ?') : '';
    $('#deal').classList.toggle('hidden', !!live); $('#acts').classList.toggle('hidden', !live); $('#dbl').disabled = !(live && v.canDouble);
    $('#deal2').classList.toggle('hidden', !(v && v.done));
  }
  function done(r) {
    v = r; paint(); setBal(r.balance);
    const msg = { blackjack: `Blackjack! +${fmt(r.payout - r.bet)} 🪙`, win: `You beat Coach! +${fmt(r.payout - r.bet)} 🪙`, push: 'Push · bet back', lose: `Coach wins · −${fmt(r.bet)} 🪙`, bust: `Bust! · −${fmt(r.bet)} 🪙` }[r.result];
    resMsg(r.payout >= r.bet, msg); if (r.payout > r.bet) fx.win(r.result === 'blackjack'); else if (r.payout < r.bet) fx.lose();
  }
  const a = (await api('GET', '/arcade/active?game=bj')).round; if (my !== nav) return;
  if (a) { v = a; $('#res').textContent = 'Hand restored'; }
  const step = path => act(async () => { const r = await api('POST', '/arcade/bj/' + path); if (!root.isConnected) return setBal(r.balance); if (r.done) done(r); else { v = r; paint(); } });
  $('#deal').onclick = act(async () => { $('#res').textContent = ''; const r = await api('POST', '/arcade/bj/start', { bet: readBet() }); v = null; paint(true); if (r.done) { await wait(calm ? 0 : 300); if (!root.isConnected) return setBal(r.balance); done(r); } else { v = r; setBal(r.balance); paint(); } });
  $('#hit').onclick = step('hit'); $('#stand').onclick = step('stand'); $('#dbl').onclick = step('double'); $('#deal2').onclick = () => $('#deal').click();
  paint();
}

/* ---------- bank ---------- */
async function renderBank(my) {
  const m = await api('GET', '/me'); if (my !== nav) return; U = m.user; showBal();
  $('#app').innerHTML = `<h1>Hawk Bank</h1><div class="panel bank"><img class="bank-logo" src="logo.svg" alt="">
    <div class="bigbal"><small>Your balance</small><b id="bb">${fmt(U.balance)}</b><span>Hawk Bucks</span></div>
    <div class="trio">${[100, 500, 1000].map(n => `<button class="btn ${n === 1000 ? 'gold' : ''}" data-amt="${n}">+${fmt(n)}</button>`).join('')}</div>
    <div class="note" id="bnote"></div></div>`;
  const note = () => { $('#bnote').innerHTML = `Free, always – no real money, no cash value. You've added <b>${fmt(U.added)}</b> so far. The leaderboard ranks <b>net winnings</b>, so adding Hawk Bucks won't move you up.`; };
  document.querySelectorAll('[data-amt]').forEach(b => b.onclick = act(async () => {
    const n = +b.dataset.amt, r = await api('POST', '/bank', { amount: n }); U.added = r.added; setBal(r.balance);
    $('#bb').textContent = fmt(r.balance); fx.bump($('#bb')); sfx.play('cash'); fx.burst(n >= 1000 ? 120 : 50); toast(`+${fmt(n)} Hawk Bucks`); note();
  }));
  note();
}

/* ---------- skill games UI (score-only; the server keeps the clock and the answers) ---------- */
const hsBox = () => '<div class="hs"><h3>🏆 Top scores</h3><ol id="hs"><li class="mutecell">Loading…</li></ol></div>';
async function loadHS(id) {
  try {
    const { top } = await api('GET', '/arcade/highscores?game=' + id), el = $('#hs'); if (!el) return;
    el.innerHTML = top.map(t => `<li class="${t.username === U.username ? 'me' : ''}"><span>${esc(t.username)}</span><b>${fmt(t.best)}</b></li>`).join('') || '<li class="mutecell">No scores yet – be the first!</li>';
  } catch (e) {}
}
function countUp(el, to, ms = 900) {
  if (!el) return; const from = +String(el.textContent).replace(/[^\d]/g, '') || 0;
  if (calm || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), step = () => { const k = Math.min(1, (performance.now() - t0) / ms); el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) setTimeout(step, 16); };
  step();
}
const skillBet = id => `${betBox()}<div class="tiers" aria-label="Payout by score">${CFG.skillTiers[id].map(([min, m]) => `<span>${fmt(min)}+ <b>${m}x</b></span>`).join('')}<span>lower <b>0</b></span></div>
  <div class="duo"><button class="btn" id="start">🪙 Play for Hawk Bucks</button><button class="btn alt" id="practice">Practice (free)</button></div>
  <div class="note">Your score sets the payout, and luck doesn't apply here. Starting over or leaving a paid game early forfeits the bet.</div>`;
const lockStart = on => { $('#start').disabled = on; const p = $('#practice'); if (p) p.disabled = on; };
function skillDone(id, r, great) {
  STATS.best[id] = { score: r.best }; paintPB(); lastRes = null;
  if (r.bet) {
    setBal(r.balance);
    $('#res').insertAdjacentHTML('beforeend', r.payout ? ` <span class="win">· ${r.mult}x → +${fmt(r.payout - r.bet)} 🪙</span>` : ` <span class="lose">· −${fmt(r.bet)} 🪙</span>`);
  }
  if (r.newBest) { fx.burst(150); sfx.play('pb'); setTimeout(() => toast(`🏆 New personal best: ${fmt(r.score)}!`), 300); fx.bump($('#pb')); }
  else if (r.bet && r.payout > r.bet) fx.win(r.mult >= 2);
  else if (r.bet && !r.payout) fx.lose();
  else if (great) fx.win(false); else sfx.play('win');
  loadHS(id);
}
function skillButtons(begin) { $('#start').onclick = () => begin(readBet())(); $('#practice').onclick = () => begin(0)(); }

/* Reaction: Bell Rush */
async function bell(root) {
  let st = null, tok = 0, ringing = false, busy = false;
  root.innerHTML = gameShell(`<div class="note" style="margin-top:0"><b>How to play:</b> press Start, wait for the bell, then tap the big button (or press Space) as fast as you can. 5 bells. Each bell is worth 1,000 minus your reaction time in milliseconds. Tap before it rings and that bell scores 0.</div>
    ${skillBet('bell')}<div class="stats"><div><small>Score</small><b id="sc">0</b></div><div><small>Bell</small><b id="bn">–</b></div></div>${hsBox()}`,
    `<button class="bellpad" id="pad" disabled><span class="bellemoji">🔔</span><b id="padtxt">Press Start</b></button><div class="pips" id="pips">${'<i></i>'.repeat(5)}</div>`);
  const pad = $('#pad'), txt = $('#padtxt'), setPad = (cls, t) => { pad.className = 'bellpad ' + cls; txt.textContent = t; };
  async function next() {
    const me = ++tok; ringing = false; setPad('wait', 'Wait for it…'); pad.disabled = false;
    try { const r = await api('POST', '/arcade/bell/next'); if (me !== tok || !root.isConnected) return; $('#bn').textContent = `${r.bell} / 5`; ringing = true; setPad('ring', 'TAP!'); sfx.play('bell'); }
    catch (e) { if (me === tok) toast(e.message); }
  }
  async function tap() {
    if (!st || busy) return; busy = true; tok++; // tok++ cancels a pending ring if this tap was early
    try {
      const r = await api('POST', '/arcade/bell/tap'); if (!root.isConnected) return;
      const pip = $('#pips').children[r.bell - 1];
      if (r.res === 'ok') { setPad('good', `${r.ms} ms · +${r.pts}`); sfx.play(r.ms < 300 ? 'streak' : 'reveal'); pip.classList.add('on'); fx.bump(txt); }
      else { setPad('bad', r.res === 'early' ? 'Too early! +0' : 'Too slow! +0'); pip.classList.add('bad'); r.res === 'early' ? fx.lose() : sfx.play('miss'); }
      countUp($('#sc'), r.total, 400);
      if (r.done) {
        st = null; pad.disabled = true; lockStart(false);
        setTimeout(() => { if (!root.isConnected) return; setPad('done', `Final: ${fmt(r.score)}`); resMsg(true, `Score ${fmt(r.score)}${r.bestMs ? ` · fastest ${r.bestMs} ms` : ''}`); skillDone('bell', r, r.score >= 3000); }, 700);
      } else setTimeout(() => { if (root.isConnected && st) next(); }, 850);
    } catch (e) { toast(e.message); } finally { busy = false; }
  }
  pad.onclick = () => { if (st && (ringing || pad.classList.contains('wait'))) tap(); };
  stopFns.push(() => { tok++; });
  skillButtons(bet => act(async () => {
    const s0 = await api('POST', '/arcade/bell/start', { bet }); if (s0.bet) setBal(s0.balance); st = {}; lockStart(true); $('#sc').textContent = '0'; $('#res').textContent = '';
    [...$('#pips').children].forEach(i => i.className = ''); pad.focus(); next();
  }));
  loadHS('bell');
}

/* Memory: Classroom Memory */
async function memory(root, my) {
  const IC = ['🦅', '🏈', '📚', '🔔', '🧪', '🎒', '🍕', '🚌']; let st = null, tick = 0, t0 = 0;
  root.innerHTML = gameShell(`<div class="note" style="margin-top:0"><b>How to play:</b> flip two cards at a time to find the 8 matching pairs. Score starts at 3,000: −100 for each try past 8 and −10 per second.</div>
    ${skillBet('memory')}<div class="stats"><div><small>Tries</small><b id="mv">0</b></div><div><small>Time</small><b id="tm">0.0s</b></div></div>${hsBox()}`,
    `<div class="mgrid" id="mg">${Array.from({ length: 16 }, (_, i) => `<button class="mcard" data-i="${i}" disabled aria-label="Card ${i + 1}, face down"><span class="mback"><img src="logo.svg" alt=""></span><span class="mface"></span></button>`).join('')}</div>`);
  const cards = [...root.querySelectorAll('.mcard')];
  const face = (i, sym) => { cards[i].querySelector('.mface').textContent = IC[sym]; cards[i].classList.add('up'); cards[i].setAttribute('aria-label', `Card ${i + 1}, ${IC[sym]}`); };
  const hide = i => { cards[i].classList.remove('up'); cards[i].setAttribute('aria-label', `Card ${i + 1}, face down`); };
  const clock = () => { clearInterval(tick); tick = setInterval(() => { if (!root.isConnected) return clearInterval(tick); $('#tm').textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's'; }, 100); };
  stopFns.push(() => clearInterval(tick));
  function begin() { st = {}; cards.forEach((c, i) => { c.disabled = false; c.classList.remove('matched', 'nope'); hide(i); }); t0 = performance.now(); clock(); lockStart(true); }
  const a = (await api('GET', '/arcade/active?game=memory')).round; if (my !== nav) return;
  if (a) { begin(); a.matched.forEach(({ i, sym }) => { face(i, sym); cards[i].classList.add('matched'); cards[i].disabled = true; }); $('#mv').textContent = a.moves; $('#res').textContent = 'Game restored (the server kept your time)'; }
  skillButtons(bet => act(async () => { const s0 = await api('POST', '/arcade/memory/start', { bet }); if (s0.bet) setBal(s0.balance); begin(); $('#mv').textContent = '0'; $('#res').textContent = ''; }));
  $('#mg').onclick = act(async e => {
    const c = e.target.closest('.mcard'); if (!c || !st || c.disabled || c.classList.contains('up')) return;
    const i = +c.dataset.i, r = await api('POST', '/arcade/memory/flip', { i }); if (!root.isConnected) return;
    face(i, r.sym); sfx.play('flip');
    if (r.pair) {
      $('#mv').textContent = r.moves;
      if (r.match) { r.pair.forEach(k => { cards[k].classList.add('matched'); cards[k].disabled = true; }); sfx.play('reveal'); fx.bump(cards[i]); }
      else { sfx.play('miss'); r.pair.forEach(k => cards[k].classList.add('nope')); await wait(calm ? 350 : 750); if (!root.isConnected) return; r.pair.forEach(k => { cards[k].classList.remove('nope'); hide(k); }); }
    }
    if (r.done) {
      st = null; clearInterval(tick); $('#tm').textContent = r.secs.toFixed(1) + 's'; lockStart(false);
      resMsg(true, `Score ${fmt(r.score)} · ${r.moves} tries in ${r.secs}s`); skillDone('memory', r, r.score >= 2000);
    }
  });
  loadHS('memory');
}

/* Trivia: Seahawk Trivia */
async function trivia(root) {
  let st = null, timer = 0;
  root.innerHTML = gameShell(`<div class="note" style="margin-top:0"><b>How to play:</b> 7 questions, 20 seconds each. 100 points for each right answer, plus a speed bonus of up to 50 (it drops 5 points per second).</div>
    ${skillBet('trivia')}<div class="stats"><div><small>Score</small><b id="sc">0</b></div><div><small>Question</small><b id="qn">–</b></div></div>${hsBox()}`,
    `<div class="tq"><div class="tboard"><h3 id="tqq">Ready for a pop quiz? 📝</h3></div><div class="tbar"><i id="tt"></i></div><div class="tans" id="ta"></div></div>`);
  stopFns.push(() => clearTimeout(timer));
  function show(q) {
    $('#qn').textContent = `${q.n} / ${q.total}`; $('#tqq').textContent = q.q; fx.bump($('#tqq'));
    $('#ta').innerHTML = q.a.map((a, k) => `<button class="tbtn" data-c="${k}"><span>${'ABCD'[k]}</span>${esc(a)}</button>`).join('');
    const bar = $('#tt'); bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth; bar.style.transition = `width ${q.secs}s linear`; bar.style.width = '0%';
    clearTimeout(timer); timer = setTimeout(() => { const b = root.querySelector('.tbtn:not(:disabled)'); if (b && st) { st.timeout = true; b.click(); } }, (q.secs + 0.4) * 1000);
  }
  skillButtons(bet => act(async () => { const r = await api('POST', '/arcade/trivia/start', { bet }); if (r.bet) setBal(r.balance); st = {}; lockStart(true); $('#sc').textContent = '0'; $('#res').textContent = ''; show(r.question); }));
  $('#ta').onclick = act(async e => {
    const b = e.target.closest('.tbtn'); if (!b || !st) return; clearTimeout(timer);
    const r = await api('POST', '/arcade/trivia/answer', { choice: +b.dataset.c }); if (!root.isConnected) return;
    const btns = [...root.querySelectorAll('.tbtn')]; btns.forEach(x => x.disabled = true); btns[r.answer].classList.add('right'); if (!r.right && !r.timeout) b.classList.add('wrong');
    const bar = $('#tt'); bar.style.width = getComputedStyle(bar).width; bar.style.transition = 'none'; st.timeout = false;
    if (r.right) { sfx.play('reveal'); fx.bump(btns[r.answer]); resMsg(true, `Correct! +${r.pts}`); } else { sfx.play('miss'); fx.lose(); resMsg(false, r.timeout ? 'Time’s up!' : 'Not quite!'); }
    countUp($('#sc'), r.score, 400);
    await wait(calm ? 400 : 1100); if (!root.isConnected) return;
    if (r.done) {
      st = null; $('#tqq').textContent = `Final score: ${fmt(r.score)} · ${r.correct}/${r.of} right`; $('#ta').innerHTML = ''; lockStart(false);
      resMsg(true, `${r.correct}/${r.of} right · ${fmt(r.score)} pts`); skillDone('trivia', r, r.correct >= 6);
    } else show(r.next);
  });
  loadHS('trivia');
}

/* Crash: Seahawk Launch. The browser animates the climb; the server's clock decides cash-outs and crashes. */
const rocketImg = Object.assign(new Image(), { src: 'rocket.svg' });
async function rocket(root, my) {
  let fl = null, raf = 0, parts = [], boom = [], lastEmit = 0;
  const hist = [];
  root.innerHTML = gameShell(`${betBox()}
    <label>Auto cash-out (optional)</label><input id="auto" type="number" min="1.01" step="0.01" placeholder="e.g. 2.00">
    <div style="height:14px"></div><button class="btn bjbig" id="launch">🚀 Launch <kbd>Space</kbd></button>
    <button class="btn gold bjbig cashbig hidden" id="cash" disabled>💰 CASH OUT <kbd>Space</kbd></button>
    <div class="note"><b>Space launches. Once it's flying, Space cashes out.</b> The multiplier climbs as the Seahawk rocket rises, so cash out before it blows. Payback is 99%: about half of all flights pass 2x, 1 in 10 pass 10x, and 1 in 100 blows up right at 1.00x.</div>`,
    `<div class="rk" id="rk"><canvas id="rkc"></canvas><div class="rkm" id="rkm">1.00x</div><div class="rkst" id="rkst">Ready for launch</div></div><div class="rkhist" id="rkh"></div>`);
  const cv = $('#rkc'), ctx = cv.getContext('2d'), W = 800, H = 450, stars = Array.from({ length: 90 }, () => [Math.random() * W, Math.random() * H, Math.random() * 1.8 + .3]);
  const d = devicePixelRatio || 1; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0);
  const mAt = (f, t) => Math.floor(Math.exp(f.rate * Math.max(0, t - f.t0)) * 100) / 100;
  const geo = (t, rate) => { // screen position for flight time t (ms): the camera zooms out as the multiplier grows
    const m = Math.exp(rate * Math.max(0, t)), span = Math.max(8000, t * 1.12), top = Math.max(2, m * 1.3);
    return { m, x: 70 + (Math.max(0, t) / span) * (W - 190), y: H - 70 - (Math.log(m) / Math.log(top)) * (H - 190), span, top };
  };
  function draw(now) {
    const t = fl ? now - fl.t0 : -1, over = fl && fl.over, m = fl ? Math.exp(fl.rate * Math.max(0, over ? fl.crashT : t)) : 1;
    ctx.save(); ctx.clearRect(0, 0, W, H);
    const shake = fl && !over && t > 0 ? Math.min(5, Math.log(m + 1) * 1.6) : (over && now - fl.endAt < 500 ? 9 * (1 - (now - fl.endAt) / 500) : 0);
    if (shake) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
    const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#0a0526'); sky.addColorStop(1, '#16316b'); ctx.fillStyle = sky; ctx.fillRect(-10, -10, W + 20, H + 20);
    const drift = fl && t > 0 ? t * 0.02 : now * 0.004;
    for (const [x, y, r] of stars) { ctx.fillStyle = `rgba(255,255,255,${.35 + r * .2})`; ctx.beginPath(); ctx.arc(x, (y + drift * r) % H, r, 0, 7); ctx.fill(); }
    const glow = ctx.createRadialGradient(70, H, 10, 70, H, 320); glow.addColorStop(0, '#12c26a55'); glow.addColorStop(1, '#12c26a00'); ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#0c1a2e'; ctx.fillRect(0, H - 34, W, 34); ctx.fillStyle = '#12c26a'; ctx.fillRect(0, H - 36, W, 3);
    let rx = 70, ry = H - 70, ang = 0, flying = false;
    if (fl && t > 0) { // trail + rocket along the curve
      const tt = over ? fl.crashT : t, g = geo(tt, fl.rate), before = geo(Math.max(0, tt - 60), fl.rate);
      const grad = ctx.createLinearGradient(70, H, g.x, g.y); grad.addColorStop(0, '#12c26a00'); grad.addColorStop(.6, '#19e58a'); grad.addColorStop(1, over ? '#ff4d5e' : '#ffe08a');
      ctx.strokeStyle = grad; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowColor = '#19e58a'; ctx.shadowBlur = 14; ctx.beginPath();
      for (let s = 0; s <= tt; s += Math.max(16, tt / 140)) { const q = { x: 70 + (s / g.span) * (W - 190), y: H - 70 - (Math.log(Math.exp(fl.rate * s)) / Math.log(g.top)) * (H - 190) }; s ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }
      ctx.lineTo(g.x, g.y); ctx.stroke(); ctx.shadowBlur = 0;
      rx = g.x; ry = g.y; ang = Math.atan2(g.y - before.y, g.x - before.x) + Math.PI / 2; flying = !over;
    }
    if (flying && now - lastEmit > 26) { lastEmit = now; for (let i = 0; i < 2; i++) parts.push({ x: rx + Math.sin(ang) * -58 + (Math.random() - .5) * 10, y: ry + Math.cos(ang) * 58 + (Math.random() - .5) * 10, vx: Math.sin(ang) * -1.2 + (Math.random() - .5) * 1.4, vy: Math.cos(ang) * 1.2 + (Math.random() - .5), r: 5 + Math.random() * 6, life: 1 }); }
    parts = parts.filter(p => p.life > 0);
    for (const p of parts) { p.x += p.vx; p.y += p.vy; p.r += .35; p.life -= .022; ctx.fillStyle = `rgba(255,${Math.round(150 + p.life * 90)},${Math.round(60 + p.life * 40)},${p.life * .35})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
    if (!over) {
      ctx.save(); ctx.translate(rx, ry); ctx.rotate(ang);
      const ih = 124, iw = ih * (80 / 150), launched = fl && t > 0, fl2 = launched ? 1 : (fl ? Math.max(0, 1 + t / 700) * .5 : 0);
      if (fl2) { const fh = (46 + Math.sin(now * .06) * 10 + Math.random() * 8) * (launched ? 1 : .6), g = ctx.createLinearGradient(0, ih / 2 - 6, 0, ih / 2 + fh); g.addColorStop(0, '#fff'); g.addColorStop(.25, '#ffe08a'); g.addColorStop(.6, '#ff9f1a'); g.addColorStop(1, '#ff4d5e00'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-iw * .26, ih / 2 - 4); ctx.quadraticCurveTo(0, ih / 2 + fh * 1.3, iw * .26, ih / 2 - 4); ctx.fill(); }
      if (rocketImg.complete) ctx.drawImage(rocketImg, -iw / 2, -ih / 2, iw, ih);
      ctx.restore();
    }
    if (over) { // explosion
      const e = (now - fl.endAt) / 1000; if (!boom.length && e < 0.05) for (let i = 0; i < 70; i++) { const a = Math.random() * 7, v = 1 + Math.random() * 6; boom.push({ x: rx, y: ry, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 3 + Math.random() * 6, life: 1, c: ['#fff', '#ffe08a', '#ff9f1a', '#ff4d5e', '#12c26a'][i % 5] }); }
      boom = boom.filter(b => b.life > 0); for (const b of boom) { b.x += b.vx; b.y += b.vy; b.vy += .06; b.life -= .016; ctx.globalAlpha = Math.max(0, b.life); ctx.fillStyle = b.c; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * b.life + 1, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1; if (e < .35) { ctx.fillStyle = `rgba(255,240,200,${.7 * (1 - e / .35)})`; ctx.beginPath(); ctx.arc(rx, ry, 30 + e * 260, 0, 7); ctx.fill(); }
    }
    ctx.restore();
    if (fl && !over) {
      const mm = mAt(fl, now); $('#rkm').textContent = mm.toFixed(2) + 'x'; $('#rkm').className = 'rkm ' + (fl.cashed ? 'cashed' : '');
      if (t < 0) $('#rkst').textContent = `Liftoff in ${Math.max(0.1, Math.ceil(-t / 100) / 10).toFixed(1)}s…`; else if (!fl.cashed) { $('#rkst').textContent = 'Climbing… press Space to cash out!'; $('#rkst').className = 'rkst'; }
      const cash = $('#cash'); if (cash && !fl.cashed) { cash.disabled = t < 150; cash.innerHTML = `💰 CASH OUT ${fmt(fl.bet * mm)} 🪙 <kbd>Space</kbd>`; }
    }
  }
  function frame(now) {
    raf = 0; if (!root.isConnected) return; draw(now);
    if ((fl && !fl.over) || parts.length || boom.length || (fl && fl.over && now - fl.endAt < 1400)) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const status = (t, cls = '') => { const el = $('#rkst'); el.textContent = t; el.className = 'rkst ' + cls; };
  const paintHist = () => { $('#rkh').innerHTML = hist.slice(0, 12).map(c => `<span class="${c >= 10 ? 'gold' : c >= 2 ? 'good' : 'bad'}">${c.toFixed(2)}x</span>`).join(''); };
  const buttons = () => { const flying = fl && !fl.over; $('#launch').classList.toggle('hidden', !!flying); $('#cash').classList.toggle('hidden', !(flying && !fl.cashed)); };
  function cashed(e) {
    if (!fl || fl.cashed) return; fl.cashed = e.mult; setBal(e.balance); buttons(); sfx.play('cash');
    status(`${e.auto ? 'Auto-' : ''}Cashed out at ${e.mult.toFixed(2)}x – watch where it would have crashed`, 'good');
    resMsg(e.payout >= fl.bet, `${e.auto ? 'Auto ' : ''}Cashed out at ${e.mult.toFixed(2)}x · ${e.payout >= fl.bet ? '+' : '−'}${fmt(Math.abs(e.payout - fl.bet))} 🪙`);
    if (e.payout > fl.bet) fx.win(e.mult >= 5);
  }
  function crashed(e) {
    if (!fl || fl.over) return; fl.over = true; fl.crashT = Math.log(e.crash) / fl.rate; fl.endAt = performance.now(); boom = [];
    $('#rkm').textContent = `${e.crash.toFixed(2)}x`; $('#rkm').className = 'rkm boom';
    if (e.balance != null) setBal(e.balance);
    if (!fl.cashed) { status(`💥 Blew up at ${e.crash.toFixed(2)}x`, 'bad'); resMsg(false, `Crashed at ${e.crash.toFixed(2)}x · −${fmt(fl.bet)} 🪙`); fx.lose(); }
    else status(`Cashed at ${fl.cashed.toFixed(2)}x · it blew up at ${e.crash.toFixed(2)}x`, 'good');
    hist.unshift(e.crash); paintHist(); buttons(); kick();
  }
  async function watch(id) {
    try {
      let e = await api('POST', '/arcade/rocket/watch', { id });
      if (!root.isConnected || !fl || fl.id !== id) return e.balance != null && setBal(e.balance);
      if (e.event === 'cashed') { cashed(e); e = await api('POST', '/arcade/rocket/watch', { id }); if (!root.isConnected || !fl || fl.id !== id) return; }
      crashed(e);
    } catch (er) { toast(er.message); }
  }
  function fly(f) { fl = { ...f, cashed: 0, over: false, launchedAt: performance.now() }; parts = []; boom = []; $('#res').textContent = ''; buttons(); kick(); watch(f.id); }
  stopFns.push(() => { cancelAnimationFrame(raf); fl = null; });
  $('#launch').onclick = act(async () => {
    const a = $('#auto').value, r = await api('POST', '/arcade/rocket/start', { bet: readBet(), auto: a ? +a : null });
    setBal(r.balance); sfx.play('start'); fly({ id: r.id, bet: r.bet, rate: r.rate, t0: performance.now() + r.liftoff });
  });
  $('#cash').onclick = act(async () => {
    if (!fl || fl.cashed || fl.over || performance.now() - fl.launchedAt < 700 || performance.now() < fl.t0 + 150) return; // a double-tap on launch must not instantly cash out
    const e = await api('POST', '/arcade/rocket/cashout'); e.event === 'cashed' ? cashed(e) : crashed(e);
  });
  const [a, h] = await Promise.all([api('GET', '/arcade/active?game=rocket'), api('GET', '/arcade/rocket/history')]); if (my !== nav) return;
  hist.push(...h.crashes); paintHist(); draw(performance.now());
  if (a.round) { fly({ id: a.round.id, bet: a.round.bet, rate: a.round.rate, t0: performance.now() - a.round.flying }); $('#res').textContent = 'Flight restored'; }
  rocketImg.onload = () => draw(performance.now());
}

/* ---------- Luck Lab ---------- */
async function renderLuck() {
  const cur = String(luckLevel()), reg = LUCK.filter(x => String(x[0])[0] !== 'x'), sup = LUCK.filter(x => String(x[0])[0] === 'x');
  const card = ([lv, e, name, desc]) => `<button class="luckcard ${String(lv)[0] === 'x' ? 'super' : ''} ${String(lv) === cur ? 'on' : ''}" data-luck="${lv}" aria-pressed="${String(lv) === cur}"><span class="le">${e}</span><b>${lv === 'normal' ? 'Normal' : String(lv)[0] === 'x' ? name : `${lv} · ${name}`}</b><small>${desc}</small><i class="lm">${lv === 'normal' ? 'Standard odds' : String(lv)[0] === 'x' ? `Lose chance ÷${String(lv).slice(1)}` : `Win chance ×${(0.5 + lv * 0.1).toFixed(1)}`}</i></button>`;
  $('#app').innerHTML = `<h1>🍀 Luck Lab</h1>
    <div class="panel luckinfo"><b>Luck really changes your odds</b> in 5 arcade games: 🪙 Heads or Tails, ✊ Hallway RPS, 🚌 Seahawk Crossing, 🎲 Scoreboard Roll and 🏈 Hail Mary.
      <br><br><b>Levels 1–10:</b> higher luck = you <b>win more often</b>, but each win pays less. Lower luck = fewer wins, bigger payouts. The <b>average payback stays the same</b> at every level. Level 1 ×0.6 … level 5 ×1.0 … level 10 ×1.5 win chance. Example: Heads or Tails is 50/50 on Normal, 75% at level 10 (pays 1.32x a call), 30% at level 1 (pays 3.30x).
      <br><br>Your luck is locked in when a round starts. It doesn't touch Hawk Drop, Locker Hunt, Slots, Roulette, Hawk 21, Seahawk Launch, skill games or sports picks. It also changes your confetti and win sounds. Hawk Bucks are pretend: no real money, ever.</div>
    <div class="luckgrid">${reg.map(card).join('')}</div>
    <div class="superhead"><h2>🔥 Super Luck</h2><p>Your chance to <b>lose</b> is divided by 2, 5 or 10 and payouts stay at <b>normal</b> prices, so you win a lot more money. Heads or Tails at <b>×2</b> wins 75% of calls, <b>×5</b> wins 90%, <b>×10</b> wins 95% (Hail Mary gives you the best of 2, 5 or 10 throws).</p>
      <p class="supnote">⚠️ Because this is so strong, <b>anything you win or lose while Super Luck is on does not count toward your Leaderboard net winnings.</b> You can still use the Hawk Bucks. Switch back to Normal or a level to climb the ranks.</p></div>
    <div class="luckgrid supergrid">${sup.map(card).join('')}</div>
    <div class="panel lucktest"><button class="btn" id="preview">✨ Preview a win</button><div class="note">Saved to your account, so it follows you to any device.</div></div>`;
  document.querySelectorAll('[data-luck]').forEach(b => b.onclick = act(async () => {
    const raw = b.dataset.luck, v = raw === 'normal' || raw[0] === 'x' ? raw : +raw, r = await api('POST', '/luck', { luck: v });
    U.luck = r.luck; CFG = null; renderLuck(); fx.burst(String(raw)[0] === 'x' ? 220 : 110); sfx.play('big'); toast(`${luckEntry()[2]} is on`);
  }));
  $('#preview').onclick = () => { fx.burst(160); sfx.play('big'); };
}

go();
})();
