# 🦅 HawkBet

South Lakes pick'em and arcade, played with fake Hawk Bucks only. No real money, no prizes, not affiliated with South Lakes HS or FCPS.

## ▶ [Play HawkBet: playhawkbet.fly.dev](https://playhawkbet.fly.dev)

That link is the live site. Make an account and play. (Running it on your own computer? See [Run it locally](#run-it-locally).)

## What's in it
- **18 games.** 11 chance games (Seahawk Drop, Locker Hunt, Seahawk Crossing, Heads or Tails, Scoreboard Roll, Hail Mary, Seahawk Slots, Lakes Roulette, Hallway RPS, Hawk 21, Seahawk Launch) and 7 skill games (Bell Rush, Classroom Memory, Seahawk Trivia, Free Throw Line, Mental Math Sprint, Marching Band, Hallway Dash).
- **Skill games** have personal bests, top-score boards, and score-tier payouts if you bet.
  - 🏀 Free Throw Line is NBA 2K style: let go in the green window.
  - 🏃 Hallway Dash is a lane runner with jump, slide, power-ups and four levels (Freshman to Senior) that get harder every 100 rows.
- **Scoreboard Roll** is provably fair: you see a fingerprint of the server seed first and can verify any roll in your browser.
- 🛍️ **Hawk Shop:** a Seahawk avatar with cosmetics. Gear carries luck (up to Luck 10), plus boosters and three Mythic Super Luck items that are gated and wear out.
- 🎁 **Rewards:** levels and XP, a daily wheel, daily challenges and 24 achievements.
- 🏫 **Site Mode** (Admin tab): switch between full HawkBet and **Seahawk Arcade** (School Edition: skill games only, no bets, no chance games), with an optional school-hours schedule.
- 🛠️ **Admin tools:** give or take Hawk Bucks (one player or everyone), items, luck, shop prices and sales, password resets, bans, and an action log.
- 🏦 The Bank only helps when you're broke (under 100 Hawk Bucks, 1,000 once an hour).
- The server decides every outcome and is the only thing that changes balances. Hawk Bucks have no cash value.

## Run it locally
Zero-dependency Node server (needs Node 22.5+ for built-in SQLite). No `npm install`.

1. **Mac:** double-click [`HawkBet.command`](HawkBet.command). It starts the server and opens http://localhost:8622 for you.
2. **Anywhere else:** run `node server.js`, then open http://localhost:8622.

        PORT=3000 node server.js
        ADMIN_USERNAME=yourname node server.js   # that username becomes admin when it signs up

- If `ADMIN_USERNAME` isn't set, the first account created is the admin.
- Data lives in `data/hawkbet.db` (gitignored). Delete the folder to reset everything.
- Lost a password (even the admin's)? `node reset-password.js USERNAME NEWPASSWORD`.

## Tests
    node --test        # spins up the server on a temp database and exercises the API

## Deploying
The live site runs on Fly.io. See [DEPLOY.md](DEPLOY.md) (HTTPS, persistent database, backups, updating the site).
