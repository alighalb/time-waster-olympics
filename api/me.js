import { publicUser } from '../lib/db.js';
import { authenticate, handler } from '../lib/auth.js';

export default handler('GET', async (req, res) => {
  const user = await authenticate(req);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token.' });
  res.status(200).json({ user: publicUser(user) });
});
