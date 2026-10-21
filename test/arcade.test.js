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
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(DIR, 'test.db'), BELL_DELAY_SCALE: '0.05', NODE_ENV: 'test' }, stdio: 'ignore',
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
  for (const bad of [0, 11, 5.5, '5', 'max', null, -1]) assert.equal((await api('POST', '/luck', { luck: bad })).status, 400, `rejects ${JSON.stringify(bad)}`);
  assert.equal((await api('POST', '/luck', { luck: 10 })).luck, 10);
  const again = client(); await again('POST', '/login', { username: 'lucky', password: 'testpass1' });
  assert.equal((await again('GET', '/me')).user.luck, 10);
  assert.equal((await api('POST', '/luck', { luck: 'normal' })).luck, 'normal');
});

test('luck never changes odds, payouts or game tables', async () => {
  const api = await newUser('fairplay');
  const snap = async () => ({
    cfg: await api('GET', '/arcade/config'),
    plinko: (await api('GET', '/arcade/plinko-table?rows=12&risk=high')).mults,
    dice: (await api('POST', '/arcade/dice', { bet: 1, target: 30, over: true })).pays,
  });
  const normal = await snap();
  for (const l of [1, 5, 10]) { await api('POST', '/luck', { luck: l }); assert.deepEqual(await snap(), normal, `luck ${l}`); }
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

test('existing flows still work: slips, bank and a chance game', async () => {
  const api = await newUser('regress');
  const me = (await api('GET', '/me')).user;
  const slip = await api('POST', '/slips', { mode: 'power', entry: 10, picks: [{ propId: 1, dir: 'more' }, { propId: 2, dir: 'less' }] });
  assert.equal(slip.balance, me.balance - 10);
  assert.equal((await api('POST', '/bank', { amount: 500 })).balance, me.balance - 10 + 500);
  const d = await api('POST', '/arcade/dice', { bet: 10, target: 50, over: true });
  assert.ok(typeof d.roll === 'number' && d.payout >= 0);
});
