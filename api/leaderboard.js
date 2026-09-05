import { getLeaderboard } from '../lib/db.js';
import { handler } from '../lib/auth.js';

export default handler('GET', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ leaderboard: await getLeaderboard() });
});
