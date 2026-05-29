const { verifySession } = require('../lib/session');

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function getJsonBinEnv() {
  const binId = process.env.JSONBIN_BIN_ID;
  const masterKey = process.env.JSONBIN_MASTER_KEY;
  if (!binId || !masterKey) return null;
  return { binId, masterKey };
}

function jsonBinUrl(binId) {
  return `https://api.jsonbin.io/v3/b/${binId}`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  const env = getJsonBinEnv();
  if (!env) {
    return sendJson(res, 500, { error: 'Server not configured' });
  }

  const { binId, masterKey } = env;
  const headers = { 'X-Master-Key': masterKey };

  if (req.method === 'GET') {
    try {
      const upstream = await fetch(jsonBinUrl(binId), { headers });
      if (upstream.status === 404) {
        return sendJson(res, 200, { record: null });
      }
      if (!upstream.ok) {
        return sendJson(res, upstream.status, { error: 'Failed to load data' });
      }
      const body = await upstream.json();
      return sendJson(res, 200, { record: body.record ?? null });
    } catch {
      return sendJson(res, 502, { error: 'Failed to reach data store' });
    }
  }

  if (req.method === 'PUT') {
    if (!verifySession(req.headers.cookie)) {
      return sendJson(res, 401, { error: 'Admin session required' });
    }

    let payload;
    try {
      payload = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: 'Invalid request body' });
    }

    if (!payload || typeof payload !== 'object') {
      return sendJson(res, 400, { error: 'Invalid data payload' });
    }

    try {
      const upstream = await fetch(jsonBinUrl(binId), {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!upstream.ok) {
        return sendJson(res, upstream.status, { error: 'Failed to save data' });
      }
      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 502, { error: 'Failed to reach data store' });
    }
  }

  res.setHeader('Allow', 'GET, PUT');
  return sendJson(res, 405, { error: 'Method not allowed' });
};
