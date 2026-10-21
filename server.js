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
const MAX_BET = 1000, START_BAL = 1000, CLAIM_AMT = 100, CLAIM_BELOW = 100, CLAIM_EVERY_MS = 24 * 3600e3;
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
  const u = db.prepare('SELECT balance FROM users WHERE id=?').get(uid), nb = u.balance + delta;
  if (nb < 0) bad('Not enough Hawk Bucks');
  db.prepare('UPDATE users SET balance=? WHERE id=?').run(nb, uid);
  db.prepare('INSERT INTO txns(user_id,delta,kind,ref,balance,ts) VALUES(?,?,?,?,?,?)').run(uid, delta, kind, ref, nb, now());
  return nb;
}
const balanceOf = uid => db.prepare('SELECT balance FROM users WHERE id=?').get(uid).balance;
function int(v, lo, hi, name) { if (!Number.isInteger(v) || v < lo || v > hi) bad(`${name} must be a whole number from ${lo} to ${hi}`); return v; }
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
  const { mode, picks } = ctx.body, entry = int(ctx.body.entry, 1, MAX_BET, 'Entry');
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
const PLINKO_RISK = { low: [1.2, 1.3], med: [0.55, 2.4], high: [0.12, 4.2] }; // [floor, curve]
const plinkoCache = {};
function plinkoMults(n, risk) {
  const key = n + risk; if (plinkoCache[key]) return plinkoCache[key];
  const [fl, pw] = PLINKO_RISK[risk], probs = [], raw = []; let c = 1;
  for (let k = 0; k <= n; k++) { probs.push(c / 2 ** n); c = c * (n - k) / (k + 1); }
  for (let k = 0; k <= n; k++) raw.push(fl + Math.pow(Math.abs(k - n / 2) / (n / 2), pw) * 12);
  const rtp = raw.reduce((a, r, k) => a + r * probs[k], 0);
  return (plinkoCache[key] = raw.map(r => r * 0.99 / rtp));
}
const MINES_N = 25, minesMult = (k, m) => { let r = 0.99; for (let i = 0; i < k; i++) r *= (MINES_N - i) / (MINES_N - m - i); return r; };
const LANES = 10, CROSS_P = { easy: 0.92, med: 0.82, hard: 0.68, extreme: 0.5 }, crossMult = (n, d) => 0.99 / Math.pow(CROSS_P[d], n);

function activeRound(uid, game) { return db.prepare("SELECT * FROM rounds WHERE user_id=? AND game=? AND status='active'").get(uid, game); }
function startRound(ctx, game, state) {
  const bet = int(ctx.body.bet, 1, MAX_BET, 'Bet');
  if (activeRound(ctx.user.id, game)) bad('Finish your current round first', 409);
  const id = Number(db.prepare('INSERT INTO rounds(user_id,game,bet,state,created) VALUES(?,?,?,?,?)').run(ctx.user.id, game, bet, JSON.stringify(state), now()).lastInsertRowid);
  return { id, bet, balance: adjust(ctx.user.id, -bet, game + '_bet', id) };
}
function finishRound(r, status, mult) {
  const payout = status === 'cashed' ? Math.round(r.bet * mult) : 0;
  db.prepare('UPDATE rounds SET status=?, mult=?, payout=? WHERE id=?').run(status, mult, payout, r.id);
  return { payout, balance: payout ? adjust(r.user_id, payout, r.game + '_win', r.id) : balanceOf(r.user_id) };
}
const live = (ctx, game) => { const r = activeRound(ctx.user.id, game); if (!r) bad('No active round', 409); return { r, st: JSON.parse(r.state) }; };
const save = (r, st) => db.prepare('UPDATE rounds SET state=? WHERE id=?').run(JSON.stringify(st), r.id);

const arcade = {
  config: () => ({ maxBet: MAX_BET, cross: Object.fromEntries(Object.keys(CROSS_P).map(d => [d, Array.from({ length: LANES }, (_, i) => crossMult(i + 1, d))])) }),
  plinkoTable: ctx => { const rows = int(+ctx.url.searchParams.get('rows'), 8, 16, 'rows'), risk = ctx.url.searchParams.get('risk'); if (!PLINKO_RISK[risk]) bad('Bad risk'); return { mults: plinkoMults(rows, risk) }; },
  plinko: ctx => tx(() => {
    const rows = int(ctx.body.rows, 8, 16, 'Rows'), risk = ctx.body.risk; if (!PLINKO_RISK[risk]) bad('Bad risk');
    const bet = int(ctx.body.bet, 1, MAX_BET, 'Bet'); adjust(ctx.user.id, -bet, 'plinko_bet');
    const path = Array.from({ length: rows }, () => crypto.randomInt(2)), k = path.reduce((a, b) => a + b, 0), mult = plinkoMults(rows, risk)[k], payout = Math.round(bet * mult);
    const id = Number(db.prepare("INSERT INTO rounds(user_id,game,bet,state,status,mult,payout,created) VALUES(?,?,?,?,?,?,?,?)").run(ctx.user.id, 'plinko', bet, JSON.stringify({ rows, risk, path }), 'done', mult, payout, now()).lastInsertRowid);
    const balance = payout ? adjust(ctx.user.id, payout, 'plinko_win', id) : balanceOf(ctx.user.id);
    return { path, k, mult, payout, bet, balance };
  }),
  active: ctx => {
    const game = ctx.url.searchParams.get('game'), r = ['mines', 'cross'].includes(game) && activeRound(ctx.user.id, game); if (!r) return { round: null };
    const st = JSON.parse(r.state);
    return game === 'mines' ? { round: { id: r.id, bet: r.bet, m: st.m, opened: st.opened, mult: minesMult(st.opened.length, st.m) } }
      : { round: { id: r.id, bet: r.bet, diff: st.diff, at: st.at, mult: crossMult(st.at, st.diff) } };
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
    let crash = LANES + 1; for (let n = 1; n <= LANES; n++) if (rnd() > CROSS_P[diff]) { crash = n; break; }
    return { ...startRound(ctx, 'cross', { diff, crash, at: 0 }), diff };
  }),
  crossStep: ctx => tx(() => {
    const { r, st } = live(ctx, 'cross'), n = st.at + 1;
    if (n === st.crash) return { hit: true, lane: n, ...finishRound(r, 'lost', 0) };
    st.at = n; const mult = crossMult(n, st.diff);
    if (n === LANES) return { at: n, mult, cashed: true, ...finishRound(r, 'cashed', mult) };
    save(r, st); return { at: n, mult, balance: balanceOf(ctx.user.id) };
  }),
  crossCash: ctx => tx(() => {
    const { r, st } = live(ctx, 'cross'); if (st.at < 1) bad('Take a step first');
    return { mult: crossMult(st.at, st.diff), ...finishRound(r, 'cashed', crossMult(st.at, st.diff)) };
  }),
};

/* ---------- more arcade games ---------- */
function oneShot(ctx, game, state, mult, bet = int(ctx.body.bet, 1, MAX_BET, 'Bet')) { // bet, decide and pay in one transaction
  adjust(ctx.user.id, -bet, game + '_bet');
  const payout = Math.round(bet * mult);
  const id = Number(db.prepare("INSERT INTO rounds(user_id,game,bet,state,status,mult,payout,created) VALUES(?,?,?,?,'done',?,?,?)").run(ctx.user.id, game, bet, JSON.stringify(state), mult, payout, now()).lastInsertRowid);
  return { bet, mult, payout, balance: payout ? adjust(ctx.user.id, payout, game + '_win', id) : balanceOf(ctx.user.id) };
}
const FLIP_MAX = 10, flipMult = n => 0.99 * 2 ** n;         // each correct call doubles, one 1% edge on the streak
const RPS_MAX = 10, rpsMult = n => 0.98 * 2 ** n;           // ties replay, so each decisive throw is 50/50
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
const SLOT = { trophy: [1, 250], hawk: [2, 80], football: [3, 30], volley: [4, 20], bball: [4, 20], bus: [5, 14], pass: [6, 5] }; // [stops per reel, 3-of-a-kind pay]
const SLOT_STRIP = Object.entries(SLOT).flatMap(([k, [w]]) => Array(w).fill(k)), BALLS = new Set(['football', 'volley', 'bball']);
function slotPay(a, b, c) {
  if (a === b && b === c) return SLOT[a][1];
  const h = [a, b, c].filter(x => x === 'hawk').length;
  if (h === 2) return 5; if ([a, b, c].every(x => BALLS.has(x))) return 3; if (h === 1) return 1; return 0;
}
const SLOT_RTP = (() => { let r = 0; for (const a of SLOT_STRIP) for (const b of SLOT_STRIP) for (const c of SLOT_STRIP) r += slotPay(a, b, c); return r / SLOT_STRIP.length ** 3; })();

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
  start: ctx => tx(() => startRound(ctx, game, { streak: 0 })),
  cash: ctx => tx(() => { const { r, st } = live(ctx, game); if (st.streak < 1) bad('Win one first'); return { streak: st.streak, mult: multFn(st.streak), ...finishRound(r, 'cashed', multFn(st.streak)) }; }),
  win: (ctx, r, st, extra) => { st.streak++; const mult = multFn(st.streak); if (st.streak >= max) return { ...extra, streak: st.streak, mult, cashed: true, ...finishRound(r, 'cashed', mult) }; save(r, st); return { ...extra, streak: st.streak, mult, balance: balanceOf(ctx.user.id) }; },
});
const flipG = streakGame('flip', FLIP_MAX, flipMult), rpsG = streakGame('rps', RPS_MAX, rpsMult);
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

Object.assign(arcade, {
  dice: ctx => tx(() => {
    const t = Math.round(Number(ctx.body.target) * 100) / 100, over = ctx.body.over === true;
    if (!Number.isFinite(t) || t < 2 || t > 98) bad('Target must be between 2 and 98');
    const chance = over ? (100 - t) / 100 : t / 100, roll = crypto.randomInt(10000) / 100, win = over ? roll > t : roll < t, pays = 0.99 / chance;
    return { roll, target: t, over, pays, win, ...oneShot(ctx, 'dice', { roll, t, over }, win ? pays : 0) };
  }),
  limbo: ctx => tx(() => {
    const target = Math.round(Number(ctx.body.target) * 100) / 100;
    if (!Number.isFinite(target) || target < 1.01 || target > 1000) bad('Target must be 1.01x to 1000x');
    const crash = Math.min(1e6, Math.max(1, Math.floor(0.99 / (1 - rnd()) * 100) / 100)), win = crash >= target; // P(crash >= x) = 0.99 / x
    return { crash, target, win, ...oneShot(ctx, 'limbo', { crash, target }, win ? target : 0) };
  }),
  slots: ctx => tx(() => {
    const reels = [0, 1, 2].map(() => SLOT_STRIP[crypto.randomInt(SLOT_STRIP.length)]);
    return { reels, ...oneShot(ctx, 'slots', { reels }, slotPay(...reels)) };
  }),
  roulette: ctx => tx(() => {
    const bets = ctx.body.bets; if (!Array.isArray(bets) || !bets.length || bets.length > 40) bad('Place 1 to 40 bets');
    let total = 0;
    for (const b of bets) { if (!ROULETTE_OK[b.type] || !ROULETTE_OK[b.type](b.value)) bad('Bad bet'); int(b.amount, 1, MAX_BET, 'Chip'); total += b.amount; }
    if (total > MAX_BET) bad(`Total bet can't be over ${MAX_BET}`);
    const n = crypto.randomInt(37), won = bets.reduce((a, b) => a + b.amount * rouletteMult(b, n), 0);
    return { n, color: rColor(n), total, ...oneShot(ctx, 'roulette', { bets, n }, won / total, total) };
  }),
  flipStart: flipG.start, flipCash: flipG.cash,
  flip: ctx => tx(() => {
    const { r, st } = live(ctx, 'flip'), call = ctx.body.call; if (call !== 'hawk' && call !== 'sl') bad('Call Seymour or SL');
    const side = crypto.randomInt(2) ? 'hawk' : 'sl';
    if (side !== call) return { side, lost: true, streak: st.streak, ...finishRound(r, 'lost', 0) };
    return flipG.win(ctx, r, st, { side });
  }),
  rpsStart: rpsG.start, rpsCash: rpsG.cash,
  rps: ctx => tx(() => {
    const { r, st } = live(ctx, 'rps'), me = ctx.body.throw; if (!BEATS[me]) bad('Pick rock, paper or scissors');
    const them = Object.keys(BEATS)[crypto.randomInt(3)], rival = RIVALS[crypto.randomInt(RIVALS.length)];
    if (me === them) { save(r, st); return { me, them, rival, tie: true, streak: st.streak, mult: st.streak ? rpsMult(st.streak) : 0, balance: balanceOf(ctx.user.id) }; }
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
  mines: (r, st) => ({ id: r.id, bet: r.bet, m: st.m, opened: st.opened, mult: minesMult(st.opened.length, st.m) }),
  cross: (r, st) => ({ id: r.id, bet: r.bet, diff: st.diff, at: st.at, mult: crossMult(st.at, st.diff) }),
  flip: (r, st) => ({ id: r.id, bet: r.bet, streak: st.streak, mult: st.streak ? flipMult(st.streak) : 0 }),
  rps: (r, st) => ({ id: r.id, bet: r.bet, streak: st.streak, mult: st.streak ? rpsMult(st.streak) : 0 }),
  bj: (r, st) => bjView(r, st, false),
  memory: (r, st) => ({ id: r.id, moves: st.moves, matched: st.matched.map(i => ({ i, sym: st.deck[i] })), cards: st.deck.length }),
};
arcade.active = ctx => {
  const game = ctx.url.searchParams.get('game'), r = VIEWS[game] && activeRound(ctx.user.id, game);
  return { round: r ? VIEWS[game](r, JSON.parse(r.state)) : null };
};
const baseConfig = arcade.config;
arcade.config = () => ({ ...baseConfig(), slots: { pays: Object.fromEntries(Object.entries(SLOT).map(([k, [, p]]) => [k, p])), rtp: SLOT_RTP }, flipMax: FLIP_MAX, rpsMax: RPS_MAX });

/* ---------- skill games: Bell Rush, Classroom Memory, Seahawk Trivia ----------
   Score-only (no Hawk Bucks at stake). The server holds all hidden state and keeps the clock. */
const SKILL_GAMES = ['bell', 'memory', 'trivia'];
function skillStart(ctx, game, state) {
  db.prepare("UPDATE rounds SET status='abandoned' WHERE user_id=? AND game=? AND status='active'").run(ctx.user.id, game); // nothing at stake, so a restart just abandons
  return Number(db.prepare('INSERT INTO rounds(user_id,game,bet,state,created) VALUES(?,?,0,?,?)').run(ctx.user.id, game, JSON.stringify(state), now()).lastInsertRowid);
}
function skillFinish(ctx, r, st, score, detail = {}) {
  const prev = db.prepare('SELECT MAX(score) AS b FROM scores WHERE user_id=? AND game=?').get(ctx.user.id, r.game).b;
  save(r, st); db.prepare("UPDATE rounds SET status='done', payout=0 WHERE id=?").run(r.id);
  db.prepare('INSERT INTO scores(user_id,game,score,detail,created) VALUES(?,?,?,?,?)').run(ctx.user.id, r.game, score, JSON.stringify(detail), now());
  return { done: true, score, best: Math.max(score, prev ?? 0), newBest: prev == null || score > prev, ...detail };
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
  bellStart: ctx => tx(() => ({ id: skillStart(ctx, 'bell', { i: 0, ring: null, taps: [] }), bells: BELLS })),
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
  memoryStart: ctx => tx(() => ({ id: skillStart(ctx, 'memory', { deck: shuffle([...Array(MEM_PAIRS).keys(), ...Array(MEM_PAIRS).keys()]), open: [], matched: [], moves: 0, t0: now() }), cards: MEM_PAIRS * 2 })),
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
    return { id: skillStart(ctx, 'trivia', st), question: triviaQuestion(st) };
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

/* ---------- Luck Lab: a cosmetic preference. It never touches odds, payouts, scores or picks. ---------- */
const parseLuck = v => v === 'normal' ? 'normal' : Number.isInteger(v) && v >= 1 && v <= 10 ? String(v) : null;
const luckOut = s => s === 'normal' || s == null ? 'normal' : Number(s);
function setLuck(ctx) {
  const v = parseLuck(ctx.body.luck); if (v === null) bad('Luck must be "normal" or a whole number from 1 to 10');
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
    const top = db.prepare(`SELECT username, balance, balance-${START_BAL}-added AS net FROM users ORDER BY net DESC, id LIMIT 20`).all();
    const me = db.prepare(`SELECT username, balance, balance-${START_BAL}-added AS net FROM users WHERE id=?`).get(ctx.user.id);
    me.rank = db.prepare(`SELECT COUNT(*)+1 AS r FROM users WHERE balance-${START_BAL}-added>?`).get(me.net).r;
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
  'GET /api/arcade/stats': need(arcade.stats),
  'GET /api/arcade/highscores': need(arcade.highscores),
  'POST /api/arcade/bell/start': need(arcade.bellStart),
  'POST /api/arcade/bell/next': need(arcade.bellNext),
  'POST /api/arcade/bell/tap': need(arcade.bellTap),
  'POST /api/arcade/memory/start': need(arcade.memoryStart),
  'POST /api/arcade/memory/flip': need(arcade.memoryFlip),
  'POST /api/arcade/trivia/start': need(arcade.triviaStart),
  'POST /api/arcade/trivia/answer': need(arcade.triviaAnswer),
};

const FILES = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js', '/logo.svg': 'logo.svg' };
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
