# Deploying HawkBet to Fly.io

**Live now:** https://playhawkbet.fly.dev (app `playhawkbet`, region `iad`, admin username `blaise`, open signups).

Why Fly.io: free automatic HTTPS, a small persistent disk (needed because accounts and balances live in a SQLite file), and a Virginia region near Reston. Expect roughly $2–5 a month for one small machine. Free tiers on other hosts (Render, Heroku-style) wipe the disk on every restart, which would erase everyone's balance, so don't use them for this.

## One-time setup

1. Create an account at fly.io (needs a card on file) and install the CLI: `brew install flyctl`, then `fly auth login`.
2. In this folder, edit `fly.toml` and change `app = "hawkbet-change-me"` to something unique, like `hawkbet-slhs`.
3. Create the app and the disk (same name and region as in `fly.toml`):

        fly apps create hawkbet-slhs
        fly volumes create hawkbet_data --region iad --size 1 -a hawkbet-slhs

4. Set the secrets (these never go in the repo). Pick your own invite code and admin username:

        fly secrets set INVITE_CODE="choose-a-code" ADMIN_USERNAME="your-username" -a hawkbet-slhs

5. Deploy:

        fly deploy -a hawkbet-slhs --ha=false

   `--ha=false` matters: SQLite must run on exactly **one** machine. Never run `fly scale count 2`.
6. Open `https://hawkbet-slhs.fly.dev`, create **your** account (username = your `ADMIN_USERNAME`, plus the invite code). You'll see the Admin tab.

## Day to day
- Update the live site: `fly deploy -a playhawkbet --ha=false`.
- Forgot a password (even the admin's): `fly ssh console -a playhawkbet -C "node reset-password.js USERNAME NEWPASSWORD"`. Locally: `node reset-password.js USERNAME NEWPASSWORD`.
- Update the site: `fly deploy -a hawkbet-slhs --ha=false`. The disk and accounts survive.
- Add/lock/grade lines in the Admin tab before and after each game.
- Logs: `fly logs -a hawkbet-slhs`. Health check is `/healthz`.
- Change the invite code (e.g. new semester): `fly secrets set INVITE_CODE="new-code"`.
- Backups: the server writes a daily copy to `/data/backups` (keeps 7 days). To pull one down: `fly ssh sftp get /data/backups/hawkbet-YYYY-MM-DD.db -a hawkbet-slhs`.
- Reset everything (new season): `fly ssh console -a hawkbet-slhs -C "rm /data/hawkbet.db"` then `fly apps restart`.

## What's already locked down
HTTPS-only (redirect plus HSTS), Secure/HttpOnly session cookie, hashed passwords, per-IP login rate limit using the real client IP, same-origin check on every POST, Content-Security-Policy, no source or database files served, signups gated by an invite code, bet caps, and every balance change decided and logged on the server.

## Still your call (not code)
- **Get the OK from the school.** Ask the activities director or a sponsoring teacher before sharing it. Betting-style pages tied to real students' games can get a site blocked or a student in trouble even with fake credits.
- **Keep the line clear:** no prizes that cost money, no way to buy or cash out credits, and keep the "not affiliated with South Lakes HS or FCPS" banner.
- **Privacy:** only usernames and password hashes are stored. Tell students not to use their real name or reuse a real password. Don't collect emails or student IDs.
- **Names and photos:** the lines are about teams, not named students. Keep it that way unless a player agrees.
- **Moderation:** usernames are public on the leaderboard. Check it now and then, and delete a bad account with `fly ssh console` and sqlite if needed.
- **Cheaper alternative with no hosting bill:** run it on a Mac or Raspberry Pi at home behind a free Cloudflare Tunnel (gives HTTPS). It's only up while that machine is on, so Fly.io is better for a real launch.
