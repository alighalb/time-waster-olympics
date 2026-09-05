/**
 * Turns a database failure into something safe to send to a browser.
 *
 * Connection strings carry a password, and driver errors sometimes echo them, so
 * everything credential-shaped is stripped before any of this leaves the server.
 */
export function redact(text) {
  return String(text ?? '')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '<connection-string>')
    .replace(/(password|pwd)\s*=\s*\S+/gi, '$1=<redacted>');
}

const HINTS = {
  '28P01': 'Password rejected. Copy the connection string again and replace [YOUR-PASSWORD] with your database password (reset it in Supabase under Settings -> Database if unsure).',
  '28000': 'The database rejected the username. Use the full pooler username, which looks like postgres.<project-ref>.',
  '3D000': 'That database name does not exist. The Supabase pooler string ends in /postgres.',
  '42501': 'Connected, but this role lacks permission for the required statement.',
  '53300': 'Too many connections. Use the transaction pooler on port 6543 rather than the direct connection.',
  ENOTFOUND: 'Host not found. Check the hostname in POSTGRES_URL.',
  ETIMEDOUT: 'Connection timed out. This usually means the DIRECT connection string was used; it is IPv6-only and unreachable from Vercel. Use the Transaction pooler string (port 6543).',
  ENETUNREACH: 'Network unreachable, which is what the IPv6-only direct connection does from Vercel. Use the Transaction pooler string (port 6543).',
  ECONNREFUSED: 'Connection refused. Check the port: the transaction pooler is 6543.',
  SELF_SIGNED_CERT_IN_CHAIN: 'TLS chain could not be verified. This happens when sslmode in the connection string re-enables verification; the driver now strips it. If it persists, make sure PG_SSL_STRICT is not set to 1.',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS chain could not be verified. Make sure PG_SSL_STRICT is not set to 1.',
};

export function describeDbError(err) {
  const code = err && (err.code || err.errno);
  return {
    error: 'Database connection failed.',
    code: code || null,
    detail: redact(err && err.message),
    hint: HINTS[code] || 'Check the Vercel function logs for the full stack trace.',
  };
}

/** Non-secret facts about the configured connection, for the diagnostics endpoint. */
export function describeConnection() {
  const raw = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!raw) return { configured: false };

  try {
    const u = new URL(raw);
    const port = u.port || '5432';
    const isPooler = /pooler\./i.test(u.hostname) || port === '6543';
    return {
      configured: true,
      host: u.hostname,           // hostname only; never the password
      port,
      database: u.pathname.replace(/^\//, '') || null,
      usernameShape: /^postgres\./.test(decodeURIComponent(u.username)) ? 'postgres.<ref>' : 'other',
      usingPooler: isPooler,
      warning: isPooler ? null
        : 'This looks like the DIRECT connection. It is IPv6-only and unreachable from Vercel. Use the Transaction pooler (port 6543).',
    };
  } catch {
    return { configured: true, parseable: false, warning: 'POSTGRES_URL is not a valid URL.' };
  }
}
