'use strict';
/* HawkBet server: zero-dependency Node (>=22.5) + built-in SQLite.
   Fake credits only. The server is the only place balances change and outcomes are decided. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = +process.env.PORT || 8622;
const PROD = process.env.NODE_ENV === 'production';
const HOST = process.env.HOST || (PROD ? '0.0.0.0' : '127.0.0.1');
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // set when behind Fly/Render/Cloudflare so we read the real client IP
const INVITE_CODE = process.env.INVITE_CODE || ''; // if set, signups must include it (hand it out in class)
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, 'data', 'x')), 'backups');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'hawkbet.db');
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || '').toLowerCase(); // if set, only this username is admin; otherwise the first account is
const START_BAL = 1000, MAX_BAL = 1e15, CLAIM_AMT = 100, CLAIM_BELOW = 100, CLAIM_EVERY_MS = 24 * 3600e3;
const SESSION_MS = 30 * 24 * 3600e3;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT ${START_BAL} CHECK(balance>=0), is_admin INTEGER NOT NULL DEFAULT 0, last_claim INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS props(id INTEGER PRIMARY KEY, sport TEXT, who TEXT, lvl TEXT, vs TEXT, stat TEXT, type TEXT, line REAL NOT NULL,
  init TEXT, status TEXT NOT NULL DEFAULT 'open', actual REAL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS slips(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), mode TEXT NOT NULL, entry INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', mult REAL, payout INTEGER, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS slip_picks(slip_id INTEGER NOT NULL REFERENCES slips(id), prop_id INTEGER NOT NULL REFERENCES props(id),
  dir TEXT NOT NULL, line REAL NOT NULL, res TEXT, PRIMARY KEY(slip_id, prop_id));
CREATE TABLE IF NOT EXISTS rounds(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), game TEXT NOT NULL, bet INTEGER NOT NULL,
  state TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', mult REAL, payout INTEGER, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS txns(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, delta INTEGER NOT NULL, kind TEXT NOT NULL, ref INTEGER, balance INTEGER NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_slips_user ON slips(user_id); CREATE INDEX IF NOT EXISTS idx_rounds_user ON rounds(user_id, game, status);
`);
if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='added'").get()) db.exec('ALTER TABLE users ADD COLUMN added INTEGER NOT NULL DEFAULT 0'); // free top-ups so far
if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='super_net'").get()) db.exec('ALTER TABLE users ADD COLUMN super_net INTEGER NOT NULL DEFAULT 0'); // net result of Super Luck play, excluded from the leaderboard
if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='luck'").get()) db.exec("ALTER TABLE users ADD COLUMN luck TEXT NOT NULL DEFAULT 'normal'"); // Luck Lab (cosmetic)
db.exec(`CREATE TABLE IF NOT EXISTS scores(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), game TEXT NOT NULL, score INTEGER NOT NULL, detail TEXT, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_scores_game ON scores(game, score DESC); CREATE INDEX IF NOT EXISTS idx_scores_user ON scores(user_id, game);`);

/* demo lines: South Lakes' real Oct 22 slate, numbers invented. Seeded once; admin manages after that. */
if (!db.prepare('SELECT 1 FROM props LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO props(sport,who,lvl,vs,stat,type,line,init,created) VALUES(?,?,?,?,?,?,?,?,?)');
  [
    ['Volleyball', 'SL Girls Varsity', 'Varsity', 'vs Westfield · Thu 7:15 PM · Home', 'Sets won', 'Sets', 2.5],
    ['Volleyball', 'SL Girls Varsity', 'Varsity', 'vs Westfield · Thu 7:15 PM · Home', 'Total sets played', 'Sets', 3.5],
    ['Volleyball', 'SL Boys Varsity', 'Varsity', '@ Westfield · Thu 7:00 PM · Away', 'Sets won', 'Sets', 2.5],
    ['Volleyball', 'SL Girls JV', 'JV', 'vs Westfield · Thu 6:00 PM · Home', 'Sets won', 'Sets', 1.5],
    ['Volleyball', 'SL Girls Freshman', 'Frosh', 'vs Westfield · Thu 5:00 PM · Home', 'Sets won', 'Sets', 0.5],
    ['Football', 'SL Varsity', 'Varsity', 'Fri · next opponent TBD', 'Points scored', 'Points', 34.5],
    ['Football', 'SL Varsity + Opp', 'Varsity', 'Fri · next opponent TBD', 'Combined points', 'Points', 58.5],
    ['Football', 'SL JV', 'JV', '@ Madison · Thu 7:15 PM · Away', 'Points scored', 'Points', 24.5],
    ['Football', 'SL Freshman', 'Frosh', '@ Madison · Thu 5:30 PM · Away', 'Points scored', 'Points', 17.5],
    ['Flag Football', 'SL Girls Varsity', 'Varsity', '@ Meridian · Wed 8:00 PM · Away', 'Points scored', 'Points', 8.5],
    ['Field Hockey', 'SL Girls Varsity', 'Varsity', 'Next game TBD', 'Goals scored', 'Goals', 1.5],
    ['Field Hockey', 'SL Girls JV', 'JV', 'Next game TBD', 'Goals scored', 'Goals', 0.5],
  ].forEach(r => ins.run(...r, 'SL', Date.now()));
}

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };
const now = () => Date.now();
function tx(fn) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } }
function adjust(uid, delta, kind, ref = null) { // the only place a balance changes
  const u = db.prepare('SELECT balance FROM users WHERE id=?').get(uid), nb = Math.min(MAX_BAL, u.balance + delta); // ceiling keeps numbers exact
  if (nb < 0) bad('Not enough Hawk Bucks');
  db.prepare('UPDATE users SET balance=? WHERE id=?').run(nb, uid);
  db.prepare('INSERT INTO txns(user_id,delta,kind,ref,balance,ts) VALUES(?,?,?,?,?,?)').run(uid, delta, kind, ref, nb, now());
  return nb;
}
const balanceOf = uid => db.prepare('SELECT balance FROM users WHERE id=?').get(uid).balance;
function int(v, lo, hi, name) { if (!Number.isInteger(v) || v < lo || v > hi) bad(`${name} must be a whole number from ${lo} to ${hi}`); return v; }
const stake = (v, name = 'Bet') => { if (!Number.isInteger(v) || v < 1 || v > MAX_BAL) bad(`${name} must be a whole number of at least 1`); return v; }; // no bet limit beyond your balance
const rnd = () => crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;

/* ---------- auth ---------- */
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function newSession(uid, res) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(token), uid, now() + SESSION_MS);
  res.setHeader('Set-Cookie', `sp_sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${PROD ? '; Secure' : ''}`);
}
function userFrom(req) {
  const m = /(?:^|;\s*)sp_sid=([a-f0-9]{64})/.exec(req.headers.cookie || ''); if (!m) return null;
  const row = db.prepare('SELECT u.*, s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(sha(m[1]));
  if (!row || row.expires < now()) return null; return row;
}
const publicUser = u => ({ username: u.username, balance: u.balance, added: u.added || 0, luck: luckOut(u.luck), isAdmin: !!u.is_admin, canClaim: u.balance < CLAIM_BELOW && now() - u.last_claim >= CLAIM_EVERY_MS });
const hits = new Map(); // crude per-IP limiter for auth routes
function limit(ip) { const t = now(), a = (hits.get(ip) || []).filter(x => t - x < 600e3); a.push(t); hits.set(ip, a); if (a.length > 30) bad('Too many attempts, try again in a few minutes', 429); }

function register(ctx) {
  if (INVITE_CODE) {
    const a = Buffer.from(String(ctx.body.invite || '')), b = Buffer.from(INVITE_CODE);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) bad('Wrong invite code', 403);
  }
  const name = String(ctx.body.username || '').trim().toLowerCase(), pw = String(ctx.body.password || '');
  if (!/^[a-z0-9_]{3,20}$/.test(name)) bad('Username: 3–20 letters, numbers or _');
  if (pw.length < 6 || pw.length > 100) bad('Password must be at least 6 characters');
  const salt = crypto.randomBytes(16).toString('hex');
  const first = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
  try {
    const r = db.prepare('INSERT INTO users(username,salt,hash,is_admin,created) VALUES(?,?,?,?,?)').run(name, salt, hashPw(pw, salt), (ADMIN_USERNAME ? name === ADMIN_USERNAME : first) ? 1 : 0, now());
    newSession(Number(r.lastInsertRowid), ctx.res);
  } catch (e) { if (/UNIQUE/.test(e.message)) bad('That username is taken', 409); throw e; }
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE username=?').get(name)) };
}
function login(ctx) {
  const name = String(ctx.body.username || '').trim().toLowerCase(), u = db.prepare('SELECT * FROM users WHERE username=?').get(name);
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(ctx.body.password || ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
  if (!ok) bad('Wrong username or password', 401);
  newSession(u.id, ctx.res); return { user: publicUser(u) };
}

/* ---------- picks / slips ---------- */
const POWER = { 2: 3, 3: 5, 4: 10, 5: 20, 6: 37.5 };
const FLEX = { 3: { 3: 2.25, 2: 1.25 }, 4: { 4: 5, 3: 1.5 }, 5: { 5: 10, 4: 2, 3: 0.4 }, 6: { 6: 25, 5: 2, 4: 0.4 } };

function placeSlip(ctx) {
  const { mode, picks } = ctx.body, entry = stake(ctx.body.entry, 'Entry');
  if (!['power', 'flex'].includes(mode)) bad('Bad mode');
  if (!Array.isArray(picks) || picks.length < 2 || picks.length > 6) bad('Pick 2 to 6 players/teams');
  if (mode === 'flex' && picks.length < 3) bad('Flex needs at least 3 picks');
  const ids = new Set(picks.map(p => p.propId)); if (ids.size !== picks.length) bad('Duplicate pick');
  return tx(() => {
    const rows = picks.map(p => {
      if (!['more', 'less'].includes(p.dir)) bad('Bad pick direction');
      const pr = db.prepare('SELECT * FROM props WHERE id=?').get(p.propId);
      if (!pr) bad('Unknown line'); if (pr.status !== 'open') bad(`${pr.who} (${pr.stat}) is locked`);
      return { pr, dir: p.dir };
    });
    const sid = Number(db.prepare('INSERT INTO slips(user_id,mode,entry,created) VALUES(?,?,?,?)').run(ctx.user.id, mode, entry, now()).lastInsertRowid);
    rows.forEach(r => db.prepare('INSERT INTO slip_picks(slip_id,prop_id,dir,line) VALUES(?,?,?,?)').run(sid, r.pr.id, r.dir, r.pr.line));
    return { slipId: sid, balance: adjust(ctx.user.id, -entry, 'slip_entry', sid) };
  });
}
function settleSlip(sid) {
  const s = db.prepare('SELECT * FROM slips WHERE id=?').get(sid);
  const picks = db.prepare('SELECT sp.*, p.status AS pstatus, p.actual FROM slip_picks sp JOIN props p ON p.id=sp.prop_id WHERE sp.slip_id=?').all(sid);
  if (s.status !== 'open' || picks.some(p => p.pstatus === 'open' || p.pstatus === 'locked')) return;
  let hits = 0, valid = 0;
  for (const p of picks) {
    let res = 'push';
    if (p.pstatus === 'graded' && p.actual !== p.line) { res = (p.actual > p.line) === (p.dir === 'more') ? 'win' : 'lose'; }
    db.prepare('UPDATE slip_picks SET res=? WHERE slip_id=? AND prop_id=?').run(res, sid, p.prop_id);
    if (res !== 'push') valid++; if (res === 'win') hits++;
  }
  let mult, status;
  if (valid < 2) { mult = 1; status = 'void'; } // not enough live picks: refund
  else {
    const table = s.mode === 'flex' && valid >= 3 ? FLEX[valid] : null;
    mult = table ? (table[hits] || 0) : (hits === valid ? POWER[valid] : 0);
    status = mult > 0 ? 'won' : 'lost';
  }
  const payout = Math.round(s.entry * mult);
  db.prepare('UPDATE slips SET status=?, mult=?, payout=? WHERE id=?').run(status, mult, payout, sid);
  if (payout > 0) adjust(s.user_id, payout, status === 'void' ? 'slip_refund' : 'slip_win', sid);
}
function settleProp(propId) {
  db.prepare("SELECT DISTINCT sp.slip_id FROM slip_picks sp JOIN slips s ON s.id=sp.slip_id WHERE sp.prop_id=? AND s.status='open'").all(propId).forEach(r => settleSlip(r.slip_id));
}
function mySlips(ctx) {
  const slips = db.prepare('SELECT * FROM slips WHERE user_id=? ORDER BY id DESC LIMIT 100').all(ctx.user.id);
  const q = db.prepare('SELECT sp.dir, sp.line, sp.res, p.who, p.stat, p.vs, p.status, p.actual FROM slip_picks sp JOIN props p ON p.id=sp.prop_id WHERE sp.slip_id=?');
  return { slips: slips.map(s => ({ ...s, picks: q.all(s.id) })) };
}

/* ---------- admin ---------- */
const admin = fn => ctx => { if (!ctx.user.is_admin) bad('Admins only', 403); return fn(ctx); };
function addProp(ctx) {
  const b = ctx.body, line = Number(b.line), t = k => String(b[k] || '').trim().slice(0, 80);
  if (!t('who') || !t('stat') || !Number.isFinite(line)) bad('Need who, stat and a numeric line');
  db.prepare('INSERT INTO props(sport,who,lvl,vs,stat,type,line,init,created) VALUES(?,?,?,?,?,?,?,?,?)').run(t('sport') || 'Football', t('who'), t('lvl') || 'Varsity', t('vs'), t('stat'), t('type') || 'Points', line, (t('init') || 'SL').slice(0, 3), now());
  return { ok: true };
}
function setProp(ctx, kind) {
  const id = int(ctx.body.propId, 1, 1e9, 'propId'), p = db.prepare('SELECT * FROM props WHERE id=?').get(id); if (!p) bad('Unknown line', 404);
  return tx(() => {
    if (kind === 'lock') { if (p.status !== 'open') bad('Not open'); db.prepare("UPDATE props SET status='locked' WHERE id=?").run(id); }
    else if (kind === 'void') { if (p.status === 'graded') bad('Already graded'); db.prepare("UPDATE props SET status='void' WHERE id=?").run(id); settleProp(id); }
    else {
      const actual = Number(ctx.body.actual); if (!Number.isFinite(actual) || ctx.body.actual === '' || ctx.body.actual === null) bad('Enter the actual result');
      if (p.status === 'graded' || p.status === 'void') bad('Already settled');
      db.prepare("UPDATE props SET status='graded', actual=? WHERE id=?").run(actual, id); settleProp(id);
    }
    return { ok: true };
  });
}

/* ---------- arcade ---------- */
const PLINKO_RISK = { low: [3.698, 1.0], med: [6.182, 1.0], high: [9.588, 1.2] }; // [steepness a, curve q]: slot payout is proportional to e^(a·d^q), d = distance from centre (0..1)
const plinkoCache = {};
function plinkoMults(n, risk) {
  const key = n + risk; if (plinkoCache[key]) return plinkoCache[key];
  const [fl, pw] = PLINKO_RISK[risk], probs = [], raw = []; let c = 1;
  for (let k = 0; k <= n; k++) { probs.push(c / 2 ** n); c = c * (n - k) / (k + 1); }
  for (let k = 0; k <= n; k++) raw.push(Math.exp(fl * Math.pow(Math.abs(k - n / 2) / (n / 2), pw)));
  const rtp = raw.reduce((a, r, k) => a + r * probs[k], 0);
  return (plinkoCache[key] = raw.map(r => r * 0.99 / rtp));
}
const MINES_N = 25, minesMult = (k, m) => { let r = 0.99; for (let i = 0; i < k; i++) r *= (MINES_N - i) / (MINES_N - m - i); return r; };
/* Luck: k = 0.6 (level 1) … 1.0 (level 5 / Normal) … 1.5 (level 10). In the five luck games it multiplies your chance to win,
   and payouts shrink to match, so the average payback (RTP) is identical at every level. Locked in when a round starts. */
const luckInfo = u => { // k = how strongly odds move; pk = how strongly payouts move
  const l = u && u.luck; if (l == null || l === 'normal') return { k: 1, pk: 1, sup: 0 };
  if (l[0] === 'x') return { k: Number(l.slice(1)), pk: 1, sup: 1 }; // Super Luck: odds improve, payouts do NOT shrink
  const k = 0.5 + 0.1 * Number(l); return { k, pk: k, sup: 0 };
};
const luckK = u => luckInfo(u).k;
// Chance of winning when the normal chance is p0. Regular luck multiplies it; Super Luck divides your chance to LOSE by k.
const winP = (p0, L) => L.sup ? Math.min(0.97, 1 - (1 - p0) / L.k) : clampP(p0 * L.k);
const payP = (p0, L) => clampP(p0 * L.pk); // the chance the payout table is priced at
const clampP = (p, lo = 0.05, hi = 0.9) => Math.min(hi, Math.max(lo, p));
const LANES = 10, CROSS_P = { easy: 0.92, med: 0.82, hard: 0.68, extreme: 0.5 };
const crossP = (d, k) => clampP(1 - (1 - CROSS_P[d]) / k, 0.05, 0.98); // luck divides the chance of getting hit
const crossMult = (n, p) => 0.99 / Math.pow(p, n);
const stCrossP = st => st.pp ?? st.p ?? CROSS_P[st.diff]; // payout pricing (st.p is the chance used to roll the lanes)

function activeRound(uid, game) { return db.prepare("SELECT * FROM rounds WHERE user_id=? AND game=? AND status='active'").get(uid, game); }
function startRound(ctx, game, state) {
  const bet = stake(ctx.body.bet);
  if (activeRound(ctx.user.id, game)) bad('Finish your current round first', 409);
  const id = Number(db.prepare('INSERT INTO rounds(user_id,game,bet,state,created) VALUES(?,?,?,?,?)').run(ctx.user.id, game, bet, JSON.stringify(state), now()).lastInsertRowid);
  return { id, bet, balance: adjust(ctx.user.id, -bet, game + '_bet', id) };
}
function superNet(uid, delta) { db.prepare('UPDATE users SET super_net=super_net+? WHERE id=?').run(delta, uid); }
function finishRound(r, status, mult) {
  const payout = status === 'cashed' ? Math.round(r.bet * mult) : 0;
  try { if (JSON.parse(r.state).sup) superNet(r.user_id, payout - r.bet); } catch (e) {}
  db.prepare('UPDATE rounds SET status=?, mult=?, payout=? WHERE id=?').run(status, mult, payout, r.id);
  return { payout, balance: payout ? adjust(r.user_id, payout, r.game + '_win', r.id) : balanceOf(r.user_id) };
}
const live = (ctx, game) => { const r = activeRound(ctx.user.id, game); if (!r) bad('No active round', 409); return { r, st: JSON.parse(r.state) }; };
const save = (r, st) => db.prepare('UPDATE rounds SET state=? WHERE id=?').run(JSON.stringify(st), r.id);

const arcade = {
  config: ctx => ({ maxBet: null, cross: Object.fromEntries(Object.keys(CROSS_P).map(d => [d, Array.from({ length: LANES }, (_, i) => crossMult(i + 1, crossP(d, luckInfo(ctx.user).pk)))])) }),
  plinkoTable: ctx => { const rows = int(+ctx.url.searchParams.get('rows'), 8, 16, 'rows'), risk = ctx.url.searchParams.get('risk'); if (!PLINKO_RISK[risk]) bad('Bad risk'); return { mults: plinkoMults(rows, risk) }; },
  plinko: ctx => tx(() => {
    const rows = int(ctx.body.rows, 8, 16, 'Rows'), risk = ctx.body.risk; if (!PLINKO_RISK[risk]) bad('Bad risk');
    const bet = stake(ctx.body.bet); adjust(ctx.user.id, -bet, 'plinko_bet');
    const path = Array.from({ length: rows }, () => crypto.randomInt(2)), k = path.reduce((a, b) => a + b, 0), mult = plinkoMults(rows, risk)[k], payout = Math.round(bet * mult);
    const id = Number(db.prepare("INSERT INTO rounds(user_id,game,bet,state,status,mult,payout,created) VALUES(?,?,?,?,?,?,?,?)").run(ctx.user.id, 'plinko', bet, JSON.stringify({ rows, risk, path }), 'done', mult, payout, now()).lastInsertRowid);
    const balance = payout ? adjust(ctx.user.id, payout, 'plinko_win', id) : balanceOf(ctx.user.id);
    return { path, k, mult, payout, bet, balance };
  }),
  active: ctx => {
    const game = ctx.url.searchParams.get('game'), r = ['mines', 'cross'].includes(game) && activeRound(ctx.user.id, game); if (!r) return { round: null };
    const st = JSON.parse(r.state);
    return game === 'mines' ? { round: { id: r.id, bet: r.bet, m: st.m, opened: st.opened, mult: minesMult(st.opened.length, st.m) } }
      : { round: { id: r.id, bet: r.bet, diff: st.diff, at: st.at, mult: crossMult(st.at, stCrossP(st)) } };
  },
  minesStart: ctx => tx(() => {
    const m = int(ctx.body.mines, 1, 24, 'Mines'), set = new Set(); while (set.size < m) set.add(crypto.randomInt(MINES_N));
    return { ...startRound(ctx, 'mines', { m, mines: [...set], opened: [] }), m };
  }),
  minesReveal: ctx => tx(() => {
    const { r, st } = live(ctx, 'mines'), i = int(ctx.body.i, 0, MINES_N - 1, 'Locker'); if (st.opened.includes(i)) bad('Already open');
    if (st.mines.includes(i)) return { bust: true, mines: st.mines, ...finishRound(r, 'lost', 0) };
    st.opened.push(i); const mult = minesMult(st.opened.length, st.m);
    if (st.opened.length === MINES_N - st.m) return { safe: true, opened: st.opened, mult, cashed: true, mines: st.mines, ...finishRound(r, 'cashed', mult) };
    save(r, st); return { safe: true, opened: st.opened, mult, balance: balanceOf(ctx.user.id) };
  }),
  minesCash: ctx => tx(() => {
    const { r, st } = live(ctx, 'mines'); if (!st.opened.length) bad('Open a locker first');
    return { mult: minesMult(st.opened.length, st.m), mines: st.mines, ...finishRound(r, 'cashed', minesMult(st.opened.length, st.m)) };
  }),
  crossStart: ctx => tx(() => {
    const diff = ctx.body.diff; if (!CROSS_P[diff]) bad('Bad difficulty');
    const L = luckInfo(ctx.user), p = crossP(diff, L.k); let crash = LANES + 1; for (let n = 1; n <= LANES; n++) if (rnd() > p) { crash = n; break; }
    return { ...startRound(ctx, 'cross', { diff, p, pp: crossP(diff, L.pk), crash, at: 0, sup: L.sup }), diff };
  }),
  crossStep: ctx => tx(() => {
    const { r, st } = live(ctx, 'cross'), n = st.at + 1;
    if (n === st.crash) return { hit: true, lane: n, ...finishRound(r, 'lost', 0) };
    st.at = n; const mult = crossMult(n, stCrossP(st));
    if (n === LANES) return { at: n, mult, cashed: true, ...finishRound(r, 'cashed', mult) };
    save(r, st); return { at: n, mult, balance: balanceOf(ctx.user.id) };
  }),
  crossCash: ctx => tx(() => {
    const { r, st } = live(ctx, 'cross'); if (st.at < 1) bad('Take a step first');
    return { mult: crossMult(st.at, stCrossP(st)), ...finishRound(r, 'cashed', crossMult(st.at, stCrossP(st))) };
  }),
};

/* ---------- more arcade games ---------- */
function oneShot(ctx, game, state, mult, bet = stake(ctx.body.bet)) { // bet, decide and pay in one transaction
  adjust(ctx.user.id, -bet, game + '_bet');
  const payout = Math.round(bet * mult);
  if (state && state.sup) superNet(ctx.user.id, payout - bet);
  const id = Number(db.prepare("INSERT INTO rounds(user_id,game,bet,state,status,mult,payout,created) VALUES(?,?,?,?,'done',?,?,?)").run(ctx.user.id, game, bet, JSON.stringify(state), mult, payout, now()).lastInsertRowid);
  return { bet, mult, payout, balance: payout ? adjust(ctx.user.id, payout, game + '_win', id) : balanceOf(ctx.user.id) };
}
const FLIP_MAX = 10, flipMult = (n, p = 0.5) => 0.99 / p ** n; // at Normal p = 0.5, so each right call doubles (one 1% edge on the streak)
const RPS_MAX = 10, rpsMult = (n, p = 0.5) => 0.98 / p ** n;    // ties replay; p is the chance of winning a decisive throw
const streakP = ctx => winP(0.5, luckInfo(ctx.user)), streakPay = ctx => payP(0.5, luckInfo(ctx.user)); // win chance: 30% at luck 1 … 50% Normal … 75% at luck 10 … 75/90/95% at Super x2/x5/x10
const RIVALS = ['Westfield', 'Chantilly', 'Oakton', 'Centreville', 'Madison', 'Herndon'];
const ROULETTE_A = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]); // the "red" numbers, shown green here
const rColor = n => n === 0 ? 'gold' : ROULETTE_A.has(n) ? 'green' : 'blue';
function rouletteMult(b, n) {
  if (b.type === 'num') return n === b.value ? 36 : 0;
  if (n === 0) return 0;
  if (b.type === 'color') return rColor(n) === b.value ? 2 : 0;
  if (b.type === 'parity') return (n % 2 ? 'odd' : 'even') === b.value ? 2 : 0;
  if (b.type === 'half') return (n <= 18 ? 'low' : 'high') === b.value ? 2 : 0;
  if (b.type === 'dozen') return Math.ceil(n / 12) === b.value ? 3 : 0;
  return 0;
}
const ROULETTE_OK = { num: v => Number.isInteger(v) && v >= 0 && v <= 36, color: v => v === 'green' || v === 'blue', parity: v => v === 'odd' || v === 'even', half: v => v === 'low' || v === 'high', dozen: v => [1, 2, 3].includes(v) };
/* Seahawk Slots: 3 reels x 3 rows, 5 paylines, your bet is split across the lines.
   The hawk is WILD for everything except the trophy; three real trophies on a line is the 250x jackpot.
   Each reel is a fixed 25-stop strip and shows the stop plus the symbols above and below it. */
const SLOT_STRIP = ['hawk', 'pass', 'bus', 'pass', 'volley', 'bball', 'football', 'volley', 'football', 'bus', 'trophy', 'bus', 'hawk', 'pass', 'bball', 'pass', 'bball', 'bus', 'volley', 'pass', 'bus', 'football', 'pass', 'volley', 'bball'];
const SLOT_PAYS = { trophy: 1250, hawk: 120, football: 20, volley: 11, bball: 11, bus: 9, pass: 6 }; // multiples of the LINE bet (bet / 5)
const SLOT_LINES = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]]; // row index used on each of the 3 reels
function slotLine(a, b, c) { // the symbol that pays on this line, or null
  if (a === b && b === c) return a;
  if (a === 'trophy' || b === 'trophy' || c === 'trophy') return null;
  const non = [a, b, c].filter(x => x !== 'hawk');
  return non.length && non.every(x => x === non[0]) ? non[0] : null;
}
function slotGrid(stops) { return [0, 1, 2].map(r => stops.map(p => SLOT_STRIP[(p + r - 1 + SLOT_STRIP.length) % SLOT_STRIP.length])); } // grid[row][reel]
function slotWins(grid) {
  const wins = [];
  SLOT_LINES.forEach((L, line) => { const sym = slotLine(grid[L[0]][0], grid[L[1]][1], grid[L[2]][2]); if (sym) wins.push({ line, sym, pay: SLOT_PAYS[sym], cells: L.map((r, c) => [r, c]) }); });
  return wins;
}
const slotMult = wins => wins.reduce((a, w) => a + w.pay, 0) / SLOT_LINES.length; // payout as a multiple of the whole bet
const SLOT_RTP = (() => { const n = SLOT_STRIP.length; let r = 0; for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) r += slotMult(slotWins(slotGrid([a, b, c]))); return r / n ** 3; })();

/* blackjack: infinite deck, dealer stands on all 17s, blackjack pays 3:2, double on first two cards */
const card = () => ({ r: crypto.randomInt(13) + 1, s: crypto.randomInt(4) });
function hand(cs) { let t = 0, a = 0; for (const c of cs) { t += c.r === 1 ? 11 : Math.min(10, c.r); if (c.r === 1) a++; } while (t > 21 && a) { t -= 10; a--; } return t; }
const isBJ = cs => cs.length === 2 && hand(cs) === 21;
function bjView(r, st, done) {
  return { id: r.id, bet: r.bet, player: st.p, dealer: done ? st.d : [st.d[0]], pt: hand(st.p), dt: hand(done ? st.d : [st.d[0]]), canDouble: !done && st.p.length === 2 && !st.dbl, done };
}
function bjSettle(r, st) {
  const p = hand(st.p); let res;
  if (p > 21) res = 'bust';
  else if (isBJ(st.p) && !isBJ(st.d)) res = 'blackjack';
  else if (isBJ(st.d) && !isBJ(st.p)) res = 'lose';
  else { if (!isBJ(st.p)) while (hand(st.d) < 17) st.d.push(card()); const d = hand(st.d); res = d > 21 || p > d ? 'win' : p === d ? 'push' : 'lose'; }
  const mult = { blackjack: 2.5, win: 2, push: 1, lose: 0, bust: 0 }[res];
  save(r, st);
  return { ...bjView(r, st, true), result: res, ...finishRound(r, mult > 0 ? 'cashed' : 'lost', mult) };
}
const streakGame = (game, max, multFn) => ({
  start: ctx => tx(() => ({ ...startRound(ctx, game, { streak: 0, p: streakP(ctx), pp: streakPay(ctx), sup: luckInfo(ctx.user).sup }), p: streakP(ctx), pp: streakPay(ctx) })),
  cash: ctx => tx(() => { const { r, st } = live(ctx, game); if (st.streak < 1) bad('Win one first'); return { streak: st.streak, mult: multFn(st.streak, st.pp ?? st.p), ...finishRound(r, 'cashed', multFn(st.streak, st.pp ?? st.p)) }; }),
  win: (ctx, r, st, extra) => { st.streak++; const mult = multFn(st.streak, st.pp ?? st.p); if (st.streak >= max) return { ...extra, streak: st.streak, mult, cashed: true, ...finishRound(r, 'cashed', mult) }; save(r, st); return { ...extra, streak: st.streak, mult, balance: balanceOf(ctx.user.id) }; },
});
const flipG = streakGame('flip', FLIP_MAX, flipMult), rpsG = streakGame('rps', RPS_MAX, rpsMult);
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

Object.assign(arcade, {
  dice: ctx => tx(() => {
    const t = Math.round(Number(ctx.body.target) * 100) / 100, over = ctx.body.over === true;
    if (!Number.isFinite(t) || t < 2 || t > 98) bad('Target must be between 2 and 98');
    const L = luckInfo(ctx.user), z0 = over ? 100 - t : t, c2 = x => Math.round(Math.min(98, Math.max(2, x)) * 100) / 100;
    const zone = c2(L.sup ? 100 - (100 - z0) / L.k : z0 * L.k), edge = over ? 100 - zone : zone, zonePay = c2(z0 * L.pk); // luck resizes the win zone
    const roll = crypto.randomInt(10000) / 100, win = over ? roll > edge : roll < edge, pays = 0.99 / (zonePay / 100);
    return { roll, target: t, edge, zone, over, pays, win, ...oneShot(ctx, 'dice', { roll, t, edge, over, sup: L.sup }, win ? pays : 0) };
  }),
  limbo: ctx => tx(() => {
    const target = Math.round(Number(ctx.body.target) * 100) / 100;
    const L = luckInfo(ctx.user), min = Math.ceil(1.01 * L.pk * 100) / 100;
    if (!Number.isFinite(target) || target < min || target > 1000) bad(`Target must be ${min}x to 1000x`);
    // Regular luck: P(crash >= x) = 0.99k / x and a win pays target / k (RTP stays 99%). Super Luck: you get the best of k throws at normal payouts.
    const one = () => Math.min(1e6, Math.max(1, Math.floor(0.99 * (L.sup ? 1 : L.k) / (1 - rnd()) * 100) / 100));
    let crash = one(); if (L.sup) for (let i = 1; i < L.k; i++) crash = Math.max(crash, one());
    const win = crash >= target, pays = target / L.pk;
    return { crash, target, pays, win, ...oneShot(ctx, 'limbo', { crash, target, k: L.k, sup: L.sup }, win ? pays : 0) };
  }),
  slots: ctx => tx(() => {
    const stops = [0, 1, 2].map(() => crypto.randomInt(SLOT_STRIP.length)), grid = slotGrid(stops), wins = slotWins(grid), mult = slotMult(wins);
    return { grid, wins, stops, ...oneShot(ctx, 'slots', { stops }, mult) };
  }),
  roulette: ctx => tx(() => {
    const bets = ctx.body.bets; if (!Array.isArray(bets) || !bets.length || bets.length > 40) bad('Place 1 to 40 bets');
    let total = 0;
    for (const b of bets) { if (!ROULETTE_OK[b.type] || !ROULETTE_OK[b.type](b.value)) bad('Bad bet'); stake(b.amount, 'Chip'); total += b.amount; }
    const n = crypto.randomInt(37), won = bets.reduce((a, b) => a + b.amount * rouletteMult(b, n), 0);
    return { n, color: rColor(n), total, ...oneShot(ctx, 'roulette', { bets, n }, won / total, total) };
  }),
  flipStart: flipG.start, flipCash: flipG.cash,
  flip: ctx => tx(() => {
    const { r, st } = live(ctx, 'flip'), call = ctx.body.call; if (call !== 'heads' && call !== 'tails') bad('Call heads or tails');
    const won = rnd() < (st.p ?? 0.5), side = won ? call : call === 'heads' ? 'tails' : 'heads';
    if (side !== call) return { side, lost: true, streak: st.streak, ...finishRound(r, 'lost', 0) };
    return flipG.win(ctx, r, st, { side });
  }),
  rpsStart: rpsG.start, rpsCash: rpsG.cash,
  rps: ctx => tx(() => {
    const { r, st } = live(ctx, 'rps'), me = ctx.body.throw; if (!BEATS[me]) bad('Pick rock, paper or scissors');
    const rival = RIVALS[crypto.randomInt(RIVALS.length)], tie = crypto.randomInt(3) === 0; // ties stay 1 in 3; luck only changes who wins the rest
    const them = tie ? me : rnd() < (st.p ?? 0.5) ? BEATS[me] : Object.keys(BEATS).find(t => BEATS[t] === me);
    if (me === them) { save(r, st); return { me, them, rival, tie: true, streak: st.streak, mult: st.streak ? rpsMult(st.streak, st.pp ?? st.p) : 0, balance: balanceOf(ctx.user.id) }; }
    if (BEATS[me] !== them) return { me, them, rival, lost: true, streak: st.streak, ...finishRound(r, 'lost', 0) };
    return rpsG.win(ctx, r, st, { me, them, rival });
  }),
  bjStart: ctx => tx(() => {
    const st = { p: [card(), card()], d: [card(), card()], dbl: false }, s = startRound(ctx, 'bj', st), r = db.prepare('SELECT * FROM rounds WHERE id=?').get(s.id);
    if (isBJ(st.p) || isBJ(st.d)) return bjSettle(r, st);
    return { ...bjView(r, st, false), balance: s.balance };
  }),
  bjHit: ctx => tx(() => {
    const { r, st } = live(ctx, 'bj'); st.p.push(card());
    if (hand(st.p) >= 21) return bjSettle(r, st);
    save(r, st); return { ...bjView(r, st, false), balance: balanceOf(ctx.user.id) };
  }),
  bjStand: ctx => tx(() => { const { r, st } = live(ctx, 'bj'); return bjSettle(r, st); }),
  bjDouble: ctx => tx(() => {
    const { r, st } = live(ctx, 'bj'); if (st.p.length !== 2 || st.dbl) bad('You can only double on your first two cards');
    adjust(ctx.user.id, -r.bet, 'bj_bet', r.id); r.bet *= 2; db.prepare('UPDATE rounds SET bet=? WHERE id=?').run(r.bet, r.id);
    st.dbl = true; st.p.push(card()); return bjSettle(r, st);
  }),
});
const VIEWS = {
  rocket: (r, st) => ({ id: r.id, bet: r.bet, auto: st.auto, flying: now() - st.t0, rate: ROCKET_RATE }),
  mines: (r, st) => ({ id: r.id, bet: r.bet, m: st.m, opened: st.opened, mult: minesMult(st.opened.length, st.m) }),
  cross: (r, st) => ({ id: r.id, bet: r.bet, diff: st.diff, at: st.at, mult: crossMult(st.at, stCrossP(st)) }),
  flip: (r, st) => ({ id: r.id, bet: r.bet, streak: st.streak, mult: st.streak ? flipMult(st.streak, st.pp ?? st.p) : 0 }),
  rps: (r, st) => ({ id: r.id, bet: r.bet, streak: st.streak, mult: st.streak ? rpsMult(st.streak, st.pp ?? st.p) : 0 }),
  bj: (r, st) => bjView(r, st, false),
  memory: (r, st) => ({ id: r.id, bet: r.bet, moves: st.moves, matched: st.matched.map(i => ({ i, sym: st.deck[i] })), cards: st.deck.length }),
};
arcade.active = ctx => {
  const game = ctx.url.searchParams.get('game'), r = VIEWS[game] && activeRound(ctx.user.id, game);
  return { round: r ? VIEWS[game](r, JSON.parse(r.state)) : null };
};
const baseConfig = arcade.config;
arcade.config = ctx => ({ ...baseConfig(ctx), luck: { ...luckInfo(ctx.user), flipP: streakP(ctx), flipPay: streakPay(ctx), rpsP: streakP(ctx), rpsPay: streakPay(ctx) }, skillTiers: SKILL_TIERS, slots: { pays: SLOT_PAYS, lines: SLOT_LINES, rtp: SLOT_RTP }, flipMax: FLIP_MAX, rpsMax: RPS_MAX });

/* ---------- Seahawk Launch (crash): cash out before the rocket blows ----------
   The server picks the crash point and keeps the clock. The browser never learns the crash point early:
   /watch holds its reply until the next event (auto cash-out or crash). */
const ROCKET_RATE = Number(process.env.ROCKET_RATE) || 0.0001, ROCKET_LIFTOFF = 700, ROCKET_MAX = 1000; // multiplier = e^(rate·ms): 2x ≈ 7s, 10x ≈ 23s
const rocketAt = ms => Math.floor(Math.exp(ROCKET_RATE * Math.max(0, ms)) * 100) / 100;
const rocketTime = m => Math.log(m) / ROCKET_RATE; // ms after liftoff when the multiplier reaches m
function rocketSettle(r, st) { // settle a round whose outcome is already decided by the clock; returns null if still flying
  if (r.status !== 'active') return null;
  const t = now() - st.t0;
  if (st.auto && st.auto < st.c && t >= rocketTime(st.auto)) return { event: 'cashed', mult: st.auto, auto: true, ...finishRound(r, 'cashed', st.auto) };
  if (t >= rocketTime(st.c)) return { event: 'crash', crash: st.c, ...finishRound(r, 'lost', 0) };
  return null;
}
const rocketRound = (ctx, id) => { const r = db.prepare("SELECT * FROM rounds WHERE id=? AND user_id=? AND game='rocket'").get(id, ctx.user.id); if (!r) bad('No such flight', 404); return r; };
Object.assign(arcade, {
  rocketStart: ctx => tx(() => {
    const old = activeRound(ctx.user.id, 'rocket'); if (old && !rocketSettle(old, JSON.parse(old.state))) bad('Your rocket is still flying', 409);
    const auto = ctx.body.auto == null || ctx.body.auto === '' ? null : Math.round(Number(ctx.body.auto) * 100) / 100;
    if (auto !== null && !(auto >= 1.01 && auto <= ROCKET_MAX)) bad(`Auto cash-out must be 1.01x to ${ROCKET_MAX}x`);
    const c = Math.min(ROCKET_MAX, Math.max(1, Math.floor(0.99 / (1 - rnd()) * 100) / 100)); // P(crash >= x) = 0.99 / x, so RTP is 99%
    const s = startRound(ctx, 'rocket', { c, t0: now() + ROCKET_LIFTOFF, auto });
    return { ...s, auto, liftoff: ROCKET_LIFTOFF, rate: ROCKET_RATE };
  }),
  rocketCash: ctx => tx(() => {
    const r = activeRound(ctx.user.id, 'rocket'); if (!r) bad('No rocket in the air', 409);
    const st = JSON.parse(r.state), done = rocketSettle(r, st); if (done) return done; // too late: it already crashed or auto-cashed
    const m = rocketAt(now() - st.t0);
    return { event: 'cashed', mult: m, ...finishRound(r, 'cashed', m) };
  }),
  rocketWatch: ctx => { // resolves at the next event; called again after a cash-out to learn where it crashed
    const id = int(ctx.body.id, 1, 1e12, 'id'), r = rocketRound(ctx, id), st = JSON.parse(r.state);
    const autoFirst = r.status === 'active' && st.auto && st.auto < st.c, at = st.t0 + rocketTime(autoFirst ? st.auto : st.c);
    return new Promise(ok => setTimeout(ok, Math.max(0, at - now()) + 5)).then(() => tx(() => {
      const fresh = rocketRound(ctx, id), done = rocketSettle(fresh, st);
      if (done) return { ...done, crash: done.event === 'crash' ? st.c : undefined };
      return { event: 'crash', crash: st.c, already: true, balance: balanceOf(ctx.user.id) }; // you'd cashed out before this
    }));
  },
  rocketHistory: ctx => ({ crashes: db.prepare("SELECT state FROM rounds WHERE user_id=? AND game='rocket' AND status!='active' ORDER BY id DESC LIMIT 12").all(ctx.user.id).map(x => JSON.parse(x.state).c) }),
});

/* ---------- skill games: Bell Rush, Classroom Memory, Seahawk Trivia ----------
   Score-only (no Hawk Bucks at stake). The server holds all hidden state and keeps the clock. */
const SKILL_GAMES = ['bell', 'memory', 'trivia'];
// Optional bets: your score picks the payout. Luck has no effect on skill games.
const SKILL_TIERS = { bell: [[4100, 3], [3800, 2], [3500, 1.5], [3000, 1]], memory: [[2600, 3], [2300, 2], [2000, 1.5], [1700, 1]], trivia: [[900, 3], [750, 2], [600, 1.5], [450, 1]] };
const skillMult = (game, score) => (SKILL_TIERS[game].find(([min]) => score >= min) || [0, 0])[1];
function skillStart(ctx, game, state) {
  const bet = ctx.body.bet == null || ctx.body.bet === 0 ? 0 : stake(ctx.body.bet); // 0 = free practice
  db.prepare("UPDATE rounds SET status='abandoned' WHERE user_id=? AND game=? AND status='active'").run(ctx.user.id, game); // restarting forfeits an unfinished round
  const id = Number(db.prepare('INSERT INTO rounds(user_id,game,bet,state,created) VALUES(?,?,?,?,?)').run(ctx.user.id, game, bet, JSON.stringify(state), now()).lastInsertRowid);
  return { id, bet, balance: bet ? adjust(ctx.user.id, -bet, game + '_bet', id) : balanceOf(ctx.user.id) };
}
function skillFinish(ctx, r, st, score, detail = {}) {
  const prev = db.prepare('SELECT MAX(score) AS b FROM scores WHERE user_id=? AND game=?').get(ctx.user.id, r.game).b;
  const mult = r.bet ? skillMult(r.game, score) : 0, payout = Math.round(r.bet * mult);
  save(r, st); db.prepare("UPDATE rounds SET status='done', mult=?, payout=? WHERE id=?").run(mult, payout, r.id);
  db.prepare('INSERT INTO scores(user_id,game,score,detail,created) VALUES(?,?,?,?,?)').run(ctx.user.id, r.game, score, JSON.stringify(detail), now());
  const balance = payout ? adjust(ctx.user.id, payout, r.game + '_win', r.id) : balanceOf(ctx.user.id);
  return { done: true, score, best: Math.max(score, prev ?? 0), newBest: prev == null || score > prev, bet: r.bet, mult, payout, balance, ...detail };
}
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Bell Rush: 5 bells. The "ring" response is held until ring time, so the browser never knows when the bell will go.
const BELLS = 5, BELL_SCALE = Number(process.env.BELL_DELAY_SCALE) || 1, BELL_EARLY_MS = 90, BELL_SLOW_MS = 2000;
const bellPoints = ms => ms < BELL_EARLY_MS ? 0 : ms > BELL_SLOW_MS ? 0 : 1000 - ms; // <90ms after the ring = anticipated, counts as early
// Classroom Memory: 8 pairs. Score starts at 3000, -100 per extra pair attempt, -10 per second.
const MEM_PAIRS = 8, memoryScore = (moves, secs) => Math.max(0, Math.round(3000 - 100 * Math.max(0, moves - MEM_PAIRS) - 10 * secs));
// Seahawk Trivia: 7 questions, 20s each. 100 per right answer + speed bonus of 50 minus 5 per second taken.
const TRIVIA_N = 7, TRIVIA_SECS = 20, triviaPoints = (right, secs) => right && secs <= TRIVIA_SECS ? 100 + Math.max(0, 50 - Math.floor(secs * 5)) : 0;
const TRIVIA = [
  ['What is the South Lakes High School mascot?', ['Seahawks', 'Eagles', 'Falcons', 'Ospreys']],
  ['What are South Lakes’ school colors?', ['Royal blue and kelly green', 'Red and gold', 'Black and orange', 'Purple and white']],
  ['South Lakes High School is in which town?', ['Reston', 'Herndon', 'Vienna', 'Chantilly']],
  ['South Lakes plays in which athletic district?', ['Concorde', 'Liberty', 'Gunston', 'Patriot']],
  ['Which school system is South Lakes part of?', ['Fairfax County Public Schools', 'Loudoun County Public Schools', 'Arlington Public Schools', 'Prince William County Schools']],
  ['Which SL team won back-to-back VHSL Class 6 state titles in 2024 and 2025?', ['Boys basketball', 'Football', 'Girls soccer', 'Baseball']],
  ['How many sides does a hexagon have?', ['6', '5', '7', '8']],
  ['What is the chemical symbol for gold?', ['Au', 'Ag', 'Go', 'Gd']],
  ['Which planet is called the Red Planet?', ['Mars', 'Venus', 'Jupiter', 'Mercury']],
  ['Who wrote “Romeo and Juliet”?', ['William Shakespeare', 'Charles Dickens', 'Mark Twain', 'Jane Austen']],
  ['What is the square root of 144?', ['12', '14', '11', '16']],
  ['What is the largest ocean on Earth?', ['Pacific', 'Atlantic', 'Indian', 'Arctic']],
  ['What is the capital of Virginia?', ['Richmond', 'Norfolk', 'Virginia Beach', 'Alexandria']],
  ['How many continents are there?', ['7', '6', '5', '8']],
  ['Which gas do plants take in for photosynthesis?', ['Carbon dioxide', 'Oxygen', 'Nitrogen', 'Helium']],
  ['Which part of the cell is called its powerhouse?', ['Mitochondria', 'Nucleus', 'Ribosome', 'Cell wall']],
  ['Who was the first president of the United States?', ['George Washington', 'Thomas Jefferson', 'John Adams', 'Abraham Lincoln']],
  ['What is the longest river in Africa?', ['Nile', 'Congo', 'Niger', 'Zambezi']],
  ['Which of these is a prime number?', ['29', '21', '27', '33']],
  ['Who painted the Mona Lisa?', ['Leonardo da Vinci', 'Pablo Picasso', 'Vincent van Gogh', 'Michelangelo']],
  ['What is 15% of 200?', ['30', '15', '20', '35']],
  ['Water boils at what temperature in Celsius (at sea level)?', ['100°', '90°', '212°', '50°']],
]; // first choice is the right one; choices are shuffled per round

function triviaQuestion(st) {
  const q = st.qs[st.i];
  return { n: st.i + 1, total: TRIVIA_N, q: TRIVIA[q.k][0], a: q.order.map(j => TRIVIA[q.k][1][j]), secs: TRIVIA_SECS };
}
Object.assign(arcade, {
  bellStart: ctx => tx(() => ({ ...skillStart(ctx, 'bell', { i: 0, ring: null, taps: [] }), bells: BELLS })),
  bellNext: ctx => {
    const { ring, bell } = tx(() => {
      const { r, st } = live(ctx, 'bell'); if (st.ring) bad('Tap the bell that is ringing first');
      st.ring = now() + Math.round((1200 + crypto.randomInt(2800)) * BELL_SCALE); save(r, st);
      return { ring: st.ring, bell: st.i + 1 };
    });
    return new Promise(ok => setTimeout(() => ok({ ring: true, bell }), Math.max(0, ring - now())));
  },
  bellTap: ctx => tx(() => {
    const { r, st } = live(ctx, 'bell'); if (!st.ring) bad('Wait for the next bell');
    const ms = now() - st.ring, res = ms < BELL_EARLY_MS ? 'early' : ms > BELL_SLOW_MS ? 'slow' : 'ok', pts = bellPoints(ms);
    st.taps.push({ ms: res === 'ok' ? ms : null, pts, res }); st.i++; st.ring = null;
    const out = { bell: st.i, res, ms: res === 'early' ? null : ms, pts, total: st.taps.reduce((a, t) => a + t.pts, 0) };
    if (st.i >= BELLS) { const ok = st.taps.filter(t => t.ms != null).map(t => t.ms); return { ...out, ...skillFinish(ctx, r, st, out.total, { bestMs: ok.length ? Math.min(...ok) : null }) }; }
    save(r, st); return out;
  }),
  memoryStart: ctx => tx(() => ({ ...skillStart(ctx, 'memory', { deck: shuffle([...Array(MEM_PAIRS).keys(), ...Array(MEM_PAIRS).keys()]), open: [], matched: [], moves: 0, t0: now() }), cards: MEM_PAIRS * 2 })),
  memoryFlip: ctx => tx(() => {
    const { r, st } = live(ctx, 'memory'), i = int(ctx.body.i, 0, MEM_PAIRS * 2 - 1, 'Card');
    if (st.open.length === 2) st.open = []; // previous mismatch has been flipped back
    if (st.matched.includes(i) || st.open.includes(i)) bad('That card is already face up');
    st.open.push(i); const out = { i, sym: st.deck[i] };
    if (st.open.length === 2) {
      const [a, b] = st.open; st.moves++; out.pair = [a, b]; out.match = st.deck[a] === st.deck[b];
      if (out.match) { st.matched.push(a, b); st.open = []; }
    }
    out.moves = st.moves; out.matched = st.matched.length / 2;
    if (st.matched.length === MEM_PAIRS * 2) { const secs = Math.round((now() - st.t0) / 100) / 10; return { ...out, ...skillFinish(ctx, r, st, memoryScore(st.moves, secs), { moves: st.moves, secs }) }; }
    save(r, st); return out;
  }),
  triviaStart: ctx => tx(() => {
    const ks = shuffle([...TRIVIA.keys()]).slice(0, TRIVIA_N), st = { qs: ks.map(k => ({ k, order: shuffle([0, 1, 2, 3]) })), i: 0, score: 0, right: 0, asked: now() };
    return { ...skillStart(ctx, 'trivia', st), question: triviaQuestion(st) };
  }),
  triviaAnswer: ctx => tx(() => {
    const { r, st } = live(ctx, 'trivia'), choice = int(ctx.body.choice, 0, 3, 'Choice'), q = st.qs[st.i];
    const secs = (now() - st.asked) / 1000, answer = q.order.indexOf(0), right = choice === answer && secs <= TRIVIA_SECS, pts = triviaPoints(right, secs);
    st.score += pts; st.right += right ? 1 : 0; st.i++;
    const out = { right, answer, pts, score: st.score, timeout: secs > TRIVIA_SECS };
    if (st.i >= TRIVIA_N) return { ...out, ...skillFinish(ctx, r, st, st.score, { correct: st.right, of: TRIVIA_N }) };
    st.asked = now(); save(r, st); return { ...out, next: triviaQuestion(st) };
  }),
  highscores: ctx => {
    const game = ctx.url.searchParams.get('game'); if (!SKILL_GAMES.includes(game)) bad('Unknown game');
    return { top: db.prepare('SELECT u.username, MAX(s.score) AS best FROM scores s JOIN users u ON u.id=s.user_id WHERE s.game=? GROUP BY s.user_id ORDER BY best DESC, MIN(s.created) LIMIT 10').all(game) };
  },
  stats: ctx => { // personal bests: best multiplier won for chance games, best score for skill games
    const best = {};
    for (const x of db.prepare(`SELECT game, MAX(mult) AS mult, MAX(payout-bet) AS win FROM rounds WHERE user_id=? AND payout>bet AND game NOT IN (${SKILL_GAMES.map(() => '?').join(',')}) GROUP BY game`).all(ctx.user.id, ...SKILL_GAMES)) best[x.game] = { mult: x.mult, win: x.win };
    for (const x of db.prepare('SELECT game, MAX(score) AS score FROM scores WHERE user_id=? GROUP BY game').all(ctx.user.id)) best[x.game] = { score: x.score };
    const recent = db.prepare("SELECT game FROM rounds WHERE user_id=? GROUP BY game ORDER BY MAX(created) DESC LIMIT 6").all(ctx.user.id).map(x => x.game);
    return { best, recent };
  },
});

/* ---------- Luck Lab setting (see luckK): changes odds in five arcade games with RTP held constant; never touches picks or skill scores ---------- */
const parseLuck = v => v === 'normal' || v === 'x2' || v === 'x5' || v === 'x10' ? v : Number.isInteger(v) && v >= 1 && v <= 10 ? String(v) : null;
const luckOut = s => s === 'normal' || s == null ? 'normal' : s[0] === 'x' ? s : Number(s);
function setLuck(ctx) {
  const v = parseLuck(ctx.body.luck); if (v === null) bad('Luck must be "normal", a whole number from 1 to 10, or x2 / x5 / x10');
  db.prepare('UPDATE users SET luck=? WHERE id=?').run(v, ctx.user.id); return { luck: luckOut(v) };
}

/* ---------- bank: free Hawk Bucks top-ups (tracked so the leaderboard ranks real winnings) ---------- */
const BANK_AMOUNTS = [100, 500, 1000], BANK_MAX_BAL = 1e6, bankHits = new Map();
function bank(ctx) {
  const amt = ctx.body.amount; if (!BANK_AMOUNTS.includes(amt)) bad('Pick 100, 500 or 1,000');
  const t = now(), a = (bankHits.get(ctx.user.id) || []).filter(x => t - x < 600e3); if (a.length >= 30) bad('Slow down – try again in a few minutes', 429); a.push(t); bankHits.set(ctx.user.id, a);
  return tx(() => {
    if (balanceOf(ctx.user.id) + amt > BANK_MAX_BAL) bad('Your balance is already maxed out');
    db.prepare('UPDATE users SET added=added+? WHERE id=?').run(amt, ctx.user.id);
    return { balance: adjust(ctx.user.id, amt, 'bank'), added: db.prepare('SELECT added FROM users WHERE id=?').get(ctx.user.id).added };
  });
}

/* ---------- routes ---------- */
const need = fn => ctx => { if (!ctx.user) bad('Please log in', 401); return fn(ctx); };
const routes = {
  'GET /api/me': ctx => ({ user: ctx.user ? publicUser(ctx.user) : null, inviteRequired: !!INVITE_CODE }),
  'POST /api/register': ctx => { limit(ctx.ip); return register(ctx); },
  'POST /api/login': ctx => { limit(ctx.ip); return login(ctx); },
  'POST /api/logout': ctx => { const m = /sp_sid=([a-f0-9]{64})/.exec(ctx.req.headers.cookie || ''); if (m) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(m[1])); ctx.res.setHeader('Set-Cookie', `sp_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${PROD ? '; Secure' : ''}`); return { ok: true }; },
  'POST /api/claim': need(ctx => tx(() => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id);
    if (u.balance >= CLAIM_BELOW) bad(`You can claim only when under ${CLAIM_BELOW} Hawk Bucks`);
    if (now() - u.last_claim < CLAIM_EVERY_MS) bad('Come back tomorrow for another top-up');
    db.prepare('UPDATE users SET last_claim=?, added=added+? WHERE id=?').run(now(), CLAIM_AMT, u.id); return { balance: adjust(u.id, CLAIM_AMT, 'claim') };
  })),
  'GET /api/props': need(() => ({ props: db.prepare("SELECT id,sport,who,lvl,vs,stat,type,line,init,status,actual FROM props ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'locked' THEN 1 ELSE 2 END, id").all() })),
  'POST /api/slips': need(placeSlip),
  'GET /api/slips': need(mySlips),
  'GET /api/leaderboard': need(ctx => {
    // ranked by net winnings (balance minus the starting 1,000 and any free top-ups), so adding Hawk Bucks can't buy a top spot
    const top = db.prepare(`SELECT username, balance, balance-${START_BAL}-added-super_net AS net FROM users ORDER BY net DESC, id LIMIT 20`).all();
    const me = db.prepare(`SELECT username, balance, balance-${START_BAL}-added-super_net AS net FROM users WHERE id=?`).get(ctx.user.id);
    me.rank = db.prepare(`SELECT COUNT(*)+1 AS r FROM users WHERE balance-${START_BAL}-added-super_net>?`).get(me.net).r;
    return { top, me };
  }),
  'POST /api/admin/props': need(admin(addProp)),
  'POST /api/admin/lock': need(admin(c => setProp(c, 'lock'))),
  'POST /api/admin/grade': need(admin(c => setProp(c, 'grade'))),
  'POST /api/admin/void': need(admin(c => setProp(c, 'void'))),
  'GET /api/arcade/config': need(arcade.config),
  'GET /api/arcade/plinko-table': need(arcade.plinkoTable),
  'GET /api/arcade/active': need(arcade.active),
  'POST /api/arcade/plinko': need(arcade.plinko),
  'POST /api/arcade/mines/start': need(arcade.minesStart),
  'POST /api/arcade/mines/reveal': need(arcade.minesReveal),
  'POST /api/arcade/mines/cashout': need(arcade.minesCash),
  'POST /api/arcade/cross/start': need(arcade.crossStart),
  'POST /api/arcade/cross/step': need(arcade.crossStep),
  'POST /api/arcade/cross/cashout': need(arcade.crossCash),
  'POST /api/arcade/dice': need(arcade.dice),
  'POST /api/arcade/limbo': need(arcade.limbo),
  'POST /api/arcade/slots': need(arcade.slots),
  'POST /api/arcade/roulette': need(arcade.roulette),
  'POST /api/arcade/flip/start': need(arcade.flipStart),
  'POST /api/arcade/flip/call': need(arcade.flip),
  'POST /api/arcade/flip/cashout': need(arcade.flipCash),
  'POST /api/arcade/rps/start': need(arcade.rpsStart),
  'POST /api/arcade/rps/throw': need(arcade.rps),
  'POST /api/arcade/rps/cashout': need(arcade.rpsCash),
  'POST /api/arcade/bj/start': need(arcade.bjStart),
  'POST /api/arcade/bj/hit': need(arcade.bjHit),
  'POST /api/arcade/bj/stand': need(arcade.bjStand),
  'POST /api/arcade/bj/double': need(arcade.bjDouble),
  'POST /api/bank': need(bank),
  'POST /api/luck': need(setLuck),
  'GET /api/feed': need(() => ({
    bets: db.prepare("SELECT u.username, r.game, r.bet, r.mult, r.payout, r.created FROM rounds r JOIN users u ON u.id=r.user_id WHERE r.status IN ('done','cashed','lost') AND r.bet>0 ORDER BY r.id DESC LIMIT 14").all(),
    big: db.prepare("SELECT u.username, r.game, r.bet, r.mult, r.payout FROM rounds r JOIN users u ON u.id=r.user_id WHERE r.payout>r.bet AND r.mult>=5 AND r.created>? ORDER BY r.payout-r.bet DESC LIMIT 6").all(now() - 7 * 864e5),
    stats: { players: db.prepare('SELECT COUNT(*) AS n FROM users').get().n, rounds: db.prepare("SELECT COUNT(*) AS n FROM rounds WHERE status!='active'").get().n, biggest: db.prepare('SELECT COALESCE(MAX(mult),0) AS m FROM rounds WHERE payout>bet').get().m },
  })),
  'GET /api/arcade/stats': need(arcade.stats),
  'GET /api/arcade/highscores': need(arcade.highscores),
  'POST /api/arcade/bell/start': need(arcade.bellStart),
  'POST /api/arcade/bell/next': need(arcade.bellNext),
  'POST /api/arcade/bell/tap': need(arcade.bellTap),
  'POST /api/arcade/memory/start': need(arcade.memoryStart),
  'POST /api/arcade/memory/flip': need(arcade.memoryFlip),
  'POST /api/arcade/trivia/start': need(arcade.triviaStart),
  'POST /api/arcade/trivia/answer': need(arcade.triviaAnswer),
  'POST /api/arcade/rocket/start': need(arcade.rocketStart),
  'POST /api/arcade/rocket/cashout': need(arcade.rocketCash),
  'POST /api/arcade/rocket/watch': need(arcade.rocketWatch),
  'GET /api/arcade/rocket/history': need(arcade.rocketHistory),
};

const FILES = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js', '/logo.svg': 'logo.svg', '/hawk.svg': 'hawk.svg', '/rocket.svg': 'rocket.svg' };
const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', svg: 'image/svg+xml' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': CSP, ...(PROD ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}) });
  res.end(body);
};
function clientIp(req) { // only trust proxy headers when told we're behind one
  if (TRUST_PROXY) { const f = req.headers['fly-client-ip'] || req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',').pop().trim(); if (f) return f; }
  return req.socket.remoteAddress;
}
function sameOrigin(req) { // CSRF belt-and-braces on top of SameSite=Lax: browsers always send Origin on cross-site POSTs
  const o = req.headers.origin; if (!o) return true;
  try { return new URL(o).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch (e) { return false; }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), key = `${req.method} ${url.pathname}`;
  if (key === 'GET /healthz') { try { db.prepare('SELECT 1').get(); return send(res, 200, '{"ok":true}'); } catch (e) { return send(res, 503, '{"ok":false}'); } }
  if (!url.pathname.startsWith('/api/')) {
    const f = FILES[url.pathname]; if (req.method !== 'GET' || !f) return send(res, 404, 'Not found', 'text/plain');
    return send(res, 200, fs.readFileSync(path.join(__dirname, f)), TYPES[f.split('.').pop()]);
  }
  const handler = routes[key]; if (!handler) return send(res, 404, JSON.stringify({ error: 'Not found' }));
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 20000) req.destroy(); });
  req.on('end', () => {
    const fail = e => {
      if (e instanceof HttpError) return send(res, e.status, JSON.stringify({ error: e.message }));
      if (e instanceof SyntaxError) return send(res, 400, JSON.stringify({ error: 'Bad JSON' }));
      console.error(e); send(res, 500, JSON.stringify({ error: 'Server error' }));
    };
    try {
      if (req.method === 'POST' && !sameOrigin(req)) bad('Cross-site request blocked', 403);
      if (req.method === 'POST' && !/application\/json/.test(req.headers['content-type'] || '')) bad('JSON only', 415);
      const body = raw ? JSON.parse(raw) : {};
      const result = handler({ req, res, url, body, user: userFrom(req), ip: clientIp(req) });
      if (result && typeof result.then === 'function') return result.then(r => send(res, 200, JSON.stringify(r)), fail);
      send(res, 200, JSON.stringify(result));
    } catch (e) { fail(e); }
  });
});

/* ---------- housekeeping: expired sessions, daily backup, clean shutdown ---------- */
function backup() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const f = path.join(BACKUP_DIR, `hawkbet-${new Date().toISOString().slice(0, 10)}.db`);
    if (!fs.existsSync(f)) db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
    fs.readdirSync(BACKUP_DIR).filter(n => /^hawkbet-.*\.db$/.test(n)).sort().slice(0, -7).forEach(n => fs.unlinkSync(path.join(BACKUP_DIR, n))); // keep 7 days
  } catch (e) { console.error('backup failed', e.message); }
}
setInterval(() => { db.prepare('DELETE FROM sessions WHERE expires<?').run(now()); backup(); }, 6 * 3600e3).unref();
backup();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => { try { db.close(); } catch (e) {} process.exit(0); }));
server.listen(PORT, HOST, () => console.log(`HawkBet on ${HOST}:${PORT}${PROD ? ' (production)' : ''}${INVITE_CODE ? ' [invite code required]' : ''}`));
