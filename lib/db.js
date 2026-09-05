import { sql, raw } from './sql.js';

let schemaReady = null;

/**
 * Serverless instances start cold, so the schema check runs once per instance and is
 * then cached on the module.
 *
 * Supabase publishes every table in the `public` schema through PostgREST, reachable
 * with the project's public anon key. This table stores bcrypt hashes, so row level
 * security is enabled with no policies and the API roles have their grants revoked:
 * PostgREST then returns nothing to anon or authenticated callers. The app itself
 * connects directly as the table owner, which is not subject to RLS.
 */
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await raw(`
        CREATE TABLE IF NOT EXISTS users (
          id            SERIAL PRIMARY KEY,
          username      TEXT        NOT NULL UNIQUE,
          password_hash TEXT        NOT NULL,
          gif_url       TEXT        NOT NULL,
          high_score    INTEGER     NOT NULL DEFAULT 0,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await raw(`CREATE INDEX IF NOT EXISTS idx_users_high_score ON users (high_score DESC, id ASC)`);
      await raw(`ALTER TABLE users ENABLE ROW LEVEL SECURITY`);

      // Roles only exist on Supabase; ignore their absence elsewhere.
      await raw(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            REVOKE ALL ON TABLE users FROM anon;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            REVOKE ALL ON TABLE users FROM authenticated;
          END IF;
        END $$;
      `);
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
