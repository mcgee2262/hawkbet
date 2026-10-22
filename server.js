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
const START_BAL = 1000, MAX_BAL = 1e15, capAmt = n => Math.min(MAX_BAL, n), CLAIM_AMT = 1000, CLAIM_BELOW = 100, CLAIM_EVERY_MS = 3600e3; // the Bank only helps when you're broke: 1,000 once an hour
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
for (const [col, def] of [['xp', 'INTEGER NOT NULL DEFAULT 0'], ['level', 'INTEGER NOT NULL DEFAULT 1'], ['last_wheel', "TEXT NOT NULL DEFAULT ''"]]) if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name=?").get(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`); // rewards
db.exec(`CREATE TABLE IF NOT EXISTS challenge_claims(user_id INTEGER NOT NULL, day TEXT NOT NULL, cid TEXT NOT NULL, PRIMARY KEY(user_id, day, cid));
CREATE TABLE IF NOT EXISTS achievements(user_id INTEGER NOT NULL, key TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY(user_id, key));
CREATE TABLE IF NOT EXISTS dice_seed(user_id INTEGER PRIMARY KEY, server_seed TEXT NOT NULL, client_seed TEXT NOT NULL, nonce INTEGER NOT NULL DEFAULT 0);`);
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
  db.prepare('INSERT INTO txns(user_id,delta,kind,ref,balance,ts) VALUES(?,?,?,?,?,?)').run(uid, Math.max(-MAX_BAL, Math.min(MAX_BAL, delta)), kind, ref, nb, now());
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
  if (!row || row.expires < now() || row.banned) return null; return row;
}
const publicUser = u => ({ username: u.username, balance: u.balance, added: u.added || 0, lvl: levelInfo(u.xp), luck: luckOut(effLuck(u)), override: hasOverride(u), gear: gearOf(u), isAdmin: !!u.is_admin, canClaim: u.balance < CLAIM_BELOW && now() - u.last_claim >= CLAIM_EVERY_MS, nextClaim: Math.max(0, u.last_claim + CLAIM_EVERY_MS - now()) });
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
  if (u.banned) bad('This account has been banned. Talk to the admin.', 403);
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
  const payout = capAmt(Math.round(s.entry * mult));
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
  if (!u) return { k: 1, pk: 1, sup: 0 }; if (!u._luck) u._luck = luckOf(effLuck(u)); return u._luck;
};
const luckOf = l => {
  if (l == null || l === 'normal') return { k: 1, pk: 1, sup: 0 };
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
  spendLuck(ctx.user, game);
  const id = Number(db.prepare('INSERT INTO rounds(user_id,game,bet,state,created) VALUES(?,?,?,?,?)').run(ctx.user.id, game, bet, JSON.stringify(state), now()).lastInsertRowid);
  return { id, bet, balance: adjust(ctx.user.id, -bet, game + '_bet', id) };
}
function superNet(uid, delta) { db.prepare('UPDATE users SET super_net=MAX(?,MIN(?,super_net+?)) WHERE id=?').run(-MAX_BAL, MAX_BAL, delta, uid); }
function finishRound(r, status, mult) {
  const payout = status === 'cashed' ? capAmt(Math.round(r.bet * mult)) : 0;
  try { if (JSON.parse(r.state).sup) superNet(r.user_id, payout - r.bet); } catch (e) {}
  addXp(r.user_id, 10 + (payout > r.bet ? 5 : 0));
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
    const path = Array.from({ length: rows }, () => crypto.randomInt(2)), k = path.reduce((a, b) => a + b, 0), mult = plinkoMults(rows, risk)[k], payout = capAmt(Math.round(bet * mult));
    addXp(ctx.user.id, 10 + (payout > bet ? 5 : 0));
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
  spendLuck(ctx.user, game);
  const payout = capAmt(Math.round(bet * mult));
  if (state && state.sup) superNet(ctx.user.id, payout - bet);
  addXp(ctx.user.id, 10 + (payout > bet ? 5 : 0));
  const id = Number(db.prepare("INSERT INTO rounds(user_id,game,bet,state,status,mult,payout,created) VALUES(?,?,?,?,'done',?,?,?)").run(ctx.user.id, game, bet, JSON.stringify(state), mult, payout, now()).lastInsertRowid);
  return { bet, mult, payout, balance: payout ? adjust(ctx.user.id, payout, game + '_win', id) : balanceOf(ctx.user.id) };
}
/* Provably fair dice: roll = first 4 bytes of HMAC-SHA256(server_seed, "client_seed:nonce") scaled to 0.00-99.99.
   Players see sha256(server_seed) up front; the seed itself is revealed when they rotate, so any roll can be recomputed. */
const sha256 = x => crypto.createHash('sha256').update(x).digest('hex');
function diceSeed(uid) {
  let r = db.prepare('SELECT * FROM dice_seed WHERE user_id=?').get(uid);
  if (!r) { db.prepare('INSERT INTO dice_seed(user_id,server_seed,client_seed,nonce) VALUES(?,?,?,0)').run(uid, crypto.randomBytes(32).toString('hex'), crypto.randomBytes(5).toString('hex')); r = db.prepare('SELECT * FROM dice_seed WHERE user_id=?').get(uid); }
  return r;
}
const fairRoll = (server, client, nonce) => Math.floor(crypto.createHmac('sha256', server).update(`${client}:${nonce}`).digest().readUInt32BE(0) / 4294967296 * 10000) / 100;
const fairInfo = uid => { const r = diceSeed(uid); return { hash: sha256(r.server_seed), clientSeed: r.client_seed, nonce: r.nonce }; };
function fairRotate(ctx) {
  const cs = String(ctx.body.clientSeed ?? '').trim().slice(0, 40);
  return tx(() => {
    const old = diceSeed(ctx.user.id);
    db.prepare('UPDATE dice_seed SET server_seed=?, client_seed=?, nonce=0 WHERE user_id=?').run(crypto.randomBytes(32).toString('hex'), cs || crypto.randomBytes(5).toString('hex'), ctx.user.id);
    return { revealed: { serverSeed: old.server_seed, hash: sha256(old.server_seed), clientSeed: old.client_seed, rolls: old.nonce }, ...fairInfo(ctx.user.id) };
  });
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
    const sd = diceSeed(ctx.user.id), nonce = sd.nonce; db.prepare('UPDATE dice_seed SET nonce=nonce+1 WHERE user_id=?').run(ctx.user.id);
    const roll = fairRoll(sd.server_seed, sd.client_seed, nonce), win = over ? roll > edge : roll < edge, pays = 0.99 / (zonePay / 100);
    return { roll, target: t, edge, zone, over, pays, win, nonce, clientSeed: sd.client_seed, hash: sha256(sd.server_seed), ...oneShot(ctx, 'dice', { roll, t, edge, zone, over, nonce, sup: L.sup }, win ? pays : 0) };
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
arcade.config = ctx => ({ ...baseConfig(ctx), luckName: luckOut(effLuck(ctx.user)), luck: { ...luckInfo(ctx.user), flipP: streakP(ctx), flipPay: streakPay(ctx), rpsP: streakP(ctx), rpsPay: streakPay(ctx) }, skillTiers: SKILL_TIERS, slots: { pays: SLOT_PAYS, lines: SLOT_LINES, rtp: SLOT_RTP }, flipMax: FLIP_MAX, rpsMax: RPS_MAX });

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
  const mult = r.bet ? skillMult(r.game, score) : 0, payout = capAmt(Math.round(r.bet * mult));
  save(r, st); db.prepare("UPDATE rounds SET status='done', mult=?, payout=? WHERE id=?").run(mult, payout, r.id);
  db.prepare('INSERT INTO scores(user_id,game,score,detail,created) VALUES(?,?,?,?,?)').run(ctx.user.id, r.game, score, JSON.stringify(detail), now());
  addXp(ctx.user.id, 25 + Math.min(25, Math.round(score / 200))); // skill games earn the most XP
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

/* ---------- Hawk Shop: cosmetics that carry luck, Luck Boosters, Mythic Super Luck items ----------
   Everyone plays at Luck 5 (Normal). Each equipped item adds its luck (Rare +1, Epic +2, Legendary +3), boosters add more,
   capped at 10. Levels 6-10 keep the same 99% payback, so that play still counts on the leaderboard.
   Mythic items give Super Luck x2/x5/x10 (more money, so those rounds stay off the leaderboard), wear out after a set number
   of luck-game rounds, and are gated by level, prerequisites and leaderboard winnings that Super Luck can't farm.
   The admin can override anyone's luck (the Luck Lab); an override ignores gear and boosters. */
db.exec(`CREATE TABLE IF NOT EXISTS inventory(user_id INTEGER NOT NULL, item_id TEXT NOT NULL, charges INTEGER, ts INTEGER NOT NULL, PRIMARY KEY(user_id, item_id));
CREATE TABLE IF NOT EXISTS boosters(user_id INTEGER NOT NULL, kind TEXT NOT NULL, rounds_left INTEGER NOT NULL, PRIMARY KEY(user_id, kind));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_log(id INTEGER PRIMARY KEY, admin_id INTEGER NOT NULL, action TEXT NOT NULL, target TEXT, detail TEXT, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, msg TEXT NOT NULL, ts INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0);`);
for (const [col, def] of [['gear', "TEXT NOT NULL DEFAULT '{}'"], ['spent', 'INTEGER NOT NULL DEFAULT 0'], ['banned', 'INTEGER NOT NULL DEFAULT 0']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name=?").get(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
const getSetting = (k, d = null) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? JSON.parse(r.value) : d; };
const putSetting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v));
if (!getSetting('luck_reset_v1')) { db.exec("UPDATE users SET luck='normal' WHERE is_admin=0"); putSetting('luck_reset_v1', true); } // luck is earned in the shop now
// net winnings for the leaderboard: free money (added) and Super Luck results don't count; shop spending doesn't hurt you
const NET_SQL = `balance-${START_BAL}-added-super_net+spent`;
const LUCK_GAMES = new Set(['flip', 'rps', 'cross', 'dice', 'limbo']);
const SLOTS = ['skin', 'hat', 'face', 'body', 'held', 'bg', 'mythic'];
const RARITY_LUCK = { common: 0, rare: 1, epic: 2, legendary: 3 };
const ITEMS = [ // [id, slot, name, emoji, rarity, price, extra]
  ['skin_classic', 'skin', 'Classic Seahawk', '🦅', 'common', 0], ['skin_blue', 'skin', 'Lake Blue', '🦅', 'common', 5000], ['skin_ice', 'skin', 'Ice Hawk', '🦅', 'common', 8000],
  ['skin_shadow', 'skin', 'Shadow Hawk', '🦅', 'rare', 30000], ['skin_neon', 'skin', 'Neon Hawk', '🦅', 'epic', 300000], ['skin_gold', 'skin', 'Golden Hawk', '🦅', 'legendary', 6000000],
  ['hat_bow', 'hat', 'Spirit Bow', '🎀', 'common', 1500], ['hat_sun', 'hat', 'Beach Hat', '👒', 'common', 2500], ['hat_snap', 'hat', 'South Lakes Snapback', '🧢', 'rare', 25000],
  ['hat_grad', 'hat', 'Graduation Cap', '🎓', 'epic', 250000], ['hat_top', 'hat', 'Golden Top Hat', '🎩', 'legendary', 2500000],
  ['face_nerd', 'face', 'Study Glasses', '👓', 'common', 1000], ['face_shades', 'face', 'Shades', '🕶️', 'rare', 20000], ['face_goggles', 'face', 'Swim Goggles', '🥽', 'epic', 200000], ['face_star', 'face', 'Star Eyes', '🤩', 'legendary', 2000000],
  ['body_tee', 'body', 'Spirit Tee', '👕', 'common', 2000], ['body_hoodie', 'body', 'Seahawks Hoodie', '🧥', 'rare', 30000], ['body_tie', 'body', 'Prom Tie', '👔', 'epic', 300000], ['body_medal', 'body', 'Gold Medal', '🥇', 'legendary', 3000000],
  ['held_finger', 'held', 'Foam Finger', '☝️', 'common', 1500], ['held_football', 'held', 'Game Ball', '🏈', 'rare', 25000], ['held_bball', 'held', 'Basketball', '🏀', 'rare', 25000],
  ['held_money', 'held', 'Money Bag', '💰', 'epic', 400000], ['held_trophy', 'held', 'Golden Trophy', '🏆', 'legendary', 4000000],
  ['bg_stadium', 'bg', 'Stadium Lights', '🏟️', 'common', 3000], ['bg_cafe', 'bg', 'Cafeteria', '🍕', 'common', 3000], ['bg_bus', 'bg', 'Bus Loop', '🚌', 'rare', 40000],
  ['bg_space', 'bg', 'Outer Space', '🌌', 'epic', 500000], ['bg_aurora', 'bg', 'Aurora', '🌈', 'legendary', 5000000],
  ['myth_diamond', 'mythic', 'Diamond Trophy', '💎', 'mythic', 50e6, { sup: 2, charges: 1000, level: 5 }],
  ['myth_wings', 'mythic', 'Golden Seahawk Wings', '🪽', 'mythic', 5e9, { sup: 5, charges: 500, level: 6, needs: 'myth_diamond', net: 1e6 }],
  ['myth_crown', 'mythic', 'Crown of the Lakes', '👑', 'mythic', 1e12, { sup: 10, charges: 250, level: 7, needs: 'myth_wings', net: 25e6, allAch: true }],
].map(([id, slot, name, emoji, rarity, price, x = {}]) => ({ id, slot, name, emoji, rarity, price, luck: RARITY_LUCK[rarity] || 0, sup: 0, ...x }));
const ITEM = Object.fromEntries(ITEMS.map(i => [i.id, i]));
const BOOSTERS = { penny: { name: 'Lucky Penny', emoji: '🪙', luck: 1, rounds: 25, price: 5000 }, clover: { name: 'Four-Leaf Clover', emoji: '🍀', luck: 2, rounds: 50, price: 40000 }, feather: { name: 'Golden Feather', emoji: '🪶', sup: 2, rounds: 10, price: 500000 } };
const shopCfg = () => getSetting('shop', { sale: 0, items: {} }); // admin edits: { sale: %, items: { id: { price, off } } }
const itemPrice = (it, cfg = shopCfg()) => Math.round(((cfg.items[it.id] && cfg.items[it.id].price) ?? it.price) * (1 - (cfg.sale || 0) / 100));
const gearOf = u => { try { return JSON.parse(u.gear || '{}'); } catch (e) { return {}; } };
function luckParts(u) { // where your luck comes from right now
  const gear = gearOf(u), parts = []; let lv = 0, sup = 0;
  for (const s of SLOTS) {
    const it = ITEM[gear[s]]; if (!it) continue;
    if (it.sup) { const inv = db.prepare('SELECT charges FROM inventory WHERE user_id=? AND item_id=?').get(u.id, it.id); if (inv && inv.charges > 0) { sup = Math.max(sup, it.sup); parts.push({ src: it.name, emoji: it.emoji, sup: it.sup, charges: inv.charges }); } }
    else if (it.luck) { lv += it.luck; parts.push({ src: it.name, emoji: it.emoji, luck: it.luck }); }
  }
  for (const b of db.prepare('SELECT kind, rounds_left FROM boosters WHERE user_id=? AND rounds_left>0').all(u.id)) {
    const B = BOOSTERS[b.kind]; if (!B) continue; if (B.sup) sup = Math.max(sup, B.sup); else lv += B.luck;
    parts.push({ src: B.name, emoji: B.emoji, luck: B.luck, sup: B.sup, rounds: b.rounds_left, booster: true });
  }
  const level = Math.min(10, 5 + lv);
  return { level, sup, parts, luck: sup ? 'x' + sup : level === 5 ? 'normal' : String(level) };
}
const hasOverride = u => u.luck != null && u.luck !== 'normal';
const effLuck = u => hasOverride(u) ? u.luck : luckParts(u).luck;
function spendLuck(u, game) { // a luck-game round uses up one booster round and one Mythic charge (only the ones actually in play)
  if (!LUCK_GAMES.has(game) || hasOverride(u)) return;
  db.prepare('UPDATE boosters SET rounds_left=rounds_left-1 WHERE user_id=? AND rounds_left>0').run(u.id);
  db.prepare('DELETE FROM boosters WHERE user_id=? AND rounds_left<=0').run(u.id);
  const m = ITEM[gearOf(u).mythic]; if (m) db.prepare('UPDATE inventory SET charges=charges-1 WHERE user_id=? AND item_id=? AND charges>0').run(u.id, m.id);
}
const netOf = uid => db.prepare(`SELECT ${NET_SQL} AS n FROM users WHERE id=?`).get(uid).n;
function itemLocks(u, it, owned) { // reasons you can't buy it yet (empty = buyable)
  const out = [], lvl = levelInfo(u.xp).level;
  if (it.level && lvl < it.level) out.push(`Reach level ${it.level} (${LEVELS[it.level - 1][1]})`);
  if (it.needs && !owned.has(it.needs)) out.push(`Own the ${ITEM[it.needs].name}`);
  if (it.net && netOf(u.id) < it.net) out.push(`Earn ${it.net.toLocaleString('en-US')} in leaderboard winnings`);
  if (it.allAch && db.prepare('SELECT COUNT(*) n FROM achievements WHERE user_id=?').get(u.id).n < ACH.length) out.push('Unlock every achievement');
  return out;
}
function shopState(ctx) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id), cfg = shopCfg(), gear = gearOf(u);
  const inv = new Map(db.prepare('SELECT item_id, charges FROM inventory WHERE user_id=?').all(u.id).map(r => [r.item_id, r.charges])); inv.set('skin_classic', null);
  const owned = new Set(inv.keys()), lp = luckParts(u);
  return {
    balance: u.balance, sale: cfg.sale || 0, gear, override: hasOverride(u) ? luckOut(u.luck) : null, luck: { level: lp.level, sup: lp.sup, parts: lp.parts, luck: luckOut(effLuck(u)) },
    items: ITEMS.map(it => ({ id: it.id, slot: it.slot, name: it.name, emoji: it.emoji, rarity: it.rarity, luck: it.luck, sup: it.sup, maxCharges: it.charges || null, price: itemPrice(it, cfg), basePrice: it.price,
      off: !!(cfg.items[it.id] && cfg.items[it.id].off), owned: owned.has(it.id), charges: inv.get(it.id) ?? null, equipped: gear[it.slot] === it.id, locks: owned.has(it.id) ? [] : itemLocks(u, it, owned) })),
    boosters: Object.entries(BOOSTERS).map(([id, b]) => ({ id, ...b, price: Math.round(b.price * (1 - (cfg.sale || 0) / 100)), active: (db.prepare('SELECT rounds_left FROM boosters WHERE user_id=? AND kind=?').get(u.id, id) || {}).rounds_left || 0 })),
  };
}
function spend(uid, amt, kind) { db.prepare('UPDATE users SET spent=spent+? WHERE id=?').run(amt, uid); return adjust(uid, -amt, kind); }
function buyItem(ctx) {
  const it = ITEM[String(ctx.body.itemId)]; if (!it) bad('No such item');
  tx(() => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id), cfg = shopCfg();
    if (cfg.items[it.id] && cfg.items[it.id].off) bad('That item is not for sale right now');
    const owned = new Set(db.prepare('SELECT item_id FROM inventory WHERE user_id=?').all(u.id).map(r => r.item_id)); owned.add('skin_classic');
    if (owned.has(it.id)) bad('You already own that');
    const locks = itemLocks(u, it, owned); if (locks.length) bad('Locked: ' + locks.join(' · '));
    const price = itemPrice(it, cfg); if (u.balance < price) bad('Not enough Hawk Bucks');
    if (price) spend(u.id, price, 'shop');
    db.prepare('INSERT INTO inventory(user_id,item_id,charges,ts) VALUES(?,?,?,?)').run(u.id, it.id, it.charges || null, now());
    const gear = gearOf(u); gear[it.slot] = it.id; db.prepare('UPDATE users SET gear=? WHERE id=?').run(JSON.stringify(gear), u.id); // wear it right away
  });
  return shopState(ctx);
}
function buyBooster(ctx) {
  const id = String(ctx.body.id), B = BOOSTERS[id]; if (!B) bad('No such booster');
  tx(() => {
    const price = Math.round(B.price * (1 - (shopCfg().sale || 0) / 100)); if (balanceOf(ctx.user.id) < price) bad('Not enough Hawk Bucks');
    spend(ctx.user.id, price, 'booster');
    db.prepare('INSERT INTO boosters(user_id,kind,rounds_left) VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET rounds_left=rounds_left+excluded.rounds_left').run(ctx.user.id, id, B.rounds);
  });
  return shopState(ctx);
}
function equipItem(ctx) {
  const slot = String(ctx.body.slot); if (!SLOTS.includes(slot)) bad('Bad slot');
  const id = ctx.body.itemId == null ? null : String(ctx.body.itemId), u = db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id), gear = gearOf(u);
  if (id) { const it = ITEM[id]; if (!it || it.slot !== slot) bad('That item does not go there'); if (id !== 'skin_classic' && !db.prepare('SELECT 1 FROM inventory WHERE user_id=? AND item_id=?').get(u.id, id)) bad("You don't own that"); gear[slot] = id; }
  else delete gear[slot];
  db.prepare('UPDATE users SET gear=? WHERE id=?').run(JSON.stringify(gear), u.id);
  return shopState(ctx);
}
function rechargeItem(ctx) {
  const it = ITEM[String(ctx.body.itemId)]; if (!it || !it.charges) bad('Only Mythic items need recharging');
  tx(() => {
    const inv = db.prepare('SELECT charges FROM inventory WHERE user_id=? AND item_id=?').get(ctx.user.id, it.id); if (!inv) bad("You don't own that");
    if (inv.charges >= it.charges) bad('Already fully charged');
    const price = Math.round(itemPrice(it) / 10); if (balanceOf(ctx.user.id) < price) bad('Not enough Hawk Bucks');
    spend(ctx.user.id, price, 'recharge'); db.prepare('UPDATE inventory SET charges=? WHERE user_id=? AND item_id=?').run(it.charges, ctx.user.id, it.id);
  });
  return shopState(ctx);
}

/* ---------- admin tools: money, items, luck, shop, passwords, bans. Every action is logged. ---------- */
const alog = (ctx, action, target, detail) => db.prepare('INSERT INTO admin_log(admin_id,action,target,detail,ts) VALUES(?,?,?,?,?)').run(ctx.user.id, action, target, detail, now());
const note = (uid, msg, from) => { if (uid !== from) db.prepare('INSERT INTO notes(user_id,msg,ts) VALUES(?,?,?)').run(uid, msg, now()); }; // no notes to yourself
const targetUser = ctx => { const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(ctx.body.username || '').toLowerCase()); if (!u) bad('No player with that username', 404); return u; };
const adminText = v => String(v ?? '').trim().slice(0, 120);
function adminUsers() {
  return { users: db.prepare(`SELECT id, username, balance, xp, added, spent, ${NET_SQL} AS net, luck, banned, is_admin, gear, created, (SELECT MAX(created) FROM rounds WHERE user_id=users.id) AS last FROM users ORDER BY id`).all()
    .map(u => ({ ...u, gear: gearOf(u), level: levelInfo(u.xp).level, luck: luckOut(u.luck), banned: !!u.banned, isAdmin: !!u.is_admin, items: db.prepare('SELECT item_id FROM inventory WHERE user_id=?').all(u.id).map(r => r.item_id) })) };
}
function adminMoney(ctx) {
  const amt = ctx.body.amount, why = adminText(ctx.body.note);
  if (!Number.isInteger(amt) || amt === 0 || Math.abs(amt) > MAX_BAL) bad('Amount must be a whole number (negative to take)');
  return tx(() => {
    const list = ctx.body.all === true ? db.prepare('SELECT * FROM users WHERE banned=0').all() : [targetUser(ctx)];
    for (const u of list) {
      if (amt > 0) { db.prepare('UPDATE users SET added=added+? WHERE id=?').run(amt, u.id); adjust(u.id, Math.min(amt, MAX_BAL - u.balance), 'admin_gift'); note(u.id, `🎁 The admin sent you ${amt.toLocaleString('en-US')} Hawk Bucks!${why ? ' "' + why + '"' : ''}`, ctx.user.id); }
      else { const take = Math.min(-amt, balanceOf(u.id)); if (take) adjust(u.id, -take, 'admin_take'); note(u.id, `The admin removed ${take.toLocaleString('en-US')} Hawk Bucks.${why ? ' "' + why + '"' : ''}`, ctx.user.id); }
    }
    alog(ctx, amt > 0 ? 'give' : 'take', ctx.body.all === true ? 'everyone' : list[0].username, `${amt}${why ? ' · ' + why : ''}`);
    return { ok: true, count: list.length };
  });
}
function adminSetBalance(ctx) {
  const v = ctx.body.balance; if (!Number.isInteger(v) || v < 0 || v > MAX_BAL) bad('Balance must be a whole number from 0 to 1,000,000,000,000,000');
  return tx(() => { const u = targetUser(ctx), d = v - u.balance; if (d > 0) db.prepare('UPDATE users SET added=added+? WHERE id=?').run(d, u.id); if (d) adjust(u.id, d, 'admin_set'); alog(ctx, 'set_balance', u.username, `${u.balance} → ${v}`); return { ok: true, balance: v }; });
}
function adminItem(ctx, give) {
  const it = ITEM[String(ctx.body.itemId)]; if (!it || it.id === 'skin_classic') bad('No such item');
  return tx(() => {
    const u = targetUser(ctx);
    if (give) { db.prepare('INSERT INTO inventory(user_id,item_id,charges,ts) VALUES(?,?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET charges=excluded.charges').run(u.id, it.id, it.charges || null, now()); note(u.id, `🎁 The admin gave you ${it.emoji} ${it.name}! Find it in your Locker.`, ctx.user.id); }
    else { db.prepare('DELETE FROM inventory WHERE user_id=? AND item_id=?').run(u.id, it.id); const g = gearOf(u); if (g[it.slot] === it.id) { delete g[it.slot]; db.prepare('UPDATE users SET gear=? WHERE id=?').run(JSON.stringify(g), u.id); } }
    alog(ctx, give ? 'give_item' : 'take_item', u.username, it.name); return { ok: true };
  });
}
function adminLuck(ctx) {
  const v = parseLuck(ctx.body.luck); if (v === null) bad('Luck must be "normal", 1-10, or x2 / x5 / x10');
  const u = targetUser(ctx); db.prepare('UPDATE users SET luck=? WHERE id=?').run(v, u.id); alog(ctx, 'luck', u.username, String(v));
  if (u.id !== ctx.user.id) note(u.id, v === 'normal' ? 'The admin cleared your luck override. Your gear decides your luck again.' : `🍀 The admin set your luck to ${String(v)[0] === 'x' ? 'Super Luck ' + v : 'level ' + v}!`);
  return { ok: true, luck: luckOut(v) };
}
function adminShop(ctx) {
  const cfg = shopCfg();
  if (ctx.body.sale != null) { const s = ctx.body.sale; if (!Number.isInteger(s) || s < 0 || s > 90) bad('Sale must be 0-90%'); cfg.sale = s; alog(ctx, 'sale', null, s + '%'); }
  if (ctx.body.itemId != null) {
    const it = ITEM[String(ctx.body.itemId)]; if (!it) bad('No such item'); const c = cfg.items[it.id] || {};
    if (ctx.body.price !== undefined) { const p = ctx.body.price; if (p === null) delete c.price; else if (!Number.isInteger(p) || p < 0 || p > MAX_BAL) bad('Bad price'); else c.price = p; }
    if (ctx.body.off !== undefined) c.off = !!ctx.body.off;
    cfg.items[it.id] = c; alog(ctx, 'shop_item', it.name, JSON.stringify(c));
  }
  putSetting('shop', cfg); return { ok: true, shop: cfg };
}
function adminPassword(ctx) {
  const pw = String(ctx.body.password || ''); if (pw.length < 6 || pw.length > 100) bad('Password must be at least 6 characters');
  const u = targetUser(ctx), salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET salt=?, hash=? WHERE id=?').run(salt, hashPw(pw, salt), u.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  alog(ctx, 'password', u.username, 'reset'); return { ok: true };
}
function adminBan(ctx) {
  const u = targetUser(ctx), on = ctx.body.banned === true; if (u.is_admin) bad("You can't ban an admin");
  db.prepare('UPDATE users SET banned=? WHERE id=?').run(on ? 1 : 0, u.id); if (on) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  alog(ctx, on ? 'ban' : 'unban', u.username, adminText(ctx.body.note)); return { ok: true };
}
const adminLog = () => ({ log: db.prepare('SELECT l.*, u.username AS admin FROM admin_log l JOIN users u ON u.id=l.admin_id ORDER BY l.id DESC LIMIT 100').all() });
function myNotes(ctx) { const n = db.prepare('SELECT id, msg, ts FROM notes WHERE user_id=? AND seen=0 ORDER BY id').all(ctx.user.id); if (n.length) db.prepare('UPDATE notes SET seen=1 WHERE user_id=? AND seen=0').run(ctx.user.id); return { notes: n, balance: balanceOf(ctx.user.id) }; }

/* ---------- rewards: XP and levels, daily challenges, the daily wheel, achievements, weekly tournament ----------
   All progress is computed on the server from the rounds and scores tables. Free Hawk Bucks from rewards go through grant(),
   which also counts them as `added`, so they never count toward leaderboard net winnings. */
const LEVELS = [[1, 'Freshman', 0], [2, 'Sophomore', 500], [3, 'Junior', 1500], [4, 'Senior', 3500], [5, 'Varsity', 7000], [6, 'Captain', 12000], [7, 'Hall of Fame', 20000]]; // [level, name, XP needed]
function levelInfo(xp = 0) {
  let i = 0; while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][2]) i++;
  const [level, name, floor] = LEVELS[i], nxt = LEVELS[i + 1];
  return { level, name, xp, floor, next: nxt ? nxt[2] : null, nextName: nxt ? nxt[1] : null, pct: nxt ? Math.round((xp - floor) / (nxt[2] - floor) * 100) : 100 };
}
const addXp = (uid, n) => db.prepare('UPDATE users SET xp=xp+? WHERE id=?').run(n, uid);
function grant(uid, n, kind) { db.prepare('UPDATE users SET added=added+? WHERE id=?').run(n, uid); return adjust(uid, n, kind); }
const ET = { timeZone: 'America/New_York' };
const dayKey = (t = now()) => new Intl.DateTimeFormat('en-CA', ET).format(new Date(t)); // YYYY-MM-DD in school time
function etMidnight(day) { // ms timestamp of 00:00 America/New_York on that day
  const guess = Date.parse(day + 'T00:00:00Z'), h = Number(new Intl.DateTimeFormat('en-US', { ...ET, hour12: false, hour: 'numeric' }).format(new Date(guess))) % 24;
  return guess + (24 - h) % 24 * 3600e3;
}
function weekStart() { const d = new Date(dayKey() + 'T12:00:00Z'), back = (d.getUTCDay() + 6) % 7; return etMidnight(new Date(d - back * 864e5).toISOString().slice(0, 10)); } // Monday 00:00 ET

const q1 = (sql, ...a) => db.prepare(sql).get(...a);
const done = "status IN ('done','cashed','lost')";
const CHALLENGES = [
  { id: 'play10', title: 'Play 10 rounds', desc: 'Any arcade game counts', goal: 10, reward: 100, icon: '🎮', p: (u, t) => q1(`SELECT COUNT(*) n FROM rounds WHERE user_id=? AND ${done} AND created>=?`, u, t).n },
  { id: 'games3', title: 'Try 3 different games', desc: 'Variety pack', goal: 3, reward: 100, icon: '🧭', p: (u, t) => q1(`SELECT COUNT(DISTINCT game) n FROM rounds WHERE user_id=? AND ${done} AND created>=?`, u, t).n },
  { id: 'win5', title: 'Win 5 rounds', desc: 'Come out ahead 5 times', goal: 5, reward: 125, icon: '✅', p: (u, t) => q1(`SELECT COUNT(*) n FROM rounds WHERE user_id=? AND ${done} AND payout>bet AND created>=?`, u, t).n },
  { id: 'big5x', title: 'Hit a 5x or bigger win', desc: 'Any game, any bet', goal: 1, reward: 150, icon: '💥', p: (u, t) => q1(`SELECT COUNT(*) n FROM rounds WHERE user_id=? AND ${done} AND payout>bet AND mult>=5 AND created>=?`, u, t).n },
  { id: 'bell3000', title: 'Score 3,000+ in Bell Rush', desc: 'Fast reflexes', goal: 1, reward: 150, icon: '🔔', p: (u, t) => q1("SELECT COUNT(*) n FROM scores WHERE user_id=? AND game='bell' AND score>=3000 AND created>=?", u, t).n },
  { id: 'memory2000', title: 'Score 2,000+ in Classroom Memory', desc: 'Sharp memory', goal: 1, reward: 150, icon: '🧠', p: (u, t) => q1("SELECT COUNT(*) n FROM scores WHERE user_id=? AND game='memory' AND score>=2000 AND created>=?", u, t).n },
  { id: 'trivia5', title: 'Get 5+ right in Seahawk Trivia', desc: 'Study up', goal: 1, reward: 150, icon: '❓', p: (u, t) => q1("SELECT COUNT(*) n FROM scores WHERE user_id=? AND game='trivia' AND json_extract(detail,'$.correct')>=5 AND created>=?", u, t).n },
  { id: 'rocket2', title: 'Cash out Seahawk Launch at 2x+', desc: 'Nerves of steel', goal: 1, reward: 125, icon: '🚀', p: (u, t) => q1("SELECT COUNT(*) n FROM rounds WHERE user_id=? AND game='rocket' AND status='cashed' AND mult>=2 AND created>=?", u, t).n },
  { id: 'bjwin', title: 'Win a hand of Hawk 21', desc: 'Beat Coach', goal: 1, reward: 100, icon: '🃏', p: (u, t) => q1("SELECT COUNT(*) n FROM rounds WHERE user_id=? AND game='bj' AND payout>bet AND created>=?", u, t).n },
  { id: 'flip3', title: 'Call 3 heads or tails in a row', desc: 'A streak of 3 in one run', goal: 3, reward: 125, icon: '🪙', p: (u, t) => q1("SELECT COALESCE(MAX(json_extract(state,'$.streak')),0) n FROM rounds WHERE user_id=? AND game='flip' AND created>=?", u, t).n },
  { id: 'rps3', title: 'Win 3 Hallway RPS throws in a row', desc: 'Beat the rival', goal: 3, reward: 125, icon: '✊', p: (u, t) => q1("SELECT COALESCE(MAX(json_extract(state,'$.streak')),0) n FROM rounds WHERE user_id=? AND game='rps' AND created>=?", u, t).n },
  { id: 'cross5', title: 'Hop 5 lanes in one crossing', desc: 'Dodge the buses', goal: 5, reward: 125, icon: '🚌', p: (u, t) => q1("SELECT COALESCE(MAX(json_extract(state,'$.at')),0) n FROM rounds WHERE user_id=? AND game='cross' AND created>=?", u, t).n },
  { id: 'dice5', title: 'Win 5 Scoreboard Rolls', desc: 'Beat the scoreboard 5 times', goal: 5, reward: 125, icon: '🎲', p: (u, t) => q1("SELECT COUNT(*) n FROM rounds WHERE user_id=? AND game='dice' AND payout>bet AND created>=?", u, t).n },
  { id: 'dicelow', title: 'Win a long-shot roll', desc: 'Win Scoreboard Roll at 10% chance or less', goal: 1, reward: 150, icon: '🎯', p: (u, t) => q1("SELECT COUNT(*) n FROM rounds WHERE user_id=? AND game='dice' AND payout>bet AND json_extract(state,'$.zone')<=10 AND created>=?", u, t).n },
  { id: 'mines5', title: 'Open 5 lockers in one Locker Hunt', desc: 'Avoid the hall monitor', goal: 5, reward: 125, icon: '🔐', p: (u, t) => q1("SELECT COALESCE(MAX(json_array_length(json_extract(state,'$.opened'))),0) n FROM rounds WHERE user_id=? AND game='mines' AND created>=?", u, t).n },
];
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function todaysChallenges(day = dayKey()) { // the same 3 for everyone on a given day
  if (process.env.NODE_ENV === 'test' && process.env.HB_TEST_CHALLENGES) return process.env.HB_TEST_CHALLENGES.split(',').map(id => CHALLENGES.find(c => c.id === id));
  const rnd = mulberry([...day].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7)), pool = [...CHALLENGES], out = [];
  while (out.length < 3) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}
const WHEEL = [[25, 30], [50, 25], [75, 18], [100, 12], [150, 8], [250, 4], [500, 2.5], [1000, 0.5]]; // [prize, weight %]: about 85 Hawk Bucks on average
const ACH = [ // [key, icon, title, description, xp, check(uid)]
  ['first_win', '🎉', 'First Win', 'Win any round', 50, u => !!q1(`SELECT 1 FROM rounds WHERE user_id=? AND ${done} AND payout>bet LIMIT 1`, u)],
  ['rounds10', '🎲', 'Warming Up', 'Play 10 rounds', 50, u => q1(`SELECT COUNT(*) n FROM rounds WHERE user_id=? AND ${done}`, u).n >= 10],
  ['rounds100', '🏟️', 'Regular', 'Play 100 rounds', 150, u => q1(`SELECT COUNT(*) n FROM rounds WHERE user_id=? AND ${done}`, u).n >= 100],
  ['rounds1000', '🏅', 'Lifer', 'Play 1,000 rounds', 400, u => q1(`SELECT COUNT(*) n FROM rounds WHERE user_id=? AND ${done}`, u).n >= 1000],
  ['mult5', '💥', 'Big Hit', 'Win at 5x or more', 75, u => !!q1(`SELECT 1 FROM rounds WHERE user_id=? AND payout>bet AND mult>=5 AND game NOT IN ('bell','memory','trivia') LIMIT 1`, u)],
  ['mult20', '🔥', 'On Fire', 'Win at 20x or more', 150, u => !!q1(`SELECT 1 FROM rounds WHERE user_id=? AND payout>bet AND mult>=20 AND game NOT IN ('bell','memory','trivia') LIMIT 1`, u)],
  ['mult100', '🌙', 'Moonshot', 'Win at 100x or more', 400, u => !!q1(`SELECT 1 FROM rounds WHERE user_id=? AND payout>bet AND mult>=100 AND game NOT IN ('bell','memory','trivia') LIMIT 1`, u)],
  ['jackpot', '🏆', 'State Champs', 'Hit the Seahawk Slots jackpot', 500, u => !!q1("SELECT 1 FROM rounds WHERE user_id=? AND game='slots' AND mult>=250 LIMIT 1", u)],
  ['rocket10', '🚀', 'To the Moon', 'Cash out Seahawk Launch at 10x+', 200, u => !!q1("SELECT 1 FROM rounds WHERE user_id=? AND game='rocket' AND status='cashed' AND mult>=10 LIMIT 1", u)],
  ['natural', '🃏', 'Natural', 'Get a blackjack in Hawk 21', 100, u => !!q1("SELECT 1 FROM rounds WHERE user_id=? AND game='bj' AND mult=2.5 LIMIT 1", u)],
  ['streak5', '🧲', 'Hot Streak', 'Win 5 in a row in Heads or Tails or Hallway RPS', 150, u => !!q1("SELECT 1 FROM rounds WHERE user_id=? AND game IN ('flip','rps') AND json_extract(state,'$.streak')>=5 LIMIT 1", u)],
  ['streak10', '👑', 'Perfect 10', 'Win 10 in a row in Heads or Tails or Hallway RPS', 400, u => !!q1("SELECT 1 FROM rounds WHERE user_id=? AND game IN ('flip','rps') AND status='cashed' AND json_extract(state,'$.streak')>=10 LIMIT 1", u)],
  ['bell4000', '🔔', 'Lightning', 'Score 4,000+ in Bell Rush', 200, u => !!q1("SELECT 1 FROM scores WHERE user_id=? AND game='bell' AND score>=4000 LIMIT 1", u)],
  ['memory2800', '🧠', 'Photographic', 'Score 2,800+ in Classroom Memory', 200, u => !!q1("SELECT 1 FROM scores WHERE user_id=? AND game='memory' AND score>=2800 LIMIT 1", u)],
  ['trivia7', '❓', 'Honor Roll', 'Get all 7 right in Seahawk Trivia', 250, u => !!q1("SELECT 1 FROM scores WHERE user_id=? AND game='trivia' AND json_extract(detail,'$.correct')=7 LIMIT 1", u)],
  ['sniper', '🎯', 'Sniper', 'Win Scoreboard Roll at 5% chance or less', 150, u => !!q1("SELECT 1 FROM rounds WHERE user_id=? AND game='dice' AND payout>bet AND json_extract(state,'$.zone')<=5 LIMIT 1", u)],
  ['bullseye', '🔔', 'Bullseye', 'Roll exactly 50.00 on Scoreboard Roll', 100, u => !!q1("SELECT 1 FROM rounds WHERE user_id=? AND game='dice' AND json_extract(state,'$.roll')=50 LIMIT 1", u)],
  ['wheel', '🎡', 'Spin Doctor', 'Spin the daily wheel', 50, u => !!q1("SELECT 1 FROM users WHERE id=? AND last_wheel!=''", u)],
  ['claims10', '📋', 'Overachiever', 'Finish 10 daily challenges', 200, u => q1('SELECT COUNT(*) n FROM challenge_claims WHERE user_id=?', u).n >= 10],
  ['varsity', '🎓', 'Varsity', 'Reach level 5', 300, u => q1('SELECT level FROM users WHERE id=?', u).level >= 5],
];
function progress(uid) { // awards any newly earned achievements and level-ups; safe to call as often as you like
  return tx(() => {
    const got = new Set(db.prepare('SELECT key FROM achievements WHERE user_id=?').all(uid).map(r => r.key)), fresh = [];
    for (const [key, icon, title, desc, xp, check] of ACH) if (!got.has(key) && check(uid)) { db.prepare('INSERT INTO achievements(user_id,key,ts) VALUES(?,?,?)').run(uid, key, now()); addXp(uid, xp); fresh.push({ key, icon, title, desc, xp }); }
    const u = db.prepare('SELECT xp, level FROM users WHERE id=?').get(uid), info = levelInfo(u.xp); let levelUp = null;
    if (info.level > u.level) { const reward = (info.level - u.level) * 100 * info.level; db.prepare('UPDATE users SET level=? WHERE id=?').run(info.level, uid); grant(uid, reward, 'level_up'); levelUp = { from: u.level, to: info.level, name: info.name, reward }; }
    return { achievements: fresh, levelUp, level: info, balance: balanceOf(uid) };
  });
}
function rewardsState(ctx) {
  const uid = ctx.user.id, day = dayKey(), t0 = etMidnight(day), claimed = new Set(db.prepare('SELECT cid FROM challenge_claims WHERE user_id=? AND day=?').all(uid, day).map(r => r.cid));
  const u = db.prepare('SELECT xp, last_wheel FROM users WHERE id=?').get(uid), have = new Map(db.prepare('SELECT key, ts FROM achievements WHERE user_id=?').all(uid).map(r => [r.key, r.ts]));
  return {
    day, level: levelInfo(u.xp), wheelReady: u.last_wheel !== day, wheel: WHEEL.map(w => w[0]),
    challenges: todaysChallenges(day).map(c => ({ id: c.id, title: c.title, desc: c.desc, icon: c.icon, goal: c.goal, reward: c.reward, progress: Math.min(c.goal, c.p(uid, t0)), claimed: claimed.has(c.id) })),
    achievements: ACH.map(([key, icon, title, desc, xp]) => ({ key, icon, title, desc, xp, unlocked: have.has(key), ts: have.get(key) || null })),
  };
}
function claimChallenge(ctx) {
  const id = String(ctx.body.id || ''), day = dayKey(), c = todaysChallenges(day).find(x => x.id === id); if (!c) bad('That challenge is not active today');
  return tx(() => {
    if (db.prepare('SELECT 1 FROM challenge_claims WHERE user_id=? AND day=? AND cid=?').get(ctx.user.id, day, id)) bad('Already claimed');
    if (c.p(ctx.user.id, etMidnight(day)) < c.goal) bad('Not finished yet');
    db.prepare('INSERT INTO challenge_claims(user_id,day,cid) VALUES(?,?,?)').run(ctx.user.id, day, id); addXp(ctx.user.id, 50);
    return { balance: grant(ctx.user.id, c.reward, 'challenge'), reward: c.reward };
  });
}
function spinWheel(ctx) {
  const day = dayKey();
  return tx(() => {
    const u = db.prepare('SELECT last_wheel FROM users WHERE id=?').get(ctx.user.id); if (u.last_wheel === day) bad('Come back tomorrow for another spin');
    let r = rnd() * 100, i = 0; for (; i < WHEEL.length - 1; i++) { r -= WHEEL[i][1]; if (r < 0) break; }
    db.prepare('UPDATE users SET last_wheel=? WHERE id=?').run(day, ctx.user.id); addXp(ctx.user.id, 10);
    return { index: i, prize: WHEEL[i][0], balance: grant(ctx.user.id, WHEEL[i][0], 'wheel') };
  });
}
function tournament(ctx) { // best multiplier of the week (Super Luck rounds and skill games excluded)
  const t = weekStart(), base = `FROM rounds r JOIN users u ON u.id=r.user_id WHERE r.created>=? AND r.payout>r.bet AND r.game NOT IN ('bell','memory','trivia') AND r.state NOT LIKE '%"sup":1%'`;
  const top = db.prepare(`SELECT u.username, r.game, MAX(r.mult) AS mult, r.bet, r.payout ${base} GROUP BY r.user_id ORDER BY mult DESC, r.id LIMIT 10`).all(t);
  const mine = db.prepare(`SELECT MAX(r.mult) AS mult ${base} AND r.user_id=?`).get(t, ctx.user.id).mult;
  return { top, mine, since: t };
}

/* ---------- bank: free Hawk Bucks top-ups (tracked so the leaderboard ranks real winnings) ---------- */
function bank(ctx) { // broke-only refill: under 100 Hawk Bucks, once an hour
  return tx(() => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id);
    if (u.balance >= CLAIM_BELOW) bad(`The Bank only helps when you're under ${CLAIM_BELOW} Hawk Bucks`);
    if (now() - u.last_claim < CLAIM_EVERY_MS) bad(`The Bank refills once an hour. Try again in ${Math.ceil((u.last_claim + CLAIM_EVERY_MS - now()) / 60e3)} min`);
    db.prepare('UPDATE users SET last_claim=?, added=added+? WHERE id=?').run(now(), CLAIM_AMT, u.id);
    return { balance: adjust(u.id, CLAIM_AMT, 'bank'), added: u.added + CLAIM_AMT, nextClaim: CLAIM_EVERY_MS };
  });
}

/* ---------- routes ---------- */
const need = fn => ctx => { if (!ctx.user) bad('Please log in', 401); return fn(ctx); };
const routes = {
  'GET /api/me': ctx => ({ user: ctx.user ? publicUser(ctx.user) : null, inviteRequired: !!INVITE_CODE }),
  'POST /api/register': ctx => { limit(ctx.ip); return register(ctx); },
  'POST /api/login': ctx => { limit(ctx.ip); return login(ctx); },
  'POST /api/logout': ctx => { const m = /sp_sid=([a-f0-9]{64})/.exec(ctx.req.headers.cookie || ''); if (m) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(m[1])); ctx.res.setHeader('Set-Cookie', `sp_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${PROD ? '; Secure' : ''}`); return { ok: true }; },
  'POST /api/claim': need(bank),
  'GET /api/props': need(() => ({ props: db.prepare("SELECT id,sport,who,lvl,vs,stat,type,line,init,status,actual FROM props ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'locked' THEN 1 ELSE 2 END, id").all() })),
  'POST /api/slips': need(placeSlip),
  'GET /api/slips': need(mySlips),
  'GET /api/leaderboard': need(ctx => {
    // ranked by net winnings (balance minus the starting 1,000 and any free top-ups), so adding Hawk Bucks can't buy a top spot
    const top = db.prepare(`SELECT username, balance, gear, ${NET_SQL} AS net FROM users WHERE banned=0 ORDER BY net DESC, id LIMIT 20`).all();
    const me = db.prepare(`SELECT username, balance, gear, ${NET_SQL} AS net FROM users WHERE id=?`).get(ctx.user.id);
    me.rank = db.prepare(`SELECT COUNT(*)+1 AS r FROM users WHERE banned=0 AND ${NET_SQL}>?`).get(me.net).r;
    return { top: top.map(x => ({ ...x, gear: gearOf(x) })), me: { ...me, gear: gearOf(me) } };
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
  'GET /api/fair': need(ctx => fairInfo(ctx.user.id)),
  'POST /api/fair/rotate': need(fairRotate),
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
  'POST /api/luck': need(admin(setLuck)),
  'GET /api/shop': need(shopState),
  'POST /api/shop/buy': need(buyItem),
  'POST /api/shop/booster': need(buyBooster),
  'POST /api/shop/equip': need(equipItem),
  'POST /api/shop/recharge': need(rechargeItem),
  'GET /api/notes': need(myNotes),
  'GET /api/admin/users': need(admin(adminUsers)),
  'GET /api/admin/log': need(admin(adminLog)),
  'GET /api/admin/shop': need(admin(() => ({ shop: shopCfg(), items: ITEMS, boosters: BOOSTERS }))),
  'POST /api/admin/money': need(admin(adminMoney)),
  'POST /api/admin/balance': need(admin(adminSetBalance)),
  'POST /api/admin/give-item': need(admin(c => adminItem(c, true))),
  'POST /api/admin/take-item': need(admin(c => adminItem(c, false))),
  'POST /api/admin/luck': need(admin(adminLuck)),
  'POST /api/admin/shop': need(admin(adminShop)),
  'POST /api/admin/password': need(admin(adminPassword)),
  'POST /api/admin/ban': need(admin(adminBan)),
  'POST /api/progress': need(ctx => progress(ctx.user.id)),
  'GET /api/rewards': need(rewardsState),
  'POST /api/challenges/claim': need(claimChallenge),
  'POST /api/wheel': need(spinWheel),
  'GET /api/tournament': need(tournament),
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
