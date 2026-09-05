import pg from 'pg';

const { Pool } = pg;

/**
 * One pool per serverless instance, reused across invocations on that instance.
 * `max: 1` keeps the total connection count sane when many instances are warm —
 * point POSTGRES_URL at Supabase's transaction pooler (port 6543) for the same reason.
 */
let pool = null;

/**
 * node-postgres reads `sslmode` out of the connection string and lets it override the
 * `ssl` option, which turns chain verification back on. Hosted poolers (Supabase among
 * them) serve a chain Node will not verify, so that surfaces as
 * SELF_SIGNED_CERT_IN_CHAIN. Strip the parameter and configure TLS explicitly below.
 */
export function normalizeConnectionString(connectionString) {
  try {
    const u = new URL(connectionString);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('ssl');
    return u.toString();
  } catch {
    return connectionString;   // not URL-shaped; hand it to pg untouched
  }
}

function getPool() {
  if (pool) return pool;

  const connectionString =
    process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error('No POSTGRES_URL / DATABASE_URL is set.');

  const isLocal = /@(localhost|127\.0\.0\.1)/.test(connectionString);

  pool = new Pool({
    connectionString: normalizeConnectionString(connectionString),
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    // Managed Postgres requires TLS. Chain verification is off by default because
    // hosted poolers commonly present an intermediate Node will not verify; the
    // connection is still encrypted. Set PG_SSL_STRICT=1 to verify the chain.
    ssl: isLocal ? false : { rejectUnauthorized: process.env.PG_SSL_STRICT === '1' },
  });

  pool.on('error', (err) => console.error('Postgres pool error:', err));
  return pool;
}

/**
 * Tagged template that compiles to a parameterised query, so interpolated values are
 * always sent as bound parameters and never concatenated into SQL.
 *
 *   sql`SELECT * FROM users WHERE id = ${id}`  ->  ('SELECT * FROM users WHERE id = $1', [id])
 */
export function buildQuery(strings, values) {
  const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
  return { text, values };
}

export function sql(strings, ...values) {
  const { text, values: params } = buildQuery(strings, values);
  return getPool().query(text, params);
}

/** Escape hatch for statements that cannot be parameterised (DDL). */
export function raw(text) {
  return getPool().query(text);
}
