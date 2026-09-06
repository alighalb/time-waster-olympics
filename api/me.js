import { sql } from '../lib/sql.js';
import { publicUser } from '../lib/db.js';
import { authenticate, handler } from '../lib/auth.js';

export default handler(['GET', 'DELETE'], async (req, res) => {
  const user = await authenticate(req);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token.' });

  if (req.method === 'DELETE') {
    // Scoped to the caller's own id, so a token can only ever delete its own account.
    await sql`DELETE FROM users WHERE id = ${user.id}`;
    return res.status(200).json({ deleted: true, username: user.username });
  }

  res.status(200).json({ user: publicUser(user) });
});
