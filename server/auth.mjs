// Login gate for the bridge. The repo is public, so NOTHING secret lives here:
// the email, password hash and signing secret are read from a config file in
// Kai's Fortress of Solitude (alongside the vault, off the repo). The bridge
// verifies the password and mints a 30-day HMAC-signed session token.
import { scryptSync, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { locateVault } from './vault.mjs';

let CONFIG = null;

function authFilePath() {
  if (process.env.MYOS_AUTH_FILE) return process.env.MYOS_AUTH_FILE;
  // Vault is <drive>:\Kai\Hub Revamped; fortress is <drive>:\Kai\Fortress of Solitude.
  const kai = dirname(locateVault());
  return join(kai, 'Fortress of Solitude', 'myos-auth.json');
}

export function loadAuth() {
  const path = authFilePath();
  if (!existsSync(path)) {
    throw new Error(`Auth config not found at ${path}. myOS will not serve the vault without it.`);
  }
  CONFIG = JSON.parse(readFileSync(path, 'utf8'));
  return { email: CONFIG.email, sessionDays: CONFIG.sessionDays || 30 };
}

function cfg() {
  if (!CONFIG) loadAuth();
  return CONFIG;
}

export function verifyPassword(email, password) {
  const c = cfg();
  if (!email || String(email).toLowerCase() !== c.email) return false;
  const got = scryptSync(String(password), c.salt, 64);
  const want = Buffer.from(c.hash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uJson = (obj) => b64u(JSON.stringify(obj));

function sign(payloadB64) {
  return b64u(createHmac('sha256', cfg().secret).update(payloadB64).digest());
}

export function issueToken() {
  const days = cfg().sessionDays || 30;
  const payload = { sub: cfg().email, exp: Date.now() + days * 864e5 };
  const p = b64uJson(payload);
  return `${p}.${sign(p)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [p, sig] = parts;
  // Compare the decoded signature bytes in constant time.
  const a = Buffer.from(sig, 'base64url');
  const b = Buffer.from(sign(p), 'base64url');
  if (a.length === 0 || a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
  catch { return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// A long-lived API key (in the fortress config) lets trusted automations —
// e.g. an iOS Shortcut pushing step counts — authenticate without the browser
// login flow. Sent as the `X-API-Key` header.
function apiKeyOk(req) {
  const key = req.headers['x-api-key'] || (req.query && req.query.key);
  const want = cfg().apiKey;
  if (!key || !want) return false;
  const a = Buffer.from(String(key));
  const b = Buffer.from(String(want));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireAuth(req, res, next) {
  if (apiKeyOk(req)) {
    req.user = { sub: cfg().email, via: 'apikey' };
    return next();
  }
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.user = payload;
  next();
}
