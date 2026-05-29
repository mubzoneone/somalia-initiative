const { adminCookieHeader, comparePasscode, verifySession } = require('../lib/session');

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const ok = verifySession(req.headers.cookie);
    return sendJson(res, 200, { ok });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const expected = process.env.ADMIN_PASSCODE;

  if (!expected) {
    return sendJson(res, 500, { ok: false, error: 'Server not configured' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, error: 'Invalid request body' });
  }

  const passcode = typeof body.passcode === 'string' ? body.passcode : '';

  if (!comparePasscode(passcode, expected)) {
    return sendJson(res, 401, { ok: false });
  }

  res.setHeader('Set-Cookie', adminCookieHeader());
  return sendJson(res, 200, { ok: true });
};
