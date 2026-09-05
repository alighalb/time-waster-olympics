import { sql } from '../../lib/sql.js';
import { publicUser } from '../../lib/db.js';
import { handler, signToken, verifyPassword } from '../../lib/auth.js';

export default handler('POST', async (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const { rows } = await sql`SELECT * FROM users WHERE username = ${username.trim()}`;
  const user = rows[0];

  // Identical response either way, so the endpoint does not leak which usernames exist.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }

  res.status(200).json({ token: signToken(user), user: publicUser(user) });
});
