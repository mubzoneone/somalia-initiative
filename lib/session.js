const crypto = require('crypto');

const COOKIE_NAME = 'si_admin';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecret() {
  return process.env.ADMIN_PASSCODE || '';
}

function signPayload(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

function buildCookieValue() {
  const expiry = String(Date.now() + SESSION_MS);
  const signature = signPayload(expiry);
  return `${expiry}.${signature}`;
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return out;
  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function verifySession(cookieHeader) {
  const secret = getSecret();
  if (!secret) return false;

  const raw = parseCookies(cookieHeader)[COOKIE_NAME];
  if (!raw) return false;

  const dot = raw.indexOf('.');
  if (dot === -1) return false;

  const expiry = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!/^\d+$/.test(expiry) || !signature) return false;

  const expected = signPayload(expiry);
  try {
    const a = Buffer.from(signature, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    if (!crypto.timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }

  return Date.now() < Number(expiry);
}

function adminCookieHeader() {
  const value = buildCookieValue();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure}`;
}

function comparePasscode(input, expected) {
  if (!expected || typeof input !== 'string') return false;
  const a = crypto.createHash('sha256').update(input, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  COOKIE_NAME,
  adminCookieHeader,
  verifySession,
  comparePasscode,
};
