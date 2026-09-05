'use strict';

/**
 * Time-Waster Olympics — self-hosted backend.
 *
 * Express + SQLite (better-sqlite3) + JWT (bcrypt hashes) + native WebSockets.
 * No third-party auth, no Firebase.
 */

const http = require('http');
const path = require('path');
const crypto = require('crypto');

const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 12;
const LEADERBOARD_SIZE = 10;
const MAX_SCORE = 100000; // sanity ceiling; a human cannot out-click this

// A generated secret means every restart invalidates old tokens. Fine for local
// dev, not for anything you leave running — set JWT_SECRET in the environment.
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET not set — using a random per-boot secret. Existing logins drop on restart.');
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    gif_url       TEXT    NOT NULL,
    high_score    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_users_high_score ON users (high_score DESC, id ASC);
`);

const stmt = {
  insertUser: db.prepare(
    'INSERT INTO users (username, password_hash, gif_url) VALUES (?, ?, ?)'
  ),
  byUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  // Single atomic statement: only writes when the new score actually wins.
  bumpHighScore: db.prepare(
    'UPDATE users SET high_score = ? WHERE id = ? AND high_score < ?'
  ),
  updateGif: db.prepare('UPDATE users SET gif_url = ? WHERE id = ?'),
  topPlayers: db.prepare(`
    SELECT id, username, gif_url, high_score
    FROM users
    WHERE high_score > 0
    ORDER BY high_score DESC, id ASC
    LIMIT ?
  `),
};

function getLeaderboard() {
  return stmt.topPlayers.all(LEADERBOARD_SIZE).map((row, i) => ({
    rank: i + 1,
    id: row.id,
    username: row.username,
    gifUrl: row.gif_url,
    highScore: row.high_score,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    gifUrl: user.gif_url,
    highScore: user.high_score,
  };
}

/** Bearer-token gate for protected routes. */
function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing Bearer token.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(401).json({ error: expired ? 'Token expired.' : 'Invalid token.' });
  }

  const user = stmt.byId.get(payload.sub);
  if (!user) return res.status(401).json({ error: 'User no longer exists.' });

  req.user = user;
  next();
}

function validateCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    return 'Username and password are required.';
  }
  const name = username.trim();
  if (name.length < 3 || name.length > 20) {
    return 'Username must be 3-20 characters.';
  }
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    return 'Username may only contain letters, numbers, _ and -.';
  }
  if (password.length < 6 || password.length > 200) {
    return 'Password must be 6-200 characters.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/signup', (req, res) => {
  const { username, password, gif_url: gifUrl } = req.body || {};

  const problem = validateCredentials(username, password);
  if (problem) return res.status(400).json({ error: problem });

  if (typeof gifUrl !== 'string' || !/^https?:\/\//.test(gifUrl)) {
    return res.status(400).json({ error: 'A valid gif_url (http/https) is required.' });
  }

  const name = username.trim();
  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);

  let info;
  try {
    info = stmt.insertUser.run(name, hash, gifUrl);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    console.error('[signup]', err);
    return res.status(500).json({ error: 'Could not create the account.' });
  }

  const user = stmt.byId.get(info.lastInsertRowid);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = stmt.byUsername.get(username.trim());
  // Same message either way so the endpoint does not leak which usernames exist.
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }

  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/leaderboard', (req, res) => {
  res.json({ leaderboard: getLeaderboard() });
});

app.post('/api/score', requireAuth, (req, res) => {
  const { score, gif_url: gifUrl } = req.body || {};

  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
    return res.status(400).json({ error: 'Score must be an integer between 0 and ' + MAX_SCORE + '.' });
  }

  // Let a player refresh their avatar along with a run.
  if (typeof gifUrl === 'string' && /^https?:\/\//.test(gifUrl) && gifUrl !== req.user.gif_url) {
    stmt.updateGif.run(gifUrl, req.user.id);
  }

  const result = stmt.bumpHighScore.run(score, req.user.id, score);
  const isNewHighScore = result.changes > 0;

  const user = stmt.byId.get(req.user.id);

  if (isNewHighScore) {
    broadcastLeaderboard();
  }

  res.json({
    isNewHighScore,
    highScore: user.high_score,
    leaderboard: getLeaderboard(),
  });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint.' }));

// ---------------------------------------------------------------------------
// WebSocket hub — pushes the top 10 to every connected client
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function broadcastLeaderboard() {
  const message = JSON.stringify({ type: 'leaderboard', leaderboard: getLeaderboard() });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => ws.terminate());

  // Seed the newcomer so the page never has to poll for a first render.
  ws.send(JSON.stringify({ type: 'leaderboard', leaderboard: getLeaderboard() }));
});

// Drop half-open sockets so wss.clients does not grow forever.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
heartbeat.unref();

// ---------------------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`Time-Waster Olympics running at http://localhost:${PORT}`);
  console.log(`WebSocket hub at ws://localhost:${PORT}/ws  ·  DB: ${DB_PATH}`);
});

function shutdown() {
  console.log('\nShutting down...');
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
