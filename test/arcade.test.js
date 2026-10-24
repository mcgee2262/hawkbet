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
let srv, boss; // boss = the first account, which makes it the admin

before(async () => {
  srv = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(DIR, 'test.db'), BELL_DELAY_SCALE: '0.05', ROCKET_RATE: '0.002', HB_TEST_CHALLENGES: 'play10,games3,win5', SKILL_TIME_SCALE: '0.05', AUTH_LIMIT: '1000', NODE_ENV: 'test' }, stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) { boss = client(); assert.equal((await boss('POST', '/register', { username: 'boss', password: 'testpass1' })).user.isAdmin, true); return; } } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
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
async function newUser(name) { const api = client(); const r = await api('POST', '/register', { username: name, password: 'testpass1' }); assert.equal(r.status, 200); api.user = name; return api; }
const setLuck = (api, luck) => boss('POST', '/admin/luck', { username: api.user, luck }); // the Luck Lab is admin-only now
const give = (api, amount) => boss('POST', '/admin/money', { username: api.user, amount });

test('luck defaults to normal; only the admin can set it, input is validated, and it persists', async () => {
  const api = await newUser('lucky');
  assert.equal((await api('GET', '/me')).user.luck, 'normal');
  assert.equal((await api('POST', '/luck', { luck: 10 })).status, 403, 'players cannot use the Luck Lab');
  for (const bad of [0, 11, 5.5, '5', 'max', null, -1, 'x3', 'x1', 'X5']) assert.equal((await setLuck(api, bad)).status, 400, `rejects ${JSON.stringify(bad)}`);
  assert.equal((await setLuck(api, 10)).luck, 10);
  const again = client(); await again('POST', '/login', { username: 'lucky', password: 'testpass1' });
  assert.equal((await again('GET', '/me')).user.luck, 10);
  assert.equal((await setLuck(api, 'normal')).luck, 'normal');
});

test('luck changes win chances but keeps average payback the same', async () => {
  const api = await newUser('fairplay');
  const dice = async () => (await api('POST', '/arcade/dice', { bet: 1, target: 50, over: true }));
  const plinko = async () => (await api('GET', '/arcade/plinko-table?rows=12&risk=high')).mults;
  const normal = { d: await dice(), p: await plinko(), cfg: await api('GET', '/arcade/config') };
  assert.equal(normal.d.zone, 50); assert.equal(normal.d.pays, 1.98);
  await setLuck(api, 10);
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
  const hi = await rate(); await setLuck(api, 1); const lo = await rate();
  assert.ok(hi > 0.65 && hi < 0.85, `luck 10 win rate ${hi}`); assert.ok(lo > 0.2 && lo < 0.4, `luck 1 win rate ${lo}`);
});

test('Super Luck x2/x5/x10 divides your chance to lose, keeps payouts, and is excluded from the leaderboard', async () => {
  const api = await newUser('superfan');
  for (const [lv, flipP] of [['x2', 0.75], ['x5', 0.9], ['x10', 0.95]]) {
    assert.equal((await setLuck(api, lv)).luck, lv);
    const cfg = (await api('GET', '/arcade/config')).luck;
    assert.equal(cfg.sup, 1); assert.equal(cfg.pk, 1); assert.ok(Math.abs(cfg.flipP - flipP) < 1e-9, `${lv} flip chance ${cfg.flipP}`);
    assert.ok(Math.abs(cfg.flipPay - 0.5) < 1e-9, 'payouts stay priced at Normal');
  }
  await setLuck(api, 'x5');
  const d = await api('POST', '/arcade/dice', { bet: 1, target: 50, over: true });
  assert.equal(d.zone, 90); assert.equal(d.pays, 1.98, 'dice pays like Normal');
  assert.equal((await api('POST', '/arcade/limbo', { bet: 1, target: 1.01 })).status, 200, 'no raised minimum under Super Luck');
  let w = 0; for (let i = 0; i < 300; i++) { await api('POST', '/arcade/flip/start', { bet: 5 }); const r = await api('POST', '/arcade/flip/call', { call: 'tails' }); if (r.lost) continue; w++; await api('POST', '/arcade/flip/cashout'); }
  assert.ok(w / 300 > 0.83 && w / 300 < 0.96, `x5 win rate ${w / 300}`);
  const lb = await api('GET', '/leaderboard'), me = (await api('GET', '/me')).user;
  assert.notEqual(me.balance, 1000, 'balance moved'); assert.equal(lb.me.net, 0, 'Super Luck play does not count toward net winnings');
  await setLuck(api, 'normal');
  assert.equal((await api('GET', '/arcade/config')).luck.sup, 0);
});

test('Seahawk Drop pays big jackpots at 99% payback', async () => {
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
  await give(api, 2000);
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
  assert.ok(paid / staked > 0.4 && paid / staked < 4, `sampled payback ${paid / staked}`); // a lone 250x jackpot can swing 400 spins; the exact payback is checked above assert.ok(wins > 40, `hit rate ${wins / 400}`);
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
  const lines = (await api('GET', '/props')).props;
  const slip = await api('POST', '/slips', { mode: 'power', entry: 10, picks: [{ propId: lines[0].id, dir: 'more' }, { propId: lines[1].id, dir: 'less' }] });
  assert.equal(slip.balance, me.balance - 10);
  assert.equal((await api('POST', '/bank')).status, 400, 'the Bank only helps when you are broke');
  const d = await api('POST', '/arcade/dice', { bet: 10, target: 50, over: true });
  assert.ok(typeof d.roll === 'number' && d.payout >= 0);
  // no bet limit: a stake above the old 1,000 cap works when you can afford it
  await give(api, 1000);
  const bal = (await api('GET', '/me')).user.balance, big = await api('POST', '/arcade/dice', { bet: 1500, target: 50, over: true });
  assert.equal(big.bet, 1500); assert.equal(big.balance, bal - 1500 + big.payout);
  assert.equal((await api('POST', '/arcade/dice', { bet: 0, target: 50, over: true })).status, 400, 'bet must be at least 1');
});

test('Scoreboard Roll is provably fair: rolls recompute from the revealed seed, and the fingerprint matches', async () => {
  const crypto = require('node:crypto'), api = await newUser('fairplayer');
  const f0 = await api('GET', '/fair'); assert.match(f0.hash, /^[0-9a-f]{64}$/); assert.equal(f0.nonce, 0);
  const rolls = [];
  for (let i = 0; i < 5; i++) { const r = await api('POST', '/arcade/dice', { bet: 10, target: 50, over: i % 2 === 0 }); assert.equal(r.status, 200); assert.equal(r.nonce, i); assert.equal(r.hash, f0.hash); rolls.push(r); }
  const rot = await api('POST', '/fair/rotate', { clientSeed: 'go hawks' });
  assert.equal(crypto.createHash('sha256').update(rot.revealed.serverSeed).digest('hex'), f0.hash, 'revealed seed hashes to the earlier fingerprint');
  assert.equal(rot.revealed.rolls, 5); assert.equal(rot.clientSeed, 'go hawks'); assert.equal(rot.nonce, 0); assert.notEqual(rot.hash, f0.hash);
  for (const r of rolls) {
    const v = Math.floor(crypto.createHmac('sha256', rot.revealed.serverSeed).update(`${r.clientSeed}:${r.nonce}`).digest().readUInt32BE(0) / 4294967296 * 10000) / 100;
    assert.equal(v, r.roll, 'roll recomputes exactly');
  }
});

test('Hawk Shop: gear adds luck, boosters run out, Mythic items are gated and wear out, spending never hurts your rank', async () => {
  const api = await newUser('shopper');
  assert.equal((await api('POST', '/shop/buy', { itemId: 'hat_snap' })).status, 400, 'cannot afford it yet');
  await give(api, 100000);
  assert.equal((await api('GET', '/notes')).notes.length, 1, 'gift shows up as a note'); assert.equal((await api('GET', '/notes')).notes.length, 0, 'notes are shown once');
  const net0 = (await api('GET', '/leaderboard')).me.net;
  let s = await api('POST', '/shop/buy', { itemId: 'hat_snap' }); assert.equal(s.luck.level, 6); assert.equal(s.gear.hat, 'hat_snap');
  s = await api('POST', '/shop/buy', { itemId: 'face_shades' }); assert.equal(s.luck.level, 7);
  assert.equal((await api('GET', '/me')).user.luck, 7); assert.ok(Math.abs((await api('GET', '/arcade/config')).luck.k - 1.2) < 1e-9);
  assert.equal((await api('GET', '/leaderboard')).me.net, net0, 'buying cosmetics does not lower net winnings');
  assert.equal((await api('POST', '/shop/buy', { itemId: 'hat_snap' })).status, 400, 'no buying twice');
  s = await api('POST', '/shop/equip', { slot: 'hat', itemId: null }); assert.equal(s.luck.level, 6, 'unequipping drops the luck');
  assert.equal((await api('POST', '/shop/equip', { slot: 'hat', itemId: 'hat_grad' })).status, 400, 'cannot wear what you do not own');
  s = await api('POST', '/shop/booster', { id: 'penny' }); assert.equal(s.luck.level, 7); assert.equal(s.boosters.find(b => b.id === 'penny').active, 25);
  for (let i = 0; i < 25; i++) await api('POST', '/arcade/dice', { bet: 1, target: 50, over: true });
  assert.equal((await api('GET', '/shop')).luck.level, 6, 'the booster ran out after 25 luck-game rounds');
  // Mythic: gated by level even with the money
  await give(api, 60e6);
  const m = await api('POST', '/shop/buy', { itemId: 'myth_diamond' }); assert.equal(m.status, 400); assert.match(m.error, /level 5/);
  const shop = await api('GET', '/shop'), wings = shop.items.find(i => i.id === 'myth_wings');
  assert.ok(wings.locks.some(l => /Diamond Trophy/.test(l)) && wings.locks.some(l => /leaderboard winnings/.test(l)), 'wings show every missing gate');
  // the admin can hand one out; it gives Super Luck x2 and uses a charge per luck-game round
  assert.equal((await boss('POST', '/admin/give-item', { username: 'shopper', itemId: 'myth_diamond' })).ok, true);
  s = await api('POST', '/shop/equip', { slot: 'mythic', itemId: 'myth_diamond' }); assert.equal(s.luck.luck, 'x2');
  const before = (await api('GET', '/leaderboard')).me.net;
  for (let i = 0; i < 3; i++) await api('POST', '/arcade/dice', { bet: 1000, target: 50, over: true });
  assert.equal((await api('GET', '/shop')).items.find(i => i.id === 'myth_diamond').charges, 997);
  assert.equal((await api('GET', '/leaderboard')).me.net, before, 'Super Luck rounds stay off the leaderboard');
  await api('POST', '/arcade/plinko', { bet: 1, rows: 8, risk: 'low' });
  assert.equal((await api('GET', '/shop')).items.find(i => i.id === 'myth_diamond').charges, 997, 'non-luck games do not use charges');
  s = await api('POST', '/shop/recharge', { itemId: 'myth_diamond' }); assert.equal(s.items.find(i => i.id === 'myth_diamond').charges, 1000);
});

test('admin tools: players, money for one or everyone, balance, shop prices and sales, password reset, bans, log; Bank only when broke', async () => {
  const api = await newUser('student'), other = await newUser('student2');
  assert.equal((await api('GET', '/admin/users')).status, 403, 'players cannot open admin tools');
  assert.equal((await api('POST', '/admin/money', { username: 'student', amount: 5 })).status, 403);
  const users = (await boss('GET', '/admin/users')).users; assert.ok(users.some(u => u.username === 'student'));
  const b0 = (await other('GET', '/me')).user.balance;
  assert.equal((await boss('POST', '/admin/money', { all: true, amount: 250, note: 'Homecoming!' })).ok, true);
  assert.equal((await other('GET', '/me')).user.balance, b0 + 250);
  assert.match((await other('GET', '/notes')).notes[0].msg, /Homecoming/);
  await boss('POST', '/admin/money', { username: 'student', amount: -100000 }); assert.equal((await api('GET', '/me')).user.balance, 0, 'taking stops at zero');
  // Bank: refill only when broke, once an hour
  const bk = await api('POST', '/bank'); assert.equal(bk.balance, 1000); assert.equal((await api('POST', '/bank')).status, 400);
  assert.equal((await boss('POST', '/admin/balance', { username: 'student', balance: 50 })).balance, 50);
  assert.match((await api('POST', '/bank')).error, /once an hour/);
  // shop control
  await boss('POST', '/admin/shop', { itemId: 'hat_bow', price: 10 }); await boss('POST', '/admin/shop', { sale: 50 });
  assert.equal((await api('GET', '/shop')).items.find(i => i.id === 'hat_bow').price, 5);
  await boss('POST', '/admin/shop', { itemId: 'hat_bow', off: true }); assert.equal((await api('POST', '/shop/buy', { itemId: 'hat_bow' })).status, 400, 'turned-off items cannot be bought');
  await boss('POST', '/admin/shop', { sale: 0, itemId: 'hat_bow', price: null, off: false });
  // password reset logs them out; bans block login
  assert.equal((await boss('POST', '/admin/password', { username: 'student', password: 'newpass9' })).ok, true);
  assert.equal((await api('GET', '/me')).user, null, 'old session ended');
  const re = client(); assert.equal((await re('POST', '/login', { username: 'student', password: 'newpass9' })).status, 200);
  await boss('POST', '/admin/ban', { username: 'student', banned: true });
  assert.equal((await re('GET', '/me')).user, null); assert.equal((await re('POST', '/login', { username: 'student', password: 'newpass9' })).status, 403);
  assert.equal((await boss('POST', '/admin/ban', { username: 'boss', banned: true })).status, 400, 'cannot ban an admin');
  await boss('POST', '/admin/ban', { username: 'student', banned: false });
  assert.equal((await re('POST', '/login', { username: 'student', password: 'newpass9' })).status, 200);
  const log = (await boss('GET', '/admin/log')).log; assert.ok(['give', 'take', 'set_balance', 'sale', 'password', 'ban', 'unban'].every(a => log.some(l => l.action === a)), 'every action is logged');
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
test('Free Throw Line: the meter starts when the player is ready, the green window is at the top, and a shot at the center of the green always counts', async () => {
  const api = await newUser('hoopster'), s = await api('POST', '/arcade/hoops/start', { bet: 0 });
  assert.equal(s.shots, 10); assert.ok(s.zone > 0.1); assert.ok(Math.abs(s.center - (0.97 - s.zone)) < 1e-9, 'green window sits at the top of the meter');
  assert.equal((await api('POST', '/arcade/hoops/shoot')).status, 409, 'cannot shoot before the meter is ready');
  await api('POST', '/arcade/hoops/ready'); let r = await api('POST', '/arcade/hoops/shoot'); assert.equal(r.hit, false, 'shooting at once (meter empty) misses'); assert.equal(r.pts, 0);
  assert.equal((await api('POST', '/arcade/hoops/shoot')).status, 409, 'cannot shoot again until the meter is ready');
  let period = r.period, zone = r.zone, makes = 0;
  for (let i = 1; i < 10; i++) {
    const ready = await api('POST', '/arcade/hoops/ready'); assert.equal(ready.period, period); assert.ok(Math.abs(ready.zone - zone) < 1e-9);
    await sleep(((0.97 - zone) * period) / 2 + 12); // the meter rises from the bottom, so the green window is reached at center * period / 2 after it starts
    r = await api('POST', '/arcade/hoops/shoot'); assert.equal(r.status, 200, JSON.stringify(r)); period = r.period; zone = r.zone; makes += r.hit ? 1 : 0;
  }
  assert.ok(r.done, 'game ends after 10 shots'); assert.ok(makes >= 8, `shots timed at the green should go in (${makes}/9)`);
  assert.equal(r.score, (await api('GET', '/arcade/highscores?game=hoops')).top[0].best);
  assert.equal((await api('POST', '/arcade/hoops/shoot')).status, 409, 'no shots after the game');
  // the player's own delay is taken off, so a slow connection does not cost a green
  const g = await newUser('lagger'); const st0 = await g('POST', '/arcade/hoops/start', { bet: 0 }); await g('POST', '/arcade/hoops/ready'); await sleep(((0.97 - st0.zone) * st0.period) / 2 + 100);
  const late = await g('POST', '/arcade/hoops/shoot', { lat: 100 }); assert.equal(late.hit, true, 'a shot that arrived 100ms late but was tapped on the green counts');
});

test('Mental Math Sprint: questions come from the server, wrong answers score 0, the sprint ends on the server clock', async () => {
  const api = await newUser('mathkid'), s = await api('POST', '/arcade/math/start', { bet: 0 }); assert.match(s.q, /\d/);
  assert.equal((await api('POST', '/arcade/math/end')).status, 400, 'cannot end early');
  const ev = q => Function(`return (${q.replace(/×/g, '*').replace(/−/g, '-').replace(/÷/g, '/')})`)();
  let r = await api('POST', '/arcade/math/answer', { answer: ev(s.q) }); assert.equal(r.right, true); assert.ok(r.pts >= 100); const sc = r.score;
  r = await api('POST', '/arcade/math/answer', { answer: 123456789 }); assert.equal(r.right, false); assert.equal(r.pts, 0); assert.equal(r.score, sc); assert.equal(r.combo, 0);
  assert.equal((await api('POST', '/arcade/math/answer', { answer: 1.5 })).status, 400);
  await sleep(3200); const end = await api('POST', '/arcade/math/end'); assert.equal(end.done, true); assert.equal(end.right, 1); assert.equal(end.score, sc);
});

test('Marching Band: the pattern grows one beat per round, wrong pads end the game, score follows the rounds', async () => {
  const api = await newUser('drummer'); let r = await api('POST', '/arcade/band/start', { bet: 0 }), seq = r.show; assert.equal(seq.length, 1);
  for (let round = 1; round <= 3; round++) {
    for (let k = 0; k < seq.length; k++) { r = await api('POST', '/arcade/band/press', { pad: seq[k] }); assert.equal(r.ok, true); }
    assert.equal(r.round, round); assert.equal(r.show.length, round + 1); assert.deepEqual(r.show.slice(0, round), seq, 'the old pattern is kept'); seq = r.show;
  }
  r = await api('POST', '/arcade/band/press', { pad: (seq[0] + 1) % 4 }); assert.equal(r.ok, false); assert.equal(r.done, true); assert.equal(r.score, 80 + 110 + 140); assert.equal(r.length, 3, 'length = rounds completed');
});

test('Hallway Dash: server builds the hallway, replays moves, jumps and slides; impossible runs are rejected', async () => {
  const api = await newUser('runner'), s = await api('POST', '/arcade/dash/start', { bet: 0 });
  assert.equal(s.rows.length, 120); assert.ok(s.rows.slice(0, 5).every(r => r[0] === 0 && r[1] === -1 && r[2] === 0 && r[3] === 0 && r[4] === -1), 'a free stretch to start');
  assert.ok(s.rows.every(r => r.length === 5), 'rows are [blocked, pass, low, high, power]');
  assert.equal((await api('POST', '/arcade/dash/rows', { from: 390 })).status, 400, 'cannot peek far ahead of the clock');
  assert.ok(s.rows.slice(0, 10).every(r => !r[0] && !r[2] && !r[3]), 'a calm opening with nothing to dodge');
  assert.ok(s.tick[0] >= 440 && s.tick[399] <= 160, 'starts slow, ends fast'); assert.ok(s.tick.every((v, i) => i === 0 || v <= s.tick[i - 1]), 'only ever speeds up'); assert.ok(s.rows.slice(0, 25).every(r => !r[2] && !r[3]), 'no hurdles or signs in the first stretch');
  assert.equal((await api('POST', '/arcade/dash/end', { moves: [{ row: 5, lane: 1 }] })).status, 400, 'moves must change lane by one');
  assert.equal((await api('POST', '/arcade/dash/end', { moves: [{ row: 9, lane: 0 }, { row: 8, lane: 1 }] })).status, 400, 'rows must increase');
  assert.equal((await api('POST', '/arcade/dash/end', { moves: [], acts: [{ row: 9, kind: 'x' }] })).status, 400, 'unknown action');
  assert.equal((await api('POST', '/arcade/dash/end', { moves: [], acts: [{ row: 9, kind: 'j' }, { row: 10, kind: 's' }] })).status, 400, 'no back-to-back jumps and slides');
  // standing still in the middle lane: the first cell in lane 1 that needs a lane change, jump or slide is where the run ends
  const hit = r => (r[0] | r[2] | r[3]) & 2, first = s.rows.findIndex(hit), row = s.rows[first], kind = row[0] & 2 ? 'block' : row[2] & 2 ? 'low' : 'high';
  const endRun = async body => { for (let i = 0; i < 40; i++) { const r = await api('POST', '/arcade/dash/end', body); if (r.status !== 400 || !/Too fast/.test(r.error)) return r; await sleep(150); } throw new Error('run never became possible'); };
  const shielded = rows => rows.some(c => c[4] >= 0 && Math.floor(c[4] / 10) === 1 && c[4] % 10 === 2); // a shield picked up in lane 1 absorbs the first hit
  const r = await endRun({ moves: [], acts: [] }); assert.equal(r.done, true); if (shielded(s.rows.slice(0, first))) assert.ok(r.rows > first, 'a shield absorbs the first hit'); else { assert.equal(r.rows, first); assert.equal(r.crashed, true); }
  if (!shielded(s.rows.slice(0, first))) assert.equal(r.score, first * 10 + r.passes * 50 + Math.min(3, Math.floor(first / 100)) * 100);
  // a jump clears a low hurdle and a slide clears a high sign, but nothing clears a full block
  const s2 = await api('POST', '/arcade/dash/start', { bet: 0 }), f2 = s2.rows.findIndex(hit), c2 = s2.rows[f2], k2 = c2[0] & 2 ? 'block' : c2[2] & 2 ? 'low' : 'high';
  const acts = k2 === 'low' ? [{ row: f2 - 1, kind: 'j' }] : k2 === 'high' ? [{ row: f2 - 1, kind: 's' }] : [];
  const r2 = await endRun({ moves: [], acts }); assert.equal(r2.done, true);
  if (k2 === 'block') { if (shielded(s2.rows.slice(0, f2))) assert.ok(r2.rows > f2, 'a shield absorbs the first hit'); else assert.equal(r2.rows, f2, 'a full block ends the run'); } else assert.ok(r2.rows > f2, `${k2} obstacle at ${f2} should be cleared, run ended at ${r2.rows}`);
});

test('Site Mode: School Edition hides chance games on the server, turns bets into daily-capped rewards, and refunds open rounds', async () => {
  const api = await newUser('classroom'); await give(api, 5000);
  assert.equal((await api('GET', '/me')).mode, 'full');
  await api('POST', '/arcade/mines/start', { bet: 100, mines: 3 }); const open = (await api('GET', '/me')).user.balance;
  assert.equal((await api('POST', '/admin/mode', { mode: 'school' })).status, 403, 'players cannot switch modes');
  assert.equal((await boss('POST', '/admin/mode', { mode: 'school' })).now.mode, 'school');
  const me = await api('GET', '/me'); assert.equal(me.mode, 'school'); assert.equal(me.user.balance, open + 100, 'the open Locker Hunt bet was refunded');
  for (const [m, p, b] of [['POST', '/arcade/dice', { bet: 10, target: 50, over: true }], ['POST', '/arcade/slots', { bet: 10 }], ['GET', '/props'], ['POST', '/slips', {}], ['GET', '/feed'], ['GET', '/tournament'], ['GET', '/fair']]) assert.equal((await api(m, p, b)).status, 403, `${p} is blocked`);
  assert.equal((await api('GET', '/arcade/config')).status, 200); assert.equal((await api('GET', '/rewards')).status, 200);
  const g = await api('POST', '/arcade/hoops/start', { bet: 500 }); assert.equal(g.bet, 0, 'bets are ignored in school mode'); assert.equal(g.balance, me.user.balance);
  await boss('POST', '/admin/mode', { mode: 'full', schedule: { on: true, days: [], start: '07:30', end: '14:30' } });
  assert.equal((await api('GET', '/me')).mode, 'full', 'a schedule with no days never switches to school');
  const all = [0, 1, 2, 3, 4, 5, 6]; await boss('POST', '/admin/mode', { schedule: { on: true, days: all, start: '00:00', end: '23:59' } });
  assert.equal((await api('GET', '/me')).mode, 'school', 'a schedule that covers right now switches to school');
  assert.equal((await boss('POST', '/admin/mode', { schedule: { start: '15:00', end: '08:00' } })).status, 400, 'end must be after start');
  await boss('POST', '/admin/mode', { mode: 'full', schedule: { on: false } }); assert.equal((await api('GET', '/me')).mode, 'full');
  assert.ok((await boss('GET', '/admin/log')).log.some(l => l.action === 'site_mode'));
});

test('football picks: 15 players seeded once, football-only props, hidden players vanish, grading settles slips', async () => {
  const api = await newUser('fan');
  const { props, game } = await api('GET', '/props');
  assert.equal(game.opp, 'Madison'); assert.match(game.line, /Madison/);
  assert.ok(props.every(p => p.sport === 'Football'), 'football only');
  assert.equal(props.filter(p => p.playerId).length, 10, '10 player props'); assert.equal(props.filter(p => !p.playerId).length, 4, '4 team props');
  assert.deepEqual([...new Set(props.filter(p => p.playerId).map(p => p.who))].sort(), ['Christian Wyatt', 'Joshua-Benjamin Dagbe', 'Nick Picarelli', 'Sebastian "Sebi" Valencia']);
  const pl = (await api('GET', '/players')).players; assert.equal(pl.length, 15);
  assert.equal(pl.find(p => p.name === 'Christian Wyatt').stats['Passing TD'], 10);
  // admin only
  assert.equal((await api('POST', '/admin/player', { name: 'X' })).status, 403); assert.equal((await api('POST', '/admin/player-hide', { id: 1 })).status, 403); assert.equal((await api('POST', '/admin/game', { opp: 'Z' })).status, 403);
  assert.equal((await api('GET', '/admin/players')).status, 403);
  // CRUD
  const made = await boss('POST', '/admin/player', { name: 'Test Guy', number: 99, positions: 'K', stats: 'Field goals: 4\nLong: 41' }); assert.equal(made.status, 200);
  assert.equal((await boss('GET', '/admin/players')).players.find(p => p.id === made.id).stats.Long, '41');
  await boss('POST', '/admin/player', { id: made.id, name: 'Test Guy II', number: 98, positions: 'K, P', stats: { 'Field goals': 5 } });
  assert.equal((await api('GET', '/players')).players.find(p => p.id === made.id).name, 'Test Guy II');
  // hide a player: profile and props disappear and can't be picked
  const wy = pl.find(p => p.name === 'Christian Wyatt'), wyProps = props.filter(p => p.playerId === wy.id);
  assert.equal(wyProps.length, 3);
  assert.equal((await boss('POST', '/admin/player-hide', { id: wy.id })).hidden, true);
  assert.ok(!(await api('GET', '/props')).props.some(p => p.playerId === wy.id)); assert.ok(!(await api('GET', '/players')).players.some(p => p.id === wy.id));
  assert.equal((await api('POST', '/slips', { mode: 'power', entry: 5, picks: [{ propId: wyProps[0].id, dir: 'more' }, { propId: props.find(p => !p.playerId).id, dir: 'more' }] })).status, 400);
  await boss('POST', '/admin/player-hide', { id: wy.id, hidden: false });
  assert.equal((await api('GET', '/props')).props.filter(p => p.playerId === wy.id).length, 3);
  // game banner updates open lines
  const g = await boss('POST', '/admin/game', { when: 'Fri 7:00 PM', home: true }); assert.match(g.line, /vs Madison · Fri 7:00 PM · Home/);
  assert.match((await api('GET', '/props')).props[0].vs, /Fri 7:00 PM/);
  // place and grade
  const a = props.find(p => p.stat === 'Receiving yards' && p.who.startsWith('Joshua')), b = props.find(p => p.stat === 'Sacks');
  const before = (await api('GET', '/me')).user.balance;
  assert.equal((await api('POST', '/slips', { mode: 'power', entry: 10, picks: [{ propId: a.id, dir: 'more' }, { propId: b.id, dir: 'more' }] })).status, 200);
  await boss('POST', '/admin/grade', { propId: a.id, actual: 120 }); await boss('POST', '/admin/grade', { propId: b.id, actual: 2 });
  assert.equal((await api('GET', '/me')).user.balance, before - 10 + 30, 'power 2-pick pays 3x');
  // a new line can link to a player
  assert.equal((await boss('POST', '/admin/props', { playerId: made.id, stat: 'Field goals', line: 1.5, type: 'Kicking' })).status, 200);
  assert.ok((await api('GET', '/props')).props.some(p => p.playerId === made.id && p.who === 'Test Guy II'));
});

test('football migration runs once: old demo lines are hidden but still reachable by admin', async () => {
  const all = (await boss('GET', '/admin/props')).props;
  assert.ok(all.some(p => p.hidden && p.sport !== 'Football'), 'old demo lines kept, hidden');
  assert.equal(all.filter(p => !p.hidden && p.playerId == null && p.sport === 'Football').length >= 4, true);
  assert.equal((await boss('GET', '/players')).players.filter(p => p.name === 'Christian Wyatt').length, 1, 'players seeded once');
});

test('football kickoff auto-locks lines, a pasted box score fills results, grade-all pays out and updates season stats once', async () => {
  const api = await newUser('grader');
  const open = () => api('GET', '/props').then(r => r.props);
  assert.equal((await boss('POST', '/admin/game', { kickoff: Date.now() + 3600e3, gp: 8 })).game.started, false);
  assert.ok((await open()).some(p => p.status === 'open'), 'still open before kickoff');
  assert.equal((await boss('GET', '/me')).user.pending, 0);
  assert.equal((await api('POST', '/admin/paste-parse', { text: 'x' })).status, 403); assert.equal((await api('POST', '/admin/grade-all', { grades: [] })).status, 403);
  // kickoff passes: everything locks by itself, picks are refused, the admin gets a badge, players see pending results
  const g = await boss('POST', '/admin/game', { kickoff: Date.now() - 5 * 3600e3 }); assert.equal(g.game.started, true); assert.equal(g.game.pendingResults, true);
  const r = await api('GET', '/props'); assert.ok(r.props.every(p => p.status !== 'open'), 'locked at kickoff'); assert.equal(r.game.pendingResults, true);
  const ids = r.props.filter(p => p.status === 'locked').slice(0, 2).map(p => p.id);
  assert.equal((await api('POST', '/slips', { mode: 'power', entry: 5, picks: ids.map(id => ({ propId: id, dir: 'more' })) })).status, 400);
  assert.ok((await boss('GET', '/me')).user.pending > 0, 'admin badge after the game');
  const box = 'Final: South Lakes 28, Madison 14\nPassing\nPlayer Cmp Att Yds TD Int\nChristian Wyatt 9 14 130 2 0\nRushing\nPlayer Car Yds Avg TD\nChristian Wyatt 8 52 6.5 1\nNick Picarelli 2 10 5.0 1\nReceiving\nPlayer Rec Yds TD\nJoshua-Benjamin Dagbe 5 101 1\nNick Picarelli 3 60 0\nDefense\nPlayer Tot Solo Ast Sacks Int\nSebastian "Sebi" Valencia 8 5 3 1.0 0\n';
  const parsed = await boss('POST', '/admin/paste-parse', { text: box });
  assert.deepEqual(parsed.scores, { sl: 28, opp: 14 });
  const val = (who, stat) => parsed.rows.find(x => x.who.startsWith(who) && x.stat === stat);
  assert.equal(val('Christian', 'Rushing yards').value, 52); assert.equal(val('Christian', 'Passing TDs').value, 2); assert.equal(val('Christian', 'Completion %').value, 64.3);
  assert.equal(val('Joshua', 'Receiving TDs').value, 1); assert.equal(val('Joshua', 'Interceptions').value, 0); assert.match(val('Joshua', 'Interceptions').note, /not listed/);
  assert.equal(val('Nick', 'Receiving yards').value, 60); assert.equal(val('Nick', 'Total TDs (rush + catch)').value, 1); assert.equal(val('Sebastian', 'Tackles').value, 8);
  assert.equal(val('South Lakes', 'South Lakes points').value, 28); assert.equal(val('Madison', 'Madison points').value, 14); assert.equal(val('South Lakes', 'Total points').value, 42); assert.equal(parsed.rows.find(x => /wins by 7/.test(x.stat)).value, 1);
  // junk paste: nothing found, nothing invented
  assert.ok((await boss('POST', '/admin/paste-parse', { text: 'hello world' })).rows.every(x => x.value == null));
  // a lineup on two of these, graded in one go
  const a = r.props.find(p => p.who.startsWith('Christian') && p.stat === 'Rushing yards'), b = r.props.find(p => p.who.startsWith('Christian') && p.stat === 'Passing TDs');
  const wy = (await boss('GET', '/admin/players')).players.find(p => p.name === 'Christian Wyatt');
  const gr = await boss('POST', '/admin/grade-all', { grades: parsed.rows.map(x => ({ propId: x.propId, actual: x.value })), updateStats: true });
  assert.equal(gr.statsUpdated, true); assert.ok(gr.graded >= 8);
  const after = (await boss('GET', '/admin/players')); const w2 = after.players.find(p => p.name === 'Christian Wyatt');
  assert.equal(w2.stats['Rushing yds/game'], 46.9); assert.equal(w2.stats['Passing TD'], 12); assert.equal(after.players.find(p => p.name === 'Nick Picarelli').stats['Receiving yds/game'], 56.3);
  assert.equal(after.game.gp, 9); assert.equal(after.game.applied, true);
  assert.equal((await boss('POST', '/admin/grade-all', { grades: [{ propId: a.id, actual: 1 }], updateStats: true })).status, 400, 'already settled lines cannot be graded again');
  assert.equal(wy.stats['Passing TD'], 10, 'stats before the update were untouched');
});

test('Free Throw max bet: capped at 5,000 by default, admin can change or turn it off, practice and other games are unaffected', async () => {
  const api = await newUser('shooter'); await give(api, 20000);
  assert.equal((await api('GET', '/arcade/config')).hoopsMax, 5000);
  const over = await api('POST', '/arcade/hoops/start', { bet: 5001 }); assert.equal(over.status, 400); assert.match(over.error, /Max bet on Free Throw Line is 5,000/);
  assert.equal((await api('POST', '/arcade/hoops/start', { bet: 5000 })).bet, 5000);
  assert.equal((await api('POST', '/arcade/hoops/start', { bet: 0 })).bet, 0, 'practice is free');
  assert.equal((await api('POST', '/arcade/math/start', { bet: 6000 })).bet, 6000, 'other skill games are not capped');
  assert.equal((await api('POST', '/admin/mode', { hoopsCap: { on: false } })).status, 403, 'admin only');
  assert.equal((await boss('POST', '/admin/mode', { hoopsCap: { max: 0 } })).status, 400);
  assert.equal((await boss('POST', '/admin/mode', { hoopsCap: { max: 100 } })).hoopsCap.max, 100);
  assert.equal((await api('POST', '/arcade/hoops/start', { bet: 101 })).status, 400);
  assert.equal((await boss('POST', '/admin/mode', { hoopsCap: { on: false } })).hoopsCap.on, false);
  assert.equal((await api('GET', '/arcade/config')).hoopsMax, null);
  assert.equal((await api('POST', '/arcade/hoops/start', { bet: 9000 })).bet, 9000, 'no limit when off');
  await boss('POST', '/admin/mode', { hoopsCap: { on: true, max: 5000 } });
});

test('Free Throw Line: the green window shrinks as the score climbs', async () => {
  const api = await newUser('shrinker'), s = await api('POST', '/arcade/hoops/start', { bet: 0 });
  await api('POST', '/arcade/hoops/ready'); await sleep(((0.97 - s.zone) * s.period) / 2 + 12);
  const r = await api('POST', '/arcade/hoops/shoot'); assert.equal(r.hit, true);
  assert.ok(r.zone < s.zone, `zone ${r.zone} should be smaller than ${s.zone} after scoring ${r.score}`); assert.ok(Math.abs(r.zone - Math.max(0.06, 0.17 - 0.00006 * r.score)) < 1e-9);
  const miss = await newUser('misser'), m0 = await miss('POST', '/arcade/hoops/start', { bet: 0 }); await miss('POST', '/arcade/hoops/ready'); const mr = await miss('POST', '/arcade/hoops/shoot');
  assert.equal(mr.hit, false); assert.ok(Math.abs(mr.zone - m0.zone) < 1e-9, 'a miss scores nothing, so the window stays the same size');
});
