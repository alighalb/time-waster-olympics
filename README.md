# Time-Waster Olympics

Click-frenzy game with accounts and a shared leaderboard, running entirely on Vercel.

- **Frontend** — static page in `public/`
- **API** — Vercel serverless functions in `api/`
- **Database** — Postgres via `pg` (Supabase, Neon, or any Postgres)
- **Auth** — bcrypt password hashes + signed JWTs, no third-party auth providers

## Deploy

The API is Vercel serverless functions; the database is any Postgres. These steps use
Supabase.

1. Import this repo at [vercel.com/new](https://vercel.com/new).
2. In Supabase: **Project Settings → Database → Connection string → Transaction pooler**
   (port 6543). Substitute your database password for `[YOUR-PASSWORD]`.

   Use the *pooler* string, not the direct connection. Serverless opens many short-lived
   connections and would exhaust a direct Postgres connection limit.
3. In Vercel: **Settings → Environment Variables** → add that string as `POSTGRES_URL`.
4. Redeploy. The `users` table is created on the first request.

Until that is done the page loads and shows a banner naming what is missing, rather than
failing silently.

### Why the table locks itself down

Supabase publishes every `public` schema table through PostgREST, readable with the
project's **public** anon key. This table holds bcrypt password hashes, so `ensureSchema()`
enables row level security with no policies and revokes grants from the `anon` and
`authenticated` roles. PostgREST then returns nothing to either. The app connects directly
as the table owner, which RLS does not apply to.

If you ever add tables by hand, do the same — a table created through raw SQL does not get
RLS automatically.

### JWT_SECRET (optional)

If `JWT_SECRET` is set it signs tokens. If not, a key is derived by HMAC from the database
connection string: stable across serverless instances, already secret, and always present
when the app can run. Rotating the database password therefore rotates the signing key and
logs everyone out. Set it explicitly to decouple them:

```bash
openssl rand -hex 32
```

### A note on preview URLs

Vercel protects preview deployments with SSO, which redirects the page's own API calls to a
login page. If the banner says it cannot reach the API, open the production URL, or turn off
Settings → Deployment Protection.

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

21 tests covering signup, duplicate usernames, login, JWT rejection, the high-score
rule, validation, leaderboard ranking, missing configuration, and that the `sql` tagged
template always binds interpolations as parameters rather than inlining them. They mock
the database with an in-memory table, so no Postgres is required to run them.

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
