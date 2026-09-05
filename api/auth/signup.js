import { sql } from '../../lib/sql.js';
import { publicUser } from '../../lib/db.js';
import { handler, hashPassword, signToken, validateCredentials } from '../../lib/auth.js';

export default handler('POST', async (req, res) => {
  const { username, password, gif_url: gifUrl } = req.body || {};

  const problem = validateCredentials(username, password);
  if (problem) return res.status(400).json({ error: problem });

  if (typeof gifUrl !== 'string' || !/^https?:\/\//.test(gifUrl)) {
    return res.status(400).json({ error: 'A valid gif_url (http/https) is required.' });
  }

  const name = username.trim();
  const passwordHash = await hashPassword(password);

  let rows;
  try {
    ({ rows } = await sql`
      INSERT INTO users (username, password_hash, gif_url)
      VALUES (${name}, ${passwordHash}, ${gifUrl})
      RETURNING *
    `);
  } catch (err) {
    if (err.code === '23505') {   // unique_violation
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    throw err;
  }

  res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
});
