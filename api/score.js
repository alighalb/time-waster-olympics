import { sql } from '../lib/sql.js';
import { getLeaderboard } from '../lib/db.js';
import { authenticate, handler, MAX_SCORE } from '../lib/auth.js';

export default handler('POST', async (req, res) => {
  const user = await authenticate(req);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token.' });

  const { score, gif_url: gifUrl } = req.body || {};
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
    return res.status(400).json({ error: `Score must be an integer between 0 and ${MAX_SCORE}.` });
  }

  if (typeof gifUrl === 'string' && /^https?:\/\//.test(gifUrl) && gifUrl !== user.gif_url) {
    await sql`UPDATE users SET gif_url = ${gifUrl} WHERE id = ${user.id}`;
  }

  // One atomic statement: the write only happens when the score actually wins,
  // so two concurrent submissions cannot clobber each other.
  const { rows } = await sql`
    UPDATE users SET high_score = ${score}
    WHERE id = ${user.id} AND high_score < ${score}
    RETURNING high_score
  `;

  const isNewHighScore = rows.length > 0;
  const highScore = isNewHighScore ? rows[0].high_score : user.high_score;

  res.status(200).json({ isNewHighScore, highScore, leaderboard: await getLeaderboard() });
});
