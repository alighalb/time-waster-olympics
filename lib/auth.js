import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sql } from '@vercel/postgres';

// 10 rounds keeps a cold serverless invocation responsive while staying strong.
export const BCRYPT_ROUNDS = 10;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
export const MAX_SCORE = 100000;

/**
 * Every instance must sign with the same key, so this has to come from the
 * environment — a generated fallback would invalidate tokens between instances.
 */
export function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set.');
  return secret;
}

export const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

export const signToken = (user) =>
  jwt.sign({ sub: user.id, username: user.username }, jwtSecret(), { expiresIn: JWT_EXPIRES_IN });

/** Resolves the Bearer token to a user row, or null. */
export async function authenticate(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return null;

  let payload;
  try {
    payload = jwt.verify(token, jwtSecret());
  } catch {
    return null;
  }

  const { rows } = await sql`SELECT * FROM users WHERE id = ${payload.sub}`;
  return rows[0] || null;
}

export function validateCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    return 'Username and password are required.';
  }
  const name = username.trim();
  if (name.length < 3 || name.length > 20) return 'Username must be 3-20 characters.';
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return 'Username may only contain letters, numbers, _ and -.';
  if (password.length < 6 || password.length > 200) return 'Password must be 6-200 characters.';
  return null;
}

/** Shared wrapper: method gate, JSON body guard, schema init, error shaping. */
/** Names every piece of required configuration that is absent. */
export function missingConfig() {
  const missing = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) missing.push('POSTGRES_URL');
  return missing;
}

export function handler(methods, fn) {
  const allowed = [].concat(methods);
  // A HEAD request is a GET without a body; health checks and link previews use it.
  if (allowed.includes('GET')) allowed.push('HEAD');
  return async (req, res) => {
    if (!allowed.includes(req.method)) {
      res.setHeader('Allow', allowed.join(', '));
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    // Report every missing variable at once, so fixing one does not just reveal the next.
    const missing = missingConfig();
    if (missing.length) {
      return res.status(503).json({
        error: 'Server is not configured yet. Missing: ' + missing.join(' and ') + '.',
        missing,
      });
    }

    try {
      const { ensureSchema } = await import('./db.js');
      await ensureSchema();
      return await fn(req, res);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Something went wrong. Check the Vercel function logs.' });
    }
  };
}
