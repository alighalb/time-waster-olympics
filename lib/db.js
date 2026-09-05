import { sql } from '@vercel/postgres';

let schemaReady = null;

/**
 * Serverless instances are short-lived and start cold, so the schema check runs
 * once per instance and is then cached on the module.
 */
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id            SERIAL PRIMARY KEY,
          username      TEXT        NOT NULL UNIQUE,
          password_hash TEXT        NOT NULL,
          gif_url       TEXT        NOT NULL,
          high_score    INTEGER     NOT NULL DEFAULT 0,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_users_high_score
        ON users (high_score DESC, id ASC)
      `;
    })().catch((err) => {
      schemaReady = null;   // let the next invocation retry rather than caching a failure
      throw err;
    });
  }
  return schemaReady;
}

export const LEADERBOARD_SIZE = 10;

export async function getLeaderboard() {
  const { rows } = await sql`
    SELECT id, username, gif_url, high_score
    FROM users
    WHERE high_score > 0
    ORDER BY high_score DESC, id ASC
    LIMIT ${LEADERBOARD_SIZE}
  `;
  return rows.map((row, i) => ({
    rank: i + 1,
    id: row.id,
    username: row.username,
    gifUrl: row.gif_url,
    highScore: row.high_score,
  }));
}

export function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    gifUrl: row.gif_url,
    highScore: row.high_score,
  };
}
