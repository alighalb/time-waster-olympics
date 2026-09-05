import { test, mock } from 'node:test';
import assert from 'node:assert';

process.env.JWT_SECRET = 'test-secret-value';
process.env.POSTGRES_URL = 'postgres://fake';

// In-memory stand-in for the users table.
let users = [];
let nextId = 1;
function fakeSql(strings, ...vals) {
  const q = strings.join('?').replace(/\s+/g, ' ').trim();
  if (/^CREATE (TABLE|INDEX)/i.test(q)) return { rows: [] };
  if (/^SELECT id, username, gif_url, high_score FROM users/i.test(q))
    return { rows: users.filter(u => u.high_score > 0)
      .sort((a,b) => b.high_score - a.high_score || a.id - b.id).slice(0, 10) };
  if (/^SELECT \* FROM users WHERE username/i.test(q))
    return { rows: users.filter(u => u.username === vals[0]) };
  if (/^SELECT \* FROM users WHERE id/i.test(q))
    return { rows: users.filter(u => u.id === vals[0]) };
  if (/^INSERT INTO users/i.test(q)) {
    if (users.some(u => u.username === vals[0])) { const e = new Error('dup'); e.code = '23505'; throw e; }
    const row = { id: nextId++, username: vals[0], password_hash: vals[1], gif_url: vals[2], high_score: 0 };
    users.push(row); return { rows: [row] };
  }
  if (/^UPDATE users SET gif_url/i.test(q)) {
    const u = users.find(u => u.id === vals[1]); if (u) u.gif_url = vals[0]; return { rows: [] };
  }
  if (/^UPDATE users SET high_score/i.test(q)) {
    const u = users.find(u => u.id === vals[1]);
    if (u && u.high_score < vals[2]) { u.high_score = vals[0]; return { rows: [{ high_score: u.high_score }] }; }
    return { rows: [] };
  }
  throw new Error('unhandled query: ' + q);
}
mock.module('@vercel/postgres', { exports: { sql: fakeSql } });

const signup = (await import('../api/auth/signup.js')).default;
const login  = (await import('../api/auth/login.js')).default;
const score  = (await import('../api/score.js')).default;
const me     = (await import('../api/me.js')).default;
const board  = (await import('../api/leaderboard.js')).default;

function mkRes() {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}
const call = async (fn, req) => { const res = mkRes(); await fn({ method: 'POST', headers: {}, ...req }, res); return res; };

let token;

test('signup creates a user and returns a token', async () => {
  const r = await call(signup, { body: { username: 'ali', password: 'secret123', gif_url: 'https://g/a.gif' } });
  assert.equal(r.code, 201);
  assert.ok(r.body.token);
  assert.equal(r.body.user.highScore, 0);
  token = r.body.token;
});

test('duplicate username returns 409', async () => {
  const r = await call(signup, { body: { username: 'ali', password: 'secret123', gif_url: 'https://g/a.gif' } });
  assert.equal(r.code, 409);
});

test('short password rejected', async () => {
  const r = await call(signup, { body: { username: 'bob', password: 'x', gif_url: 'https://g/a.gif' } });
  assert.equal(r.code, 400);
});

test('bad gif_url rejected', async () => {
  const r = await call(signup, { body: { username: 'bob', password: 'secret123', gif_url: 'nope' } });
  assert.equal(r.code, 400);
});

test('login succeeds with right password', async () => {
  const r = await call(login, { body: { username: 'ali', password: 'secret123' } });
  assert.equal(r.code, 200); assert.ok(r.body.token);
});

test('login fails with wrong password, same message', async () => {
  const r = await call(login, { body: { username: 'ali', password: 'WRONG' } });
  assert.equal(r.code, 401);
  assert.equal(r.body.error, 'Wrong username or password.');
});

test('score requires a token', async () => {
  const r = await call(score, { body: { score: 10 } });
  assert.equal(r.code, 401);
});

test('score 42 is a new high score', async () => {
  const r = await call(score, { headers: { authorization: 'Bearer ' + token }, body: { score: 42 } });
  assert.equal(r.code, 200);
  assert.equal(r.body.isNewHighScore, true);
  assert.equal(r.body.highScore, 42);
});

test('lower score does NOT overwrite', async () => {
  const r = await call(score, { headers: { authorization: 'Bearer ' + token }, body: { score: 10 } });
  assert.equal(r.body.isNewHighScore, false);
  assert.equal(r.body.highScore, 42);
});

test('non-integer score rejected', async () => {
  const r = await call(score, { headers: { authorization: 'Bearer ' + token }, body: { score: 'abc' } });
  assert.equal(r.code, 400);
});

test('forged token rejected', async () => {
  const r = await call(score, { headers: { authorization: 'Bearer not.a.token' }, body: { score: 5 } });
  assert.equal(r.code, 401);
});

test('/api/me returns the user', async () => {
  const r = await call(me, { method: 'GET', headers: { authorization: 'Bearer ' + token } });
  assert.equal(r.code, 200);
  assert.equal(r.body.user.username, 'ali');
});

test('leaderboard ranks correctly and hides zero scores', async () => {
  const s2 = await call(signup, { body: { username: 'rival', password: 'secret123', gif_url: 'https://g/b.gif' } });
  await call(score, { headers: { authorization: 'Bearer ' + s2.body.token }, body: { score: 99 } });
  await call(signup, { body: { username: 'ghost', password: 'secret123', gif_url: 'https://g/c.gif' } }); // never plays
  const r = await call(board, { method: 'GET' });
  assert.deepEqual(r.body.leaderboard.map(x => `${x.rank}:${x.username}=${x.highScore}`), ['1:rival=99', '2:ali=42']);
});

test('wrong HTTP method returns 405', async () => {
  const r = await call(board, { method: 'DELETE' });
  assert.equal(r.code, 405);
  assert.equal(r.headers.Allow, 'GET');
});
