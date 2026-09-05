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
export function handler(methods, fn) {
  const allowed = [].concat(methods);
  return async (req, res) => {
    if (!allowed.includes(req.method)) {
      res.setHeader('Allow', allowed.join(', '));
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    try {
      const { ensureSchema } = await import('./db.js');
      await ensureSchema();
      return await fn(req, res);
    } catch (err) {
      console.error(err);
      if (!process.env.JWT_SECRET) {
        return res.status(500).json({ error: 'Server is missing JWT_SECRET.' });
      }
      if (!process.env.POSTGRES_URL) {
        return res.status(500).json({ error: 'No database is connected (POSTGRES_URL is unset).' });
      }
      return res.status(500).json({ error: 'Something went wrong.' });
    }
  };
}
