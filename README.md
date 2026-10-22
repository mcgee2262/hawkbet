# 🦅 HawkBet

South Lakes pick'em and arcade, played with fake Hawk Bucks only. No real money, not affiliated with South Lakes HS or FCPS.

## ▶ [Open HawkBet](http://localhost:8622)

That link opens HawkBet on your own computer once it's running:

1. **Mac:** double-click [`HawkBet.command`](HawkBet.command) in this folder. It starts the server and opens the site for you.
2. **Anywhere else:** run `node server.js`, then click **[Open HawkBet](http://localhost:8622)**.

A public link anyone can click (for example `https://hawkbet-slhs.fly.dev`) comes after deploying. See [DEPLOY.md](DEPLOY.md).

Zero-dependency Node server (needs Node 22.5+ for built-in SQLite). No `npm install`.

    node server.js            # http://localhost:8622
    PORT=3000 node server.js
    ADMIN_USERNAME=yourname node server.js   # that username becomes admin when it signs up

- Admin: if `ADMIN_USERNAME` is set, only that username is admin (it still has to sign up). If not set, the first account created is admin.
- Data lives in `data/hawkbet.db` (gitignored). Delete the folder to reset everything.
- Admin tab: add lines, lock them at game time, enter the final result to settle slips and pay winners, or void a cancelled game.
- The server decides all outcomes (Plinko drops, Mines positions, Crossing hits, slip grading) and is the only thing that changes balances. Mines/Crossing rounds survive a page refresh.
- Hawk Bucks have no cash value: no buying, no cash-out, no prizes for credits.

## Arcade
- 🎰 Seahawk Slots is a 3×3 machine with 5 paylines, a wild hawk (not for trophies) and a 250x jackpot (97.06% payback). Pull the lever with the mouse, tap it, or press Space.
- 14 games: 11 classic Hawk Bucks games (including 🚀 Seahawk Launch, a crash game) plus 3 score-only skill games (Bell Rush, Classroom Memory, Seahawk Trivia) with personal bests and top-10 lists.
- 🔥 Super Luck (×2 / ×5 / ×10) divides your chance to lose and keeps normal payouts. Anything won or lost under Super Luck is excluded from leaderboard net winnings.
- 🏠 Home is a casino lobby: game carousel, Originals grid, live bets and big wins from real rounds.
- 🍀 Luck Lab (Normal or 1–10) changes win chances in Seymour Flip, Hallway RPS, Seahawk Crossing, Scoreboard Roll and Hail Mary (×0.6 at 1 up to ×1.5 at 10). Payouts shrink to match, so average payback is the same at every level. Skill games can be played free or for Hawk Bucks, paid by score tier.
- Sound effects are generated with the Web Audio API (no files). Toggle with the 🔊 button; the choice is saved in the browser.

## Tests
    node --test        # spins up the server on a temp database and exercises the API

## Deploying
See [DEPLOY.md](DEPLOY.md) (Fly.io, HTTPS, persistent database, invite code, backups).
