import { test } from 'node:test';
import assert from 'node:assert';
import { buildQuery } from '../lib/sql.js';

test('interpolations become bound parameters, never inlined text', () => {
  const id = 7;
  const q = buildQuery(['SELECT * FROM users WHERE id = ', ''], [id]);
  assert.equal(q.text, 'SELECT * FROM users WHERE id = $1');
  assert.deepEqual(q.values, [7]);
});

test('numbers placeholders in order', () => {
  const q = buildQuery(['INSERT INTO users (a, b, c) VALUES (', ', ', ', ', ')'], ['x', 'y', 'z']);
  assert.equal(q.text, 'INSERT INTO users (a, b, c) VALUES ($1, $2, $3)');
  assert.deepEqual(q.values, ['x', 'y', 'z']);
});

test('a SQL injection attempt stays a parameter value', () => {
  const evil = "'; DROP TABLE users; --";
  const q = buildQuery(['SELECT * FROM users WHERE username = ', ''], [evil]);
  assert.equal(q.text, 'SELECT * FROM users WHERE username = $1');
  assert.ok(!q.text.includes('DROP'));   // the payload never reaches the SQL string
  assert.deepEqual(q.values, [evil]);
});

test('a query with no interpolation passes through unchanged', () => {
  const q = buildQuery(['SELECT 1'], []);
  assert.equal(q.text, 'SELECT 1');
  assert.deepEqual(q.values, []);
});

test('sslmode is stripped so it cannot override the ssl option', async () => {
  const { normalizeConnectionString } = await import('../lib/sql.js');
  const out = normalizeConnectionString(
    'postgresql://postgres.abc:pw@aws-0.pooler.supabase.com:6543/postgres?sslmode=require'
  );
  assert.ok(!out.includes('sslmode'));
  assert.ok(out.startsWith('postgresql://postgres.abc:pw@aws-0.pooler.supabase.com:6543/postgres'));
});

test('other query parameters survive normalisation', async () => {
  const { normalizeConnectionString } = await import('../lib/sql.js');
  const out = normalizeConnectionString('postgresql://u:p@h:6543/db?sslmode=require&application_name=two');
  assert.ok(out.includes('application_name=two'));
  assert.ok(!out.includes('sslmode'));
});

test('a non-URL connection string is passed through untouched', async () => {
  const { normalizeConnectionString } = await import('../lib/sql.js');
  const raw = 'host=localhost user=postgres dbname=two';
  assert.equal(normalizeConnectionString(raw), raw);
});
