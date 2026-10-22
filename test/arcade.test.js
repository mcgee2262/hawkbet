// Run with: node --test   (from the repo root)
// Spins up the real server on a throwaway database and exercises the API end to end.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const PORT = 18000 + Math.floor(Math.random() * 2000);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hawkbet-test-'));
const BASE = `http://127.0.0.1:${PORT}`;
let srv;

before(async () => {
  srv = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(DIR, 'test.db'), BELL_DELAY_SCALE: '0.05', ROCKET_RATE: '0.002', HB_TEST_CHALLENGES: 'play10,games3,win5', NODE_ENV: 'test' }, stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) return; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => { srv.kill(); fs.rmSync(DIR, { recursive: true, force: true }); });

function client() { // tiny cookie-keeping API client
  let cookie = '';
  return async (method, p, body) => {
    const r = await fetch(BASE + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, ...(await r.json()) };
  };
}
async function newUser(name) { const api = client(); const r = await api('POST', '/register', { username: name, password: 'testpass1' }); assert.equal(r.status, 200); return api; }

test('luck defaults to normal, validates input, and persists across logins', async () => {
  const api = await newUser('lucky');
  assert.equal((await api('GET', '/me')).user.luck, 'normal');
  for (const bad of [0, 11, 5.5, '5', 'max', null, -1, 'x3', 'x1', 'X5']) assert.equal((await api('POST', '/luck', { luck: bad })).status, 400, `rejects ${JSON.stringify(bad)}`);
  assert.equal((await api('POST', '/luck', { luck: 10 })).luck, 10);
  const again = client(); await again('POST', '/login', { username: 'lucky', password: 'testpass1' });
  assert.equal((await again('GET', '/me')).user.luck, 10);
  assert.equal((await api('POST', '/luck', { luck: 'normal' })).luck, 'normal');
});

test('luck changes win chances but keeps average payback the same', async () => {
  const api = await newUser('fairplay');
  const dice = async () => (await api('POST', '/arcade/dice', { bet: 1, target: 50, over: true }));
  const plinko = async () => (await api('GET', '/arcade/plinko-table?rows=12&risk=high')).mults;
  const normal = { d: await dice(), p: await plinko(), cfg: await api('GET', '/arcade/config') };
  assert.equal(normal.d.zone, 50); assert.equal(normal.d.pays, 1.98);
  await api('POST', '/luck', { luck: 10 });
  const lucky = { d: await dice(), p: await plinko(), cfg: await api('GET', '/arcade/config') };
  assert.equal(lucky.d.zone, 75, 'luck 10 widens the dice win zone by 1.5x');
  assert.ok(Math.abs(lucky.d.pays * lucky.d.zone / 100 - 0.99) < 1e-9, 'dice RTP still 99%');
  assert.deepEqual(lucky.p, normal.p, 'plinko is fixed-odds');
  assert.equal(lucky.cfg.luck.k, 1.5); assert.equal(lucky.cfg.luck.flipP, 0.75);
  assert.ok(lucky.cfg.cross.med[0] < normal.cfg.cross.med[0], 'safer lanes pay less');
  assert.equal((await api('POST', '/arcade/limbo', { bet: 1, target: 1.2 })).status, 400, 'limbo minimum target rises with luck');
  const l = await api('POST', '/arcade/limbo', { bet: 1, target: 3 }); assert.equal(l.pays, 2);
  // Seymour Flip: measure the real win rate at luck 10 vs luck 1
  const rate = async () => { let w = 0; for (let i = 0; i < 300; i++) { await api('POST', '/arcade/flip/start', { bet: 1 }); const r = await api('POST', '/arcade/flip/call', { call: 'heads' }); if (r.lost) continue; w++; await api('POST', '/arcade/flip/cashout'); } return w / 300; };
  const hi = await rate(); await api('POST', '/luck', { luck: 1 }); const lo = await rate();
  assert.ok(hi > 0.65 && hi < 0.85, `luck 10 win rate ${hi}`); assert.ok(lo > 0.2 && lo < 0.4, `luck 1 win rate ${lo}`);
});

test('Super Luck x2/x5/x10 divides your chance to lose, keeps payouts, and is excluded from the leaderboard', async () => {
  const api = await newUser('superfan');
  for (const [lv, flipP] of [['x2', 0.75], ['x5', 0.9], ['x10', 0.95]]) {
    assert.equal((await api('POST', '/luck', { luck: lv })).luck, lv);
    const cfg = (await api('GET', '/arcade/config')).luck;
    assert.equal(cfg.sup, 1); assert.equal(cfg.pk, 1); assert.ok(Math.abs(cfg.flipP - flipP) < 1e-9, `${lv} flip chance ${cfg.flipP}`);
    assert.ok(Math.abs(cfg.flipPay - 0.5) < 1e-9, 'payouts stay priced at Normal');
  }
  await api('POST', '/luck', { luck: 'x5' });
  const d = await api('POST', '/arcade/dice', { bet: 1, target: 50, over: true });
  assert.equal(d.zone, 90); assert.equal(d.pays, 1.98, 'dice pays like Normal');
  assert.equal((await api('POST', '/arcade/limbo', { bet: 1, target: 1.01 })).status, 200, 'no raised minimum under Super Luck');
  let w = 0; for (let i = 0; i < 300; i++) { await api('POST', '/arcade/flip/start', { bet: 5 }); const r = await api('POST', '/arcade/flip/call', { call: 'tails' }); if (r.lost) continue; w++; await api('POST', '/arcade/flip/cashout'); }
  assert.ok(w / 300 > 0.83 && w / 300 < 0.96, `x5 win rate ${w / 300}`);
  const lb = await api('GET', '/leaderboard'), me = (await api('GET', '/me')).user;
  assert.notEqual(me.balance, 1000, 'balance moved'); assert.equal(lb.me.net, 0, 'Super Luck play does not count toward net winnings');
  await api('POST', '/luck', { luck: 'normal' });
  assert.equal((await api('GET', '/arcade/config')).luck.sup, 0);
});

test('Hawk Drop pays big jackpots at 99% payback', async () => {
  const api = await newUser('plinkopro');
  for (const risk of ['low', 'med', 'high']) for (const rows of [8, 12, 16]) {
    const m = (await api('GET', `/arcade/plinko-table?rows=${rows}&risk=${risk}`)).mults;
    assert.equal(m.length, rows + 1);
    let rtp = 0, c = 1; for (let k = 0; k <= rows; k++) { rtp += m[k] * c / 2 ** rows; c = c * (rows - k) / (k + 1); }
    assert.ok(Math.abs(rtp - 0.99) < 1e-9, `${risk}/${rows} rtp ${rtp}`);
  }
  assert.ok((await api('GET', '/arcade/plinko-table?rows=16&risk=high')).mults[0] >= 700, 'high risk 16 rows pays 700x+ at the edges');
  assert.ok((await api('GET', '/arcade/plinko-table?rows=12&risk=med')).mults[0] >= 45, 'medium 12 rows pays 45x+ at the edges');
});

test('Seahawk Slots: 3x3 grid, 5 paylines, wild hawk, payout matches the grid, ~97% payback', async () => {
  const api = await newUser('slotfan');
  const cfg = (await api('GET', '/arcade/config')).slots;
  assert.ok(cfg.rtp > 0.95 && cfg.rtp < 1, `exact payback ${cfg.rtp}`); assert.equal(cfg.lines.length, 5); assert.equal(cfg.pays.trophy / 5, 250);
  await api('POST', '/bank', { amount: 1000 }); await api('POST', '/bank', { amount: 1000 });
  const lineOf = (g, L) => L.map((r, c) => g[r][c]);
  const expect = g => { let t = 0; for (const L of cfg.lines) { const s = lineOf(g, L), non = s.filter(x => x !== 'hawk'); let sym = null;
    if (s[0] === s[1] && s[1] === s[2]) sym = s[0]; else if (!s.includes('trophy') && non.length && non.every(x => x === non[0])) sym = non[0]; if (sym) t += cfg.pays[sym]; } return t / 5; };
  let staked = 0, paid = 0, wins = 0;
  for (let i = 0; i < 400; i++) {
    const r = await api('POST', '/arcade/slots', { bet: 10 });
    assert.equal(r.grid.length, 3); assert.ok(r.grid.every(row => row.length === 3));
    assert.equal(r.mult, expect(r.grid), 'server payout follows the lines'); assert.equal(r.payout, Math.round(10 * r.mult));
    const winning = cfg.lines.map((L, k) => k).filter(k => { const s = lineOf(r.grid, cfg.lines[k]), non = s.filter(x => x !== 'hawk'); return (s[0] === s[1] && s[1] === s[2]) || (!s.includes('trophy') && non.length && non.every(x => x === non[0])); });
    assert.deepEqual(r.wins.map(w => w.line), winning, 'winning lines match the grid');
    staked += 10; paid += r.payout; wins += r.payout > 0;
  }
  assert.ok(paid / staked > 0.6 && paid / staked < 1.5, `sampled payback ${paid / staked}`); assert.ok(wins > 40, `hit rate ${wins / 400}`);
});

test('rewards: level, daily challenges, wheel and achievements are server-side and never touch net winnings', async () => {
  const api = await newUser('rewardkid');
  let rw = await api('GET', '/rewards');
  assert.equal(rw.level.name, 'Freshman'); assert.equal(rw.level.level, 1); assert.equal(rw.wheelReady, true);
  assert.deepEqual(rw.challenges.map(c => c.id), ['play10', 'games3', 'win5']); assert.ok(rw.achievements.length >= 15 && rw.achievements.every(a => !a.unlocked));
  assert.equal((await api('POST', '/challenges/claim', { id: 'games3' })).status, 400, 'cannot claim before finishing');
  assert.equal((await api('POST', '/challenges/claim', { id: 'bell3000' })).status, 400, 'cannot claim a challenge that is not active today');
  // the wheel: once a day, prize comes from the table, free credits are not "winnings"
  const w0 = (await api('GET', '/me')).user, w = await api('POST', '/wheel');
  assert.ok(rw.wheel.includes(w.prize)); assert.equal(w.balance, w0.balance + w.prize);
  assert.equal((await api('POST', '/wheel')).status, 400, 'one spin per day');
  const me = (await api('GET', '/me')).user; assert.equal(me.added, w.prize);
  assert.equal((await api('GET', '/leaderboard')).me.net, 0, 'free rewards are not net winnings');
  // play 3 different games: challenge becomes claimable exactly once
  await api('POST', '/arcade/dice', { bet: 1, target: 50, over: true }); await api('POST', '/arcade/limbo', { bet: 1, target: 2 }); await api('POST', '/arcade/slots', { bet: 5 });
  rw = await api('GET', '/rewards'); const g3 = rw.challenges.find(c => c.id === 'games3'); assert.equal(g3.progress, 3);
  const before = (await api('GET', '/me')).user, cl = await api('POST', '/challenges/claim', { id: 'games3' });
  assert.equal(cl.reward, 100); assert.equal(cl.balance, before.balance + 100); assert.equal((await api('POST', '/challenges/claim', { id: 'games3' })).status, 400, 'no double claims');
  assert.equal((await api('GET', '/me')).user.added, w.prize + 100);
  // XP: every round earns it; 50 rounds crosses 500 XP = Sophomore, with a one-time level-up reward
  for (let i = 0; i < 50; i++) await api('POST', '/arcade/dice', { bet: 1, target: 50, over: true });
  const pr = await api('POST', '/progress');
  assert.ok(pr.achievements.some(a => a.key === 'rounds10'), 'Warming Up unlocked'); assert.ok(pr.achievements.some(a => a.key === 'wheel'));
  assert.ok(pr.levelUp && pr.levelUp.to === 2 && pr.levelUp.name === 'Sophomore' && pr.levelUp.reward === 200, JSON.stringify(pr.levelUp));
  const pr2 = await api('POST', '/progress'); assert.equal(pr2.levelUp, null); assert.equal(pr2.achievements.length, 0, 'achievements unlock once');
  assert.equal((await api('GET', '/me')).user.lvl.name, 'Sophomore');
  assert.ok((await api('GET', '/tournament')).top);
});

test('live feed shows recent rounds and site stats', async () => {
  const api = await newUser('feedwatch');
  await api('POST', '/arcade/dice', { bet: 3, target: 50, over: true });
  const f = await api('GET', '/feed');
  assert.ok(f.bets.length >= 1 && f.bets[0].username && f.bets[0].game); assert.ok(f.stats.players >= 1 && f.stats.rounds >= 1);
});

test('skill games: practice is free, bets pay by score tier', async () => {
  const api = await newUser('skillbet');
  const start = (await api('GET', '/me')).user.balance;
  let r = await api('POST', '/arcade/trivia/start'); assert.equal(r.bet, 0);
  for (let i = 0; i < 7; i++) r = await api('POST', '/arcade/trivia/answer', { choice: 1 });
  assert.equal(r.payout, 0); assert.equal((await api('GET', '/me')).user.balance, start, 'practice never touches the balance');
  r = await api('POST', '/arcade/trivia/start', { bet: 100 }); assert.equal(r.bet, 100); assert.equal(r.balance, start - 100);
  for (let i = 0; i < 7; i++) r = await api('POST', '/arcade/trivia/answer', { choice: 0 });
  const tier = [[900, 3], [750, 2], [600, 1.5], [450, 1]].find(([m]) => r.score >= m);
  assert.equal(r.mult, tier ? tier[1] : 0); assert.equal(r.payout, Math.round(100 * r.mult)); assert.equal(r.balance, start - 100 + r.payout);
  const tooMuch = await api('POST', '/arcade/bell/start', { bet: 10 ** 9 });
  assert.equal(tooMuch.status, 400); assert.match(tooMuch.error, /Not enough/, 'you can only bet what you have');
});

test('Bell Rush: early taps score 0, real taps score 1000 - ms, and the score is saved', async () => {
  const api = await newUser('belltest');
  await api('POST', '/arcade/bell/start');
  let early = null;
  for (let b = 1; b <= 5; b++) {
    const ring = api('POST', '/arcade/bell/next');
    if (b === 1) { early = await api('POST', '/arcade/bell/tap'); assert.equal(early.res, 'early'); assert.equal(early.pts, 0); await ring; continue; }
    assert.equal((await ring).ring, true);
    await new Promise(r => setTimeout(r, 150));
    const t = await api('POST', '/arcade/bell/tap');
    assert.equal(t.res, 'ok'); assert.ok(t.ms >= 140 && t.ms < 600, `ms ${t.ms}`); assert.equal(t.pts, 1000 - t.ms);
    if (b === 5) { assert.equal(t.done, true); assert.equal(t.newBest, true); assert.equal(t.score, t.total); }
  }
  assert.equal((await api('POST', '/arcade/bell/tap')).status, 409, 'no tapping after the game ends');
  const hs = await api('GET', '/arcade/highscores?game=bell');
  assert.equal(hs.top[0].username, 'belltest');
  assert.ok((await api('GET', '/arcade/stats')).best.bell.score > 0);
});

test('Classroom Memory: cards stay hidden until flipped and the score follows the formula', async () => {
  const api = await newUser('memtest');
  assert.equal((await api('POST', '/arcade/memory/start')).cards, 16);
  assert.equal((await api('POST', '/arcade/memory/flip', { i: 99 })).status, 400, 'validates card index');
  const seen = {}; let last;
  for (let i = 0; i < 16; i++) { // flip each card once, pairing as we go, to learn the deck
    const r = await api('POST', '/arcade/memory/flip', { i }); seen[i] = r.sym; last = r;
    if (r.pair && !r.match) continue;
  }
  // finish any unmatched pairs using what we learned
  const bySym = {}; for (const [i, s] of Object.entries(seen)) (bySym[s] ||= []).push(+i);
  for (const [a, b] of Object.values(bySym)) {
    if (last.done) break;
    const r1 = await api('POST', '/arcade/memory/flip', { i: a });
    if (r1.status === 400) continue; // already matched
    last = await api('POST', '/arcade/memory/flip', { i: b });
  }
  assert.equal(last.done, true);
  const expected = Math.max(0, Math.round(3000 - 100 * Math.max(0, last.moves - 8) - 10 * last.secs));
  assert.equal(last.score, expected);
  assert.equal((await api('POST', '/arcade/memory/flip', { i: 0 })).status, 409, 'no flipping after the game ends');
});

test('Seahawk Trivia: answers are checked server-side and scored 100 + speed bonus', async () => {
  const api = await newUser('quizkid');
  let r = await api('POST', '/arcade/trivia/start');
  assert.equal(r.question.a.length, 4); assert.ok(!('answer' in r.question), 'answer is not sent with the question');
  assert.equal((await api('POST', '/arcade/trivia/answer', { choice: 7 })).status, 400);
  let score = 0;
  for (let i = 0; i < 7; i++) {
    const a = await api('POST', '/arcade/trivia/answer', { choice: 0 });
    if (a.right) assert.ok(a.pts >= 100 && a.pts <= 150, JSON.stringify(a)); else assert.equal(a.pts, 0, JSON.stringify(a));
    score += a.pts; assert.equal(a.score, score);
    if (i === 6) { assert.equal(a.done, true); assert.equal(a.of, 7); assert.ok(a.correct >= 0 && a.correct <= 7); } else assert.ok(a.next.q);
  }
});

test('Seahawk Launch: crash point stays secret, cash-outs and auto cash-outs pay correctly', async () => {
  const api = await newUser('rocketeer');
  const bal0 = (await api('GET', '/me')).user.balance;
  let s = await api('POST', '/arcade/rocket/start', { bet: 100 });
  assert.equal(s.balance, bal0 - 100); assert.ok(!('c' in s) && !('crash' in s), 'crash point is not sent');
  assert.equal((await api('POST', '/arcade/rocket/start', { bet: 10 })).status, 409, 'one rocket at a time');
  const early = await api('POST', '/arcade/rocket/cashout'); // before liftoff = 1.00x, you just get your bet back
  assert.equal(early.event, 'cashed'); assert.equal(early.mult, 1); assert.equal(early.balance, bal0);
  const after = await api('POST', '/arcade/rocket/watch', { id: s.id }); assert.equal(after.event, 'crash'); assert.ok(after.crash >= 1);
  // auto cash-out at 1.5x: either it cashes at exactly 1.5x or the rocket crashed below 1.5x first
  let wins = 0;
  for (let i = 0; i < 6; i++) {
    const b = (await api('GET', '/me')).user.balance; s = await api('POST', '/arcade/rocket/start', { bet: 10, auto: 1.5 });
    const ev = await api('POST', '/arcade/rocket/watch', { id: s.id });
    if (ev.event === 'cashed') { wins++; assert.equal(ev.mult, 1.5); assert.equal(ev.balance, b - 10 + 15); const end = await api('POST', '/arcade/rocket/watch', { id: s.id }); assert.ok(end.crash >= 1.5); }
    else { assert.ok(ev.crash <= 1.5); assert.equal(ev.balance, b - 10); }
  }
  assert.equal((await api('POST', '/arcade/rocket/start', { bet: 10, auto: 0.5 })).status, 400, 'validates auto cash-out');
  assert.equal((await api('POST', '/arcade/rocket/watch', { id: 999999 })).status, 404, 'cannot watch someone else’s flight');
  assert.ok((await api('GET', '/arcade/rocket/history')).crashes.length >= 7);
});

test('existing flows still work: slips, bank and a chance game', async () => {
  const api = await newUser('regress');
  const me = (await api('GET', '/me')).user;
  const slip = await api('POST', '/slips', { mode: 'power', entry: 10, picks: [{ propId: 1, dir: 'more' }, { propId: 2, dir: 'less' }] });
  assert.equal(slip.balance, me.balance - 10);
  assert.equal((await api('POST', '/bank', { amount: 500 })).balance, me.balance - 10 + 500);
  const d = await api('POST', '/arcade/dice', { bet: 10, target: 50, over: true });
  assert.ok(typeof d.roll === 'number' && d.payout >= 0);
  // no bet limit: a stake above the old 1,000 cap works when you can afford it
  await api('POST', '/bank', { amount: 1000 });
  const bal = (await api('GET', '/me')).user.balance, big = await api('POST', '/arcade/dice', { bet: 1500, target: 50, over: true });
  assert.equal(big.bet, 1500); assert.equal(big.balance, bal - 1500 + big.payout);
  assert.equal((await api('POST', '/arcade/dice', { bet: 0, target: 50, over: true })).status, 400, 'bet must be at least 1');
});
