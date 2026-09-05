import { test } from 'node:test';
import assert from 'node:assert';
import { redact, describeDbError, describeConnection } from '../lib/diagnose.js';

test('redact strips connection strings and passwords', () => {
  const msg = 'failed for postgresql://postgres.abc:SuperSecret123@aws-0.pooler.supabase.com:6543/postgres';
  const out = redact(msg);
  assert.ok(!out.includes('SuperSecret123'));
  assert.ok(!out.includes('postgresql://'));
  assert.match(out, /<connection-string>/);
});

test('a wrong password is explained, not echoed', () => {
  const d = describeDbError({ code: '28P01', message: 'password authentication failed for user "postgres.abc"' });
  assert.equal(d.code, '28P01');
  assert.match(d.hint, /Password rejected/);
});

test('the direct-connection timeout gets the pooler hint', () => {
  const d = describeDbError({ code: 'ENETUNREACH', message: 'connect ENETUNREACH' });
  assert.match(d.hint, /Transaction pooler/);
});

test('describeConnection never returns the password', () => {
  const saved = process.env.POSTGRES_URL;
  process.env.POSTGRES_URL = 'postgresql://postgres.abc:SuperSecret123@aws-0.pooler.supabase.com:6543/postgres';
  try {
    const c = describeConnection();
    assert.equal(JSON.stringify(c).includes('SuperSecret123'), false);
    assert.equal(c.usingPooler, true);
    assert.equal(c.port, '6543');
    assert.equal(c.usernameShape, 'postgres.<ref>');
  } finally { process.env.POSTGRES_URL = saved; }
});

test('a direct connection string is flagged as unreachable from Vercel', () => {
  const saved = process.env.POSTGRES_URL;
  process.env.POSTGRES_URL = 'postgresql://postgres:pw@db.abc.supabase.co:5432/postgres';
  try {
    const c = describeConnection();
    assert.equal(c.usingPooler, false);
    assert.match(c.warning, /IPv6-only/);
  } finally { process.env.POSTGRES_URL = saved; }
});
