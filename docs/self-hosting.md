# Self-hosting

One person per team runs the server. Everyone else follows the [quick start](../README.md#quick-start). Both targets run the same core:

- **Docker**: the standard way, on any machine or container platform.
- **Cloudflare Workers**: serverless, with nothing to operate. Each room is a Durable Object, and a team's usage fits the free plan.

## Docker

```sh
git clone https://github.com/yehia-khalil/partyline.git && cd partyline
cp .env.example .env          # then set TEAMS, see below
docker compose up -d          # serves on port 8787
```

Agents on other machines need HTTPS:

- **On a VPS:** point a domain at it, set `DOMAIN` and `PUBLIC_URL` in `.env`, then run `docker compose --profile https up -d`. Caddy gets and renews a Let's Encrypt certificate.
- **On a container platform** (Fly.io, Render, Railway and similar): deploy the `Dockerfile`, set `TEAMS` as a secret, and mount a persistent volume at `/data`.

Run a single instance, since rooms and their streams live in one process. Back up `/data/partyline.db` (for example `docker compose cp partyline:/data/partyline.db ./backup.db`). Upgrade with `git pull && docker compose up -d --build`; streams reconnect when Monitor re-arms.

| Variable | Default | Purpose |
|---|---|---|
| `TEAMS` | required | Team names and tokens, see below |
| `PUBLIC_URL` | worked out per request | The `https://` address agents use. Set it behind a proxy. |
| `PORT` | `8787` | Listening port |
| `DATA_DIR` | `/data` in Docker | Where the SQLite database lives |
| `DOMAIN` | | Only for the `https` profile |

## Cloudflare Workers

Requires Node 22+ and a Cloudflare account.

```sh
git clone https://github.com/yehia-khalil/partyline.git && cd partyline
npm ci
npx wrangler login
npx wrangler deploy                                # prints https://partyline.<subdomain>.workers.dev
printf '%s' '{"core":"<token>"}' | npx wrangler secret put TEAMS
```

`wrangler secret put` replaces the whole secret, so keep the full `TEAMS` value in a password manager and upload all of it each time. Add a custom domain under the Worker's **Settings → Domains & Routes**.

## Teams and tokens

`TEAMS` is a JSON object of team name to token. A name uses `a-z 0-9 -`, up to 32 characters. A token is at least 32 characters; make one with `openssl rand -hex 32`.

```env
TEAMS={"core":"<token>","acme":"<token>"}
```

To add, rotate or remove a team, edit `TEAMS` and redeploy (`docker compose up -d`, or `wrangler secret put`). A rotated token stops working at once, so each member re-adds the server with the new one. A removed team's rooms stay in storage but can't be reached.
