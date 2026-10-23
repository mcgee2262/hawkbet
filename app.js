/* HawkBet client. Fake credits only. Every balance change and outcome comes from the server (server.js);
   this file only draws the UI and animates results the server already decided. */
(() => {
const $ = (s, el = document) => el.querySelector(s);
const fmt = n => Math.round(n).toLocaleString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- api + session ---------- */
let MODE = 'full', SCHOOLR = { each: 50, cap: 1000 };
const SCHOOL = () => MODE === 'school';
let U = null, INVITE = false, PROPS = [], CFG = null, pending = 0; // pending = payout still being animated, hidden from the balance until it lands
async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify(body || {}) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !/login|register|\/me/.test(path)) { U = null; renderAuth(); }
  if (!r.ok) throw new Error(j.error || 'Something went wrong');
  if (method === 'POST' && path.startsWith('/arcade/')) {
    if (typeof j.payout === 'number' || j.done) queueProgress();
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
  function noise(t = 0, d = 0.15, g = 0.1, f = 2000, type = 'bandpass', f2) { // filtered white noise: swishes, thuds, cheers
    const n = Math.floor(ac.sampleRate * d), buf = ac.createBuffer(1, n, ac.sampleRate), ch = buf.getChannelData(0); for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(), fl = ac.createBiquadFilter(), a = ac.createGain(), st = ac.currentTime + t; src.buffer = buf; fl.type = type; fl.frequency.setValueAtTime(f, st); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, st + d);
    a.gain.setValueAtTime(0.0001, st); a.gain.exponentialRampToValueAtTime(g, st + Math.min(0.03, d / 3)); a.gain.exponentialRampToValueAtTime(0.0001, st + d); src.connect(fl); fl.connect(a); a.connect(out); src.start(st);
  }
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
    pad0: () => { tone(150, 0, 0.3, 'sine', 0.22, 80); noise(0, 0.1, 0.16, 1800, 'bandpass'); },
    pad1: () => { tone(190, 0, 0.28, 'sine', 0.22, 105); noise(0, 0.1, 0.16, 2200, 'bandpass'); },
    pad2: () => { tone(240, 0, 0.26, 'sine', 0.22, 135); noise(0, 0.1, 0.16, 2600, 'bandpass'); },
    pad3: () => { tone(300, 0, 0.24, 'sine', 0.22, 170); noise(0, 0.12, 0.2, 3200, 'bandpass'); },
    green: () => { notes([1047, 1319, 1760], 0.05, 0.2, 'triangle', 0.07); tone(2093, 0.15, 0.4, 'sine', 0.04); },
    swish: () => { noise(0, 0.38, 0.16, 3200, 'bandpass', 900); tone(1568, 0.12, 0.22, 'sine', 0.035); },
    brick: () => { tone(160, 0, 0.2, 'square', 0.09, 70); noise(0, 0.14, 0.14, 700, 'lowpass'); },
    rim: () => { tone(980, 0, 0.14, 'triangle', 0.08, 520); tone(1470, 0, 0.08, 'sine', 0.03); },
    cheer: () => { noise(0, 0.9, 0.09, 1100, 'bandpass', 2400); noise(0.05, 0.8, 0.05, 3000, 'highpass'); },
    roar: () => { noise(0, 1.3, 0.13, 900, 'bandpass', 2600); noise(0.1, 1.2, 0.07, 2800, 'highpass'); notes([523, 659, 784, 1047], 0.07, 0.2, 'triangle', 0.05); },
    tick: () => tone(1100, 0, 0.04, 'square', 0.03),
    whoosh: () => noise(0, 0.28, 0.1, 500, 'bandpass', 2600),
    near: () => { tone(620, 0, 0.12, 'triangle', 0.06, 1500); noise(0, 0.12, 0.06, 2500, 'highpass'); },
    crash: () => { noise(0, 0.45, 0.22, 450, 'lowpass', 120); tone(120, 0, 0.4, 'sawtooth', 0.13, 38); },
    clear: () => { notes([523, 659, 784], 0.06, 0.14, 'triangle', 0.06); noise(0.1, 0.5, 0.05, 1500, 'bandpass', 2600); },
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
    if (parts.length > 420) parts.splice(0, parts.length - 420);
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
const propById = id => PROPS.find(p => String(p.id) === String(id));
const pick = {}; let mode = 'power', entry = 25, slipOpen = false;

/* ---------- router ---------- */
let view = 'home', boardTab = 'picks', GAME = null, stat = 'All', lineTab = 'open', game = 'plinko', nav = 0;
async function go() {
  const my = ++nav; stopGames();
  try { const m = await api('GET', '/me'); U = m.user; INVITE = m.inviteRequired; if (m.schoolReward) SCHOOLR = m.schoolReward; setMode(m.mode); } catch (e) {} if (my !== nav) return;
  if (U && SCHOOL() && ['board', 'lineups', 'luck'].includes(location.hash.slice(1))) { location.hash = '#home'; return; }
  document.body.classList.toggle('out', !U);
  $('#logout').classList.toggle('hidden', !U); $('#adminLink').classList.toggle('hidden', !(U && U.isAdmin)); if (U && U.isAdmin) $('#adminLink a span').textContent = U.pending ? `Admin · ${U.pending} to grade` : 'Admin'; $('#lvlchip').classList.toggle('hidden', !U);
  if (!U) return renderAuth();
  $('#logout').textContent = `${U.username} · Log out`; showBal(); paintMe(); $('#lucklink').classList.toggle('hidden', !U.isAdmin);
  view = location.hash.slice(1) || 'home';
  document.querySelectorAll('[data-v]').forEach(a => a.classList.toggle('on', a.dataset.v === view));
  document.querySelectorAll('#origlist a').forEach(a => a.classList.toggle('on', view === 'arcade' && a.dataset.og === game));
  if (view !== 'arcade') document.documentElement.style.removeProperty('--ga');
  if (SCHOOL() && !SKILL_IDS.has(game)) game = 'hoops';
  paintLevel(); document.body.classList.remove('drawer');
  const R = { rewards: renderRewards, home: renderHome, board: renderBoard, arcade: renderArcade, lineups: renderLineups, leaders: renderLeaders, admin: renderAdmin, bank: renderBank, luck: renderLuck, shop: renderShop };
  try { await (R[view] || renderHome)(my); const ap = $('#app'); ap.classList.remove('pagein'); void ap.offsetWidth; ap.classList.add('pagein'); } catch (e) { if (my === nav) $('#app').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  renderSlipBar();
}
window.addEventListener('hashchange', go);
const paintSound = () => { const b = $('#sound'); b.textContent = sfx.on ? '🔊' : '🔇'; b.setAttribute('aria-pressed', String(sfx.on)); b.setAttribute('aria-label', sfx.on ? 'Sound on' : 'Sound off'); };
$('#sound').onclick = () => { sfx.toggle(); paintSound(); toast(sfx.on ? '🔊 Sound on' : '🔇 Sound off'); }; paintSound();
$('#logout').onclick = async () => { await api('POST', '/logout').catch(() => {}); U = null; $('#meav').classList.add('hidden'); CFG = null; Object.keys(pick).forEach(k => delete pick[k]); slipOpen = false; $('#slip').classList.add('hidden'); location.hash = ''; go(); };

/* ---------- auth ---------- */
function renderAuth(signup = false) {
  $('#slipbar').classList.add('hidden'); $('#slip').classList.add('hidden'); document.body.classList.add('out'); $('#logout').classList.add('hidden'); $('#adminLink').classList.add('hidden'); $('#lvlchip').classList.add('hidden');
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
async function loadProps() { const r = await api('GET', '/props'); PROPS = r.props; GAME = r.game; }
const fmtStat = v => typeof v === 'number' ? String(v) : String(v);
const arrow = t => t === 'up' ? ' ⬆️' : t === 'down' ? ' ⬇️' : '';
const banner = () => `<div class="matchup"><span>🦅 South Lakes <i>vs</i> ${esc(GAME.opp)}</span><b>${esc(GAME.when)}${GAME.home === true ? ' · Home' : GAME.home === false ? ' · Away' : ''}</b></div>
  ${GAME.pendingResults ? '<div class="note pendnote">🔒 Game started: picks are locked. Scores usually post 1–2 days after the game, then lineups are graded.</div>' : ''}`;
async function renderBoard(my, keep) {
  await loadProps(); if (my !== nav) return;
  const live = PROPS.filter(p => p.status === 'open' || p.status === 'locked');
  const types = ['All', ...new Set(live.map(p => p.type))];
  if (!types.includes(stat)) stat = 'All';
  const list = live.filter(p => stat === 'All' || p.type === stat);
  if (!keep || !$('#picksArea')) $('#app').innerHTML = '<div id="picksArea"></div>';
  let body;
  if (boardTab === 'players') {
    const { players } = await api('GET', '/players'); if (my !== nav) return;
    body = `<div class="grid pgrid">${players.map(profile).join('')}</div>`;
  } else body = `<div class="pills">${types.map(t => `<button class="pill ${t === stat ? 'on' : ''}" data-stat="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div class="grid">${list.map(card).join('') || '<div class="empty">No lines right now. Check back before game day.</div>'}</div>`;
  $('#picksArea').innerHTML = `<h1>Seahawk Picks <small class="fb">🏈 Football</small></h1>${banner()}
    <div class="sub"><button class="pill ${boardTab === 'picks' ? 'on' : ''}" data-bt="picks">Tonight’s props</button><button class="pill ${boardTab === 'players' ? 'on' : ''}" data-bt="players">Player profiles</button></div>${body}`;
}
function profile(p) {
  const rows = Object.entries(p.stats);
  return `<div class="card pcard"><div class="pnum">#${p.number == null ? '–' : p.number}</div><div class="who">${esc(p.name)}</div><div class="vs">${esc(p.positions)}</div>
    <table class="pstats">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(fmtStat(v))}</b></td></tr>`).join('') || '<tr><td colspan="2">No stats yet</td></tr>'}</table></div>`;
}
function card(p) {
  const c = pick[p.id], lock = p.status !== 'open', team = p.playerId == null;
  return `<div class="card ${c ? 'sel' : ''} ${lock ? 'locked' : ''}"><span class="lvl">${lock ? '🔒 Locked' : esc(p.type)}</span>
    ${team ? `<div class="logo">${esc(p.init)}</div>` : `<div class="logo numb">#${p.number == null ? '' : p.number}</div>`}<div class="who">${esc(p.who)}</div><div class="vs">${esc(p.vs)}</div>
    <div class="num">${p.line}</div><div class="stat">${esc(p.stat)}</div>
    ${p.proj != null ? `<div class="proj"><span>HawkBet projection <b>${p.proj}${arrow(p.trend)}</b></span>${p.avg != null ? `<span>Season avg <b>${p.avg}</b></span>` : ''}</div>` : ''}
    <div class="mm"><button class="${c === 'less' ? 'on' : ''}" ${lock ? 'disabled' : ''} data-pick="${p.id}" data-d="less">▼ Less</button><button class="${c === 'more' ? 'on' : ''}" ${lock ? 'disabled' : ''} data-pick="${p.id}" data-d="more">▲ More</button></div></div>`;
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-bt],[data-stat],[data-pick]'); if (!t) return;
  if (t.dataset.bt) { boardTab = t.dataset.bt; renderBoard(nav, true); }
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
let lbTab = 'net';
let lbGame = 'hoops';
async function renderLeaders(my) {
  if (SCHOOL()) {
    const ids = [...SKILL_IDS], t = await api('GET', '/arcade/highscores?game=' + lbGame); if (my !== nav) return;
    $('#app').innerHTML = `<h1>Top Scores</h1><div class="sub">${ids.map(id => `<button class="pill ${id === lbGame ? 'on' : ''}" data-lbg="${id}">${esc(gameLabel(id))}</button>`).join('')}</div>
      <div class="panel"><table class="lb"><tr><th>#</th><th>Player</th><th>Best score</th></tr>${t.top.map((x, i) => `<tr class="${x.username === U.username ? 'me' : ''}"><td>${i + 1}</td><td>${esc(x.username)}</td><td><b>${fmt(x.best)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="mutecell">No scores yet. Be the first!</td></tr>'}</table></div>`;
    document.querySelectorAll('[data-lbg]').forEach(b => b.onclick = () => { lbGame = b.dataset.lbg; renderLeaders(nav); }); return;
  }
  const tabs = `<div class="sub"><button class="pill ${lbTab === 'net' ? 'on' : ''}" data-lbt="net">💰 Net winnings</button><button class="pill ${lbTab === 'week' ? 'on' : ''}" data-lbt="week">⚡ Best win this week</button></div>`;
  if (lbTab === 'week') {
    const t = await api('GET', '/tournament'); if (my !== nav) return;
    $('#app').innerHTML = `<h1>Leaderboard</h1>${tabs}<div class="panel"><table class="lb"><tr><th>#</th><th>Player</th><th>Game</th><th>Multiplier</th></tr>
      ${t.top.map((x, i) => `<tr class="${x.username === U.username ? 'me' : ''}"><td>${i + 1}</td><td>${esc(x.username)}</td><td class="mutecell">${esc(gameLabel(x.game))}</td><td><span class="win">${x.mult.toFixed(2)}x</span> · +${fmt(x.payout - x.bet)} 🪙</td></tr>`).join('') || '<tr><td colspan="4" class="mutecell gempty">No big wins yet this week. Be the first!</td></tr>'}</table>
      <div class="note">Your best this week: <b>${t.mine ? t.mine.toFixed(2) + 'x' : '–'}</b>. Resets every Monday. Skill games and Super Luck rounds don't count.</div></div>`;
  } else {
    const r = await api('GET', '/leaderboard'); if (my !== nav) return;
    const inTop = r.top.some(x => x.username === r.me.username);
    const net = n => `<span class="${n > 0 ? 'win' : n < 0 ? 'lose' : ''}">${n > 0 ? '+' : ''}${fmt(n)}</span>`;
    const row = (x, rank) => `<tr class="${x.username === r.me.username ? 'me' : ''}"><td>${rank}</td><td class="lbname">${avatar(x.gear, 30)}${esc(x.username)}</td><td class="mutecell">${fmt(x.balance)}</td><td>${net(x.net)} 🪙</td></tr>`;
    $('#app').innerHTML = `<h1>Leaderboard</h1>${tabs}<div class="panel"><table class="lb"><tr><th>#</th><th>Player</th><th>Balance</th><th>Net winnings</th></tr>
      ${r.top.map((x, i) => row(x, i + 1)).join('')}${inTop ? '' : row(r.me, r.me.rank)}</table>
      <div class="note">Ranked by net winnings: balance minus the starting 1,000 and anything added at the Bank, by the admin or from rewards. Super Luck rounds don't count. Shop spending doesn't lower your rank.</div></div>`;
  }
  document.querySelectorAll('[data-lbt]').forEach(b => b.onclick = () => { lbTab = b.dataset.lbt; renderLeaders(nav); });
}

/* ---------- admin ---------- */
async function renderLines(my) {
  const [pr, pl] = await Promise.all([api('GET', '/admin/props'), api('GET', '/admin/players')]); if (my !== nav) return;
  const props = pr.props, players = pl.players, g = pl.game;
  $('#app').innerHTML = `<div class="panel adm"><h2>Tonight’s game</h2><form id="gf" class="addf"><input name="opp" value="${esc(g.opp)}" placeholder="Opponent"><input name="when" value="${esc(g.when)}" placeholder="Tonight · 7:00 PM">
      <input name="kickoff" type="datetime-local" value="${g.kickoff ? new Date(g.kickoff - new Date(g.kickoff).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}" title="Kickoff: picks lock by themselves then"><input name="gp" type="number" min="0" max="40" value="${g.gp}" title="Games played so far" style="max-width:90px">
      <select name="home"><option value="" ${g.home === null ? 'selected' : ''}>Home/away not set</option><option value="true" ${g.home === true ? 'selected' : ''}>Home</option><option value="false" ${g.home === false ? 'selected' : ''}>Away</option></select>
      <button class="btn" type="submit">Save game</button></form><div class="note">Kickoff locks every open line by itself. Games played is used when season stats are updated after grading (it adds 1 each game).</div></div>
    ${g.ungraded ? `<div class="panel adm gradebox" style="margin-top:14px"><h2>Grade from box score ${g.pendingResults ? '<span class="st locked">game started</span>' : ''}</h2>
      <div class="note" style="margin-top:0">Open the box score on MaxPreps yourself, select the stats tables, copy, and paste here. The site fills what it can find; check every number before grading.</div>
      <textarea id="boxtxt" rows="7" placeholder="Paste the box score text here"></textarea>
      <div class="addf"><input id="boxsl" type="number" min="0" placeholder="South Lakes score"><input id="boxop" type="number" min="0" placeholder="${esc(g.opp)} score"><button class="btn" id="boxread">Read it</button></div><div id="boxres"></div></div>` : ''}
    <div class="panel adm" style="margin-top:14px"><h2>Players</h2>${players.map(p => `<div class="row"><div class="g"><b>#${p.number == null ? '–' : p.number} ${esc(p.name)}</b> <small style="color:var(--mut)">${esc(p.positions)}${p.hidden ? ' · HIDDEN' : ''}</small></div>
      <button class="pill" data-pe="${p.id}">Edit</button><button class="pill" data-ph="${p.id}" data-h="${p.hidden ? 0 : 1}">${p.hidden ? 'Show' : 'Hide'}</button></div>`).join('')}
    <form id="plf" class="addf" style="margin-top:10px"><input type="hidden" name="id"><input name="name" placeholder="Name" required><input name="number" type="number" min="0" max="99" placeholder="#"><input name="positions" placeholder="QB, CB">
      <textarea name="stats" rows="4" placeholder="One per line, like:&#10;Rushing yds/game: 46.3"></textarea><button class="btn" type="submit">Save player</button></form>
    <div class="note">Hiding a player removes them and all their props from the site. Nothing is deleted; Show brings them back.</div></div>
    <div class="panel adm" style="margin-top:14px"><h2>Add a line</h2><form id="pf" class="addf">
      <select name="playerId"><option value="">Team line (no player)</option>${players.map(p => `<option value="${p.id}">#${p.number == null ? '–' : p.number} ${esc(p.name)}</option>`).join('')}</select>
      <input name="who" placeholder="Team name (if no player)"><input name="stat" placeholder="Stat (Rushing yards)" required><input name="type" placeholder="Filter (Rushing)"><input name="line" type="number" step="0.5" placeholder="Line (45.5)" required>
      <input name="proj" type="number" step="any" placeholder="Projection"><input name="avg" type="number" step="any" placeholder="Season avg"><select name="trend"><option value="">No arrow</option><option value="up">⬆️ Up</option><option value="down">⬇️ Down</option></select>
      <button class="btn" type="submit">Add line</button></form></div>
    <div class="panel adm" style="margin-top:14px"><h2>Lines</h2>${props.map(p => `<div class="row"><div class="g"><b>${esc(p.who)}</b> · ${esc(p.stat)} <b>${p.line}</b>${p.hidden ? ' <small style="color:var(--mut)">(old/hidden)</small>' : ''}<br><small style="color:var(--mut)">${esc(p.vs)}</small></div>
      <span class="st ${p.status}">${p.status}${p.status === 'graded' ? ' · ' + p.actual : ''}</span>
      ${p.status === 'open' ? `<button class="pill" data-ad="lock" data-id="${p.id}">Lock</button>` : ''}
      ${p.status === 'open' || p.status === 'locked' ? `<input type="number" step="any" placeholder="Result" id="r${p.id}"><button class="pill" data-ad="grade" data-id="${p.id}">Grade</button><button class="pill" data-ad="void" data-id="${p.id}">Void</button>` : ''}</div>`).join('')}
    <div class="note">After the game, type each real stat in Result and press Grade. That settles every slip and pays winners. Void refunds picks on a cancelled line. For "wins by 7+" enter 1 for yes, 0 for no.</div></div>`;
  $('#gf').onsubmit = act(async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); await api('POST', '/admin/game', { opp: f.opp, when: f.when, home: f.home === '' ? null : f.home === 'true', kickoff: f.kickoff ? new Date(f.kickoff).getTime() : null, gp: Number(f.gp) }); toast('Game saved'); renderAdmin(nav); });
  if ($('#boxread')) $('#boxread').onclick = act(async () => {
    const r = await api('POST', '/admin/paste-parse', { text: $('#boxtxt').value, sl: $('#boxsl').value, opp: $('#boxop').value }); const miss = r.rows.filter(x => x.value == null).length;
    $('#boxres').innerHTML = `<div class="note">Scores read: South Lakes ${r.scores.sl ?? '?'} – ${esc(g.opp)} ${r.scores.opp ?? '?'}. ${miss ? `<b>${miss} line${miss === 1 ? '' : 's'} not found: type them in.</b>` : 'Everything found. Still check it.'} Blank lines are left open.</div>
      ${r.rows.map(x => `<div class="row"><div class="g"><b>${esc(x.who)}</b> · ${esc(x.stat)} <b>${x.line}</b>${x.note ? `<br><small style="color:var(--gold)">${esc(x.note)}</small>` : ''}</div><input type="number" step="any" data-gid="${x.propId}" value="${x.value ?? ''}" placeholder="Result"></div>`).join('')}
      <label class="note"><input type="checkbox" id="boxst" checked> Also update season stats on the player profiles (adds this game, once)</label><button class="btn" id="boxgo">Grade all</button>`;
    $('#boxgo').onclick = act(async () => {
      const grades = [...document.querySelectorAll('[data-gid]')].map(i => ({ propId: Number(i.dataset.gid), actual: i.value === '' ? null : Number(i.value) })), n = grades.filter(x => x.actual != null).length;
      if (!n || !confirm(`Grade ${n} line${n === 1 ? '' : 's'}? This pays out winners right away.`)) return;
      const d = await api('POST', '/admin/grade-all', { grades, updateStats: $('#boxst').checked }); toast(`Graded ${d.graded}${d.statsUpdated ? ' · season stats updated' : ''}`); const m = await api('GET', '/me'); U = m.user; renderAdmin(nav);
    });
  });
  $('#pf').onsubmit = act(async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.line = Number(f.line); f.playerId = f.playerId ? Number(f.playerId) : null; await api('POST', '/admin/props', f); toast('Line added'); renderAdmin(nav); });
  $('#plf').onsubmit = act(async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (!f.id) delete f.id; await api('POST', '/admin/player', f); toast('Player saved'); renderAdmin(nav); });
  document.querySelectorAll('[data-pe]').forEach(b => b.onclick = () => { const p = players.find(x => String(x.id) === b.dataset.pe), f = $('#plf'); f.id.value = p.id; f.name.value = p.name; f.number.value = p.number == null ? '' : p.number; f.positions.value = p.positions; f.stats.value = Object.entries(p.stats).map(([k, v]) => `${k}: ${v}`).join('\n'); f.scrollIntoView({ block: 'center' }); });
  document.querySelectorAll('[data-ph]').forEach(b => b.onclick = act(async () => { await api('POST', '/admin/player-hide', { id: Number(b.dataset.ph), hidden: b.dataset.h === '1' }); toast(b.dataset.h === '1' ? 'Player hidden' : 'Player shown'); renderAdmin(nav); }));
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
const GAME_COLOR = { plinko: '#ff4fd8', mines: '#3d8bff', cross: '#ffc542', flip: '#f5a623', dice: '#a855ff', limbo: '#19e58a', slots: '#ff4d5e', roulette: '#12c26a', rps: '#ff7a3c', bj: '#e0284a', rocket: '#ffb21a', bell: '#ffd24a', memory: '#9b5cff', trivia: '#16e0c0', hoops: '#ff8a3c', math: '#4f8bff', band: '#19e58a', dash: '#ffc542' };
const GAMES = [['plinko', '🔵 Seahawk Drop'], ['mines', '🔐 Locker Hunt'], ['cross', '🚌 Seahawk Crossing'], ['flip', '🪙 Heads or Tails'], ['dice', '🎲 Scoreboard Roll'], ['limbo', '🏈 Hail Mary'], ['slots', '🎰 Seahawk Slots'], ['roulette', '🎡 Lakes Roulette'], ['rps', '✊ Hallway RPS'], ['bj', '🃏 Hawk 21'], ['rocket', '🚀 Seahawk Launch'], ['bell', '🔔 Bell Rush'], ['memory', '🧠 Classroom Memory'], ['trivia', '❓ Seahawk Trivia'], ['hoops', '🏀 Free Throw Line'], ['math', '➕ Mental Math Sprint'], ['band', '🥁 Marching Band'], ['dash', '🏃 Hallway Dash']];
const GAME_FNS = { plinko, mines, cross, flip, dice, limbo, slots, roulette, rps, bj, rocket, bell, memory, trivia, hoops, math, band, dash }; // every game that can launch
const CATS = [['all', 'All'], ['featured', '⭐ Featured'], ['recent', '🕘 Recent'], ['classic', '🎰 Classic'], ['skill', '🧠 Skill']];
const SKILL_IDS = new Set(['bell', 'memory', 'trivia', 'hoops', 'math', 'band', 'dash']);
let arcCat = 'all';
const catsNow = () => SCHOOL() ? CATS.filter(([k]) => k !== 'classic') : CATS;
async function renderArcade(my) {
  CFG = { ...(await api('GET', '/arcade/config')), user: U.username }; U.luck = CFG.luckName; // luck can change between visits (boosters and charges run out)
  if (Date.now() - (renderArcade.at || 0) > 30000) { STATS = await api('GET', '/arcade/stats').catch(() => STATS); renderArcade.at = Date.now(); } if (my !== nav) return;
  const list = gameList(), byId = Object.fromEntries(list.map(g => [g.id, g]));
  const week = Math.floor((Date.now() / 864e5 + 4) / 7), featured = [...new Set([0, 1, 2].map(k => list[(week * 3 + k * 5) % list.length]))]; // rotates every Monday
  const shown = { all: list, featured, recent: STATS.recent.map(id => byId[id]).filter(Boolean), classic: list.filter(g => !SKILL_IDS.has(g.id)), skill: list.filter(g => SKILL_IDS.has(g.id)) }[arcCat] || list;
  const cur = byId[game] || list[0]; document.documentElement.style.setProperty('--ga', GAME_COLOR[cur.id] || '#3d6bff');
  $('#app').innerHTML = `<div class="archead"><h1>Seahawk Arcade</h1>${SCHOOL() ? `<span class="luckchip">🏫 Seahawk Arcade · skill games earn up to ${fmt(SCHOOLR.cap)} 🪙 a day</span>` : `<a class="luckchip" href="#shop">${luckBadge()}</a>`}</div>
    <div class="pills cats" role="group" aria-label="Filter games">${catsNow().map(([k, l]) => `<button class="pill ${k === arcCat ? 'on' : ''}" data-cat="${k}" aria-pressed="${k === arcCat}">${l}</button>`).join('')}</div>
    <div class="gstrip">${shown.map(g => `<button class="gtile ${g.id === game ? 'on' : ''}" data-g="${g.id}" aria-label="${esc(g.title)}"><span>${esc(g.emoji)}</span><b>${esc(g.title)}</b><small>${esc(bestText(g.id) ? '🏆 ' + bestText(g.id) : g.tag)}</small></button>`).join('') || '<div class="mutecell gempty">Nothing here yet – play a game first!</div>'}</div>
    <div class="gamehead"><span class="ge">${esc(cur.emoji)}</span><div class="gt"><h2>${esc(cur.title)}</h2><small>${esc(cur.desc)}</small></div><div class="pbbar" id="pb"></div></div>
    <div id="gm"></div>
    <div class="arcfoot">🎟️ Hawk Bucks are pretend: no money, no prizes, nothing to cash out.</div>`;
  document.querySelectorAll('[data-g]').forEach(b => b.onclick = async () => { const y = scrollY; game = b.dataset.g; await go(); scrollTo(0, y); }); // keep your place on the page when switching games
  document.querySelectorAll('[data-cat]').forEach(b => b.onclick = async () => { const y = scrollY; arcCat = b.dataset.cat; await go(); scrollTo(0, y); });
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
  dice: { Space: ['#roll'], u: ['#ouflip'], a: ['#auto'], hint: 'Space roll · U over/under · A auto-roll · ←/→ nudge target' },
  limbo: { Space: ['#throw'], hint: 'Space throw' },
  slots: { Space: ['#spin'], a: ['#auto'], hint: 'Space pulls the lever · A auto-spin ×10 · or drag the lever down' },
  roulette: { Space: ['#spin'], x: ['#clr'], hint: 'Space spin · X clear chips' },
  rps: { Space: ['#start', 'last:[data-t]'], r: ['[data-t="rock"]'], p: ['[data-t="paper"]'], s: ['[data-t="scissors"]'], c: ['#cash'], hint: 'Space start / repeat last throw · R rock · P paper · S scissors · C cash out' },
  bj: { Space: ['#deal', '#hit'], h: ['#hit'], s: ['#stand'], d: ['#dbl'], hint: 'Space deal / hit · H hit · S stand · D double' },
  rocket: { Space: ['#launch', '#cash'], hint: 'Space launches · Space again while flying = CASH OUT' },
  bell: { Space: ['#pad', '#start'], hint: 'Space start / tap the bell' },
  memory: { Space: ['#start'], hint: 'Space start · Tab + Enter flips a card' },
  trivia: { Space: ['#start'], ...ANS, hint: 'Space start · 1–4 or A–D answer' },
  hoops: { Space: ['#shoot', '#start'], hint: 'Space start / shoot' },
  math: { Space: ['#start'], hint: 'Space start · type the answer, Enter to submit' },
  band: { Space: ['#start'], hint: 'Space start · keys 1–4 play the drums' },
  dash: { Space: ['#start'], hint: 'Space start · ← → or A / D change lanes' },
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
  hoops: { tag: 'Timing', desc: 'Ten shots, one swinging meter. Hit the green and the gym goes quiet for you.' },
  math: { tag: 'Quick math', desc: 'Sixty seconds of mental math that keeps getting harder. No calculator, no mercy.' },
  band: { tag: 'Memory', desc: 'Repeat the drumline, one beat longer every round. Band kids already know.' },
  dash: { tag: 'Action', desc: 'Dodge backpacks between classes and grab hall passes. The bell is not waiting.' },
};
/* ---------- cover art: one glossy vector object per game, reused for the carousel (landscape) and the Originals grid (portrait) ---------- */
const ART = { // [gradient start, gradient end]
  plinko: ['#ff4fd8', '#5b2bd0'], mines: ['#2fb0ff', '#2a3fd8'], cross: ['#ffc542', '#ff5a3c'], flip: ['#ffb53a', '#b83a1c'], dice: ['#b06aff', '#3a2fe0'],
  limbo: ['#22e08a', '#06705a'], slots: ['#ff4d6e', '#6a1fd8'], roulette: ['#14c98a', '#0a4f8a'], rps: ['#ff8a3c', '#d8204a'], bj: ['#e0284a', '#2e0a2a'],
  rocket: ['#ffb21a', '#ff2d6e'], bell: ['#ffe08a', '#e07a12'], memory: ['#9b5cff', '#ff4fd8'], trivia: ['#18e0c4', '#2f4bff'], hoops: ['#ff8a3c', '#b8341c'], math: ['#2f6bff', '#0a2a7a'], band: ['#12c26a', '#0a3a8a'], dash: ['#ffc542', '#d8204a'],
};
let artSeq = 0;
function objArt(id, u) { // returns SVG markup for the game's object, drawn in a 300x300 box
  const rg = (n, ...s) => `<radialGradient id="${u}${n}" cx=".35" cy=".3" r=".85">${s.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</radialGradient>`;
  const lg = (n, ...s) => `<linearGradient id="${u}${n}" x1="0" y1="0" x2="1" y2="1">${s.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
  const gold = lg('gold', [0, '#fff3a8'], [.5, '#f6b800'], [1, '#a86400']), shadow = '<ellipse cx="150" cy="270" rx="88" ry="11" fill="#000" opacity=".3"/>';
  const em = (x, y, sz, e, extra = '') => `<text x="${x}" y="${y}" font-size="${sz}" text-anchor="middle" dominant-baseline="central" ${extra}>${e}</text>`;
  const card = (x, y, rot, rank, suit, col) => `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="-55" y="-75" width="110" height="150" rx="12" fill="#fff" stroke="#c9cfe8" stroke-width="3"/><text x="-42" y="-42" font-size="34" font-weight="900" fill="${col}">${rank}</text><text x="0" y="28" font-size="76" text-anchor="middle" fill="${col}">${suit}</text></g>`;
  const chip = (x, y, c, n) => Array.from({ length: n }, (_, k) => `<ellipse cx="${x}" cy="${y - k * 11}" rx="38" ry="14" fill="${c}" stroke="#fff" stroke-width="3" stroke-dasharray="9 7"/>`).join('');
  switch (id) {
    case 'plinko': {
      const pegs = [[165, 3], [197, 4], [229, 5]].flatMap(([y, n]) => Array.from({ length: n }, (_, k) => `<circle cx="${150 + (k - (n - 1) / 2) * 48}" cy="${y}" r="7.5" fill="#fff" opacity=".93"/>`)).join('');
      return `<defs>${rg('b', [0, '#ffe0f8'], [.35, '#ff4fd8'], [1, '#7a1a9a'])}${rg('c', [0, '#d8fbff'], [.4, '#27d3ff'], [1, '#0a5fa8'])}</defs>${shadow}${pegs}${[0, 1, 2, 3, 4, 5].map(k => `<rect x="${52 + k * 40}" y="252" width="34" height="16" rx="6" fill="${[ '#ffc542', '#19e58a', '#2a3a6a', '#2a3a6a', '#19e58a', '#ffc542'][k]}"/>`).join('')}<circle cx="150" cy="92" r="46" fill="url(#${u}b)"/><image href="logo.svg" x="124" y="66" width="52" height="52" /><ellipse cx="132" cy="70" rx="17" ry="10" fill="#fff" opacity=".55" transform="rotate(-30 132 70)"/><circle cx="104" cy="186" r="15" fill="url(#${u}c)"/><circle cx="99" cy="181" r="5" fill="#fff" opacity=".8"/>`;
    }
    case 'mines':
      return `<defs>${lg('l', [0, '#5cc0ff'], [1, '#2a3fd8'])}${lg('g1', [0, '#d8fcff'], [.5, '#34e0ff'], [1, '#1a7fe0'])}</defs>${shadow}<rect x="62" y="38" width="118" height="200" rx="14" fill="url(#${u}l)" stroke="#0e1a66" stroke-width="5"/><rect x="74" y="52" width="94" height="170" rx="8" fill="none" stroke="#0e1a6688" stroke-width="3"/>${[66, 80, 94].map(y => `<rect x="90" y="${y}" width="60" height="7" rx="3.5" fill="#0e1a66" opacity=".55"/>`).join('')}<rect x="88" y="104" width="62" height="62" rx="12" fill="#ffffff2e" stroke="#0e1a66" stroke-width="2.5"/><image href="logo.svg" x="93" y="109" width="52" height="52" /><circle cx="160" cy="196" r="8" fill="#e8eef8" stroke="#0e1a66" stroke-width="3"/><rect x="86" y="198" width="46" height="16" rx="4" fill="#ffffff55"/><path d="M216 140 L268 188 L216 262 L164 188Z" fill="url(#${u}g1)" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><path d="M164 188H268M216 140L194 188L216 262L238 188Z" fill="none" stroke="#ffffffaa" stroke-width="2.5" stroke-linejoin="round"/><path d="M216 140L238 188H194Z" fill="#fff" opacity=".55"/><path d="M262 110l5 12 12 5-12 5-5 12-5-12-12-5 12-5z" fill="#fff"/>`;
    case 'cross':
      return `<defs>${lg('y', [0, '#fff08a'], [.55, '#ffc21a'], [1, '#d88a00'])}${lg('w', [0, '#bfe8ff'], [1, '#4a8fd0'])}</defs><rect x="0" y="262" width="300" height="38" fill="#2a3150"/>${[10, 110, 210].map(x => `<rect x="${x}" y="278" width="60" height="6" rx="3" fill="#ffffffaa"/>`).join('')}<ellipse cx="150" cy="262" rx="120" ry="9" fill="#000" opacity=".3"/><rect x="26" y="136" width="248" height="104" rx="26" fill="url(#${u}y)" stroke="#8a5a00" stroke-width="4"/>${[0, 1, 2, 3, 4].map(k => `<rect x="${44 + k * 42}" y="152" width="34" height="32" rx="6" fill="url(#${u}w)" stroke="#0e2a50" stroke-width="2.5"/>`).join('')}<rect x="26" y="200" width="248" height="10" fill="#1a1a1a" opacity=".45"/><text x="150" y="228" font-size="14" font-weight="900" text-anchor="middle" fill="#3a2a00" letter-spacing="3">SOUTH LAKES</text><rect x="262" y="176" width="14" height="22" rx="4" fill="#fff6c0"/>${[78, 222].map(x => `<circle cx="${x}" cy="244" r="25" fill="#1a1f2b" stroke="#6b7489" stroke-width="6"/><circle cx="${x}" cy="244" r="9" fill="#aab4c8"/>`).join('')}<image href="hawk.svg" x="168" y="46" width="96" height="96"/>`;
    case 'flip':
      return `<defs>${gold}</defs>${shadow}<svg x="38" y="28" width="224" height="224" viewBox="0 0 200 200">${coinFace('heads').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg><ellipse cx="62" cy="258" rx="30" ry="9" fill="url(#${u}gold)" stroke="#7a4a00" stroke-width="3"/><ellipse cx="238" cy="250" rx="26" ry="8" fill="url(#${u}gold)" stroke="#7a4a00" stroke-width="3"/><path d="M262 40l4 11 11 4-11 4-4 11-4-11-11-4 11-4z" fill="#fff"/>`;
    case 'dice': {
      const die = (x, y, rot, s, pips, col, logo) => `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="${-s / 2 + 9}" y="${-s / 2 + 11}" width="${s}" height="${s}" rx="${s * .2}" fill="#2a1f9a" opacity=".7"/><rect x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}" rx="${s * .2}" fill="url(#${u}d)" stroke="#d8d4ff" stroke-width="3"/>${logo ? `<image href="logo.svg" x="${-s * .34}" y="${-s * .34}" width="${s * .68}" height="${s * .68}"/>` : pips.map(([px, py]) => `<circle cx="${px * s / 4}" cy="${py * s / 4}" r="${s * .075}" fill="${col}"/>`).join('')}</g>`;
      return `<defs>${lg('d', [0, '#ffffff'], [1, '#d4d0ff'])}</defs>${shadow}${die(108, 118, -14, 124, [[-1, -1], [0, 0], [1, 1]], '#5b2bd0')}${die(196, 176, 16, 104, [], '#ff4fd8', true)}<path d="M262 60l4 11 11 4-11 4-4 11-4-11-11-4 11-4z" fill="#fff"/>`;
    }
    case 'limbo':
      return `<defs>${lg('f', [0, '#e0894a'], [1, '#6b3210'])}</defs>${shadow}<path d="M20 244 Q120 20 262 84" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="3 12" stroke-linecap="round" opacity=".8"/><g transform="rotate(-28 150 160)"><ellipse cx="150" cy="160" rx="112" ry="66" fill="url(#${u}f)" stroke="#3a1a08" stroke-width="5"/><path d="M82 112Q70 160 82 208M218 112Q230 160 218 208" fill="none" stroke="#fff" stroke-width="9"/><line x1="112" y1="168" x2="188" y2="168" stroke="#fff" stroke-width="7" stroke-linecap="round"/><image href="logo.svg" x="126" y="106" width="52" height="52" />${[122, 140, 160, 180].map(x => `<line x1="${x}" y1="156" x2="${x}" y2="180" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`).join('')}<ellipse cx="120" cy="124" rx="52" ry="14" fill="#fff" opacity=".22"/></g><path d="M246 34l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#fff"/>`;
    case 'slots':
      return `<defs>${lg('m', [0, '#ff6a86'], [1, '#6a1fd8'])}${gold}</defs>${shadow}<rect x="46" y="22" width="190" height="238" rx="26" fill="url(#${u}m)" stroke="url(#${u}gold)" stroke-width="6"/>${Array.from({ length: 9 }, (_, k) => `<circle cx="${68 + k * 20.6}" cy="44" r="5" fill="${k % 2 ? '#ffe08a' : '#fff'}"/>`).join('')}<rect x="64" y="72" width="154" height="104" rx="12" fill="#0a0a18" stroke="url(#${u}gold)" stroke-width="5"/>${[0, 1, 2].map(k => `<rect x="${70 + k * 50}" y="80" width="46" height="88" rx="8" fill="#fff"/>${k === 1 ? `<image href="logo.svg" x="${73 + k * 50}" y="106" width="40" height="40"/>` : `<text x="${93 + k * 50}" y="146" font-size="64" font-weight="900" text-anchor="middle" fill="#e0182e" stroke="#7a0a18" stroke-width="2">7</text>`}`).join('')}<line x1="66" y1="124" x2="216" y2="124" stroke="#ff4d5e" stroke-width="4" opacity=".7"/><rect x="92" y="200" width="98" height="40" rx="10" fill="#1a0a3a" stroke="url(#${u}gold)" stroke-width="3"/>${[108, 128, 148, 168].map((x, k) => `<ellipse cx="${x}" cy="${222 - (k % 2) * 4}" rx="11" ry="5" fill="url(#${u}gold)"/>`).join('')}<line x1="244" y1="122" x2="270" y2="60" stroke="#d8e0ee" stroke-width="9" stroke-linecap="round"/><circle cx="273" cy="52" r="16" fill="#ff2d44" stroke="#fff" stroke-width="3"/><circle cx="267" cy="46" r="5" fill="#fff" opacity=".8"/>`;
    case 'roulette': {
      const seg = Math.PI * 2 / 37, C = { green: '#0f9d58', blue: '#1b4fd8', gold: '#f5a623' }, R = 104;
      return `<defs>${gold}</defs>${shadow}<circle cx="150" cy="148" r="122" fill="url(#${u}gold)" stroke="#7a4a00" stroke-width="4"/><circle cx="150" cy="148" r="112" fill="#0a1a2a"/>${WHEEL.map((n, i) => { const a0 = i * seg - Math.PI / 2, a1 = a0 + seg; return `<path d="M150 148L${150 + R * Math.cos(a0)} ${148 + R * Math.sin(a0)}A${R} ${R} 0 0 1 ${150 + R * Math.cos(a1)} ${148 + R * Math.sin(a1)}Z" fill="${C[rcol(n)]}"/>`; }).join('')}<circle cx="150" cy="148" r="62" fill="#0a1424" stroke="url(#${u}gold)" stroke-width="5"/><image href="logo.svg" x="116" y="114" width="68" height="68"/><circle cx="222" cy="86" r="8" fill="#fff"/><circle cx="219" cy="83" r="3" fill="#fff" opacity=".9"/>`;
    }
    case 'rps':
      return `${shadow}${em(100, 150, 128, '✊', 'transform="rotate(-8 100 150)"')}${em(204, 168, 128, '✌️', 'transform="rotate(10 204 168)"')}<text x="150" y="120" font-size="58" font-weight="900" text-anchor="middle" fill="#ffe08a" stroke="#8a2a00" stroke-width="5" paint-order="stroke" letter-spacing="2">VS</text><path d="M150 20v28M96 38l14 22M204 38l-14 22" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".7"/><image href="hawk.svg" x="108" y="196" width="84" height="84"/>`;
    case 'bj':
      return `<defs>${gold}</defs>${shadow}${card(112, 128, -14, 'A', '♠', '#14182e')}${card(184, 118, 12, 'K', '♥', '#e0182e')}${chip(76, 252, '#e0284a', 4)}${chip(224, 256, '#1b4fd8', 3)}<ellipse cx="150" cy="268" rx="40" ry="16" fill="url(#${u}gold)" stroke="#7a4a00" stroke-width="3"/><image href="logo.svg" x="130" y="246" width="40" height="40"/>`;
    case 'rocket':
      return `<defs>${lg('fl', [0, '#fff'], [.4, '#ffe08a'], [1, '#ff4d5e00'])}</defs>${shadow}<path d="M20 262 Q60 150 190 70" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="2 12" stroke-linecap="round" opacity=".7"/><g transform="rotate(36 150 150)"><path d="M122 222Q150 330 178 222Z" fill="url(#${u}fl)"/><image href="rocket.svg" x="92" y="40" width="116" height="217"/></g><g><rect x="196" y="196" width="86" height="40" rx="12" fill="#0a0a1ccc" stroke="#ffe08a" stroke-width="3"/><text x="239" y="224" font-size="25" font-weight="900" text-anchor="middle" fill="#ffe08a">12.4x</text></g><path d="M262 120l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#fff"/>`;
    case 'bell':
      return `<defs>${gold}</defs>${shadow}<path d="M20 120Q4 150 18 186M280 120Q296 150 282 186M36 100Q22 150 36 202M264 100Q278 150 264 202" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".65"/><circle cx="150" cy="44" r="14" fill="url(#${u}gold)" stroke="#7a4a00" stroke-width="4"/><path d="M150 52C108 52 94 104 92 156C90 196 74 210 66 228H234C226 210 210 196 208 156C206 104 192 52 150 52Z" fill="url(#${u}gold)" stroke="#7a4a00" stroke-width="5" stroke-linejoin="round"/><ellipse cx="150" cy="229" rx="86" ry="13" fill="#d89a00" stroke="#7a4a00" stroke-width="4"/><circle cx="150" cy="250" r="19" fill="url(#${u}gold)" stroke="#7a4a00" stroke-width="4"/><image href="logo.svg" x="116" y="110" width="68" height="68"/><path d="M118 82C104 108 102 150 100 184" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" opacity=".55"/>`;
    case 'memory': {
      const back = (x, y, r) => `<g transform="translate(${x} ${y}) rotate(${r})"><rect x="-48" y="-62" width="96" height="124" rx="12" fill="url(#${u}k)" stroke="#fff" stroke-width="4"/><image href="logo.svg" x="-28" y="-28" width="56" height="56"/></g>`;
      return `<defs>${lg('k', [0, '#4f7cff'], [1, '#6a2bd0'])}</defs>${shadow}${back(88, 96, -8)}${back(212, 92, 7)}${back(92, 208, 6)}<g transform="translate(212 208) rotate(-6)"><rect x="-48" y="-62" width="96" height="124" rx="12" fill="#fff" stroke="#19e58a" stroke-width="6"/>${em(0, 4, 64, '🦅')}</g><path d="M150 140l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#fff"/>`;
    }
    case 'trivia':
      return `<defs>${gold}</defs>${shadow}<rect x="34" y="34" width="232" height="168" rx="12" fill="#0f5a44" stroke="#a8672a" stroke-width="12"/><text x="150" y="168" font-size="150" font-weight="900" text-anchor="middle" fill="url(#${u}gold)" stroke="#7a4a00" stroke-width="5" paint-order="stroke">?</text><image href="logo.svg" x="216" y="150" width="44" height="44"/>${['A', 'B', 'C', 'D'].map((l, k) => `<circle cx="${68 + k * 55}" cy="240" r="21" fill="${k === 2 ? '#19e58a' : '#2f4bff'}" stroke="#fff" stroke-width="3"/><text x="${68 + k * 55}" y="248" font-size="22" font-weight="900" text-anchor="middle" fill="#fff">${l}</text>`).join('')}`;
    case 'hoops':
      return `<defs>${rg('b', [0, '#ffd2a0'], [.4, '#ff7a1a'], [1, '#8a2a00'])}</defs>${shadow}<rect x="70" y="30" width="160" height="110" rx="10" fill="#fff" stroke="#c9cfe8" stroke-width="6"/><rect x="108" y="64" width="84" height="56" rx="4" fill="none" stroke="#e8461a" stroke-width="6"/><path d="M96 142h108l-22 66h-64z" fill="none" stroke="#fff" stroke-width="3" opacity=".85"/><ellipse cx="150" cy="142" rx="56" ry="10" fill="none" stroke="#ff5a1a" stroke-width="9"/><circle cx="150" cy="226" r="40" fill="url(#${u}b)" stroke="#5a1a00" stroke-width="4"/><path d="M110 226h80M150 186v80M121 198q29 28 58 0M121 254q29-28 58 0" fill="none" stroke="#3a1000" stroke-width="3.5"/><image href="logo.svg" x="26" y="26" width="46" height="46"/>`;
    case 'math':
      return `<defs>${gold}</defs>${shadow}<rect x="30" y="38" width="240" height="176" rx="14" fill="#0f5a44" stroke="#a8672a" stroke-width="12"/><text x="82" y="112" font-size="62" font-weight="900" fill="#fff" text-anchor="middle">7</text><text x="150" y="112" font-size="62" font-weight="900" fill="url(#${u}gold)" text-anchor="middle">×</text><text x="218" y="112" font-size="62" font-weight="900" fill="#fff" text-anchor="middle">8</text><text x="150" y="182" font-size="56" font-weight="900" fill="#ffe08a" text-anchor="middle">= ?</text><rect x="46" y="232" width="208" height="14" rx="7" fill="#c9cfe8"/><image href="logo.svg" x="116" y="224" width="0" height="0"/>`;
    case 'band':
      return `<defs>${lg('d', [0, '#ffffff'], [1, '#c9d4f0'])}${gold}</defs>${shadow}<path d="M70 120l-40 -70M230 120l40 -70" stroke="#d8a85a" stroke-width="9" stroke-linecap="round"/><circle cx="26" cy="46" r="11" fill="#d8a85a"/><circle cx="274" cy="46" r="11" fill="#d8a85a"/><ellipse cx="150" cy="120" rx="96" ry="30" fill="url(#${u}d)" stroke="#1b4fd8" stroke-width="6"/><path d="M54 120v84q0 36 96 36t96-36v-84" fill="#1b4fd8" stroke="#0a2a7a" stroke-width="6"/><path d="M62 150l40 70m40-70l-0 80m0-80l40 70m16-70l40 70" stroke="#fff" stroke-width="5" opacity=".7" fill="none"/><image href="logo.svg" x="118" y="146" width="64" height="64"/>`;
    case 'dash':
      return `<defs>${gold}</defs>${shadow}<path d="M30 270L120 40M270 270L180 40" stroke="#fff" stroke-width="6" opacity=".35"/><path d="M150 250V60" stroke="#fff" stroke-width="5" stroke-dasharray="16 18" opacity=".35"/>${em(86, 120, 56, '🎒')}${em(214, 170, 56, '🪣')}${em(150, 96, 40, '🎫')}<image href="hawk.svg" x="88" y="150" width="124" height="124"/>${em(60, 240, 40, '💨', 'opacity=".8"')}`;
    default: return em(150, 150, 150, '🎮');
  }
}
function cover(id, emoji) { // landscape art for the carousel (800x450)
  const u = 'c' + (++artSeq), [a, b] = ART[id] || ['#2f4bff', '#0a1131'];
  return `<svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs><linearGradient id="${u}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><radialGradient id="${u}gl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <rect width="800" height="450" fill="url(#${u}bg)"/><circle cx="620" cy="225" r="260" fill="url(#${u}gl)"/><path d="M380 0h90L250 450H160zM560 0h40L400 450h-40z" fill="#fff" opacity=".07"/><g transform="translate(450 40) scale(1.28)">${objArt(id, u)}</g></svg>`;
}
function tileArt(id, title) { // portrait Stake-style tile (300x375)
  const u = 't' + (++artSeq), [a, b] = ART[id] || ['#2f4bff', '#0a1131'], t = String(title).toUpperCase(), words = t.split(' '), two = t.length > 10 && words.length > 1, half = Math.ceil(words.length / 2), lines = two ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : [t], fs = two ? 31 : 38;
  return `<svg viewBox="0 0 300 375" aria-hidden="true" focusable="false"><defs><linearGradient id="${u}bg" x1="0" y1="0" x2=".7" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><radialGradient id="${u}gl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <rect width="300" height="375" fill="url(#${u}bg)"/><circle cx="150" cy="160" r="170" fill="url(#${u}gl)"/><path d="M-20 90L300 -30V20L-20 160zM-20 250L320 120v50L-20 320z" fill="#fff" opacity=".08"/>
    <g transform="translate(0 6)">${objArt(id, u)}</g>
    <image href="logo.svg" x="9" y="8" width="38" height="38"/>
    <rect y="298" width="300" height="77" fill="#000" opacity=".3"/>${lines.map((ln, k) => `<text x="150" y="${two ? 334 + k * 32 : 349}" font-size="${fs}" font-weight="900" text-anchor="middle" fill="#fff" stroke="#00000066" stroke-width="7" paint-order="stroke" letter-spacing="1.2" font-family="Inter,system-ui,sans-serif">${esc(ln)}</text>`).join('')}</svg>`;
}
const gameList = () => GAMES.filter(([id]) => GAME_FNS[id] && (!SCHOOL() || SKILL_IDS.has(id))).map(([id, label]) => {
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
const NEW_GAMES = new Set(['hoops', 'math', 'band', 'dash']);
const gameLabel = id => (GAMES.find(([k]) => k === id) || [id, id])[1];
function mountShowcase(el) {
  const list = gameList();
  el.innerHTML = `<div id="carHost"></div><section class="allg" aria-labelledby="allgH"><h2 id="allgH">${SCHOOL() ? '🏫 Seahawk Arcade' : '🎰 HawkBet Originals'}</h2>
    <div class="allgames orig">${list.map(g => `<button class="gcard tile" data-car-play="${g.id}" aria-label="Play ${esc(g.title)}">${NEW_GAMES.has(g.id) ? '<i class="newb">NEW</i>' : ''}<div class="tilea">${tileArt(g.id, g.title)}</div><span class="tiletag">${esc(g.tag)}</span></button>`).join('')}</div></section>`;
  el.querySelector('.allgames').addEventListener('click', e => { const b = e.target.closest('[data-car-play]'); if (b) openGame(b.dataset.carPlay); });
  el.querySelectorAll('.gcard').forEach(c => { // tilt toward the pointer
    c.addEventListener('pointermove', e => { if (calm || e.pointerType !== 'mouse') return; const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; c.style.transform = `perspective(600px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-4px)`; });
    c.addEventListener('pointerleave', () => { c.style.transform = ''; });
  });
  stopFns.push(carousel(el.querySelector('#carHost'), list.map(g => ({ ...g, art: cover(g.id, g.emoji) })), { label: 'Featured games', onPlay: openGame }));
}

/* ---------- Home: the casino lobby ---------- */
async function renderHome(my) {
  if (SCHOOL()) {
    $('#app').innerHTML = `<section class="hero"><div class="heroin"><div class="herobal"><small>Your balance</small><b>${fmt(U.balance)}</b><span>Hawk Bucks</span></div>
      <div class="heroact"><a class="btn gold" href="#arcade">🎮 Play now</a><a class="btn alt" href="#rewards">🎁 Rewards</a><a class="btn alt" href="#shop">🛍️ Hawk Shop</a></div></div></section><div id="showcase"></div>
      <div class="arcfoot">🎟️ Hawk Bucks are pretend: no money, no prizes, nothing to cash out. Not affiliated with South Lakes HS or FCPS.</div>`;
    return mountShowcase($('#showcase'));
  }
  const feed = await api('GET', '/feed').catch(() => ({ bets: [], big: [], stats: { players: 0, rounds: 0, biggest: 0 } })); if (my !== nav) return;
  const ago = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago'; };
  const betRow = b => `<div class="lbrow"><span class="g">${esc(gameLabel(b.game))}</span><span class="u">${esc(b.username)}</span><span class="b">${fmt(b.bet)} 🪙</span><span class="m ${b.payout > b.bet ? 'win' : 'lose'}">${b.payout ? b.mult.toFixed(2) + 'x' : '0.00x'}</span><span class="p ${b.payout > b.bet ? 'win' : 'lose'}">${b.payout > b.bet ? '+' : '−'}${fmt(Math.abs(b.payout - b.bet))}</span></div>`;
  const ticker = feed.big.length ? feed.big.concat(feed.big).map(b => `<span>🔥 <b>${esc(b.username)}</b> hit <b class="win">${b.mult.toFixed(2)}x</b> on ${esc(gameLabel(b.game))} <b class="win">+${fmt(b.payout - b.bet)} 🪙</b></span>`).join('') : '';
  $('#app').innerHTML = `<section class="hero"><div class="heroin"><div class="floaties" aria-hidden="true"><span style="left:46%;top:14%;--d:7s">🪙</span><span style="left:60%;top:58%;--d:9s;--l:-2s">🎲</span><span style="left:74%;top:12%;--d:8s;--l:-4s">♠️</span><span style="left:88%;top:52%;--d:10s;--l:-1s">💎</span><span style="left:34%;top:62%;--d:8.5s;--l:-3s">🍀</span><span style="left:94%;top:10%;--d:7.5s;--l:-5s">🏈</span></div><div><small>Welcome back</small><h1>${esc(U.username)}</h1></div>
      <div class="herobal"><small>Your balance</small><b>${fmt(U.balance)}</b><span>Hawk Bucks</span></div>
      <div class="heroact"><a class="btn gold" href="#arcade">🎰 Play now</a><a class="btn alt" href="#bank">🏦 Bank</a><a class="btn alt" href="#shop">🛍️ Hawk Shop</a></div></div></section>
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

/* Plinko: Seahawk Drop. The server drops the ball; we animate the path it sends back. */
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
  let target = 50, over = true, autoRun = false, rolling = false, fast = false, streak = 0, bestStreak = 0, sel = null;
  const L = CFG.luck, c2 = x => Math.round(Math.min(98, Math.max(2, x)) * 100) / 100, S = { rolls: [], profit: 0, best: 0 };
  let fair = null;
  root.innerHTML = gameShell(`${betBox()}
    <button class="btn bjbig" id="roll">🎲 Roll dice <kbd>Space</kbd></button>
    <div class="duo"><button class="btn alt" id="ouflip">⇄ Roll <b id="oulab">Over</b> <kbd>U</kbd></button><button class="btn alt" id="speed" aria-pressed="false">⚡ Instant</button></div>
    <div class="dpre" id="dpre">${[1.5, 2, 5, 10, 50].map(m => `<button class="chip" data-m="${m}">${m}x</button>`).join('')}<button class="chip" data-w="98">98% safe</button></div>
    <div class="stats3"><div><small>Multiplier</small><input id="mulin" type="number" min="1.01" step="0.01"></div><div><small>Roll <span id="oul2">over</span></small><input id="tgn" type="number" min="2" max="98" step="0.01" value="50"></div><div><small>Win chance %</small><input id="wcin" type="number" min="2" max="98" step="0.01"></div></div>
    <div class="note">Type in any box and the others follow. The <b>green zone</b> wins. Smaller zone = bigger payout. <kbd>←</kbd><kbd>→</kbd> nudge the target.</div>
    <details class="dauto"><summary>⚡ Auto-roll</summary>
      <div class="arow"><label>Rolls<select id="acount"><option>10</option><option>25</option><option>50</option><option>100</option><option value="0">Until stopped</option></select></label><label>On a win<select id="awin"><option value="same">Keep bet</option><option value="reset">Reset bet</option></select></label></div>
      <div class="arow"><label>Stop if up<input id="astopw" type="number" min="0" placeholder="off"></label><label>Stop if down<input id="astopl" type="number" min="0" placeholder="off"></label><label>Stop on win ≥ (x)<input id="astopx" type="number" min="0" placeholder="off"></label></div>
      <button class="btn alt" id="auto">⚡ Start auto <kbd>A</kbd></button></details>
    ${luckLine('your green win zone is resized, payouts adjust to match.')}`,
    `<div class="dstage"><div class="board" id="board"><div class="bbulbs" aria-hidden="true">${Array.from({ length: 18 }, (_, k) => `<i style="--k:${k}"></i>`).join('')}</div>
      <div class="bhead"><span>🦅 SEAHAWKS</span><span id="rollno">ROLL #1</span><span id="fire" class="fire hidden">🔥 HOT</span></div>
      <div class="dnum" id="dnum" aria-live="polite">${[0, 1, '.', 2, 3].map(d => d === '.' ? '<i class="pt">.</i>' : `<i class="dd">5</i>`).join('')}</div></div>
      <div class="dbar" id="dbar"><div class="dclip"><div class="turf"></div><div class="dz lose" id="dzl"></div><div class="dz win" id="dzw"></div></div><div class="dball" id="dball" aria-hidden="true"><i>🏈</i></div><input type="range" id="tg" class="dslider" min="2" max="98" step="0.01" value="50" aria-label="Dice target"><div class="dmark hidden" id="dmark"><span id="dmv"></span></div></div>
      <div class="dticks"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
      <div class="dhist" id="dh" aria-label="Recent rolls"></div><div class="ddet" id="ddet"></div>
      <div class="dstats" id="dstats"></div><svg class="dgraph" id="dgraph" viewBox="0 0 300 70" preserveAspectRatio="none" aria-label="Session profit"></svg>
      <details class="dfair" id="dfair"><summary>🔒 Provably fair</summary><div class="fbody">
        <p class="note">Before each roll the server has locked in a secret seed. You see its fingerprint (SHA-256) now, and the seed itself when you rotate. Every roll = HMAC-SHA256(server seed, "your seed:roll number"). Rotate, then check any past roll below.</p>
        <div class="frow"><small>Server seed fingerprint</small><code id="fhash">…</code></div>
        <div class="frow"><small>Your seed</small><input id="fcs" maxlength="40" aria-label="Client seed"></div><div class="frow"><small>Next roll #</small><b id="fnonce">0</b></div>
        <button class="btn alt" id="frot">🔄 Rotate seeds &amp; reveal old one</button>
        <div class="fverify"><b>Verify a roll</b><input id="vss" placeholder="Server seed (revealed after rotating)"><div class="arow"><input id="vcs" placeholder="Your seed"><input id="vn" type="number" min="0" placeholder="Roll #"></div><button class="btn alt" id="vgo">Check</button><div id="vout" class="note"></div></div></div></details></div>`);
  const $r = s => root.querySelector(s), pos = v => `calc(17px + (100% - 34px) * ${v / 100})`;
  const z0of = t => over ? 100 - t : t;
  function geom() { // [win chance %, win zone edge, payout]
    const z0 = z0of(target), zone = c2(L.sup ? 100 - (100 - z0) / L.k : z0 * L.k), edge = over ? 100 - zone : zone, zonePay = c2(z0 * L.pk);
    return { zone, edge, pays: 0.99 / (zonePay / 100) };
  }
  const tFromZ0 = z0 => over ? 100 - z0 : z0;
  function paint(skip) {
    const g = geom(), act = document.activeElement;
    if (act !== $r('#mulin')) $r('#mulin').value = +g.pays.toFixed(g.pays >= 100 ? 0 : 2);
    if (act !== $r('#wcin')) $r('#wcin').value = g.zone.toFixed(2);
    if (act !== $r('#tgn')) $r('#tgn').value = target;
    $r('#oulab').textContent = over ? 'Over' : 'Under'; $r('#oul2').textContent = over ? 'over' : 'under';
    const lose = $r('#dzl'), win = $r('#dzw');
    if (over) { lose.style.cssText = `left:0;width:${pos(g.edge)}`; win.style.cssText = `left:${pos(g.edge)};right:0`; } else { win.style.cssText = `left:0;width:${pos(g.edge)}`; lose.style.cssText = `left:${pos(g.edge)};right:0`; }
    $r('#tg').value = target;
  }
  const setTarget = v => { target = Math.round(Math.min(98, Math.max(2, +v || 50)) * 100) / 100; paint(); };
  const fromMult = m => { const zonePay = 99 / Math.max(1.01, m); setTarget(tFromZ0(Math.min(98, Math.max(2, zonePay / L.pk)))); };
  const fromChance = w => { const z0 = L.sup ? 100 - (100 - w) * L.k : w / L.k; setTarget(tFromZ0(Math.min(98, Math.max(2, z0)))); };
  $r('#tg').oninput = e => setTarget(e.target.value);
  $r('#tgn').oninput = e => { if (e.target.value !== '') setTarget(e.target.value); }; $r('#tgn').onblur = () => paint();
  $r('#mulin').oninput = e => { if (+e.target.value > 0) fromMult(+e.target.value); }; $r('#mulin').onblur = () => paint();
  $r('#wcin').oninput = e => { if (+e.target.value > 0) fromChance(+e.target.value); }; $r('#wcin').onblur = () => paint();
  $r('#dpre').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; sfx.play('tap'); b.dataset.m ? fromMult(+b.dataset.m) : fromChance(+b.dataset.w); };
  const flipOU = () => { over = !over; target = c2(100 - target); paint(); sfx.play('tap'); }; $r('#ouflip').onclick = flipOU;
  $r('#speed').onclick = e => { fast = !fast; e.currentTarget.setAttribute('aria-pressed', fast); e.currentTarget.classList.toggle('on', fast); };
  const keys = e => { if (!root.isConnected) return; if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.id !== 'tg') return; const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0; if (d) { e.preventDefault(); setTarget(target + d * (e.shiftKey ? 10 : 1)); } };
  document.addEventListener('keydown', keys); stopFns.push(() => document.removeEventListener('keydown', keys));
  /* scoreboard digits (odometer): 5 cells "dd.dd" */
  const cells = () => [...root.querySelectorAll('#dnum .dd')], fmtRoll = v => v.toFixed(2).padStart(5, '0').replace('.', '');
  const showRoll = v => { const s = fmtRoll(v); cells().forEach((c, i) => { c.textContent = s[i]; }); };
  async function odometer(v) {
    const s = fmtRoll(v), cs = cells(), t0 = performance.now(), locks = fast ? [60, 110, 160, 210] : [380, 520, 660, 820];
    await new Promise(done => { const step = () => { const el = performance.now() - t0; let all = true;
      cs.forEach((c, i) => { if (el >= locks[i]) { if (c.textContent !== s[i] || !c.classList.contains('lock')) { c.textContent = s[i]; c.classList.add('lock'); sfx.play('tap'); } } else { all = false; c.textContent = Math.floor(Math.random() * 10); } });
      all ? done() : setTimeout(step, 45); }; step(); });
    cs.forEach(c => c.classList.remove('lock'));
  }
  /* the football: rolls back and forth along the field while the digits spin, then settles on the roll */
  let ballAt = 50, ballSpin = 0;
  const ballX = v => { const w = $r('#dbar').clientWidth; return 17 + (w - 34) * v / 100; };
  const placeBall = (v, spin = ballSpin) => { const b = $r('#dball'); if (b) b.style.transform = `translate(${ballX(v)}px,-50%) rotate(${spin}deg)`; };
  function rollBall(to, dur) {
    const b = $r('#dball'), pts = [ballAt], side = ballAt < 50;
    for (let i = 0; i < 3; i++) pts.push((side === (i % 2 === 0)) ? 62 + Math.random() * 36 : Math.random() * 38); // zig-zag across the field
    pts.push(to);
    const wts = [1, 0.9, 0.8, 1.5], tot = wts.reduce((a, c) => a + c, 0), ends = wts.map((w, i) => wts.slice(0, i + 1).reduce((a, c) => a + c, 0) / tot * dur);
    const ease = k => k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2, easeOut = k => 1 - (1 - k) ** 3 * (1 - 2.2 * k * (1 - k)); // last leg overshoots a hair, then settles
    const t0 = performance.now(), w = $r('#dbar').clientWidth, spin0 = ballSpin; b.classList.add('rolling');
    return new Promise(done => { const step = () => {
      if (!b.isConnected) return done();
      const el = Math.min(dur, performance.now() - t0); let i = ends.findIndex(e => el <= e); if (i < 0) i = 3;
      const a = i ? ends[i - 1] : 0, k = (el - a) / ((ends[i] - a) || 1), v = pts[i] + (pts[i + 1] - pts[i]) * (i === 3 ? easeOut(k) : ease(k));
      ballSpin = spin0 + (v - pts[0]) * (w - 34) / 100 / 14 * 57.3; placeBall(v); // spin matches the distance rolled
      if (el < dur) setTimeout(step, 16); else { ballAt = to; b.classList.remove('rolling'); done(); }
    }; step(); });
  }
  const onRs = () => placeBall(ballAt); addEventListener('resize', onRs); stopFns.push(() => removeEventListener('resize', onRs)); setTimeout(onRs, 0);
  function pill() {
    $r('#dh').innerHTML = S.rolls.slice(0, 25).map((h, i) => `<button data-i="${i}" class="${h.win ? 'good' : 'bad'}${sel === h ? ' sel' : ''}">${h.roll.toFixed(2)}</button>`).join('');
  }
  $r('#dh').onclick = e => { const b = e.target.closest('button'); if (!b) return; sel = S.rolls[+b.dataset.i]; pill(); const h = sel;
    $r('#ddet').innerHTML = `Roll #${h.nonce + 1} · ${h.over ? 'Over' : 'Under'} ${h.target.toFixed(2)} · chance ${h.zone.toFixed(2)}% · rolled <b>${h.roll.toFixed(2)}</b> · bet ${fmt(h.bet)} → ${h.win ? '<b class="g">+' + fmt(h.payout - h.bet) + '</b>' : '<b class="r">−' + fmt(h.bet) + '</b>'} · <button class="chip" id="dverify">Verify</button>`;
    $r('#dverify').onclick = () => { $r('#dfair').open = true; $r('#vcs').value = h.clientSeed; $r('#vn').value = h.nonce; $r('#vss').focus(); };
  };
  function stats() {
    const R = S.rolls, w = R.filter(x => x.win).length;
    $r('#dstats').innerHTML = [['Rolls', R.length], ['Win rate', R.length ? Math.round(w / R.length * 100) + '%' : '–'], ['Profit', (S.profit > 0 ? '+' : '') + fmt(S.profit)], ['Best hit', S.best ? S.best.toFixed(2) + 'x' : '–'], ['Best streak', bestStreak]].map(([k, v]) => `<div><small>${k}</small><b class="${k === 'Profit' ? (S.profit > 0 ? 'g' : S.profit < 0 ? 'r' : '') : ''}">${v}</b></div>`).join('');
    const pts = [0]; [...R].reverse().forEach(x => pts.push(pts[pts.length - 1] + x.payout - x.bet));
    const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), span = hi - lo || 1, X = i => pts.length < 2 ? 0 : i / (pts.length - 1) * 300, Y = v => 66 - (v - lo) / span * 62;
    $r('#dgraph').innerHTML = `<line x1="0" x2="300" y1="${Y(0)}" y2="${Y(0)}" stroke="#ffffff33" stroke-dasharray="4 4"/>` + (pts.length > 1 ? `<polyline fill="none" stroke="${S.profit >= 0 ? '#19e58a' : '#ff5d6c'}" stroke-width="2.5" stroke-linejoin="round" points="${pts.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>` : '');
    $r('#rollno').textContent = 'ROLL #' + (R.length + 1);
    const hot = streak >= 3; $r('#fire').classList.toggle('hidden', !hot); $r('#board').classList.toggle('onfire', hot);
  }
  function paintFair() { if (!fair) return; $r('#fhash').textContent = fair.hash; if (document.activeElement !== $r('#fcs')) $r('#fcs').value = fair.clientSeed; $r('#fnonce').textContent = fair.nonce; }
  api('GET', '/fair').then(f => { fair = f; if (root.isConnected) paintFair(); }).catch(() => {});
  async function hmacRoll(server, client, nonce) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(server), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new DataView(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${client}:${nonce}`)));
    return Math.floor(sig.getUint32(0) / 4294967296 * 10000) / 100;
  }
  $r('#frot').onclick = act(async () => {
    const r = await api('POST', '/fair/rotate', { clientSeed: $r('#fcs').value }); fair = r; paintFair();
    $r('#vss').value = r.revealed.serverSeed; $r('#vcs').value = r.revealed.clientSeed; $r('#vn').value = 0;
    $r('#vout').innerHTML = `Old server seed revealed (${r.revealed.rolls} rolls). It hashes to <code>${r.revealed.hash.slice(0, 16)}…</code> – the fingerprint you saw. Pick a roll # and press Check.`;
  });
  $r('#vgo').onclick = async () => {
    try { const s = $r('#vss').value.trim(), c = $r('#vcs').value, n = +$r('#vn').value; if (!s) return $r('#vout').textContent = 'Paste the revealed server seed first.';
      const v = await hmacRoll(s, c, n), hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
      $r('#vout').innerHTML = `Roll #${n + 1} was <b>${v.toFixed(2)}</b>. Server seed fingerprint <code>${hash.slice(0, 16)}…</code>`; } catch (e) { $r('#vout').textContent = 'Could not verify that.'; }
  };
  async function doRoll() {
    if (rolling) return false; rolling = true; $r('#roll').disabled = true;
    try {
      const r = await api('POST', '/arcade/dice', { bet: readBet(), target, over }), mk = $r('#dmark'), bar = $r('#dbar'), board = $r('#board');
      $r('#res').textContent = ''; board.classList.remove('good', 'bad'); mk.className = 'dmark hidden'; bar.classList.remove('flash-g', 'flash-r'); $r('#dball').classList.remove('good', 'bad');
      if (!calm) await Promise.all([odometer(r.roll), rollBall(r.roll, fast ? 210 : 820)]); else { showRoll(r.roll); ballAt = r.roll; placeBall(r.roll); }
      if (!root.isConnected) { setBal(r.balance); return false; }
      mk.style.left = pos(r.roll); mk.className = 'dmark land ' + (r.win ? 'good' : 'bad'); $r('#dball').classList.add(r.win ? 'good' : 'bad'); $r('#dmv').textContent = r.roll.toFixed(2);
      board.classList.add(r.win ? 'good' : 'bad'); bar.classList.add(r.win ? 'flash-g' : 'flash-r');
      streak = r.win ? streak + 1 : 0; bestStreak = Math.max(bestStreak, streak); if (r.win && r.mult >= 3) fx.bump(board);
      S.rolls.unshift(r); S.profit += r.payout - r.bet; if (r.win) S.best = Math.max(S.best, r.mult);
      if (fair) { fair.nonce = r.nonce + 1; paintFair(); }
      sel = null; $r('#ddet').innerHTML = ''; pill(); stats();
      settleShot(r, r.mult >= 5);
      if (r.win && streak === 3) toast('🔥 Hot streak – 3 in a row!');
      return r;
    } finally { rolling = false; if (root.isConnected) $r('#roll').disabled = autoRun; }
  }
  $r('#roll').onclick = act(async () => { await doRoll(); });
  const num = id => { const v = parseFloat($r(id).value); return v > 0 ? v : 0; };
  async function toggleAuto() {
    const btn = $r('#auto');
    if (autoRun) { autoRun = false; return; }
    autoRun = true; $r('#roll').disabled = true; $r('.dauto').open = true;
    const total = +$r('#acount').value || Infinity, upT = num('#astopw'), dnT = num('#astopl'), xT = num('#astopx'), resetOnWin = $r('#awin').value === 'reset', bet0 = readBet(); let net = 0;
    for (let n = total; n > 0 && autoRun && root.isConnected; n--) {
      btn.innerHTML = `⏹ Stop (${n === Infinity ? '∞' : n} left) <kbd>A</kbd>`;
      let r; try { r = await doRoll(); } catch (e) { toast(e.message); sfx.play('error'); break; }
      if (!r) break; net += r.payout - r.bet;
      if (resetOnWin && r.win) { $('#bet').value = bet0; $('#bet').dispatchEvent(new Event('input')); }
      if (upT && net >= upT) { toast('Auto-roll stopped: profit target reached'); break; }
      if (dnT && -net >= dnT) { toast('Auto-roll stopped: loss limit reached'); break; }
      if (xT && r.win && r.mult >= xT) { toast(`Auto-roll stopped: ${r.mult.toFixed(2)}x hit`); break; }
      await wait(calm || fast ? 120 : 420);
    }
    autoRun = false; if (root.isConnected) { btn.innerHTML = '⚡ Start auto <kbd>A</kbd>'; $r('#roll').disabled = false; }
  }
  $r('#auto').onclick = toggleAuto; stopFns.push(() => { autoRun = false; });
  paint(); pill(); stats();
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
  let spinning = false, autoRun = false, busy = false, recent = [], hitTimer = 0;
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
        <div class="shandle" id="shandle"><svg class="lsvg" viewBox="0 0 90 270" overflow="visible"><defs>
            <linearGradient id="lpl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5d6a7c"/><stop offset=".45" stop-color="#eef3f9"/><stop offset="1" stop-color="#76849a"/></linearGradient>
            <radialGradient id="lbl" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#ffc2c9"/><stop offset=".32" stop-color="#ff2d44"/><stop offset="1" stop-color="#6e0010"/></radialGradient>
            <radialGradient id="lpv" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#9aa7b8"/><stop offset="1" stop-color="#434e5f"/></radialGradient></defs>
          <rect x="-4" y="90" width="34" height="90" rx="10" fill="url(#lpl)" stroke="#2e3745" stroke-width="2"/><rect x="8" y="104" width="12" height="62" rx="6" fill="#121821" stroke="#2e3745" stroke-width="1.5"/>
          <circle cx="4" cy="99" r="2.4" fill="#59667a"/><circle cx="23" cy="99" r="2.4" fill="#59667a"/><circle cx="4" cy="171" r="2.4" fill="#59667a"/><circle cx="23" cy="171" r="2.4" fill="#59667a"/>
          <line id="lr0" x1="26" y1="135" x2="26" y2="35" stroke="#2a3340" stroke-width="13" stroke-linecap="round"/><line id="lr1" x1="26" y1="135" x2="26" y2="35" stroke="#b7c2d1" stroke-width="9" stroke-linecap="round"/><line id="lr2" x1="24" y1="135" x2="24" y2="35" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".85"/>
          <circle cx="26" cy="135" r="12" fill="url(#lpv)" stroke="#2e3745" stroke-width="2"/><circle cx="26" cy="135" r="4.5" fill="#2e3745"/>
          <g id="hball" class="lball" tabindex="0" role="button" aria-label="Pull the lever to spin" transform="translate(26 35)"><circle r="19" fill="url(#lbl)" stroke="#5a0010" stroke-width="2"/><ellipse cx="-6" cy="-8" rx="7" ry="4.2" fill="#fff" opacity=".72" transform="rotate(-30 -6 -8)"/><circle class="lrim" r="21" fill="none" stroke="transparent" stroke-width="3"/></g></svg><div class="hhint">PULL ↓</div></div></div>
      <div class="slast" id="slast" aria-label="Recent spins"></div></div>`, 'wide2');
  const reels = [...root.querySelectorAll('.sreel')], strips = reels.map(r => r.firstElementChild), slotm = $('#slotm'), lever = $('#shandle'), svg = $('.lsvg');
  const tileH = () => reels[0].clientHeight / 3, rnd = () => keys[Math.floor(Math.random() * keys.length)];
  const perLineTxt = () => { const v = readBet() / 5; return v % 1 ? v.toFixed(1) : String(v); };
  $('#bet').addEventListener('input', () => { $('#perline').textContent = perLineTxt(); }); $('#perline').textContent = perLineTxt();
  const pills = () => { $('#slast').innerHTML = recent.slice(0, 12).map(m => `<span class="${m >= 5 ? 'gold' : m >= 1 ? 'good' : m > 0 ? 'meh' : 'bad'}">${m ? m.toFixed(2) + 'x' : '0x'}</span>`).join(''); };
    const curCol = c => [...strips[c].children].map(e => e.dataset.k).slice(0, 3);
  async function spinReel(c, final3, dur) { // symbols scroll DOWN: new ones enter at the top and settle with a little overshoot
    const cur = curCol(c), filler = Array.from({ length: 12 + c * 5 + Math.round(dur / 320) }, rnd), seq = [...final3, ...filler, ...cur], t = tileH();
    strips[c].innerHTML = seq.map(symTile).join(''); strips[c].style.transition = 'none'; strips[c].style.transform = `translateY(${-(seq.length - 3) * t}px)`; void strips[c].offsetWidth;
    reels[c].classList.add('blur'); strips[c].style.transition = `transform ${dur}ms cubic-bezier(.15,.8,.22,1.07)`; strips[c].style.transform = 'translateY(0)';
    await new Promise(res => { const done = () => { strips[c].removeEventListener('transitionend', done); res(); }; strips[c].addEventListener('transitionend', done); setTimeout(done, dur + 140); });
    reels[c].classList.remove('blur'); while (strips[c].children.length > 3) strips[c].lastElementChild.remove(); // the final symbols are already in place at the top: just drop the filler, nothing is redrawn
    reels[c].classList.add('thud'); setTimeout(() => reels[c].classList.remove('thud'), 260);
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
    const tick = setInterval(() => sfx.play('flip'), 140);
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
    coinRain({ jackpot: 40, mega: 30, big: 22, nice: 14, win: 9, small: 4 }[tier]);
    if (tier === 'jackpot') { slotm.classList.add('frenzy'); sfx.play('jackpot'); fx.burst(170); setTimeout(() => fx.burst(110), 700); }
    else if (tier === 'mega' || tier === 'big') { slotm.classList.add('frenzy'); fx.win(true); sfx.play('big'); }
    else if (tier === 'nice') { fx.win(true); } else if (tier === 'win') { fx.win(false); } else sfx.play('coin');
    wins.forEach((w, i) => setTimeout(() => sfx.play('coin'), 120 + i * 140));
    return { tier, hold: { jackpot: 4200, mega: 3000, big: 2400, nice: 1800, win: 1400, small: 700 }[tier] };
  }
  function begin() { // lock the machine and send the bet the moment the lever moves, so the result is back before it bottoms out
    if (spinning) return null; spinning = true; clearTimeout(hitTimer); lever.classList.add('locked'); $('#spin').disabled = true; clearHits(); $('#res').textContent = '';
    return api('POST', '/arcade/slots', { bet: readBet() }).then(r => ({ r }), e => ({ e }));
  }
  async function run(req) { // play the spin for a request that is already in flight
    let ok = false;
    try {
      const got = await req; if (got.e) throw got.e; const r = got.r;
      U.balance = r.balance; pending += r.payout; showBal(); // the bet leaves now; winnings appear when the reels stop
      await playSpin(r); if (!root.isConnected) { pending = 0; return setBal(r.balance); }
      recent.unshift(r.mult); pills();
      let hold = 600;
      if (r.payout > 0) { const c = await celebrate(r); hold = c.hold; resMsg(r.payout >= r.bet, `${r.mult.toFixed(2)}x · ${r.payout >= r.bet ? '+' : '−'}${fmt(Math.abs(r.payout - r.bet))} 🪙`); }
      else { resMsg(false, `No win · −${fmt(r.bet)} 🪙`); fx.lose(); }
      pending = Math.max(0, pending - r.payout); showBal(); ok = true;
      await wait(calm ? 0 : autoRun ? hold : Math.min(hold, 800));
      if (!autoRun) hitTimer = setTimeout(() => { if (!spinning) clearHits(); }, 2500);
    } catch (e) { toast(e.message); sfx.play('error'); }
    finally { spinning = false; if (root.isConnected) { lever.classList.remove('locked'); $('#spin').disabled = autoRun; } }
    return ok;
  }
  /* ---- the lever: a chrome arm on a bracket. Pulling it moves the ball down and toward you (it grows a little), then it springs back ---- */
  const FULL = 162, CATCH = 0.82, P = { x: 26, y: 135 }, RX = 36, RY = 100, REST_Y = P.y - RY, FULL_Y = P.y + RY * 0.951;
  const rods = ['lr0', 'lr1', 'lr2'].map(id => $('#' + id)), ballEl = $('#hball'), arm = { raf: 0, done: null, a: 0 };
  function drawArm(a) { // a = degrees pulled (0 = resting up, 162 = all the way down)
    const r = a * Math.PI / 180, bx = P.x + RX * Math.sin(r), by = P.y - RY * Math.cos(r), depth = (1 - Math.cos(r)) / 2, k = 1 + 0.3 * depth;
    rods.forEach((l, i) => { l.setAttribute('x2', bx - (i === 2 ? 2 * k : 0)); l.setAttribute('y2', by); l.setAttribute('stroke-width', [13, 9, 2.4][i] * k); });
    ballEl.setAttribute('transform', `translate(${bx.toFixed(2)} ${by.toFixed(2)}) scale(${(1 + 0.3 * depth).toFixed(3)})`); arm.a = a;
  }
  function animateArm(from, to, ms, ease) { // frame-by-frame so a new move can take over cleanly
    cancelAnimationFrame(arm.raf); if (arm.done) arm.done();
    if (calm || !ms) { drawArm(to); return Promise.resolve(); }
    return new Promise(res => { arm.done = res; const t0 = performance.now(); (function step(now) { const k = Math.min(1, (now - t0) / ms); drawArm(from + (to - from) * ease(k)); if (k < 1) arm.raf = requestAnimationFrame(step); else { arm.done = null; res(); } })(t0); });
  }
  const accel = k => k * k, spring = k => 1 - Math.exp(-7 * k) * Math.cos(8 * k); // spring overshoots a touch, then settles
  const kick = () => { slotm.classList.add('kick'); setTimeout(() => slotm.classList.remove('kick'), 140); };
  async function pullAuto() { // what Space / the Spin button do: the lever pulls itself
    if (spinning || busy) return false; busy = true; const req = begin(); if (!req) { busy = false; return false; }
    sfx.play('lever'); await animateArm(arm.a, FULL, 300, accel); sfx.play('ratchet'); kick();
    animateArm(FULL, 0, 620, spring); busy = false; return run(req);
  }
  let drag = null;
  ballEl.addEventListener('pointerdown', e => {
    if (spinning || busy) return; const sc = svg.getBoundingClientRect().height / 270;
    drag = { y0: e.clientY, span: (FULL_Y - REST_Y) * sc, max: 0, caught: false }; try { ballEl.setPointerCapture(e.pointerId); } catch (x) {} lever.classList.add('dragging'); e.preventDefault();
  });
  ballEl.addEventListener('pointermove', e => {
    if (!drag || drag.caught) return; const p = Math.max(0, Math.min(1, (e.clientY - drag.y0) / drag.span)), a = p * FULL; drag.max = Math.max(drag.max, a); cancelAnimationFrame(arm.raf); drawArm(a);
    if (p >= CATCH) { drag.caught = true; const req = begin(); sfx.play('ratchet'); kick(); animateArm(a, FULL, 60, accel).then(() => animateArm(FULL, 0, 620, spring)); if (req) run(req); }
  });
  const release = () => { if (!drag) return; const d = drag; drag = null; lever.classList.remove('dragging'); if (d.caught) return; if (d.max < 8) pullAuto(); else animateArm(arm.a, 0, 480, spring); };
  ballEl.addEventListener('pointerup', release); ballEl.addEventListener('pointercancel', release);
  ballEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pullAuto(); } }); // keyboard: focus the lever and press Enter
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

/* Coach: the Hawk 21 dealer. A cartoon South Lakes coach in SVG; CSS classes on .coach switch his mood. */
const coachSvg = () => `<svg viewBox="0 0 220 250" aria-hidden="true">
  <g class="cbody"><path d="M26 252C26 192 60 168 110 168S194 192 194 252Z" fill="#0a8f4e"/><path d="M26 252C26 206 48 182 78 174C58 196 52 224 56 252Z" fill="#14c46f" opacity=".5"/>
    <rect x="94" y="136" width="32" height="38" rx="9" fill="#e0a87c"/><path d="M82 170L110 210L138 170L126 163L110 188L94 163Z" fill="#fff"/><path d="M95 164L110 188L125 164" fill="none" stroke="#06582f" stroke-width="2"/>
    <image href="logo.svg" x="136" y="198" width="32" height="32"/><path d="M90 166Q110 220 130 166" fill="none" stroke="#e8eef5" stroke-width="3.5"/><rect x="101" y="206" width="20" height="13" rx="6.5" fill="#ffd24a" stroke="#a86a00" stroke-width="2"/><circle cx="106" cy="212" r="2.6" fill="#a86a00"/></g>
  <g class="carm"><path d="M168 194C192 202 202 230 194 254L170 254C174 232 168 216 154 206Z" fill="#0a8f4e"/><g class="chand2"><circle cx="184" cy="246" r="13" fill="#f0bd92"/><rect x="178" y="224" width="24" height="32" rx="4" fill="#fff" stroke="#c9cfe8" stroke-width="2" transform="rotate(14 190 240)"/></g></g>
  <g class="chead">
    <circle cx="64" cy="98" r="10" fill="#e0a87c"/><circle cx="156" cy="98" r="10" fill="#e0a87c"/><ellipse cx="110" cy="98" rx="47" ry="50" fill="#f0bd92"/>
    <ellipse cx="82" cy="112" rx="9" ry="6" fill="#ff8a8a" opacity=".28"/><ellipse cx="138" cy="112" rx="9" ry="6" fill="#ff8a8a" opacity=".28"/>
    <g class="eye"><ellipse cx="90" cy="94" rx="9.5" ry="10.5" fill="#fff"/><circle class="pup" cx="91" cy="96" r="4.6" fill="#1b2a4a"/><circle cx="93" cy="93" r="1.6" fill="#fff"/><ellipse class="lid" cx="90" cy="94" rx="10.5" ry="11.5" fill="#f0bd92"/></g>
    <g class="eye"><ellipse cx="130" cy="94" rx="9.5" ry="10.5" fill="#fff"/><circle class="pup" cx="131" cy="96" r="4.6" fill="#1b2a4a"/><circle cx="133" cy="93" r="1.6" fill="#fff"/><ellipse class="lid" cx="130" cy="94" rx="10.5" ry="11.5" fill="#f0bd92"/></g>
    <path class="brow bl" d="M77 80Q90 73 103 80" stroke="#4a2e1a" stroke-width="5.5" fill="none" stroke-linecap="round"/><path class="brow br" d="M117 80Q130 73 143 80" stroke="#4a2e1a" stroke-width="5.5" fill="none" stroke-linecap="round"/>
    <path d="M110 98Q104 110 110 114" stroke="#c98f66" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M80 122Q96 110 110 119Q124 110 140 122Q128 132 110 126Q92 132 80 122Z" fill="#5a3a22"/>
    <path class="m m-smile" d="M93 133Q110 150 127 133" stroke="#7a2a1a" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    <g class="m m-open"><ellipse cx="110" cy="138" rx="12" ry="9.5" fill="#5a1410"/><ellipse cx="110" cy="143" rx="7" ry="4" fill="#e0627a"/></g>
    <path class="m m-flat" d="M97 138H123" stroke="#7a2a1a" stroke-width="4.5" stroke-linecap="round"/>
    <path class="m m-frown" d="M95 143Q110 130 125 143" stroke="#7a2a1a" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    <path d="M60 80C60 40 88 26 110 26S160 40 160 80Z" fill="#0a8f4e"/><path d="M110 26V80M84 34Q78 56 80 80M136 34Q142 56 140 80" stroke="#06582f" stroke-width="2" fill="none" opacity=".55"/>
    <path d="M52 82C80 70 140 70 170 84C148 98 80 98 52 82Z" fill="#1b4fd8" stroke="#0b2a6b" stroke-width="3"/><image href="logo.svg" x="92" y="36" width="36" height="36"/>
  </g>
  <g class="chand"><ellipse cx="110" cy="100" rx="40" ry="32" fill="#f0bd92" stroke="#d99a6c" stroke-width="3"/><path d="M82 90Q110 78 138 90M84 104Q110 94 136 104" stroke="#d99a6c" stroke-width="3" fill="none"/></g>
</svg>`;
const COACH_LINES = {
  hello: ['Welcome to Hawk 21, rookie.', 'Coach is dealing. Try to keep up.', 'Hustle up and place your bet!'],
  deal: ['Cards are out!', 'Here we go.', 'Eyes on the table, rookie.'],
  hit: ['Another card? Bold.', 'Hit you? Okay, hit YOU.', 'Careful now…'],
  stand: ['Standing? Smart. My turn.', 'Let’s see what I’ve got…'],
  dbl: ['Doubling down! I respect it.', 'Big swing, rookie.'],
  win: ['Okay okay… nice hand.', 'You got me this time.', 'Take your Hawk Bucks. Don’t spend them all in one place.'],
  natural: ['BLACKJACK?! In MY gym?!', 'Wow. Just… wow.'],
  lose: ['Coach stands on 17. Always.', 'That’s a lap for you.', 'Better luck next time, rookie.'],
  bust: ['BUST! Drop and give me twenty.', 'Too greedy, rookie.'],
  push: ['A push. Nobody runs laps.', 'Tie game. Run it back.'],
};

/* Blackjack: Hawk 21 */
async function bj(root, my) {
  const RK = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }, SU = ['♠', '♥', '♦', '♣']; let v = null, shown = { player: 0, dealer: 0 };
  root.innerHTML = gameShell(`${betBox()}<div style="height:14px"></div><button class="btn bjbig" id="deal">🃏 Deal <kbd>Space</kbd></button>
    <div class="note">Beat Coach to 21. Blackjack pays 3:2, Coach stands on 17, and you can double on your first two cards.</div>`,
    `<div class="coachrow"><div class="coach idle" id="coach" role="img" aria-label="Coach, the dealer">${coachSvg()}</div><div class="cbub" id="cbub"></div></div><div class="felt"><div class="who2">Coach <b id="dt"></b></div><div class="hand2" id="dealer"></div><div class="feltlogo"><img src="logo.svg" alt="">HAWK 21</div><div class="hand2" id="player"></div><div class="who2">You <b id="pt"></b></div></div>
    <div class="bjacts hidden" id="acts"><button class="btn blue" id="hit"><span>👊</span>Hit<kbd>H</kbd></button><button class="btn" id="stand"><span>✋</span>Stand<kbd>S</kbd></button><button class="btn gold" id="dbl"><span>💰</span>Double<kbd>D</kbd></button></div>
    <button class="btn bjbig bjdeal2 hidden" id="deal2">🃏 Deal again <kbd>Space</kbd></button>`);
  let coachT = 0;
  function coachSay(kind, mood, hold = 3200) { // mood: idle | deal | think | smug | shock | shrug | sad
    const c = $('#coach'), b = $('#cbub'); if (!c) return; const L = COACH_LINES[kind], line = L[Math.floor(Math.random() * L.length)];
    c.className = 'coach ' + mood; b.textContent = line; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    clearTimeout(coachT); coachT = setTimeout(() => { if (c.isConnected) c.className = 'coach idle'; }, hold);
  }
  stopFns.push(() => clearTimeout(coachT)); setTimeout(() => coachSay('hello', 'idle', 6000), 300);
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
    setTimeout(() => coachSay({ blackjack: 'natural', win: 'win', push: 'push', lose: 'lose', bust: 'bust' }[r.result], { blackjack: 'shock', win: 'sad', push: 'shrug', lose: 'smug', bust: 'smug' }[r.result], 4500), calm ? 0 : 450);
  }
  const a = (await api('GET', '/arcade/active?game=bj')).round; if (my !== nav) return;
  if (a) { v = a; $('#res').textContent = 'Hand restored'; }
  const step = path => act(async () => { coachSay({ hit: 'hit', stand: 'stand', double: 'dbl' }[path], path === 'double' ? 'smug' : 'think', 2600); const r = await api('POST', '/arcade/bj/' + path); if (!root.isConnected) return setBal(r.balance); if (r.done) done(r); else { v = r; paint(); } });
  $('#deal').onclick = act(async () => { $('#res').textContent = ''; coachSay('deal', 'deal', 2400); const r = await api('POST', '/arcade/bj/start', { bet: readBet() }); v = null; paint(true); if (r.done) { await wait(calm ? 0 : 300); if (!root.isConnected) return setBal(r.balance); done(r); } else { v = r; setBal(r.balance); paint(); } });
  $('#hit').onclick = step('hit'); $('#stand').onclick = step('stand'); $('#dbl').onclick = step('double'); $('#deal2').onclick = () => $('#deal').click();
  paint();
}

/* ---------- bank ---------- */
async function renderBank(my) {
  const m = await api('GET', '/me'); if (my !== nav) return; U = m.user; showBal();
  const broke = U.balance < 100, wait = Math.ceil(U.nextClaim / 60e3);
  $('#app').innerHTML = `<h1>Hawk Bank</h1><div class="panel bank"><img class="bank-logo" src="logo.svg" alt="">
    <div class="bigbal"><small>Your balance</small><b id="bb">${fmt(U.balance)}</b><span>Hawk Bucks</span></div>
    ${broke && U.canClaim ? '<button class="btn gold bjbig" id="claim">🆘 Get 1,000 Hawk Bucks</button>' : `<div class="bankshut">${broke ? `⏳ The Bank refills once an hour. Come back in <b>${wait} min</b>.` : '🔒 The Bank only opens when you\'re <b>broke</b> (under 100 Hawk Bucks).'}</div>`}
    <div class="note">The Bank is a safety net: when you're under 100 Hawk Bucks it gives you 1,000, once an hour. Want more? Win it in the <a href="#arcade">Arcade</a>, finish <a href="#rewards">daily challenges</a>, or spin the daily wheel. Hawk Bucks are pretend: no real money, no cash value.</div></div>`;
  if ($('#claim')) $('#claim').onclick = act(async () => { const r = await api('POST', '/bank'); setBal(r.balance); $('#bb').textContent = fmt(r.balance); fx.bump($('#bb')); sfx.play('cash'); fx.burst(120); toast('+1,000 Hawk Bucks'); renderBank(nav); });
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
const skillBet = id => SCHOOL() ? `<div class="tiers" aria-label="Hawk Bucks by score">${CFG.skillTiers[id].map(([min, m]) => `<span>${fmt(min)}+ <b>+${Math.round(SCHOOLR.each * m)} 🪙</b></span>`).join('')}</div>
  <div class="duo"><button class="btn bjbig" id="start">▶ Play <kbd>Space</kbd></button></div>
  <div class="note">Your score earns Hawk Bucks (up to ${fmt(SCHOOLR.cap)} a day). Scores go on the top-scores board and count toward challenges and achievements.</div>` : `${betBox()}<div class="tiers" aria-label="Payout by score">${CFG.skillTiers[id].map(([min, m]) => `<span>${fmt(min)}+ <b>${m}x</b></span>`).join('')}<span>lower <b>0</b></span></div>
  <div class="duo"><button class="btn" id="start">🪙 Play for Hawk Bucks</button><button class="btn alt" id="practice">Practice (free)</button></div>
  <div class="note">Your score sets the payout, and luck doesn't apply here. Starting over or leaving a paid game early forfeits the bet.</div>`;
const lockStart = on => { $('#start').disabled = on; const p = $('#practice'); if (p) p.disabled = on; };
function skillDone(id, r, great) {
  STATS.best[id] = { score: r.best }; paintPB(); lastRes = null;
  if (r.reward) { setBal(r.balance); $('#res').insertAdjacentHTML('beforeend', ` <span class="win">· +${fmt(r.reward)} 🪙 Hawk Bucks</span>`); }
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
function skillButtons(begin) { $('#start').onclick = () => begin(SCHOOL() ? 0 : readBet())(); if ($('#practice')) $('#practice').onclick = () => begin(0)(); }

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

/* Timing: Free Throw Line, NBA 2K style. A vertical shot meter fills up; let go inside the green window. The server runs the meter clock. */
const BALL_SVG = `<svg viewBox="0 0 40 40" aria-hidden="true"><defs><radialGradient id="bbg" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#ffb877"/><stop offset=".55" stop-color="#e8641a"/><stop offset="1" stop-color="#7a2400"/></radialGradient></defs><circle cx="20" cy="20" r="18.6" fill="url(#bbg)" stroke="#3d1100" stroke-width="1.3"/><path d="M20 1.5V38.5M1.5 20H38.5M6.2 7.6Q20 20 6.2 32.4M33.8 7.6Q20 20 33.8 32.4" fill="none" stroke="#2f0d00" stroke-width="1.4"/><ellipse cx="13" cy="11" rx="6.4" ry="3.4" fill="#fff" opacity=".4" transform="rotate(-35 13 11)"/></svg>`;
const ARENA_SVG = `<svg viewBox="0 0 400 260" preserveAspectRatio="none" aria-hidden="true" class="cscene"><defs>
  <linearGradient id="aw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05081c"/><stop offset="1" stop-color="#101c4a"/></linearGradient>
  <linearGradient id="af" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e0a259"/><stop offset=".5" stop-color="#c98a45"/><stop offset="1" stop-color="#8a5622"/></linearGradient>
  <linearGradient id="ab" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="agl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="jg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#19e58a"/><stop offset="1" stop-color="#0a8f4e"/></linearGradient>
  <linearGradient id="ajt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1230"/><stop offset="1" stop-color="#050810"/></linearGradient></defs>
  <rect width="400" height="260" fill="url(#aw)"/>
  <g class="beams"><path d="M40 0L90 150L10 150Z"/><path d="M130 0L200 150L110 150Z"/><path d="M270 0L340 150L240 150Z"/><path d="M360 0L420 150L330 150Z"/></g>
  <g class="banners">${[['STATE', '2024', 30], ['STATE', '2025', 76], ['REGION', '2025', 322], ['DISTRICT', '2025', 366]].map(([a, b, x]) => `<path d="M${x - 15} 0h30v54l-15 -10l-15 10z" fill="#1b4fd8" stroke="#fff" stroke-width="1.5"/><text x="${x}" y="22" text-anchor="middle" font-size="7" font-weight="900" fill="#fff">${a}</text><text x="${x}" y="33" text-anchor="middle" font-size="9" font-weight="900" fill="#ffc542">${b}</text>`).join('')}</g>
  <g class="stands"><path d="M0 70H400V150H0Z" fill="#0b1236"/><path d="M0 90H400M0 112H400M0 132H400" stroke="#1d2a5e" stroke-width="2"/></g>
  <g class="crowd">${Array.from({ length: 52 }, (_, i) => { const r = i % 3, x = 8 + (i * 7.7) % 386, y = 80 + r * 21 + (i % 2) * 3; return `<circle cx="${x.toFixed(1)}" cy="${y}" r="4.6" fill="${['#3b6bff', '#19e58a', '#ffc542', '#ff7a8a', '#d6e0ff'][i % 5]}" opacity=".88" style="animation-delay:${(i % 9) * 35}ms"/>`; }).join('')}</g>
  <g class="jumbo"><rect x="132" y="6" width="136" height="50" rx="7" fill="url(#ajt)" stroke="#3a4c90" stroke-width="2"/><text x="200" y="19" text-anchor="middle" font-size="8" font-weight="900" letter-spacing="2" fill="#8fb0ff">SEAHAWKS</text><text id="jtS" x="168" y="46" text-anchor="middle" font-size="24" font-weight="900" fill="#ffb21a" font-family="ui-monospace,Menlo,monospace">0</text><text id="jtN" x="238" y="40" text-anchor="middle" font-size="11" font-weight="900" fill="#fff" font-family="ui-monospace,Menlo,monospace">SHOT 1/10</text><image href="logo.svg" x="192" y="22" width="16" height="16"/></g>
  <rect y="150" width="400" height="110" fill="url(#af)"/>${Array.from({ length: 11 }, (_, i) => `<path d="M${i * 40} 150L${-120 + i * 64} 260" stroke="#00000020" stroke-width="2"/>`).join('')}
  <path d="M170 150H350L392 260H150Z" fill="#1b4fd8" opacity=".55" stroke="#fff" stroke-width="2.4"/><ellipse cx="260" cy="204" rx="62" ry="15" fill="none" stroke="#fff" stroke-width="2.2" opacity=".85"/><image href="logo.svg" x="241" y="190" width="38" height="28" opacity=".85"/>
  <path d="M148 150L128 260" stroke="#fff" stroke-width="3.2"/>
  <rect y="150" width="400" height="110" fill="url(#agl)"/>
  <g class="supp"><rect x="292" y="104" width="7" height="60" rx="2" fill="#2a3a6a"/><rect x="294" y="164" width="3" height="44" fill="#1d2a5e"/></g>
  <g class="bboard"><rect x="289" y="54" width="9" height="62" rx="2" fill="#fff" stroke="#c9cfe8" stroke-width="2"/><rect x="286" y="76" width="4" height="22" fill="#e8461a"/></g>
  <g class="rimg"><path d="M246 109H290" stroke="#ff5a1a" stroke-width="5" stroke-linecap="round"/><ellipse cx="268" cy="109" rx="22" ry="4.5" fill="none" stroke="#ff7a3c" stroke-width="2" opacity=".7"/></g>
  <g class="netg" id="net" style="transform-origin:268px 111px"><path d="M248 111L255 144M258 113L262 146M268 114V147M278 113L274 146M288 111L281 144M250 124H286M254 135H282" fill="none" stroke="#fff" stroke-width="1.5" opacity=".85"/></g>
  <g id="shooter" class="shooter"><ellipse cx="92" cy="231" rx="34" ry="6.5" fill="#0007"/><g transform="translate(92 231) scale(1.3) translate(-92 -231)">
    <g class="legs"><path d="M85 214v12M99 214v12" stroke="#f5a623" stroke-width="5" stroke-linecap="round"/><path d="M79 230q6-7 13 0v3H79zM93 230q6-7 13 0v3H93z" fill="#fff" stroke="#1b4fd8" stroke-width="1.6"/><rect x="79" y="231" width="13" height="3" rx="1.5" fill="#19e58a"/><rect x="93" y="231" width="13" height="3" rx="1.5" fill="#19e58a"/></g>
    <path d="M74 205h36l3 14H71z" fill="#1b4fd8" stroke="#fff" stroke-width="1.5"/><path d="M92 206v12" stroke="#ffffff55" stroke-width="1.5"/>
    <g class="wingback"><path d="M76 186q-13 12-7 27q9-8 9-23z" fill="#0b2a6b" stroke="#1b4fd8" stroke-width="1"/></g>
    <g class="torso"><path d="M75 182q17-9 34 0l2 24H73z" fill="url(#jg)" stroke="#fff" stroke-width="1.6"/><path d="M82 181q10 7 20 0" fill="none" stroke="#fff" stroke-width="2"/><text x="92" y="200" text-anchor="middle" font-size="12" font-weight="900" fill="#fff" stroke="#0b2a6b" stroke-width=".7">23</text></g>
    <g class="wingup"><path d="M105 186q11-4 17-14q2-4 6-3q1 5-2 9q-6 12-19 14z" fill="#1b4fd8" stroke="#0b2a6b" stroke-width="1.4"/><path d="M122 172l5-6M126 176l6-3" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g>
    <circle cx="92" cy="166" r="14" fill="#fff"/><path d="M78 164q14-15 28 0z" fill="#0b2a6b"/><path d="M78 162h28v4H78z" fill="#e8461a"/><path d="M104 168l11 4-11 4z" fill="#ffc542" stroke="#b26b00" stroke-width="1"/><circle cx="99" cy="167" r="2.8" fill="#ffd24a"/><circle cx="99.7" cy="167" r="1.4" fill="#0a0e13"/>
  </g></g></svg>`;
async function hoops(root) {
  let st = null, s0 = 0, period = 1700, zone = 0.17, center = 0.8, frozen = false, timer = 0, busy = false, streak = 0, total = 0, lat = 0;
  root.innerHTML = gameShell(`<div class="note" style="margin-top:0"><b>How to play:</b> 10 shots, NBA 2K style. A shot meter fills and drains: tap <b>SHOOT</b> (or press Space) when it's in the <b style="color:#19e58a">green window</b> near the top. Dead center is a perfect green (150). Makes in a row add a streak bonus, but the window shrinks and the meter speeds up.</div>
    ${skillBet('hoops')}<div class="stats"><div><small>Score</small><b id="sc">0</b></div><div><small>Shot</small><b id="sn">–</b></div></div>${hsBox()}`,
    `<div class="hoopsw"><div class="court" id="court">${ARENA_SVG}<div class="vmeter" id="vmeter"><i class="vzone" id="vz"><i class="vperf" id="vp"></i></i><i class="vfill" id="vf"></i><i class="vmark" id="vm"></i><b class="vlabel" id="vl"></b></div>
      <div class="hshadow" id="hsh"></div><div class="hball" id="hball"><i class="flame">🔥</i><div class="bb">${BALL_SVG}</div></div><div class="hpop" id="hpop"></div><div class="hsub" id="hsub"></div><div class="hflash" id="hflash"></div></div>
      <button class="btn bjbig shootbtn" id="shoot" disabled>🏀 SHOOT <kbd>Space</kbd></button><div class="pips" id="pips">${'<i></i>'.repeat(10)}</div></div>`);
  const court = $('#court'), ball = $('#hball'), shoot = $('#shoot'), net = $('#net'), vmeter = $('#vmeter'), vf = $('#vf'), vm = $('#vm'), vz = $('#vz'), vp = $('#vp'), vl = $('#vl'), hsh = $('#hsh'), shooter = $('#shooter');
  const tri = el => { const ph = (((el % period) + period) % period) / period; return ph < 0.5 ? ph * 2 : 2 - ph * 2; };
  const paintZone = () => { const lo = center - zone, hi = Math.min(1, center + zone); vz.style.bottom = lo * 100 + '%'; vz.style.height = (hi - lo) * 100 + '%'; vp.style.height = (zone / 3 * 2 / (hi - lo)) * 100 + '%'; };
  const place = pos => { vf.style.transform = `scaleY(${Math.max(0.001, pos)})`; vm.style.bottom = pos * 100 + '%'; };
  const T = (x, y, sc, rot) => `translate(${x}px,${y}px) translate(-50%,-50%) scale(${sc}) rotate(${rot}deg)`;
  const size = () => { const cw = court.clientWidth; ball.style.fontSize = cw * 0.085 + 'px'; return cw; };
  const rest = () => { const cw = size(), ch = court.clientHeight; ball.getAnimations().forEach(a => a.cancel()); ball.style.transform = T(cw * 0.345, ch * 0.59, 1, 0); hsh.getAnimations().forEach(a => a.cancel()); hsh.style.opacity = 0; ball.classList.toggle('fire', streak >= 3); };
  function loop() { clearTimeout(timer); if (!root.isConnected || !st) return; if (!frozen) place(tri(performance.now() - s0)); timer = setTimeout(loop, 16); }
  stopFns.push(() => clearTimeout(timer)); paintZone(); place(0.4); setTimeout(rest, 0);
  const ro = new ResizeObserver(() => { if (!ball.getAnimations().length) rest(); }); ro.observe(court); stopFns.push(() => ro.disconnect());
  const pop = (txt, cls) => { const p = $('#hpop'); p.textContent = txt; p.className = 'hpop'; void p.offsetWidth; p.className = 'hpop show ' + cls; };
  const sub = txt => { const p = $('#hsub'); p.textContent = txt; p.className = 'hsub'; void p.offsetWidth; p.className = 'hsub show'; };
  const flash = cls => { const f = $('#hflash'); f.className = 'hflash'; void f.offsetWidth; f.className = 'hflash ' + cls; };
  const bump = (el, cls, ms) => { el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };
  function animShot(r) {
    const cw = size(), ch = court.clientHeight, X = f => f * cw, Y = f => f * ch, x0 = X(.345), y0 = Y(.59);
    const frames = r.hit
      ? [{ transform: T(x0, y0, 1, 0), offset: 0 }, { transform: T(x0 + X(.01), y0 - Y(.04), 1, 40), offset: .13 }, { transform: T(X(.47), Y(.12), .74, 330), offset: .5, easing: 'ease-in' }, { transform: T(X(.675), Y(.405), .62, 520), offset: .7 }, { transform: T(X(.675), Y(.54), .6, 560), offset: .8 }, { transform: T(X(.69), Y(.88), .85, 640), offset: 1 }]
      : [{ transform: T(x0, y0, 1, 0), offset: 0 }, { transform: T(x0 + X(.01), y0 - Y(.04), 1, 40), offset: .13 }, { transform: T(X(.48), Y(.12), .76, 300), offset: .5, easing: 'ease-in' }, { transform: T(X(.705), Y(.39), .66, 430), offset: .68 }, { transform: T(X(.8), Y(.58), .74, 560), offset: .82 }, { transform: T(X(.9), Y(.88), .85, 760), offset: 1 }];
    const dur = calm ? 200 : 1200; ball.animate(frames, { duration: dur, fill: 'forwards', easing: 'linear' });
    hsh.style.opacity = .5; hsh.animate([{ transform: `translate(${x0}px,${Y(.86)}px) translate(-50%,-50%) scale(1)`, opacity: .5 }, { transform: `translate(${X(.5)}px,${Y(.86)}px) translate(-50%,-50%) scale(.6)`, opacity: .2, offset: .5 }, { transform: `translate(${X(r.hit ? .69 : .9)}px,${Y(.86)}px) translate(-50%,-50%) scale(1)`, opacity: .5 }], { duration: dur, fill: 'forwards' });
    bump(shooter, 'jump', 420);
    setTimeout(() => { if (!root.isConnected) return; if (r.hit) { bump(shooter, 'fist', 700); bump(net, 'swish', 700); sfx.play('swish'); if (r.perfect) bump(court.querySelector('.bboard'), 'bflash', 500); } else { bump(shooter, 'shake', 500); bump(court.querySelector('.rimg'), 'rimhit', 500); sfx.play('rim'); setTimeout(() => sfx.play('brick'), 230); } }, calm ? 0 : 820);
  }
  function release(r) { // 2K-style timing read-out: GREEN when it goes in, early/late otherwise
    if (r.hit) return [r.perfect ? 'PERFECT GREEN!' : 'GREEN!', r.perfect ? 'perfect' : 'green', r.perfect ? 'Perfect release' : 'Good release'];
    if (r.stalled) return ['SHOT CLOCK', 'bad', 'Too slow'];
    const d = Math.abs(r.pos - r.center), way = r.pos < r.center ? 'early' : 'late', how = d <= r.zone * 1.8 ? 'Slightly' : 'Very';
    return [way === 'early' ? 'EARLY' : 'LATE', 'bad', `${how} ${way}`];
  }
  // The server starts its copy of the meter the moment it hears 'ready'. We start ours at the midpoint of that round trip, so both match, and we tell the server our one-way delay when we shoot.
  async function begin(r, send, first) {
    period = r.period; zone = r.zone; center = r.nextCenter ?? r.center; paintZone(); vl.textContent = ''; vmeter.classList.remove('green', 'miss'); rest(); place(0.0);
    if (!first) { for (let i = 0; i < 3 && root.isConnected && st; i++) { const t1 = performance.now(); try { const k = await api('POST', '/arcade/hoops/ready'); const t2 = performance.now(); send = t1; lat = (t2 - t1) / 2; period = k.period; zone = k.zone; center = k.center; paintZone(); s0 = (t1 + t2) / 2; break; } catch (e) { if (i === 2) { toast(e.message); return; } await wait(200); } } }
    else { const t2 = performance.now(); lat = (t2 - send) / 2; s0 = (send + t2) / 2; }
    if (!root.isConnected || !st) return; frozen = false; shoot.disabled = false;
  }
  const nextShot = r => begin(r, 0, false);
  async function fire() {
    if (!st || busy || frozen) return; busy = true; frozen = true; shoot.disabled = true; sfx.play('whoosh');
    try {
      const r = await api('POST', '/arcade/hoops/shoot', { lat: Math.round(lat) }); if (!root.isConnected) return;
      place(r.pos); streak = r.streak; total = r.score; const pip = $('#pips').children[r.shot - 1], [word, cls, detail] = release(r); animShot(r);
      vl.textContent = word.replace('PERFECT ', ''); vmeter.classList.add(r.hit ? 'green' : 'miss'); sub(detail);
      await wait(calm ? 100 : 820); if (!root.isConnected) return;
      if (r.hit) { pip.classList.add('on'); flash('g'); court.querySelector('.crowd').classList.add('cheer'); setTimeout(() => court.querySelector('.crowd').classList.remove('cheer'), 1100); sfx.play('green'); setTimeout(() => sfx.play(r.perfect ? 'roar' : 'cheer'), 150); pop(word, cls); resMsg(true, `${word} +${r.pts}`); if (r.perfect) fx.burst(70); if (r.streak >= 3) streakFx(r.streak); }
      else { pip.classList.add('bad'); flash('r'); pop(word, 'bad'); resMsg(false, detail); }
      $('#jtN').textContent = `SHOT ${Math.min(r.shot + 1, 10)}/10`; $('#jtS').textContent = r.score; $('#sn').textContent = `${Math.min(r.shot + 1, 10)} / 10`; countUp($('#sc'), r.score, 300);
      await wait(calm ? 300 : 900); if (!root.isConnected) return;
      if (r.done) { st = null; clearTimeout(timer); lockStart(false); rest(); resMsg(true, `${r.makes}/10 green · ${fmt(r.score)} pts`); skillDone('hoops', r, r.makes >= 7); }
      else { busy = false; await nextShot(r); }
    } catch (e) { toast(e.message); frozen = false; shoot.disabled = false; } finally { busy = false; }
  }
  shoot.onclick = fire;
  skillButtons(bet => act(async () => {
    const sent = 0, r = await api('POST', '/arcade/hoops/start', { bet }); if (r.bet) setBal(r.balance); st = {}; streak = 0; lockStart(true); $('#sc').textContent = '0'; $('#jtS').textContent = '0'; $('#jtN').textContent = 'SHOT 1/10'; $('#sn').textContent = '1 / 10'; $('#res').textContent = '';
    [...$('#pips').children].forEach(i => i.className = ''); center = r.center; await begin({ period: r.period, zone: r.zone, center: r.center }, sent, false); loop();
  }));
  loadHS('hoops');
}

/* Math: Mental Math Sprint */
async function math(root) {
  let st = null, endT = 0, ending = false, tickT = 0, secs = 60, t0 = 0;
  const syms = ['+', '−', '×', '÷', '=', 'π', '√', '%', '²', '∑', '∞', '7', '3', '9'];
  root.innerHTML = gameShell(`<div class="note" style="margin-top:0"><b>How to play:</b> 60 seconds, as many problems as you can. 100 points for each right answer, plus up to 40 for speed and a combo bonus for answering right in a row. Problems get harder as you go. Press Enter to answer.</div>
    ${skillBet('math')}<div class="stats"><div><small>Score</small><b id="sc">0</b></div><div><small>Right</small><b id="mr">0</b></div></div>${hsBox()}`,
    `<div class="mq chalk" id="mq"><div class="msyms" aria-hidden="true">${syms.map((ch, i) => `<i style="left:${(i * 37) % 94}%;top:${(i * 53) % 86}%;animation-delay:${-(i % 7) * 1.1}s;font-size:${22 + (i % 4) * 10}px">${ch}</i>`).join('')}</div>
      <div class="mtimer" id="mtimer"><i id="mt"></i></div><div class="msecs" id="msecs">60</div>
      <div class="mflame"><div class="mfbar"><i id="mfl"></i></div><span id="mc"></span></div>
      <div class="mbig" id="mqq"><span>R</span><span>e</span><span>a</span><span>d</span><span>y</span><span>?</span></div>
      <div class="mrow"><input id="mans" inputmode="numeric" autocomplete="off" aria-label="Your answer" placeholder="?" disabled><button class="btn" id="msub" disabled>Answer ↵</button></div><div class="mfb" id="mfb"></div></div>`);
  stopFns.push(() => { clearTimeout(endT); clearInterval(tickT); });
  const ans = $('#mans'), sub = $('#msub'), mq = $('#mq'), big = $('#mqq');
  const setQ = q => { big.innerHTML = [...(q + ' = ?')].map((ch, i) => ch === ' ' ? '<s></s>' : `<span style="animation-delay:${i * 32}ms">${ch}</span>`).join(''); ans.value = ''; ans.focus(); };
  const shake = () => { mq.classList.remove('wrong'); void mq.offsetWidth; mq.classList.add('wrong'); setTimeout(() => mq.classList.remove('wrong'), 450); };
  function fly(text, good) { // the answer's points float up from the problem
    const r = big.getBoundingClientRect(), e = document.createElement('i'); e.className = 'flynum ' + (good ? 'good' : 'bad'); e.textContent = text; e.style.left = r.left + r.width / 2 + 'px'; e.style.top = r.top + r.height / 2 + 'px'; document.body.appendChild(e);
    e.animate([{ transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 }, { transform: 'translate(-50%,-90%) scale(1.3)', opacity: 1, offset: .25 }, { transform: 'translate(-50%,-260%) scale(1)', opacity: 0 }], { duration: 900, easing: 'ease-out' }).onfinish = () => e.remove();
    if (good) fx.burst(26, r.left + r.width / 2, r.top + r.height / 2);
  }
  function finish(r) {
    if (!st) return; st = null; clearTimeout(endT); clearInterval(tickT); ans.disabled = sub.disabled = true; $('#mtimer').classList.remove('hot'); big.innerHTML = `<span class="done">Time! ${fmt(r.score)}</span>`; lockStart(false); sfx.play('clear');
    resMsg(true, `${r.right} right · best combo ${r.bestCombo} · ${fmt(r.score)} pts`); skillDone('math', r, r.right >= 20);
  }
  async function submit() {
    if (!st || ending) return; const v = ans.value.trim(); if (!/^-?\d+$/.test(v)) return; sub.disabled = true;
    try {
      const r = await api('POST', '/arcade/math/answer', { answer: parseInt(v, 10) }); if (!root.isConnected || !st) return;
      if (r.done) return finish(r);
      const fb = $('#mfb'); fb.className = 'mfb ' + (r.right ? 'good' : 'bad'); fb.textContent = r.right ? `+${r.pts}` : `✗ the answer was ${r.answer}`;
      if (r.right) { sfx.play(r.combo >= 5 ? 'streak' : 'reveal'); fly(`+${r.pts}`, true); fx.bump(big); } else { sfx.play('miss'); shake(); fly(`${r.answer}`, false); }
      countUp($('#sc'), r.score, 250); $('#mr').textContent = r.rightCount; $('#mc').textContent = r.combo >= 2 ? `🔥 ×${r.combo}` : ''; $('#mfl').style.width = Math.min(100, r.combo * 10) + '%'; $('#mfl').classList.toggle('max', r.combo >= 10); setQ(r.q);
    } catch (e) { toast(e.message); } finally { if (st) sub.disabled = false; }
  }
  sub.onclick = submit; ans.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
  skillButtons(bet => act(async () => {
    const r = await api('POST', '/arcade/math/start', { bet }); if (r.bet) setBal(r.balance); st = {}; ending = false; secs = r.secs; t0 = performance.now(); lockStart(true); ans.disabled = sub.disabled = false;
    $('#sc').textContent = '0'; $('#mr').textContent = '0'; $('#mc').textContent = ''; $('#mfl').style.width = '0%'; $('#mfb').textContent = ''; $('#res').textContent = ''; setQ(r.q);
    const bar = $('#mt'); bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth; bar.style.transition = `width ${r.secs}s linear`; bar.style.width = '0%';
    clearInterval(tickT); let lastSec = 99; tickT = setInterval(() => { if (!root.isConnected || !st) return clearInterval(tickT); const left = Math.max(0, secs - (performance.now() - t0) / 1000), sec = Math.ceil(left); $('#msecs').textContent = sec;
      $('#mtimer').classList.toggle('hot', left <= 10); if (sec !== lastSec) { lastSec = sec; if (sec <= 5 && sec > 0) { sfx.play('tick'); mq.classList.add('buzz'); setTimeout(() => mq.classList.remove('buzz'), 180); } } }, 100);
    clearTimeout(endT); endT = setTimeout(async () => { if (!st) return; ending = true; try { finish(await api('POST', '/arcade/math/end')); } catch (e) { toast(e.message); ending = false; } }, r.secs * 1000 + 300);
  }));
  loadHS('math');
}

/* Rhythm memory: Marching Band */
const BAND_PADS = [['#1b4fd8', 'Blue'], ['#12c26a', 'Green'], ['#f5b800', 'Gold'], ['#e8ecf5', 'White']];
const drumSvg = k => `<svg viewBox="0 0 200 190" class="drum" aria-hidden="true"><defs><linearGradient id="dsh" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset=".3" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient><linearGradient id="dhd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#cfd6e6"/></linearGradient></defs>
  <ellipse cx="100" cy="176" rx="70" ry="9" fill="#000" opacity=".35"/>
  <path d="M18 76v68q0 32 82 32t82-32V76z" style="fill:var(--pc)"/><path d="M18 76v68q0 32 82 32t82-32V76z" fill="url(#dsh)"/>
  <path d="M30 92L52 158M70 100L84 172M100 104V176M130 100L116 172M170 92L148 158" stroke="#fff" stroke-width="3.5" opacity=".55" fill="none" stroke-linecap="round"/>
  <ellipse cx="100" cy="146" rx="82" ry="30" fill="none" stroke="#c8cfdd" stroke-width="6" clip-path="inset(50% 0 0 0)"/>
  <ellipse cx="100" cy="76" rx="82" ry="34" fill="url(#dhd)"/><ellipse class="hl" cx="100" cy="76" rx="76" ry="30" style="fill:var(--pc)"/>
  <ellipse cx="100" cy="76" rx="82" ry="34" fill="none" stroke="#e6eaf3" stroke-width="7"/><ellipse cx="100" cy="76" rx="82" ry="34" fill="none" stroke="#7d869c" stroke-width="1.5"/>
  <image href="logo.svg" x="78" y="56" width="44" height="40" opacity=".92"/></svg>`;
async function band(root) {
  let st = null, playing = false, busy = false, tok = 0, plen = 0, done = 0;
  root.innerHTML = gameShell(`<div class="note" style="margin-top:0"><b>How to play:</b> watch the drums light up, then play the pattern back (click, or keys 1–4). Every round adds one beat, and the faster you go the better. Finishing a round of length n scores 50 + 30 × n.</div>
    ${skillBet('band')}<div class="stats"><div><small>Score</small><b id="sc">0</b></div><div><small>Pattern</small><b id="bl">–</b></div></div>${hsBox()}`,
    `<div class="bandw"><div class="bandstage" id="bstage"><div class="beams" aria-hidden="true"><i></i><i></i><i></i></div><div class="bflash" id="bfl"></div>
      <div class="beads" id="beads" aria-label="Pattern progress"></div>
      <div class="bandgrid" id="bg">${BAND_PADS.map(([c, n], k) => `<button class="bpad" data-pad="${k}" style="--pc:${c}" disabled aria-label="${n} drum, key ${k + 1}">${drumSvg(k)}<i class="ring"></i><i class="stk l"></i><i class="stk r"></i><b class="pn">${k + 1}</b></button>`).join('')}</div>
      <div class="bandmsg" id="bm">Press Play 🥁</div></div></div>`);
  const pads = [...root.querySelectorAll('.bpad')], stage = $('#bstage');
  const msg = (t, cls = '') => { const m = $('#bm'); m.textContent = t; m.className = 'bandmsg ' + cls; void m.offsetWidth; m.classList.add('pop'); };
  stopFns.push(() => { tok++; });
  const beads = n => { plen = n; $('#beads').innerHTML = Array.from({ length: n }, () => '<i></i>').join(''); };
  const bead = (i, c) => { const b = $('#beads').children[i]; if (b) { b.style.setProperty('--bc', c); b.className = 'on'; } };
  function sparks(k) {
    if (calm) return; const p = pads[k], r = p.getBoundingClientRect(), c = BAND_PADS[k][0];
    for (let i = 0; i < 9; i++) { const e = document.createElement('i'); e.className = 'spk'; e.style.background = c; p.appendChild(e); const a = Math.random() * Math.PI - Math.PI, d = 40 + Math.random() * 60;
      e.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px),calc(-50% + ${Math.sin(a) * d - 20}px)) scale(0)`, opacity: 0 }], { duration: 480 + Math.random() * 200, easing: 'ease-out' }).onfinish = () => e.remove(); }
  }
  const hit = k => { const p = pads[k]; p.classList.remove('lit'); void p.offsetWidth; p.classList.add('lit'); sfx.play('pad' + k); sparks(k); stage.classList.remove('beat'); void stage.offsetWidth; stage.classList.add('beat'); setTimeout(() => p.classList.remove('lit'), 170); };
  async function playback(seq) {
    const me = ++tok; playing = true; pads.forEach(p => p.disabled = true); beads(seq.length); done = 0; msg('Watch…', 'dim'); await wait(calm ? 250 : 650);
    const step = Math.max(240, 480 - seq.length * 14);
    for (let i = 0; i < seq.length; i++) { if (me !== tok || !root.isConnected) return; hit(seq[i]); bead(i, BAND_PADS[seq[i]][0]); await wait(step); }
    if (me !== tok) return; playing = false; pads.forEach(p => p.disabled = false); $('#beads').querySelectorAll('i').forEach(b => b.className = ''); msg('Your turn!', 'go');
  }
  async function press(k) {
    if (!st || playing || busy) return; busy = true; hit(k);
    try {
      const r = await api('POST', '/arcade/band/press', { pad: k }); if (!root.isConnected) return;
      if (!r.ok) {
        st = null; tok++; pads.forEach(p => { p.disabled = true; }); sfx.play('miss'); fx.lose(); stage.classList.remove('shake', 'redflash'); void stage.offsetWidth; stage.classList.add('shake', 'redflash'); setTimeout(() => stage.classList.remove('shake', 'redflash'), 600);
        let n = 0; const blink = setInterval(() => { pads[r.expected].classList.toggle('hint'); if (++n > 5) { clearInterval(blink); pads[r.expected].classList.remove('hint'); } }, 220);
        msg(r.late ? 'Too slow!' : 'Wrong drum!', 'bad'); lockStart(false); resMsg(true, `Cleared ${r.length} round${r.length === 1 ? '' : 's'} · missed a pattern of ${r.length + 1} · ${fmt(r.score)} pts`); skillDone('band', r, r.length >= 8); return;
      }
      if (r.perfect) { st = null; msg('PERFECT!', 'gold'); sfx.play('roar'); fx.burst(200); lockStart(false); resMsg(true, `All 20 rounds! ${fmt(r.score)} pts`); skillDone('band', r, true); return; }
      if (r.round) { bead(plen - 1, BAND_PADS[k][0]); countUp($('#sc'), r.score, 300); $('#bl').textContent = r.show.length; sfx.play('clear'); fx.burst(24 + r.round * 4, innerWidth / 2, innerHeight / 3); fx.bump($('#bl')); msg(`Round ${r.round} cleared!`, 'gold'); if (r.round % 4 === 0) sfx.play('cheer'); await wait(calm ? 200 : 900); if (root.isConnected && st) playback(r.show); }
      else { bead(done++, BAND_PADS[k][0]); }
    } catch (e) { toast(e.message); } finally { busy = false; }
  }
  $('#bg').onclick = e => { const b = e.target.closest('.bpad'); if (b && !b.disabled) press(+b.dataset.pad); };
  const keys = e => { if (!root.isConnected) return; if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return; const k = ['1', '2', '3', '4'].indexOf(e.key); if (k >= 0 && !e.repeat) { e.preventDefault(); if (!pads[k].disabled) press(k); } };
  document.addEventListener('keydown', keys); stopFns.push(() => document.removeEventListener('keydown', keys));
  skillButtons(bet => act(async () => {
    const r = await api('POST', '/arcade/band/start', { bet }); if (r.bet) setBal(r.balance); st = {}; lockStart(true); $('#sc').textContent = '0'; $('#bl').textContent = '1'; $('#res').textContent = ''; playback(r.show);
  }));
  loadHS('band');
}

/* Action: Hallway Dash. A perspective hallway drawn on canvas. The server builds the hallway; we run it, then send our lane changes to be replayed and checked. */
function rrPath(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function dashBag(c, x, y, sz, a, b) { // a backpack standing in the hallway
  const w = sz * .8, h = sz * .95; c.save(); c.translate(x, y);
  c.fillStyle = '#0007'; c.beginPath(); c.ellipse(0, 0, w * .66, sz * .13, 0, 0, 7); c.fill();
  c.strokeStyle = b; c.lineWidth = sz * .07; c.beginPath(); c.arc(0, -h, w * .17, Math.PI, 0); c.stroke();
  const g = c.createLinearGradient(-w / 2, -h, w / 2, 0); g.addColorStop(0, a); g.addColorStop(1, b); c.fillStyle = g; rrPath(c, -w / 2, -h, w, h, sz * .2); c.fill();
  c.fillStyle = 'rgba(0,0,0,.25)'; rrPath(c, -w * .36, -h * .56, w * .72, h * .42, sz * .1); c.fill(); c.strokeStyle = '#ffffff55'; c.lineWidth = Math.max(1, sz * .03); c.stroke();
  c.strokeStyle = '#ffd24a'; c.lineWidth = Math.max(1.5, sz * .04); c.beginPath(); c.moveTo(-w * .2, -h * .62); c.lineTo(w * .2, -h * .62); c.stroke(); c.fillStyle = '#ffd24a'; c.beginPath(); c.arc(w * .2, -h * .62, sz * .035, 0, 7); c.fill();
  c.fillStyle = 'rgba(255,255,255,.22)'; c.beginPath(); c.ellipse(-w * .22, -h * .8, w * .16, h * .1, -.5, 0, 7); c.fill(); c.restore();
}
function dashBucket(c, x, y, sz) { // mop bucket with a puddle
  c.save(); c.translate(x, y); c.fillStyle = 'rgba(90,170,255,.45)'; c.beginPath(); c.ellipse(sz * .05, 0, sz * .62, sz * .17, 0, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.ellipse(-sz * .1, -sz * .02, sz * .22, sz * .05, 0, 0, 7); c.fill();
  const w = sz * .55, h = sz * .62, g = c.createLinearGradient(-w, 0, w, 0); g.addColorStop(0, '#d89a00'); g.addColorStop(.5, '#ffe14a'); g.addColorStop(1, '#c78600');
  c.fillStyle = g; c.beginPath(); c.moveTo(-w * .62, -h); c.lineTo(w * .62, -h); c.lineTo(w * .46, 0); c.lineTo(-w * .46, 0); c.closePath(); c.fill();
  c.fillStyle = '#7a5200'; c.beginPath(); c.ellipse(0, -h, w * .62, sz * .08, 0, 0, 7); c.fill(); c.strokeStyle = '#999'; c.lineWidth = Math.max(1.5, sz * .04); c.beginPath(); c.arc(0, -h, w * .6, Math.PI, 0); c.stroke();
  c.fillStyle = '#e8461a'; c.fillRect(-w * .5, -h * .62, w, sz * .1); c.restore();
}
function dashBall(c, x, y, sz) { c.save(); c.translate(x, y); c.fillStyle = '#0007'; c.beginPath(); c.ellipse(0, 0, sz * .34, sz * .09, 0, 0, 7); c.fill(); const r = sz * .3, g = c.createRadialGradient(-r * .3, -sz * .5, r * .1, 0, -sz * .35, r * 1.1); g.addColorStop(0, '#ffb066'); g.addColorStop(1, '#c2410c');
  c.fillStyle = g; c.beginPath(); c.arc(0, -r, r, 0, 7); c.fill(); c.strokeStyle = '#3a1000'; c.lineWidth = Math.max(1, sz * .03); c.beginPath(); c.moveTo(-r, -r); c.lineTo(r, -r); c.moveTo(0, -r * 2); c.lineTo(0, 0); c.arc(-r * 1.05, -r, r * .85, -.9, .9); c.moveTo(r * .2, -r); c.arc(r * 1.05, -r, r * .85, Math.PI - .9, Math.PI + .9); c.stroke(); c.restore(); }
function dashMonitor(c, x, y, sz) { c.save(); c.translate(x, y); c.fillStyle = '#0007'; c.beginPath(); c.ellipse(0, 0, sz * .36, sz * .1, 0, 0, 7); c.fill();
  c.fillStyle = '#2a2f55'; c.fillRect(-sz * .2, -sz * .42, sz * .14, sz * .42); c.fillRect(sz * .06, -sz * .42, sz * .14, sz * .42); c.fillStyle = '#111'; c.fillRect(-sz * .22, -sz * .06, sz * .18, sz * .06); c.fillRect(sz * .04, -sz * .06, sz * .18, sz * .06);
  c.fillStyle = '#ffd24a'; rrPath(c, -sz * .3, -sz * .86, sz * .6, sz * .5, sz * .08); c.fill(); c.fillStyle = '#d6e0ff'; c.fillRect(-sz * .3, -sz * .66, sz * .6, sz * .07); c.fillRect(-sz * .3, -sz * .52, sz * .6, sz * .05);
  c.fillStyle = '#f0c8a0'; c.beginPath(); c.arc(0, -sz * 1.0, sz * .18, 0, 7); c.fill(); c.fillStyle = '#1b2a6b'; c.beginPath(); c.arc(0, -sz * 1.04, sz * .18, Math.PI, 0); c.fill(); c.fillRect(-sz * .26, -sz * 1.05, sz * .52, sz * .05);
  c.fillStyle = '#e8461a'; c.fillRect(-sz * .2, -sz * .72, sz * .4, sz * .02); c.restore(); }
function dashHawk(c, x, y, sz, phase, lean, dir, t, pose) { // the Seahawk, seen from behind with a backpack, legs and wings pumping
  const bob = -Math.abs(Math.sin(phase)) * sz * .05, tum = t || { rot: 0, sc: 1 };
  c.save(); c.translate(x, y); c.rotate(lean + tum.rot + (pose && pose.slide ? .35 * pose.slide : 0)); c.scale(tum.sc * (pose && pose.slide ? 1 + .12 * pose.slide : 1), tum.sc * (pose && pose.slide ? 1 - .5 * pose.slide : 1)); if (pose && pose.air) phase = 0.3;
  c.fillStyle = '#0007'; c.beginPath(); c.ellipse(0, 0, sz * .34, sz * .09, 0, 0, 7); c.fill();
  for (let i = 0; i < 2; i++) { const ph = phase + i * Math.PI, lx = (i ? 1 : -1) * sz * .14, fy = -Math.max(0, Math.sin(ph)) * sz * .13;
    c.strokeStyle = '#f5a623'; c.lineWidth = sz * .06; c.lineCap = 'round'; c.beginPath(); c.moveTo(lx, -sz * .22 + bob); c.lineTo(lx * 1.15, fy - sz * .04); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.ellipse(lx * 1.15, fy - sz * .03, sz * .12, sz * .06, 0, 0, 7); c.fill(); c.fillStyle = '#1b4fd8'; c.fillRect(lx * 1.15 - sz * .12, fy - sz * .035, sz * .24, sz * .025); }
  for (const a of [-.45, 0, .45]) { c.save(); c.translate(0, -sz * .22 + bob); c.rotate(a); c.fillStyle = a ? '#14308f' : '#0b2a6b'; c.beginPath(); c.ellipse(0, sz * .1, sz * .07, sz * .18, 0, 0, 7); c.fill(); c.restore(); }
  const flap = Math.sin(phase * 2) * .4; for (const sd of [-1, 1]) { c.save(); c.translate(sd * sz * .27, -sz * .52 + bob); c.rotate(sd * (.5 + flap)); const g = c.createLinearGradient(0, -sz * .2, 0, sz * .3); g.addColorStop(0, '#2a5fe0'); g.addColorStop(1, '#0b2a6b'); c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, sz * .11, sz * .3, 0, 0, 7); c.fill(); c.fillStyle = '#fff'; c.globalAlpha = .75; c.beginPath(); c.ellipse(0, sz * .22, sz * .05, sz * .07, 0, 0, 7); c.fill(); c.restore(); }
  const bg = c.createLinearGradient(0, -sz * .84, 0, -sz * .2); bg.addColorStop(0, '#19e58a'); bg.addColorStop(1, '#1b4fd8'); c.fillStyle = bg; c.beginPath(); c.ellipse(0, -sz * .5 + bob, sz * .3, sz * .34, 0, 0, 7); c.fill();
  const pg = c.createLinearGradient(0, -sz * .72, 0, -sz * .28); pg.addColorStop(0, '#ffd24a'); pg.addColorStop(1, '#e09a00'); c.fillStyle = pg; rrPath(c, -sz * .17, -sz * .72 + bob, sz * .34, sz * .42, sz * .07); c.fill(); c.strokeStyle = '#7a4a00'; c.lineWidth = Math.max(1, sz * .025); c.stroke();
  c.beginPath(); c.moveTo(-sz * .1, -sz * .55 + bob); c.lineTo(sz * .1, -sz * .55 + bob); c.stroke(); c.strokeStyle = '#14308f'; c.lineWidth = sz * .04; c.beginPath(); c.moveTo(-sz * .17, -sz * .66 + bob); c.lineTo(-sz * .2, -sz * .4 + bob); c.moveTo(sz * .17, -sz * .66 + bob); c.lineTo(sz * .2, -sz * .4 + bob); c.stroke();
  c.fillStyle = '#fff'; c.beginPath(); c.arc(0, -sz * .88 + bob, sz * .19, 0, 7); c.fill(); c.fillStyle = '#0b2a6b'; c.beginPath(); c.arc(0, -sz * .9 + bob, sz * .19, Math.PI * 1.03, Math.PI * 1.97); c.closePath(); c.fill();
  c.fillStyle = '#ffc542'; c.beginPath(); c.moveTo(dir * sz * .15, -sz * .86 + bob); c.lineTo(dir * sz * .3, -sz * .81 + bob); c.lineTo(dir * sz * .15, -sz * .77 + bob); c.closePath(); c.fill();
  c.fillStyle = '#ffd24a'; c.beginPath(); c.arc(dir * sz * .08, -sz * .86 + bob, sz * .04, 0, 7); c.fill(); c.fillStyle = '#0a0e13'; c.beginPath(); c.arc(dir * sz * .09, -sz * .86 + bob, sz * .02, 0, 7); c.fill(); c.restore();
}
let dashTips = { low: false, high: false, lane: false, done: false };
async function dash(root) {
  let st = null, run = null, timer = 0, played = false;
  const W = 400, H = 560, HY = 140, PY = 468, VX = 200, LANE = 122, BW = 94, FL = 212, K = 0.16, AHEAD = 24, PX = 100, AIR = 2, MAGNET = 12;
  const CPN = ['LEVEL 2 · SOPHOMORE', 'LEVEL 3 · JUNIOR', 'LEVEL 4 · SENIOR'], CPS = ['SOPH', 'JUNIOR', 'SENIOR'], LVN = ['FRESHMAN', 'SOPHOMORE', 'JUNIOR', 'SENIOR'], LVC = ['#19e58a', '#5b8cff', '#a855ff', '#ff5d6c'], GR = 0.25; // GR: a lane change counts up to a quarter row late, so near-misses are dodges
  root.innerHTML = gameShell(`<div class="note" style="margin-top:0"><b>🎯 Goal:</b> race down the hallway and get to class before the bell. <b>← →</b> switch lanes around carts, <b>↑</b> jump the backpacks, <b>↓</b> slide under signs (phones: swipe, or tap a side). Grab 🪙 chips (+50), 🧲 magnet pulls them in, 🛡️ shield saves you from one hit. It starts easy and gets harder every 100 rows (Freshman → Senior). Every row is 10 points, each new level is +100 and the 🎓 door is a +500 jackpot.</div>
    ${skillBet('dash')}<div class="stats"><div><small>Score</small><b id="sc">0</b></div><div><small>Chips</small><b id="ps">0</b></div></div>${hsBox()}`,
    `<div class="dashwrap"><canvas id="dcv" width="${W}" height="${H}" aria-label="Hallway Dash game"></canvas><div class="dashmsg" id="dm"></div>
      <div class="dashintro" id="dintro">🎓 Reach class! ← → lanes · ↑ jump · ↓ slide</div><button class="dashinfo" id="dinfo" aria-label="How to play">ⓘ How to play</button></div>`);
  const hideIntro = () => { const d = $('#dintro'); if (d) d.classList.add('hidden'); };
  let firstVisit = true; try { firstVisit = !localStorage.getItem('hb_dash_seen'); localStorage.setItem('hb_dash_seen', '1'); } catch (e) {}
  if (firstVisit) { const t = setTimeout(hideIntro, 3000); const kd = () => { hideIntro(); document.removeEventListener('keydown', kd); }; document.addEventListener('keydown', kd); stopFns.push(() => { clearTimeout(t); document.removeEventListener('keydown', kd); }); } else hideIntro();
  $('#dinfo').onclick = () => showModal(`<h3>🎯 How to play</h3><p>Race down the hall before the bell and reach the <b>🎓 CLASS door</b> for a <b>+500 jackpot</b>. It starts easy and gets harder every 100 rows.</p>
    <ul class="dashrules"><li><b>⬅️ ➡️</b> switch lanes around the carts</li><li><b>⬆️</b> jump over the backpacks</li><li><b>⬇️</b> slide under the hanging signs</li><li><b>🪙</b> grab chips for points</li><li><b>🧲 🛡️</b> magnet and shield power-ups</li></ul><p><small>Phones: swipe up / down, tap left / right</small></p><button class="btn" data-close>Got it</button>`);
  const cv = $('#dcv'), c = cv.getContext('2d'), tiers = (CFG && CFG.skillTiers && CFG.skillTiers.dash) || [[2500, 3], [1800, 2], [1200, 1.5], [700, 1]];
  const msg = t => { const m = $('#dm'); m.textContent = t; m.classList.toggle('hidden', !t); };
  stopFns.push(() => { clearTimeout(timer); run = null; });
  const S = d => 1 / (1 + d * K), P = (x, s, h) => [VX + x * s, HY + (PY - HY - h) * s], OX = l => (l - 1) * LANE, LX = (l, s = 1) => VX + OX(l) * s;
  const poly = (pts, fill) => { c.fillStyle = fill; c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fill(); };
  const wall = (sd, s1, s2, h1, h2, fill) => poly([P(sd * FL, s1, h1), P(sd * FL, s2, h1), P(sd * FL, s2, h2), P(sd * FL, s1, h2)], fill);
  function box(ox, d, len, w, h, front, top, side, deco, h0 = 0) { // a solid box in a lane (h0 = how high off the floor it floats): side, top, then the front face
    const s1 = S(d), s2 = S(d + len), l1 = VX + (ox - w / 2) * s1, r1 = VX + (ox + w / 2) * s1, l2 = VX + (ox - w / 2) * s2, r2 = VX + (ox + w / 2) * s2, y0 = P(0, s1, h0)[1], yh = P(0, s1, h)[1], y0b = P(0, s2, h0)[1], yhb = P(0, s2, h)[1];
    if (ox < -1) poly([[r1, yh], [r1, y0], [r2, y0b], [r2, yhb]], side); else if (ox > 1) poly([[l1, yh], [l1, y0], [l2, y0b], [l2, yhb]], side);
    poly([[l1, yh], [r1, yh], [r2, yhb], [l2, yhb]], top); poly([[l1, yh], [r1, yh], [r1, y0], [l1, y0]], front); if (deco) deco(l1, r1, yh, y0, s1);
  }
  function chip(x, y, sz, now, k) { // a casino chip, spinning
    c.save(); c.translate(x, y - sz * .55 - Math.sin(now / 260 + k) * sz * .07); const g = c.createRadialGradient(0, 0, 0, 0, 0, sz * .75); g.addColorStop(0, 'rgba(255,214,74,.5)'); g.addColorStop(1, 'rgba(255,214,74,0)'); c.fillStyle = g; c.fillRect(-sz * .75, -sz * .75, sz * 1.5, sz * 1.5);
    c.scale(Math.max(.14, Math.abs(Math.cos(now / 200 + k))), 1); c.fillStyle = '#c0102a'; c.beginPath(); c.arc(0, 0, sz * .34, 0, 7); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = Math.max(1, sz * .07); c.setLineDash([sz * .13, sz * .13]); c.beginPath(); c.arc(0, 0, sz * .27, 0, 7); c.stroke(); c.setLineDash([]);
    c.fillStyle = '#ffc542'; c.beginPath(); c.arc(0, 0, sz * .17, 0, 7); c.fill(); c.fillStyle = '#7a4a00'; c.font = `900 ${Math.round(sz * .22)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('★', 0, 1); c.restore();
  }
  function orb(x, y, sz, now, emoji, col) { c.save(); c.translate(x, y - sz * .6 - Math.sin(now / 300) * sz * .08); const g = c.createRadialGradient(0, 0, 0, 0, 0, sz * .62); g.addColorStop(0, col + 'cc'); g.addColorStop(1, col + '00'); c.fillStyle = g; c.fillRect(-sz * .62, -sz * .62, sz * 1.24, sz * 1.24); c.strokeStyle = col; c.lineWidth = Math.max(1.5, sz * .05); c.beginPath(); c.arc(0, 0, sz * .36, 0, 7); c.stroke(); c.font = `${Math.round(sz * .44)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(emoji, 0, 2); c.restore(); }
  function vault(d, now) { // the CLASS door: a gold jackpot vault at the end of the hall
    const s = S(d); poly([P(-FL, s, 0), P(FL, s, 0), P(FL, s, 600), P(-FL, s, 600)], '#16246a');
    const dg = c.createLinearGradient(0, P(0, s, 330)[1], 0, P(0, s, 0)[1]); dg.addColorStop(0, '#fff3b0'); dg.addColorStop(.5, '#ffc542'); dg.addColorStop(1, '#c78600'); poly([P(-120, s, 0), P(120, s, 0), P(120, s, 330), P(-120, s, 330)], dg);
    poly([P(-100, s, 20), P(100, s, 20), P(100, s, 310), P(-100, s, 310)], 'rgba(120,70,0,.28)'); const cx = VX, cy = P(0, s, 170)[1], fs = Math.max(6, 74 * s);
    c.fillStyle = '#6b3d00'; c.font = `900 ${fs}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('🎓', cx, cy - fs * .55); c.font = `900 ${fs * .42}px system-ui`; c.fillText('CLASS', cx, cy + fs * .35); c.fillText('JACKPOT +500', cx, cy + fs * .85);
  }
  const speedAt = r => 420 / dashTickAt(Math.max(0, Math.floor(r)));
  const dashTickAt = r => run.tick[Math.min(r, run.tick.length - 1)];
  const scoreNow = () => Math.floor(run.pos) * 10 + run.passes * 50 + Math.min(3, Math.floor(run.pos / 100)) * 100;
  function scene(rp, now, crashed, tum) {
    c.save(); if (run.shakeUntil > now) c.translate((Math.random() - .5) * run.amp, (Math.random() - .5) * run.amp);
    c.translate(W / 2, H / 2); c.rotate(Math.max(-1, Math.min(1, (run.target - run.laneX) / 70)) * .018); c.translate(-W / 2, -H / 2); // the camera leans a touch into lane changes
    c.fillStyle = '#0a1233'; c.fillRect(-30, -30, W + 60, H + 60);
    const sf = S(AHEAD), sn = S(-1.5), cg = c.createLinearGradient(0, 0, 0, HY + 60); cg.addColorStop(0, '#080e2a'); cg.addColorStop(1, '#1a2a66');
    poly([P(-FL, sf, 600), P(FL, sf, 600), P(FL, sn, 600), P(-FL, sn, 600)], cg);
    const fg = c.createLinearGradient(0, P(0, sf, 0)[1], 0, H); fg.addColorStop(0, '#1a2a63'); fg.addColorStop(1, '#101a45'); poly([P(-FL, sf, 0), P(FL, sf, 0), P(FL, sn, 0), P(-FL, sn, 0)], fg);
    const toEnd = run.max - rp; if (toEnd > AHEAD - 1) { // the far door, always in sight, tells you where you are headed
      poly([P(-FL, sf, 0), P(FL, sf, 0), P(FL, sf, 600), P(-FL, sf, 600)], '#16246a'); const dg = c.createLinearGradient(0, P(0, sf, 330)[1], 0, P(0, sf, 0)[1]); dg.addColorStop(0, '#fff3b0'); dg.addColorStop(1, '#ffb21a'); poly([P(-96, sf, 0), P(96, sf, 0), P(96, sf, 300), P(-96, sf, 300)], dg);
      c.fillStyle = '#7a4a00'; c.font = '900 8px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('🎓 CLASS', VX, P(0, sf, 190)[1]); }
    const r0 = Math.floor(rp) - 1, r1 = Math.floor(rp) + AHEAD;
    for (let r = r1; r >= r0; r--) {
      const d1 = r - rp, s1 = S(d1), s2 = S(d1 + 1), par = r & 1, row = run.rows[r];
      for (let l = 0; l < 3; l++) { const ox = OX(l); poly([P(ox - 53, s2, 0), P(ox + 53, s2, 0), P(ox + 53, s1, 0), P(ox - 53, s1, 0)], par ? '#3a559f' : '#314a90');
        for (const e of [-1, 1]) poly([P(ox + e * 53 - 1.6, s2, 0), P(ox + e * 53 + 1.6, s2, 0), P(ox + e * 53 + 1.6, s1, 0), P(ox + e * 53 - 1.6, s1, 0)], 'rgba(255,255,255,.55)'); }
      if (row) for (let l = 0; l < 3; l++) { // lane warnings on the floor a couple of rows before an obstacle
        const kind = (row[0] >> l & 1) ? 'b' : (row[2] >> l & 1) ? 'l' : (row[3] >> l & 1) ? 'h' : ''; if (!kind) continue; const ox = OX(l);
        for (const back of [1, 2, 3]) { if (r - back < 0) continue; const e1 = S(r - back - rp), e2 = S(r - back + 1 - rp); poly([P(ox - 53, e2, 0), P(ox + 53, e2, 0), P(ox + 53, e1, 0), P(ox - 53, e1, 0)], kind === 'b' ? 'rgba(255,60,80,.16)' : kind === 'l' ? 'rgba(255,200,40,.17)' : 'rgba(60,200,255,.17)'); }
        const gy = P(0, S(r - 2 - rp + .5), 0)[1], gs = S(r - 2 - rp + .5); if (r - 2 - rp > -.3) { c.font = `900 ${Math.round(34 * gs)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = kind === 'b' ? '#ff5d6c' : kind === 'l' ? '#ffd24a' : '#5bd0ff'; c.fillText(kind === 'b' ? '✕' : kind === 'l' ? '▲' : '▼', LX(l, gs), gy); } }
      for (const sd of [-1, 1]) { wall(sd, s1, s2, 0, 30, '#0a1233'); wall(sd, s1, s2, 30, 290, par ? '#2850c4' : '#2f5bd8'); wall(sd, s1, s2, 290, 600, '#18276a'); wall(sd, S(d1 + .08), S(d1 + .92), 46, 276, par ? '#3563e0' : '#3c6cf0'); wall(sd, S(d1 + .78), S(d1 + .84), 150, 190, '#ffd24a');
        wall(sd, S(d1 + .49), S(d1 + .51), 46, 276, 'rgba(8,16,60,.55)'); wall(sd, S(d1 + .42), S(d1 + .46), 150, 186, '#ffd24a'); wall(sd, S(d1 + .54), S(d1 + .58), 150, 186, '#ffd24a'); wall(sd, S(d1 + .1), S(d1 + .4), 238, 246, 'rgba(8,16,60,.5)'); wall(sd, S(d1 + .6), S(d1 + .9), 238, 246, 'rgba(8,16,60,.5)'); }
      if (r % 3 === 0) { poly([P(-58, S(d1 + .25), 598), P(58, S(d1 + .25), 598), P(58, S(d1 + .75), 598), P(-58, S(d1 + .75), 598)], 'rgba(255,255,235,.8)'); for (let l = 0; l < 3; l++) poly([P(OX(l) - 40, S(d1 + .78), 0), P(OX(l) + 40, S(d1 + .78), 0), P(OX(l) + 40, S(d1 + .22), 0), P(OX(l) - 40, S(d1 + .22), 0)], 'rgba(255,255,255,.07)'); }
      if (r === 100 || r === 200 || r === 300) { // checkpoint arch
        const sa = S(d1 + .5), a = P(-FL + 8, sa, 330), b = P(FL - 8, sa, 330); poly([P(-FL + 8, sa, 300), P(FL - 8, sa, 300), P(FL - 8, sa, 360), P(-FL + 8, sa, 360)], '#0b1236');
        c.fillStyle = '#ffd24a'; c.font = `900 ${Math.max(7, 40 * sa)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(CPN[r / 100 - 1], VX, P(0, sa, 330)[1]); }
    }
    if (toEnd < AHEAD - .5 && toEnd > -.5) vault(Math.max(0.05, toEnd), now);
    const fog = c.createLinearGradient(0, P(0, sf, 600)[1] - 10, 0, P(0, sf, 0)[1] + 90); fog.addColorStop(0, 'rgba(8,14,42,.78)'); fog.addColorStop(1, 'rgba(8,14,42,0)'); c.fillStyle = fog; c.fillRect(0, 0, W, P(0, sf, 0)[1] + 90);
    for (let r = Math.min(r1, run.max); r >= Math.floor(rp) - 1; r--) { // objects, far to near
      const d = r - rp, row = run.rows[r]; if (d < -.8 || d > AHEAD - .5 || !row) continue; const s = S(d), y = P(0, s, 0)[1]; c.globalAlpha = Math.min(1, (AHEAD - 1 - d) / 5) * (d < 1.2 ? Math.max(.35, (d + .8) / 2) : 1);
      for (let l = 0; l < 3; l++) { const ox = OX(l), x = LX(l, s), v = (r * 7 + l * 13) % 3, sh = (w, op) => { c.fillStyle = `rgba(0,0,0,${op})`; c.beginPath(); c.ellipse(x, y, w * s, w * .16 * s, 0, 0, 7); c.fill(); };
        if (row[0] >> l & 1) { sh(58, .3); box(ox, d, .7, BW, 104, v ? '#2f5bd8' : '#d8203a', v ? '#9ab6ff' : '#ff8a96', v ? '#1b3a9a' : '#8a1224', (a, b, yt, yb, ss) => { c.fillStyle = 'rgba(8,16,60,.55)'; for (let i = 0; i < 3; i++) c.fillRect(a + (b - a) * .14, yt + (yb - yt) * (.14 + i * .12), (b - a) * .72, Math.max(1, 3 * ss)); c.fillStyle = '#ffd24a'; c.fillRect(a, yb - (yb - yt) * .2, b - a, (yb - yt) * .09); c.fillStyle = '#111'; c.beginPath(); c.arc(a + (b - a) * .17, yb, 5 * ss, 0, 7); c.arc(b - (b - a) * .17, yb, 5 * ss, 0, 7); c.fill(); }); }
        if (row[2] >> l & 1) dashBag(c, x, y, 78 * s, v ? '#3d8bff' : '#ff5a6e', v ? '#16379a' : '#a3182e');
        if (row[3] >> l & 1) { const pa = P(ox - BW / 2 + 4, s, 330), pb = P(ox + BW / 2 - 4, s, 330); c.strokeStyle = '#8a93b8'; c.lineWidth = Math.max(1.5, 4 * s); c.beginPath(); c.moveTo(P(ox - BW / 2 + 6, s, 72)[0], P(0, s, 72)[1]); c.lineTo(pa[0], pa[1]); c.moveTo(P(ox + BW / 2 - 6, s, 72)[0], P(0, s, 72)[1]); c.lineTo(pb[0], pb[1]); c.stroke();
          box(ox, d, .12, BW, 128, '#d8203a', '#ff7a8a', '#8a1224', null, 72); const bb = P(ox, s, 100); c.fillStyle = '#fff'; c.font = `900 ${Math.max(6, 18 * s)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('HALL CLOSED', bb[0], bb[1]); sh(46, .25); }
        if (row[1] === l && !run.got.has(r)) chip(x, y, 82 * s, now, r);
        if (row[4] >= 0 && Math.floor(row[4] / 10) === l && !run.got.has(-r)) orb(x, y, 96 * s, now, row[4] % 10 === 1 ? '🧲' : '🛡️', row[4] % 10 === 1 ? '#ff5d6c' : '#5bd0ff'); }
      c.globalAlpha = 1;
    }
    for (const p of run.parts) { c.globalAlpha = Math.max(0, p.life / p.max); c.fillStyle = p.col; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill(); } c.globalAlpha = 1;
    const sp = Math.min(2.3, speedAt(rp)), lean = Math.max(-1, Math.min(1, (run.target - run.laneX) / 70)) * .28;
    c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(run.laneX, PY, PX * .34, PX * .09, 0, 0, 7); c.fill(); // the shadow stays on the floor when you jump
    if (run.shield) { c.strokeStyle = 'rgba(91,208,255,.8)'; c.lineWidth = 3; c.beginPath(); c.arc(run.laneX, PY - PX * .5 - run.air, PX * .62 + Math.sin(now / 120) * 2, 0, 7); c.stroke(); c.fillStyle = 'rgba(91,208,255,.12)'; c.fill(); }
    if (run.magnetUntil >= Math.floor(rp)) { c.strokeStyle = 'rgba(255,93,108,.5)'; c.lineWidth = 2; c.setLineDash([6, 8]); c.lineDashOffset = -now / 40; c.beginPath(); c.arc(run.laneX, PY - PX * .5 - run.air, PX * .95, 0, 7); c.stroke(); c.setLineDash([]); }
    dashHawk(c, run.laneX, PY - run.air, PX, now / 1000 * 9 * sp, lean, run.dir, tum, { air: run.air > 1, slide: run.slide });
    if (!crashed || tum) { const a = Math.max(0, sp - 1.05) * .22; if (a > 0) { c.strokeStyle = `rgba(255,255,255,${Math.min(.3, a)})`; c.lineWidth = 2; for (let i = 0; i < 12; i++) { const ang = i * 2.399 + .3, dd = ((now * .5 * sp + i * 91) % 320) + 90; c.beginPath(); c.moveTo(VX + Math.cos(ang) * dd * .85, 230 + Math.sin(ang) * dd * .9); c.lineTo(VX + Math.cos(ang) * (dd + 34), 230 + Math.sin(ang) * (dd + 34) * 1.1); c.stroke(); } } }
    const vg = c.createRadialGradient(VX, H * .5, H * .3, VX, H * .5, H * .78); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,10,.5)'); c.fillStyle = vg; c.fillRect(0, 0, W, H);
    hud(rp, now); c.restore();
  }
  function hud(rp, now) { // one slim bar: score, level, chips; a thin progress line; small hints
    const sc = run.t0 ? scoreNow() : 0, cur = tiers.find(([m]) => sc >= m), nxt = [...tiers].reverse().find(([m]) => m > sc), lab = m => SCHOOL() ? `+${Math.round(SCHOOLR.each * m)}🪙` : `${m}x`, lv = Math.min(3, Math.floor(rp / 100));
    if (run.flashUntil > now) { const k = (run.flashUntil - now) / 1200, g = c.createRadialGradient(VX, H * .45, 40, VX, H * .45, H * .7); g.addColorStop(0, `rgba(255,214,74,${.28 * k})`); g.addColorStop(1, 'rgba(255,214,74,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H); }
    c.fillStyle = 'rgba(6,10,28,.72)'; rrPath(c, 8, 8, W - 16, 32, 12); c.fill(); c.textBaseline = 'middle';
    c.textAlign = 'left'; c.fillStyle = '#8fb0ff'; c.font = '800 9px system-ui'; c.fillText('SCORE', 20, 17); c.fillStyle = '#fff'; c.font = '900 17px ui-monospace,Menlo,monospace'; c.fillText(fmt(sc), 20, 31);
    c.fillStyle = LVC[lv] + '33'; rrPath(c, W / 2 - 78, 14, 156, 20, 10); c.fill(); c.strokeStyle = LVC[lv]; c.lineWidth = 1.5; c.stroke(); c.fillStyle = LVC[lv]; c.textAlign = 'center'; c.font = '900 11px system-ui'; c.fillText(`LEVEL ${lv + 1} · ${LVN[lv]}`, W / 2, 24.5);
    c.textAlign = 'right'; c.fillStyle = '#ffd24a'; c.font = '900 15px system-ui'; c.fillText(`🪙 ${run.passes}`, W - 20, 25);
    const bx = 24, bw = W - 48, by = 52, pr = Math.min(1, rp / run.max); c.fillStyle = 'rgba(255,255,255,.14)'; rrPath(c, bx, by, bw, 5, 3); c.fill(); const pg = c.createLinearGradient(bx, 0, bx + bw, 0); pg.addColorStop(0, '#19e58a'); pg.addColorStop(.5, '#5b8cff'); pg.addColorStop(1, '#ff5d6c'); c.fillStyle = pg; if (pr > 0) { rrPath(c, bx, by, Math.max(5, bw * pr), 5, 3); c.fill(); }
    for (let i = 1; i <= 3; i++) { const x = bx + bw * i / 4; c.fillStyle = rp >= i * 100 ? '#fff' : '#ffffff66'; c.beginPath(); c.arc(x, by + 2.5, 3.2, 0, 7); c.fill(); c.font = '700 8px system-ui'; c.textAlign = 'center'; c.fillStyle = rp >= i * 100 ? LVC[i] : '#8fb0ff'; c.fillText(CPS[i - 1], x, by + 14); }
    c.font = '14px system-ui'; c.textAlign = 'center'; c.fillText('🎓', bx + bw + 4, by + 2); c.fillText('🦅', bx + Math.max(4, bw * pr), by - 8);
    c.textAlign = 'left'; c.font = '800 10px system-ui'; c.fillStyle = '#ffd24acc'; c.fillText(cur ? `PAYOUT ${lab(cur[1])}` : `${fmt(tiers[tiers.length - 1][0])} pts to win`, 20, 80); c.textAlign = 'right'; c.fillStyle = '#ffffffaa'; c.fillText(`🎓 ${Math.max(0, Math.round(run.max - rp))} rows to class`, W - 20, 80);
    c.textAlign = 'left'; c.font = '900 12px system-ui'; c.fillStyle = '#ffffffcc'; c.fillText(`×${Math.min(3, speedAt(rp)).toFixed(1)} speed`, 12, 548);
    if (nxt) { c.textAlign = 'center'; c.font = '700 10px system-ui'; c.fillStyle = '#ffffff99'; c.fillText(`next: ${fmt(nxt[0])} pts → ${lab(nxt[1])}`, W / 2, 548); }
    if (run.chain >= 2) { c.textAlign = 'right'; c.fillStyle = '#ffd24a'; c.font = '900 16px system-ui'; c.fillText(`🪙 combo ×${run.chain}`, W - 12, 548); }
    if (run.magnetUntil >= Math.floor(rp)) { c.textAlign = 'left'; c.font = '800 12px system-ui'; c.fillStyle = '#ff9aa5'; c.fillText(`🧲 ${Math.max(0, Math.ceil(run.magnetUntil - rp))}`, 12, 528); }
    if (run.shield) { c.textAlign = 'left'; c.font = '800 12px system-ui'; c.fillStyle = '#8fe0ff'; c.fillText('🛡️ ready', 62, 528); }
    if (run.pop && now - run.pop.t0 < (run.pop.dur || 900)) { const dur = run.pop.dur || 900, k = (now - run.pop.t0) / dur; c.save(); c.globalAlpha = k < .8 ? 1 : 1 - (k - .8) * 5; c.translate(VX, (run.pop.y || 190) - k * 26); const sc2 = .7 + Math.min(1, k * 6) * .5; c.scale(sc2, sc2); c.font = `900 ${run.pop.size || 30}px system-ui`; c.textAlign = 'center'; c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,.65)'; c.strokeText(run.pop.text, 0, 0); c.fillStyle = run.pop.col; c.fillText(run.pop.text, 0, 0); c.restore(); }
  }
  const cum = t => { const a = [0]; t.forEach(x => a.push(a[a.length - 1] + x)); return a; };
  function rowPosAt(el) { const T = run.tick, C = run.cum; let lo = 0, hi = T.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (C[mid] <= el) lo = mid; else hi = mid - 1; } return lo + Math.min(1, (el - C[lo]) / T[lo]); }
  const popup = (text, col, extra) => { run.pop = { text, col, t0: performance.now(), ...extra }; };
  const tipOf = text => popup(text, '#fff', { dur: 2000, y: 215, size: 22 });
  const puff = (n, x, y, col, spd = 1) => { for (let i = 0; i < n; i++) run.parts.push({ x: x + (Math.random() - .5) * 20, y, vx: (Math.random() - .5) * 2.2 * spd, vy: -Math.random() * 2.5 * spd - .5, r: 2 + Math.random() * 3, life: 26 + Math.random() * 14, max: 40, col }); };
  const blank = () => ({ rows: Array.from({ length: 60 }, () => [0, -1, 0, 0, -1]), tick: Array(80).fill(340), max: 400, moves: [], acts: [], lane: 1, next: 1, from: 1, dir: 1, laneX: LX(1), target: LX(1), lastRow: -1, lastAct: -9, checked: -1, passes: 0, chain: 0, sinceGot: 0, pos: 0, queued: 0, qAct: null, over: false, parts: [], lastPuff: 0, shakeUntil: 0, amp: 0, pop: null, t0: 0, got: new Set(), air: 0, slide: 0, shield: false, shieldUsed: 0, magnetUntil: -1, flashUntil: 0, jump: null, slideT: null, cp: 0, cum: cum(Array(80).fill(340)) });
  function turn(d) { if (run && !run.over && run.t0) run.queued = d; }
  function act2(kind) { if (run && !run.over && run.t0) run.qAct = kind; }
  async function more() { if (run.fetching || run.rows.length > run.max) return; run.fetching = true; try { const r = await api('POST', '/arcade/dash/rows', { from: run.rows.length }); if (run) run.rows.push(...r.rows); } catch (e) {} finally { if (run) run.fetching = false; } }
  async function over(crashed) {
    run.over = true; clearTimeout(timer); const moves = run.moves, acts = run.acts; run.shakeUntil = performance.now() + 700; run.amp = crashed ? 18 : 0;
    if (crashed) { sfx.play('crash'); fx.lose(); puff(26, run.laneX, PY - 40, '#ffd24a', 2.2); msg('💥 Ouch! Tardy slip.'); } else { sfx.play('roar'); fx.burst(200); run.flashUntil = performance.now() + 2000; msg('🎓 You made it to class!'); }
    const t0 = performance.now(), rp = run.pos;
    await new Promise(done => { const step = () => { if (!root.isConnected || !run) return done(); const k = Math.min(1, (performance.now() - t0) / (calm ? 100 : 800)); run.parts.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .12; p.life--; }); run.parts = run.parts.filter(p => p.life > 0);
      scene(rp, performance.now(), true, crashed ? { rot: k * 4.2, sc: 1 - k * .25 } : null); k < 1 ? setTimeout(step, 16) : done(); }; step(); });
    if (!root.isConnected) return;
    try { const r = await api('POST', '/arcade/dash/end', { moves, acts }); st = null; run = null; lockStart(false); resMsg(true, `${r.rows} rows · ${r.passes} chips · ${r.checkpoints} checkpoints · ${fmt(r.score)} pts`); msg(`${fmt(r.score)} pts`); skillDone('dash', r, r.score >= 1200); }
    catch (e) { toast(e.message); st = null; run = null; lockStart(false); }
  }
  const setScore = (el, v) => { const t = fmt(v); if (el && el.textContent !== t) el.textContent = t; };
  let last = 0;
  function tickLoop() {
    if (!run || run.over || !root.isConnected) return; const now = performance.now(), el = now - run.t0, rp = rowPosAt(el); run.pos = rp; const dt = Math.min(50, now - last) / 16, nr = Math.floor(rp - GR) + 1; last = now;
    if (run.queued) { const nl = run.next + run.queued; if (nl >= 0 && nl <= 2 && nr > run.lastRow) { run.moves.push({ row: nr, lane: nl }); run.lastRow = nr; run.from = run.next; run.next = nl; run.dir = run.queued; sfx.play('whoosh'); } run.queued = 0; }
    if (run.qAct && nr >= run.lastAct + 3) { run.acts.push({ row: nr, kind: run.qAct }); run.lastAct = nr; const dur = Math.max(260, run.cum[Math.min(run.cum.length - 1, nr + AIR)] - el); if (run.qAct === 'j') { run.jump = { t0: now, dur }; sfx.play('tap'); } else { run.slideT = { t0: now, dur }; sfx.play('whoosh'); } run.qAct = null; }
    while (run.checked + 1 + GR <= rp) {
      run.checked++; const r = run.checked, mv = run.moves.find(m => m.row === r); if (mv) run.lane = mv.lane; if (r > run.max) return over(false); const row = run.rows[r]; if (!row) break;
      const air = run.acts.some(a => a.kind === 'j' && a.row <= r && r < a.row + AIR), slide = run.acts.some(a => a.kind === 's' && a.row <= r && r < a.row + AIR), L = run.lane, [mask, pass, low, high, power] = row;
      const blocked = (mask >> L & 1) || ((low >> L & 1) && !air) || ((high >> L & 1) && !slide);
      if (blocked) { if (run.shield) { run.shield = false; run.shieldUsed++; popup('SHIELD SAVED YOU!', '#5bd0ff'); sfx.play('crash'); run.shakeUntil = now + 220; run.amp = 9; puff(18, run.laneX, PY - 40, '#5bd0ff', 1.8); } else return over(true); }
      else if ((low >> L & 1) || (high >> L & 1)) { popup(low >> L & 1 ? 'CLEAN JUMP!' : 'SMOOTH SLIDE!', '#ffd24a'); sfx.play('near'); }
      else if (mv && (row[0] >> run.from & 1)) { popup('NEAR MISS!', '#ffd24a'); sfx.play('near'); run.shakeUntil = now + 160; run.amp = 5; }
      if (pass >= 0 && (pass === L || (run.magnetUntil >= r && Math.abs(pass - L) <= 1))) { run.passes++; run.chain++; run.sinceGot = 0; run.got.add(r); sfx.play('coin'); puff(10, run.laneX, PY - 50, '#ffd24a', 1.3); if (run.chain >= 3) popup(`CHIPS ×${run.chain}!`, '#19e58a'); } else if (++run.sinceGot > 14) run.chain = 0;
      if (power >= 0 && Math.floor(power / 10) === L) { run.got.add(-r); if (power % 10 === 1) { run.magnetUntil = r + MAGNET; popup('🧲 MAGNET!', '#ff9aa5'); } else { run.shield = true; popup('🛡️ SHIELD!', '#8fe0ff'); } sfx.play('clear'); puff(14, run.laneX, PY - 60, '#ffffff', 1.4); }
      if (r === 100 || r === 200 || r === 300) { run.flashUntil = now + 1200; popup(`${CPN[r / 100 - 1]}! +100`, LVC[r / 100], { dur: 1500, size: 24 }); sfx.play('clear'); fx.burst(50, innerWidth / 2, innerHeight / 3); run.cp++; }
    }
    if (!dashTips.done) { for (let k = 3; k <= 8; k++) { const nx = run.rows[nr + k]; if (!nx) break; if (!dashTips.low && nx[2]) { dashTips.low = true; tipOf('⬆️ JUMP the backpacks!'); break; } if (!dashTips.high && nx[3]) { dashTips.high = true; tipOf('⬇️ SLIDE under the sign!'); break; } } if (!dashTips.lane && rp > 3) { dashTips.lane = true; tipOf('⬅️ ➡️ change lanes around the carts'); } if (dashTips.low && dashTips.high && dashTips.lane) dashTips.done = true; }
    run.target = LX(run.next ?? run.lane); run.laneX += (run.target - run.laneX) * Math.min(1, .3 * dt);
    run.air = 0; if (run.jump) { const kk = (now - run.jump.t0) / run.jump.dur; run.air = kk < 1 ? Math.sin(kk * Math.PI) * 78 : 0; if (kk >= 1) run.jump = null; }
    run.slide = 0; if (run.slideT) { const kk = (now - run.slideT.t0) / run.slideT.dur; run.slide = kk < 1 ? Math.max(0, Math.min(1, kk * 6, (1 - kk) * 6)) : 0; if (kk >= 1) run.slideT = null; }
    if (now - run.lastPuff > 70) { run.lastPuff = now; puff(1, run.laneX, PY - 2, 'rgba(210,220,255,.6)', .6); }
    run.parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += .1 * dt; p.life -= dt; }); run.parts = run.parts.filter(p => p.life > 0);
    scene(rp, now, false, null); setScore($('#sc'), scoreNow()); $('#ps').textContent = run.passes; if (rp > run.rows.length - 60) more();
    timer = setTimeout(tickLoop, 16);
  }
  const keys = e => { if (!root.isConnected) return; const k = e.key.toLowerCase(); if (k === 'arrowleft' || k === 'a') { e.preventDefault(); turn(-1); } else if (k === 'arrowright' || k === 'd') { e.preventDefault(); turn(1); } else if (k === 'arrowup' || k === 'w') { e.preventDefault(); act2('j'); } else if (k === 'arrowdown' || k === 's') { e.preventDefault(); act2('s'); } };
  document.addEventListener('keydown', keys); stopFns.push(() => document.removeEventListener('keydown', keys));
  let sx = 0, sy = 0; cv.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; }); cv.addEventListener('pointerup', e => { const dx = e.clientX - sx, dy = e.clientY - sy, r = cv.getBoundingClientRect(); if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) act2(dy < 0 ? 'j' : 's'); else turn(Math.abs(dx) > 24 ? Math.sign(dx) : e.clientX < r.left + r.width / 2 ? -1 : 1); });
  const idle = blank(); const drawIdle = () => { if (run || !root.isConnected) return; run = idle; scene(0, performance.now(), true, null); run = null; }; setTimeout(drawIdle, 60);
  skillButtons(bet => act(async () => {
    const r = await api('POST', '/arcade/dash/start', { bet }); if (r.bet) setBal(r.balance); st = {}; played = true; hideIntro(); lockStart(true); $('#sc').textContent = '0'; $('#ps').textContent = '0'; $('#res').textContent = '';
    run = { ...blank(), rows: r.rows, tick: r.tick, cum: cum(r.tick), max: r.max };
    scene(0, performance.now(), false, null); for (const n of [3, 2, 1]) { msg(String(n)); sfx.play('tick'); await wait(calm ? 200 : 650); if (!root.isConnected || !run) return; } msg('GO!'); sfx.play('whoosh'); setTimeout(() => { if (run && !run.over) msg(''); }, 500);
    run.t0 = performance.now(); last = run.t0; tickLoop();
  }));
  loadHS('dash');
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

/* ---------- Rewards: level, daily wheel, daily challenges, achievements ---------- */
const LEVEL_TABLE = [[1, 'Freshman', 0], [2, 'Sophomore', 500], [3, 'Junior', 1500], [4, 'Senior', 3500], [5, 'Varsity', 7000], [6, 'Captain', 12000], [7, 'Hall of Fame', 20000]];
const WHEEL_COLORS = ['#2f6bff', '#a040ff', '#ff4fd8', '#ff9f1a', '#19e58a', '#16c0e0', '#ff4d5e', '#ffc542'];
function wheelSvg(prizes) {
  const R = 140, c = 150, paths = prizes.map((p, i) => {
    const a0 = (i * 45 - 90) * Math.PI / 180, a1 = ((i + 1) * 45 - 90) * Math.PI / 180, mid = ((i + .5) * 45 - 90) * Math.PI / 180;
    return `<path d="M${c} ${c}L${c + R * Math.cos(a0)} ${c + R * Math.sin(a0)}A${R} ${R} 0 0 1 ${c + R * Math.cos(a1)} ${c + R * Math.sin(a1)}Z" fill="${WHEEL_COLORS[i]}" stroke="#0a1131" stroke-width="3"/><text transform="translate(${c + 96 * Math.cos(mid)} ${c + 96 * Math.sin(mid)}) rotate(${(i + .5) * 45})" font-size="${p >= 1000 ? 19 : 22}" font-weight="900" text-anchor="middle" dominant-baseline="central" fill="#fff" stroke="#00000088" stroke-width="4" paint-order="stroke">${p}</text>`;
  }).join('');
  return `<svg viewBox="0 0 300 300" class="wsvg" aria-hidden="true"><circle cx="150" cy="150" r="147" fill="#ffc542"/><g id="wg" class="wg">${paths}</g><circle cx="150" cy="150" r="30" fill="#0a1131" stroke="#ffc542" stroke-width="5"/><image href="logo.svg" x="128" y="128" width="44" height="44"/></svg>`;
}
async function renderRewards(my) {
  const rw = await api('GET', '/rewards'); if (my !== nav) return;
  const L = rw.level, done = rw.achievements.filter(a => a.unlocked).length, claimable = rw.challenges.filter(c => !c.claimed && c.progress >= c.goal).length;
  $('#app').innerHTML = `<h1>🎁 Rewards</h1>
    <section class="panel lvlcard"><div class="bigbadge sm">${L.level}</div><div class="lvlinfo"><h2>${esc(L.name)}</h2><div class="xpbig"><u style="width:${L.pct}%"></u></div>
      <small>${fmt(L.xp)} XP${L.next ? ` · ${fmt(L.next - L.xp)} more to <b>${esc(L.nextName)}</b>` : ' · max level!'}</small></div>
      <div class="lvlsteps">${LEVEL_TABLE.map(([n, name, xp]) => `<span class="${L.level >= n ? 'on' : ''}" title="${fmt(xp)} XP"><b>${n}</b>${esc(name)}</span>`).join('')}</div>
      <div class="note">Earn XP in every game: +10 per round (+5 if you win), +25–50 for each skill game, +50 for each daily challenge. Each new level gives free Hawk Bucks.</div></section>
    <div class="rwgrid"><section class="panel wheelcard"><h2>🎡 Daily Wheel</h2><div class="wheelbox"><div class="wptr">▼</div>${wheelSvg(rw.wheel)}</div>
        <button class="btn bjbig" id="wspin" ${rw.wheelReady ? '' : 'disabled'}>${rw.wheelReady ? '🎡 Spin! <kbd>Space</kbd>' : 'Come back tomorrow'}</button><div class="res" id="wres"></div></section>
      <section class="panel"><h2>📋 Daily challenges ${claimable ? `<span class="chip2">${claimable} ready</span>` : ''}</h2>
        ${rw.challenges.map(c => `<div class="chal ${c.claimed ? 'done' : ''}"><i>${c.icon}</i><div class="cinfo"><b>${esc(c.title)}</b><small>${esc(c.desc)}</small><div class="cbar"><u style="width:${Math.round(c.progress / c.goal * 100)}%"></u></div><small>${c.progress} / ${c.goal}</small></div>
          <div class="cact"><b>+${c.reward} 🪙</b>${c.claimed ? '<span class="win">Claimed ✓</span>' : `<button class="btn gold" data-claim="${c.id}" ${c.progress >= c.goal ? '' : 'disabled'}>Claim</button>`}</div></div>`).join('')}
        <div class="note">Same 3 challenges for everyone, and they refresh every day at midnight (school time).</div></section></div>
    <section class="panel"><h2>🏅 Achievements <small class="mutecell">${done} / ${rw.achievements.length}</small></h2><div class="achgrid">${rw.achievements.map(a => `<div class="ach ${a.unlocked ? 'on' : ''}" title="${esc(a.desc)}"><i>${a.icon}</i><b>${esc(a.title)}</b><small>${esc(a.desc)}</small><em>${a.unlocked ? `✓ +${a.xp} XP` : `🔒 ${a.xp} XP`}</em></div>`).join('')}</div></section>`;
  const spin = $('#wspin'); let rot = 0;
  async function doSpin() {
    if (!spin || spin.disabled) return; spin.disabled = true;
    try {
      const r = await api('POST', '/wheel'), i = r.index; rot += 360 * 6 + (360 - (i + .5) * 45); const wg = $('#wg'); wg.style.transition = calm ? 'none' : 'transform 4.6s cubic-bezier(.12,.75,.15,1)'; wg.style.transform = `rotate(${rot}deg)`;
      if (!calm) for (let t = 0; t < 16; t++) { sfx.play('tap'); await wait(110 + t * 22); }
      if (!root_ok()) return; setBal(r.balance); $('#wres').innerHTML = `<span class="win">You won +${fmt(r.prize)} 🪙!</span>`; fx.burst(r.prize >= 250 ? 220 : 110); sfx.play(r.prize >= 250 ? 'jackpot' : 'big'); spin.textContent = 'Come back tomorrow'; checkProgress();
    } catch (e) { toast(e.message); sfx.play('error'); spin.disabled = false; }
  }
  const root_ok = () => !!$('#wspin') && view === 'rewards';
  if (spin) spin.onclick = doSpin;
  const key = e => { if (e.code === 'Space' && view === 'rewards' && $('#wspin') && !$('#wspin').disabled && !e.target.matches('input,textarea,button')) { e.preventDefault(); doSpin(); } };
  document.addEventListener('keydown', key); stopFns.push(() => document.removeEventListener('keydown', key));
  document.querySelectorAll('[data-claim]').forEach(b => b.onclick = act(async () => { const r = await api('POST', '/challenges/claim', { id: b.dataset.claim }); setBal(r.balance); toast(`+${fmt(r.reward)} Hawk Bucks!`); fx.burst(90); sfx.play('big'); checkProgress(); renderRewards(nav); }));
}

/* ---------- Luck Lab ---------- */
async function renderLuck() {
  if (!U.isAdmin) { location.hash = '#shop'; return; }
  const cur = String(luckLevel()), reg = LUCK.filter(x => String(x[0])[0] !== 'x'), sup = LUCK.filter(x => String(x[0])[0] === 'x');
  const card = ([lv, e, name, desc]) => `<button class="luckcard ${String(lv)[0] === 'x' ? 'super' : ''} ${String(lv) === cur ? 'on' : ''}" data-luck="${lv}" aria-pressed="${String(lv) === cur}"><span class="le">${e}</span><b>${lv === 'normal' ? 'Normal' : String(lv)[0] === 'x' ? name : `${lv} · ${name}`}</b><small>${desc}</small><i class="lm">${lv === 'normal' ? 'Standard odds' : String(lv)[0] === 'x' ? `Lose chance ÷${String(lv).slice(1)}` : `Win chance ×${(0.5 + lv * 0.1).toFixed(1)}`}</i></button>`;
  $('#app').innerHTML = `<h1>🍀 Luck Lab <small class="mutecell">admin only</small></h1><div class="panel luckinfo">This sets <b>your own</b> luck override. To set a player's luck, open <a href="#admin">Admin → Players</a>. Everyone else earns luck from gear in the <a href="#shop">Hawk Shop</a>.</div>
    <div class="panel luckinfo"><b>Luck really changes your odds</b> in 5 arcade games: 🪙 Heads or Tails, ✊ Hallway RPS, 🚌 Seahawk Crossing, 🎲 Scoreboard Roll and 🏈 Hail Mary.
      <br><br><b>Levels 1–10:</b> higher luck = you <b>win more often</b>, but each win pays less. Lower luck = fewer wins, bigger payouts. The <b>average payback stays the same</b> at every level. Level 1 ×0.6 … level 5 ×1.0 … level 10 ×1.5 win chance. Example: Heads or Tails is 50/50 on Normal, 75% at level 10 (pays 1.32x a call), 30% at level 1 (pays 3.30x).
      <br><br>Your luck is locked in when a round starts. It doesn't touch Seahawk Drop, Locker Hunt, Slots, Roulette, Hawk 21, Seahawk Launch, skill games or sports picks. It also changes your confetti and win sounds. Hawk Bucks are pretend: no real money, ever.</div>
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

/* ---------- avatars: a Seahawk you dress up. Skins recolor the hawk; the other slots are layered on top ---------- */
const SKIN_FX = { skin_classic: '', skin_blue: 'hue-rotate(55deg) saturate(1.3)', skin_ice: 'hue-rotate(35deg) saturate(.35) brightness(1.35)', skin_shadow: 'grayscale(1) brightness(.5) contrast(1.5)',
  skin_neon: 'hue-rotate(170deg) saturate(2.6) brightness(1.15) drop-shadow(0 0 3px #ff4fd8)', skin_gold: 'sepia(1) saturate(3.2) hue-rotate(-12deg) brightness(1.08) drop-shadow(0 0 3px #ffc542)' };
const ITEM_EMO = { hat_bow: '🎀', hat_sun: '👒', hat_snap: '🧢', hat_grad: '🎓', hat_top: '🎩', face_nerd: '👓', face_shades: '🕶️', face_goggles: '🥽', face_star: '✨', body_tee: '👕', body_hoodie: '🧥', body_tie: '👔', body_medal: '🥇',
  held_finger: '☝️', held_football: '🏈', held_bball: '🏀', held_money: '💰', held_trophy: '🏆', myth_diamond: '💎', myth_wings: '🪽', myth_crown: '👑' };
function avatar(gear = {}, size = 40, extra = '') {
  const g = gear || {}, layer = (slot, cls) => g[slot] && ITEM_EMO[g[slot]] ? `<i class="${cls}">${ITEM_EMO[g[slot]]}</i>` : '';
  const m = g.mythic, myth = m === 'myth_wings' ? '<i class="avwings">🪽</i>' : '', top = m === 'myth_crown' ? '<i class="avcrown">👑</i>' : m === 'myth_diamond' ? '<i class="avgem">💎</i>' : '';
  return `<span class="av ${g.bg ? 'bg-' + g.bg.slice(3) : ''} ${m ? 'myth' : ''} ${extra}" style="--s:${size}px" aria-hidden="true">${myth}<img src="hawk.svg" alt="" style="filter:${SKIN_FX[g.skin] || 'none'}">${layer('body', 'avbody')}${layer('face', 'avface')}${layer('hat', 'avhat')}${layer('held', 'avheld')}${top}</span>`;
}
const RARITY = { common: ['Common', '#9fb0c8'], rare: ['Rare', '#3d8bff'], epic: ['Epic', '#a855ff'], legendary: ['Legendary', '#ffb21a'], mythic: ['Mythic', '#ff4fd8'] };
const SLOT_NAMES = [['skin', '🦅 Skins'], ['hat', '🧢 Hats'], ['face', '🕶️ Face'], ['body', '👕 Body'], ['held', '🏈 Held'], ['bg', '🌌 Backgrounds'], ['mythic', '💎 Mythic']];
const luckTag = it => it.sup ? `<span class="ltag sup">🔥 Super Luck ×${it.sup}</span>` : it.luck ? `<span class="ltag">🍀 +${it.luck} luck</span>` : '<span class="ltag none">Just for looks</span>';
const luckSum = l => l.sup ? `🔥 Super Luck ×${l.sup}` : `🍀 Luck ${l.level}${l.level === 5 ? ' · Normal' : l.level === 10 ? ' · MAX' : ''}`;
function paintMe() { const el = $('#meav'); if (!el || !U) return; el.innerHTML = avatar(U.gear, 34); el.classList.toggle('hidden', !U); }
let shopTab = 'shop', shopSlot = 'all', tryOn = null;
async function renderShop(my) {
  const S = await api('GET', '/shop'); if (my !== nav) return;
  U.gear = S.gear; U.luck = S.luck.luck; U.balance = S.balance; CFG = null; showBal(); paintMe();
  const preview = { ...S.gear, ...(tryOn ? { [tryOn.slot]: tryOn.id } : {}) };
  const card = it => { const [rn, rc] = RARITY[it.rarity], locked = !it.owned && it.locks.length, off = it.off && !it.owned;
    const btn = it.owned ? (it.equipped ? `<button class="btn alt" data-unequip="${it.slot}" ${it.slot === 'skin' ? 'disabled' : ''}>✓ Wearing</button>` : `<button class="btn alt" data-equip="${it.id}" data-slot="${it.slot}">Wear it</button>`)
      : off ? '<button class="btn alt" disabled>Not for sale</button>' : locked ? '<button class="btn alt" disabled>🔒 Locked</button>' : `<button class="btn ${it.rarity === 'mythic' ? 'gold' : ''}" data-buy="${it.id}">Buy · ${fmt(it.price)} 🪙</button>`;
    return `<div class="icard r-${it.rarity} ${it.owned ? 'own' : ''}" style="--rc:${rc}"><button class="itry" data-try="${it.id}" data-slot="${it.slot}" title="Try it on">${it.slot === 'skin' ? avatar({ skin: it.id }, 64) : it.slot === 'bg' ? `<span class="bgsw bg-${it.id.slice(3)}"></span>` : `<span class="iemo">${ITEM_EMO[it.id] || it.emoji}</span>`}</button>
      <small class="rar">${rn}</small><b>${esc(it.name)}</b>${luckTag(it)}${!it.owned && it.price !== it.basePrice && it.price < it.basePrice ? `<s class="was">${fmt(it.basePrice)}</s>` : ''}
      ${it.maxCharges ? `<small class="chg">${it.owned ? `⚡ ${it.charges}/${it.maxCharges} charges` : `Lasts ${it.maxCharges} luck-game rounds`}</small>` : ''}
      ${locked ? `<ul class="locks">${it.locks.map(l => `<li>🔒 ${esc(l)}</li>`).join('')}</ul>` : ''}${btn}
      ${it.owned && it.maxCharges && it.charges < it.maxCharges ? `<button class="pill" data-recharge="${it.id}">Recharge · ${fmt(Math.round(it.price / 10))} 🪙</button>` : ''}</div>`; };
  const list = S.items.filter(it => (shopTab === 'locker' ? it.owned : true) && (shopSlot === 'all' || it.slot === shopSlot) && !(SCHOOL() && (it.luck || it.sup) && !it.owned));
  $('#app').innerHTML = `<div class="archead"><h1>🛍️ Hawk Shop</h1><div class="sub"><button class="pill ${shopTab === 'shop' ? 'on' : ''}" data-st="shop">🛍️ Shop</button><button class="pill ${shopTab === 'locker' ? 'on' : ''}" data-st="locker">🎒 My Locker</button></div></div>
    ${S.sale ? `<div class="salebar">🔥 SALE: everything ${S.sale}% off!</div>` : ''}
    <div class="shopwrap"><aside class="panel mecard">${avatar(preview, 170, 'big')}
      ${tryOn ? `<div class="trynote">Trying on: <b>${esc(S.items.find(i => i.id === tryOn.id).name)}</b> <button class="pill" id="untry">✕</button></div>` : ''}
      ${SCHOOL() ? '<div class="note">In Seahawk Arcade you can still dress up your Seahawk. Luck gear only matters in the chance games.</div>' : `<div class="lucktotal ${S.luck.sup ? 'sup' : ''}">${luckSum(S.luck)}</div>`}
      ${S.override ? `<div class="note">The admin set your luck to <b>${esc(String(S.override))}</b>. Gear is ignored until they clear it.</div>` : ''}
      <ul class="lparts">${S.luck.parts.map(p => `<li>${p.emoji} ${esc(p.src)} <b>${p.sup ? '×' + p.sup + ' Super' : '+' + p.luck}</b>${p.rounds ? ` · ${p.rounds} rounds left` : ''}${p.charges ? ` · ${p.charges} charges` : ''}</li>`).join('') || '<li class="mutecell">No luck gear yet. Everyone starts at Luck 5 (Normal).</li>'}</ul>
      <div class="note">Luck 6–10 = you win more often but each win pays a bit less (same 99% payback), and it <b>counts</b> on the leaderboard. 🔥 Super Luck pays full price, so those rounds <b>don't count</b> on the leaderboard. Luck works in Heads or Tails, RPS, Crossing, Scoreboard Roll and Hail Mary. Max total: Luck 10.</div></aside>
    <div class="shopmain"><div class="pills">${[['all', 'All'], ...SLOT_NAMES].map(([k, l]) => `<button class="pill ${shopSlot === k ? 'on' : ''}" data-ss="${k}">${l}</button>`).join('')}</div>
      ${shopTab === 'shop' && shopSlot === 'all' && !SCHOOL() ? `<h2>⚡ Luck Boosters</h2><div class="igrid">${S.boosters.map(b => `<div class="icard r-rare" style="--rc:#19e58a"><span class="iemo">${b.emoji}</span><small class="rar">Booster</small><b>${esc(b.name)}</b>
        <span class="ltag ${b.sup ? 'sup' : ''}">${b.sup ? '🔥 Super Luck ×' + b.sup : '🍀 +' + b.luck + ' luck'} for ${b.rounds} rounds</span>${b.active ? `<small class="chg">Active: ${b.active} rounds left</small>` : ''}<button class="btn" data-boost="${b.id}">Buy · ${fmt(b.price)} 🪙</button></div>`).join('')}</div>` : ''}
      ${list.length ? `<div class="igrid">${list.map(card).join('')}</div>` : '<div class="empty">Nothing here yet. Go shopping! 🛍️</div>'}</div></div>`;
  const redo = () => renderShop(nav), apply = r => { U.gear = r.gear; U.luck = r.luck.luck; CFG = null; setBal(r.balance); paintMe(); };
  document.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { shopTab = b.dataset.st; redo(); });
  document.querySelectorAll('[data-ss]').forEach(b => b.onclick = () => { shopSlot = b.dataset.ss; redo(); });
  document.querySelectorAll('[data-try]').forEach(b => b.onclick = () => { tryOn = { id: b.dataset.try, slot: b.dataset.slot }; redo(); });
  if ($('#untry')) $('#untry').onclick = () => { tryOn = null; redo(); };
  document.querySelectorAll('[data-buy]').forEach(b => b.onclick = act(async () => { const it = S.items.find(i => i.id === b.dataset.buy);
    if (it.price >= 1e6 && !confirm(`Buy ${it.name} for ${fmt(it.price)} Hawk Bucks?`)) return;
    apply(await api('POST', '/shop/buy', { itemId: it.id })); tryOn = null; sfx.play(it.rarity === 'mythic' || it.rarity === 'legendary' ? 'jackpot' : 'cash'); fx.burst(it.rarity === 'mythic' ? 260 : 90); toast(`${it.emoji} ${it.name} is yours!`); redo(); }));
  document.querySelectorAll('[data-boost]').forEach(b => b.onclick = act(async () => { apply(await api('POST', '/shop/booster', { id: b.dataset.boost })); sfx.play('cash'); fx.burst(60); toast('Booster active!'); redo(); }));
  document.querySelectorAll('[data-equip]').forEach(b => b.onclick = act(async () => { apply(await api('POST', '/shop/equip', { slot: b.dataset.slot, itemId: b.dataset.equip })); tryOn = null; sfx.play('flip'); redo(); }));
  document.querySelectorAll('[data-unequip]').forEach(b => b.onclick = act(async () => { apply(await api('POST', '/shop/equip', { slot: b.dataset.unequip, itemId: null })); sfx.play('tap'); redo(); }));
  document.querySelectorAll('[data-recharge]').forEach(b => b.onclick = act(async () => { apply(await api('POST', '/shop/recharge', { itemId: b.dataset.recharge })); sfx.play('cash'); toast('⚡ Fully charged'); redo(); }));
}

/* gifts and messages from the admin */
async function checkNotes() {
  if (!U) return;
  try { const r = await api('GET', '/notes'); if (!r.notes.length) return; setBal(r.balance);
    showModal(`<div class="bigbadge">🎁</div><h2>Message from the admin</h2>${r.notes.map(n => `<p>${esc(n.msg)}</p>`).join('')}<button class="btn gold" data-close>Nice!</button>`); fx.burst(140); sfx.play('big');
    const m = await api('GET', '/me'); U = m.user || U; paintMe(); } catch (e) {}
}
setInterval(() => { if (!document.hidden) checkNotes(); }, 20000);

/* ---------- admin: players, money, items, luck, shop, log ---------- */
let admTab = 'players', admSel = null;
async function renderAdmin(my) {
  if (!U.isAdmin) { location.hash = '#home'; return; }
  const tabs = `<div class="sub">${[['players', '👥 Players'], ['mode', '🏫 Site mode'], ['shop', '🛍️ Shop'], ['log', '📜 Log'], ['lines', '🏈 Football']].map(([k, l]) => `<button class="pill ${admTab === k ? 'on' : ''}" data-at="${k}">${l}</button>`).join('')}</div>`;
  const wire = () => document.querySelectorAll('[data-at]').forEach(b => b.onclick = () => { admTab = b.dataset.at; renderAdmin(nav); });
  if (admTab === 'lines') { await renderLines(my); if (my !== nav) return; $('#app').insertAdjacentHTML('afterbegin', `<h1>🛠️ Admin</h1>${tabs}`); return wire(); }
  if (admTab === 'mode') {
    const c = await api('GET', '/admin/mode'); if (my !== nav) return; const sc = c.schedule, D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    $('#app').innerHTML = `<h1>🛠️ Admin</h1>${tabs}<div class="panel adm"><h2>Site mode</h2>
      <div class="modecards"><button class="modecard ${c.mode === 'full' ? 'on' : ''}" data-mode="full"><b>🎰 HawkBet</b><span>Everything: all games, sports picks, luck, bets.</span></button>
        <button class="modecard ${c.mode === 'school' ? 'on' : ''}" data-mode="school"><b>🏫 Seahawk Arcade</b><span>School Edition: only the 7 skill games. No bets, no chance games, no sports picks. Skill scores earn Hawk Bucks (up to ${fmt(SCHOOLR.cap)} a day). The server blocks everything else.</span></button></div>
      <div class="note">Right now the site is in <b>${c.now.mode === 'school' ? '🏫 School Edition' : '🎰 HawkBet'}</b> mode${c.now.source === 'schedule' ? ' (set by the schedule)' : ''}. Balances and items carry over when you switch. Bets still open in chance games are refunded when School mode starts.</div></div>
    <div class="panel adm"><h2>⏰ Auto-schedule</h2><label class="chk"><input type="checkbox" id="son" ${sc.on ? 'checked' : ''}> Switch to School Edition automatically during school hours (Eastern time). Off by default.</label>
      <div class="admrow">${D.map((d, i) => `<button class="pill ${sc.days.includes(i) ? 'on' : ''}" data-day="${i}">${d}</button>`).join('')}</div>
      <div class="admrow"><label>From <input type="time" id="sst" value="${sc.start}"></label><label>Until <input type="time" id="sen" value="${sc.end}"></label><button class="btn" id="ssave">Save schedule</button></div>
      <div class="note">With the schedule on, the manual setting above is used outside school hours. Every change is written to the admin log. If a teacher or IT approved the site, tell them this switch exists.</div></div>`;
    wire();
    document.querySelectorAll('[data-mode]').forEach(b => b.onclick = act(async () => { if (!confirm(b.dataset.mode === 'school' ? 'Switch to Seahawk Arcade (School Edition)?' : 'Switch to full HawkBet?')) return; await api('POST', '/admin/mode', { mode: b.dataset.mode }); toast('Mode saved'); await go(); }));
    const days = new Set(sc.days); document.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { const d = +b.dataset.day; days.has(d) ? days.delete(d) : days.add(d); b.classList.toggle('on', days.has(d)); });
    $('#ssave').onclick = act(async () => { await api('POST', '/admin/mode', { schedule: { on: $('#son').checked, days: [...days], start: $('#sst').value, end: $('#sen').value } }); toast('Schedule saved'); await go(); });
    return;
  }
  if (admTab === 'log') {
    const { log } = await api('GET', '/admin/log'); if (my !== nav) return;
    $('#app').innerHTML = `<h1>🛠️ Admin</h1>${tabs}<div class="panel"><table class="lb"><tr><th>When</th><th>Admin</th><th>Action</th><th>Player</th><th>Detail</th></tr>
      ${log.map(l => `<tr><td class="mutecell">${new Date(l.ts).toLocaleString()}</td><td>${esc(l.admin)}</td><td><b>${esc(l.action)}</b></td><td>${esc(l.target || '')}</td><td class="mutecell">${esc(l.detail || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="mutecell">Nothing yet.</td></tr>'}</table></div>`;
    return wire();
  }
  if (admTab === 'shop') {
    const r = await api('GET', '/admin/shop'); if (my !== nav) return; const cfg = r.shop;
    $('#app').innerHTML = `<h1>🛠️ Admin</h1>${tabs}<div class="panel adm"><h2>Store-wide sale</h2><div class="admrow"><input id="sale" type="number" min="0" max="90" value="${cfg.sale || 0}"> % off <button class="btn" id="saleb">Set sale</button></div></div>
      <div class="panel adm"><h2>Items</h2><table class="lb"><tr><th>Item</th><th>Rarity</th><th>Default</th><th>Price</th><th>For sale</th></tr>
      ${r.items.filter(i => i.id !== 'skin_classic').map(i => { const c = cfg.items[i.id] || {}; return `<tr><td>${ITEM_EMO[i.id] || i.emoji} ${esc(i.name)}</td><td>${RARITY[i.rarity][0]}</td><td class="mutecell">${fmt(i.price)}</td>
        <td><input type="number" min="0" class="pricein" data-pid="${i.id}" value="${c.price ?? i.price}"></td><td><button class="pill ${c.off ? '' : 'on'}" data-toff="${i.id}" data-off="${c.off ? 1 : 0}">${c.off ? 'Off' : 'On'}</button></td></tr>`; }).join('')}</table>
      <div class="note">Change a price and press Enter. Mythic gates (level, prerequisites, leaderboard winnings) still apply.</div></div>`;
    $('#saleb').onclick = act(async () => { await api('POST', '/admin/shop', { sale: Math.floor(+$('#sale').value || 0) }); toast('Sale updated'); renderAdmin(nav); });
    document.querySelectorAll('.pricein').forEach(i => i.onchange = act(async () => { await api('POST', '/admin/shop', { itemId: i.dataset.pid, price: Math.floor(+i.value) }); toast('Price saved'); }));
    document.querySelectorAll('[data-toff]').forEach(b => b.onclick = act(async () => { await api('POST', '/admin/shop', { itemId: b.dataset.toff, off: b.dataset.off !== '1' }); renderAdmin(nav); }));
    return wire();
  }
  const [{ users }, shop] = await Promise.all([api('GET', '/admin/users'), api('GET', '/admin/shop')]); if (my !== nav) return;
  const sel = users.find(u => u.username === admSel);
  const luckOpts = ['normal', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'x2', 'x5', 'x10'];
  $('#app').innerHTML = `<h1>🛠️ Admin</h1>${tabs}
    <div class="panel adm"><h2>🎁 Give everyone Hawk Bucks</h2><div class="admrow"><input id="allamt" type="number" placeholder="Amount (e.g. 1000)"><input id="allnote" placeholder="Note, e.g. Happy Homecoming!" maxlength="120"><button class="btn gold" id="allgo">Send to everyone</button></div></div>
    <div class="admgrid"><div class="panel"><table class="lb plist"><tr><th></th><th>Player</th><th>Balance</th><th>Lvl</th><th>Net</th><th>Luck</th><th>Last played</th></tr>
      ${users.map(u => `<tr class="${u.username === admSel ? 'me' : ''} ${u.banned ? 'banned' : ''}" data-pu="${esc(u.username)}"><td>${avatar(u.gear, 28)}</td><td><b>${esc(u.username)}</b>${u.isAdmin ? ' 🛠️' : ''}${u.banned ? ' 🚫' : ''}</td><td>${fmt(u.balance)}</td><td>${u.level}</td><td>${fmt(u.net)}</td><td>${esc(String(u.luck))}</td><td class="mutecell">${u.last ? new Date(u.last).toLocaleDateString() : '–'}</td></tr>`).join('')}</table></div>
    <div class="panel adm admside">${sel ? `<div class="admwho">${avatar(sel.gear, 72)}<div><h2>${esc(sel.username)}</h2><small>${fmt(sel.balance)} 🪙 · Level ${sel.level} · ${sel.items.length} items</small></div></div>
      <h3>💰 Give or take Hawk Bucks</h3><div class="admrow"><input id="amt" type="number" placeholder="Amount (negative takes)"><input id="anote" placeholder="Note (optional)" maxlength="120"></div><button class="btn" id="amtgo">Send</button>
      <h3>🧮 Set exact balance</h3><div class="admrow"><input id="setbal" type="number" min="0" value="${sel.balance}"><button class="btn alt" id="setgo">Set</button></div>
      <h3>🎁 Give or take an item</h3><div class="admrow"><select id="itsel">${shop.items.filter(i => i.id !== 'skin_classic').map(i => `<option value="${i.id}">${ITEM_EMO[i.id] || i.emoji} ${esc(i.name)}${sel.items.includes(i.id) ? ' (owned)' : ''}</option>`).join('')}</select></div>
      <div class="duo"><button class="btn alt" id="itgive">Give item</button><button class="btn alt" id="ittake">Take item</button></div>
      <h3>🍀 Luck override (Luck Lab)</h3><div class="admrow"><select id="lk">${luckOpts.map(l => `<option ${String(l) === String(sel.luck) ? 'selected' : ''} value="${l}">${l === 'normal' ? 'No override (gear decides)' : String(l)[0] === 'x' ? 'Super Luck ' + l : 'Level ' + l}</option>`).join('')}</select><button class="btn alt" id="lkgo">Set</button></div>
      <h3>🔑 Reset password</h3><div class="admrow"><input id="pw" type="text" placeholder="New password (6+)" autocomplete="off"><button class="btn alt" id="pwgo">Reset</button></div>
      ${sel.isAdmin ? '' : `<h3>🚫 Ban</h3><button class="btn ${sel.banned ? '' : 'alt'}" id="ban">${sel.banned ? 'Unban player' : 'Ban player'}</button>`}`
      : '<div class="empty">👈 Pick a player to manage them.</div>'}</div></div>`;
  wire();
  document.querySelectorAll('[data-pu]').forEach(r => r.onclick = () => { admSel = r.dataset.pu; renderAdmin(nav); });
  $('#allgo').onclick = act(async () => { const n = Math.floor(+$('#allamt').value); if (!n || !confirm(`Send ${fmt(n)} Hawk Bucks to every player?`)) return; const r = await api('POST', '/admin/money', { all: true, amount: n, note: $('#allnote').value }); toast(`Sent to ${r.count} players`); sfx.play('cash'); renderAdmin(nav); });
  if (!sel) return;
  const who = { username: sel.username }, done = msg => { toast(msg); sfx.play('cash'); renderAdmin(nav); };
  $('#amtgo').onclick = act(async () => { const n = Math.floor(+$('#amt').value); if (!n) return toast('Type an amount'); await api('POST', '/admin/money', { ...who, amount: n, note: $('#anote').value }); done(n > 0 ? `Sent ${fmt(n)} to ${sel.username}` : `Took ${fmt(-n)} from ${sel.username}`); });
  $('#setgo').onclick = act(async () => { await api('POST', '/admin/balance', { ...who, balance: Math.floor(+$('#setbal').value) }); done('Balance set'); });
  $('#itgive').onclick = act(async () => { await api('POST', '/admin/give-item', { ...who, itemId: $('#itsel').value }); done('Item given'); });
  $('#ittake').onclick = act(async () => { await api('POST', '/admin/take-item', { ...who, itemId: $('#itsel').value }); done('Item taken'); });
  $('#lkgo').onclick = act(async () => { const v = $('#lk').value, r = await api('POST', '/admin/luck', { ...who, luck: v === 'normal' || v[0] === 'x' ? v : +v }); if (sel.username === U.username) { U.luck = r.luck; CFG = null; } done('Luck set'); });
  $('#pwgo').onclick = act(async () => { await api('POST', '/admin/password', { ...who, password: $('#pw').value }); done('Password reset. Tell them the new one.'); });
  if ($('#ban')) $('#ban').onclick = act(async () => { if (!sel.banned && !confirm(`Ban ${sel.username}? They'll be logged out.`)) return; await api('POST', '/admin/ban', { ...who, banned: !sel.banned }); done(sel.banned ? 'Unbanned' : 'Banned'); });
}

/* ---------- levels, achievements, shell ---------- */
function paintLevel() {
  if (!U || !U.lvl) return; const l = U.lvl;
  $('#lvlnum').textContent = l.level; $('#lvlname').textContent = l.name; $('#xpfill').style.width = l.pct + '%'; $('#lvlchip').title = `${l.name} · ${fmt(l.xp)} XP${l.next ? ` · ${fmt(l.next - l.xp)} to ${l.nextName}` : ''}`;
}
function showModal(html) { const m = $('#modal'); m.innerHTML = `<div class="mbox">${html}</div>`; m.classList.remove('hidden'); const b = m.querySelector('[data-close]'); if (b) { b.onclick = closeModal; b.focus(); } }
const closeModal = () => $('#modal').classList.add('hidden');
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); document.body.classList.remove('drawer'); } });
function achToast(a) {
  const el = document.createElement('div'); el.className = 'achcard'; el.innerHTML = `<i>${a.icon}</i><div><b>Achievement unlocked!</b><small>${esc(a.title)} · +${a.xp} XP</small></div>`; $('#achstack').appendChild(el); sfx.play('pb');
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 420); }, 4200);
}
function levelUpModal(l) {
  showModal(`<div class="bigbadge">${l.to}</div><h2>LEVEL UP!</h2><p>You're now a <b>${esc(l.name)}</b>.<br>Reward: <b>+${fmt(l.reward)} 🪙</b> Hawk Bucks</p><button class="btn gold" data-close>Nice!</button>`);
  fx.burst(220); sfx.play('jackpot');
}
let progT = 0; const queueProgress = () => { clearTimeout(progT); progT = setTimeout(checkProgress, 1500); };
async function checkProgress() {
  if (!U) return;
  try {
    const r = await api('POST', '/progress'); U.lvl = r.level; paintLevel();
    r.achievements.forEach((a, i) => setTimeout(() => achToast(a), i * 700));
    if (r.levelUp) { setBal(r.balance); levelUpModal(r.levelUp); }
    refreshRewardDot();
  } catch (e) {}
}
async function refreshRewardDot() { try { const r = await api('GET', '/rewards'); $('#rwdot').classList.toggle('hidden', !(r.wheelReady || r.challenges.some(c => !c.claimed && c.progress >= c.goal))); } catch (e) {} }
// gentle break reminder: after 45 minutes of active play
let playedMin = 0; setInterval(() => { if (!U || document.hidden) return; if (++playedMin % 45 === 0) showModal(`<div class="bigbadge">⏰</div><h2>Take a break?</h2><p>You've been playing for ${playedMin} minutes. Stretch, grab some water, and come back later. HawkBet will still be here.</p><button class="btn" data-close>Keep playing</button>`); }, 60000);
/* ---------- Site Mode: HawkBet (all games) vs Seahawk Arcade (School Edition, skill games only) ---------- */
function renderOrig() {
  $('#origlist').innerHTML = gameList().map(g => `<a href="#arcade" data-og="${g.id}" style="--gc:${GAME_COLOR[g.id]}"><i>${g.emoji}</i><span>${esc(g.title)}</span></a>`).join('');
  $('#origtitle').textContent = SCHOOL() ? 'Skill Games' : 'HawkBet Originals';
}
function applyMode() {
  const s = SCHOOL(); document.body.classList.toggle('school', s);
  document.querySelector('.wordmark').innerHTML = s ? 'Seahawk<b>Arcade</b>' : 'Hawk<b>Bet</b>';
  document.title = s ? 'Seahawk Arcade – South Lakes' : "HawkBet – South Lakes Pick'em";
  $('.banner').textContent = s ? 'Seahawk Arcade · play for points · pretend Hawk Bucks only · not affiliated with South Lakes HS or FCPS' : 'Fake credits only · no real money · not affiliated with South Lakes HS or FCPS · lines are demo data';
  renderOrig();
}
let modeSeen = null;
function setMode(m) { if (!m) return; if (m !== MODE || modeSeen === null) { MODE = m; applyMode(); } modeSeen = m; }
setInterval(async () => { if (!U || document.hidden) return; try { const m = await api('GET', '/me'); if (m.mode !== MODE) { setMode(m.mode); toast(m.mode === 'school' ? '🏫 Switched to Seahawk Arcade (School Edition)' : '🎰 Switched to HawkBet'); go(); } } catch (e) {} }, 45000);
function initShell() {
  renderOrig();
  $('#origlist').addEventListener('click', e => { const a = e.target.closest('[data-og]'); if (!a) return; e.preventDefault(); game = a.dataset.og; arcCat = 'all'; if (location.hash === '#arcade') go(); else location.hash = '#arcade'; document.body.classList.remove('drawer'); });
  try { document.body.classList.toggle('sbc', localStorage.getItem('hb.sidebar') === 'min'); } catch (e) {}
  $('#sidecol').onclick = () => { const on = document.body.classList.toggle('sbc'); try { localStorage.setItem('hb.sidebar', on ? 'min' : 'open'); } catch (e) {} };
  const drawer = () => document.body.classList.toggle('drawer'); $('#menubtn').onclick = drawer; $('#tabmore').onclick = drawer; $('#scrim').onclick = () => document.body.classList.remove('drawer');
  $('#side').addEventListener('click', e => { if (e.target.closest('a')) document.body.classList.remove('drawer'); });
}
initShell(); setTimeout(() => { if (U) checkProgress(); }, 2500);
go();
})();
