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
