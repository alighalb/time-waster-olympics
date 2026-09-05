# Time-Waster Olympics

Click-frenzy game with accounts and a shared leaderboard, running entirely on Vercel.

- **Frontend** — static page in `public/`
- **API** — Vercel serverless functions in `api/`
- **Database** — Postgres (`@vercel/postgres`)
- **Auth** — bcrypt password hashes + signed JWTs, no third-party auth providers

## Deploy

1. Import this repo at [vercel.com/new](https://vercel.com/new).
2. **Storage → Create Database → Postgres**, connected to this project.
   Vercel injects `POSTGRES_URL` automatically.
3. Redeploy. The `users` table is created on the first request.

That is the only required configuration. Until it is done the page loads and shows a
banner naming exactly what is missing, rather than failing silently.

### JWT_SECRET (optional)

If `JWT_SECRET` is set it is used to sign tokens. If it is not, a key is derived by
HMAC from the database connection string — stable across serverless instances, already
secret, and always present when the app can run at all. Rotating the database password
therefore rotates the signing key and logs everyone out; set `JWT_SECRET` explicitly to
decouple the two:

```bash
openssl rand -hex 32
```

### A note on preview URLs

Vercel protects preview deployments with SSO, which redirects the page's own API calls
to a login page. If the banner says it cannot reach the API, open the production URL, or
turn off Settings → Deployment Protection.

## Local development

```bash
npm install
npx vercel link      # once, connects this folder to the Vercel project
npx vercel env pull  # writes .env.local with POSTGRES_URL and JWT_SECRET
npm run dev          # vercel dev, http://localhost:3000
```

## Tests

```bash
npm test
```

14 tests covering signup, duplicate usernames, login, JWT rejection, the high-score
rule, validation and leaderboard ranking. They mock `@vercel/postgres` with an
in-memory table, so no database is required to run them.

## API

| Method | Path | Auth | Body | Returns |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/signup` | — | `username`, `password`, `gif_url` | `201 { token, user }` · `409` if taken |
| POST | `/api/auth/login` | — | `username`, `password` | `200 { token, user }` · `401` on bad credentials |
| GET | `/api/me` | Bearer | — | `{ user }` — restores a stored session |
| GET | `/api/leaderboard` | — | — | `{ leaderboard }` (top 10) |
| POST | `/api/score` | Bearer | `score` (int), optional `gif_url` | `{ isNewHighScore, highScore, leaderboard }` |

`POST /api/score` writes through a single guarded statement:

```sql
UPDATE users SET high_score = $1 WHERE id = $2 AND high_score < $1 RETURNING high_score
```

so a lower score can never overwrite a better one, and two concurrent submissions
cannot race.

## Schema

```sql
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  gif_url       TEXT        NOT NULL,
  high_score    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Why the leaderboard polls instead of pushing

The first version used a WebSocket hub that broadcast the top 10 the moment anyone set
a new high score. Serverless functions are torn down after each request, so nothing can
hold a socket open or broadcast from one instance to another. The board therefore
refreshes every 4 seconds, pausing while the tab is hidden and refreshing immediately on
focus and after your own run.

True push would need either a host that runs a persistent process (Render, Railway,
Fly.io) or an external realtime service such as Pusher or Ably.

## Notes

`public/config.js` sets `TWO_API_BASE`. Leave it empty — the API is served from the same
origin. It only matters if you host the frontend somewhere other than the API.

The Giphy key in `public/index.html` is a browser-side key and is therefore public.
This repo is public too, so rotate it if that matters to you.
