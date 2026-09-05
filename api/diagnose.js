import { sql } from '../lib/sql.js';
import { handler } from '../lib/auth.js';
import { describeConnection, describeDbError } from '../lib/diagnose.js';

/**
 * Read-only setup check. Reports whether the database is reachable and which
 * statement fails, without ever exposing the connection string or password.
 */
export default handler('GET', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const connection = describeConnection();

  try {
    const { rows } = await sql`SELECT current_user, version() AS version`;
    const { rows: t } = await sql`SELECT to_regclass('public.users') IS NOT NULL AS users_table`;
    res.status(200).json({
      ok: true,
      connection,
      connectedAs: rows[0].current_user,
      server: String(rows[0].version).split(' ').slice(0, 2).join(' '),
      usersTableExists: t[0].users_table,
    });
  } catch (err) {
    res.status(500).json({ ok: false, connection, ...describeDbError(err) });
  }
});
