# Time-Waster Olympics

Self-hosted click-frenzy game. No Firebase, no third-party auth.

- **Backend** — Node.js + Express (`server.js`)
- **Database** — SQLite via `better-sqlite3` (`data.db`, created on first boot)
- **Auth** — bcrypt password hashes + signed JWTs
- **Real-time** — native WebSocket hub at `/ws`, pushes the top 10 on every new high score

## Run it

```bash
cd "Time-Waster Olympics"
npm install
JWT_SECRET="$(openssl rand -hex 32)" npm start
```

Then open <http://localhost:3000>.

Live-reload while editing: `npm run dev`.

### Environment variables

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | HTTP + WebSocket port |
| `JWT_SECRET` | random per boot | **Set this.** Without it, every restart logs everyone out. |
| `DB_PATH` | `./data.db` | SQLite file |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |

Reset all scores: stop the server, `rm data.db*`, start again.

## API

| Method | Path | Auth | Body | Returns |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/signup` | — | `username`, `password`, `gif_url` | `201 { token, user }` · `409` if the username is taken |
| POST | `/api/auth/login` | — | `username`, `password` | `200 { token, user }` · `401` on bad credentials |
| GET | `/api/me` | Bearer | — | `{ user }` — used to restore a stored session |
| GET | `/api/leaderboard` | — | — | `{ leaderboard }` |
| POST | `/api/score` | Bearer | `score` (int), optional `gif_url` | `{ isNewHighScore, highScore, leaderboard }` |
| WS | `/ws` | — | — | `{ type: "leaderboard", leaderboard: [...] }` on connect and on every new high score |

A `POST /api/score` only writes when the score beats the stored `high_score`, and only
a real improvement triggers a broadcast.

## Schema

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  gif_url       TEXT    NOT NULL,
  high_score    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

## Notes for deployment

The Giphy key is in `public/index.html` and is therefore public — it is a browser-side
key, so scope/rotate it accordingly. Put the server behind TLS before exposing it; the
frontend switches to `wss://` automatically on HTTPS.
