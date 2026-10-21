# 🦅 HawkBet

South Lakes pick'em and arcade, played with fake Hawk Bucks only. No real money, not affiliated with South Lakes HS or FCPS.

**Run it:** `node server.js` then open <http://localhost:8622>. **Put it online:** see [DEPLOY.md](DEPLOY.md).

Zero-dependency Node server (needs Node 22.5+ for built-in SQLite). No `npm install`.

    node server.js            # http://localhost:8622
    PORT=3000 node server.js
    ADMIN_USERNAME=yourname node server.js   # that username becomes admin when it signs up

- Admin: if `ADMIN_USERNAME` is set, only that username is admin (it still has to sign up). If not set, the first account created is admin.
- Data lives in `data/hawkbet.db` (gitignored). Delete the folder to reset everything.
- Admin tab: add lines, lock them at game time, enter the final result to settle slips and pay winners, or void a cancelled game.
- The server decides all outcomes (Plinko drops, Mines positions, Crossing hits, slip grading) and is the only thing that changes balances. Mines/Crossing rounds survive a page refresh.
- Hawk Bucks have no cash value: no buying, no cash-out, no prizes for credits.

## Deploying
See [DEPLOY.md](DEPLOY.md) (Fly.io, HTTPS, persistent database, invite code, backups).
