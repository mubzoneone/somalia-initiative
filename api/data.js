const { verifySession } = require('../lib/session');

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function getSupabaseEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

function tableUrl(supabaseUrl) {
  return `${supabaseUrl.replace(/\/$/, '')}/rest/v1/app_data`;
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
  try {
    return await _handler(req, res);
  } catch (err) {
    console.error('[api/data] unhandled error:', err);
    return sendJson(res, 500, { error: `Unhandled error: ${err.message}` });
  }
};

async function _handler(req, res) {
  const env = getSupabaseEnv();
  if (!env) {
    return sendJson(res, 500, { error: 'Server not configured' });
  }

  const { url, key } = env;
  const baseHeaders = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
  };

  if (req.method === 'GET') {
    try {
      const upstream = await fetch(
        `${tableUrl(url)}?id=eq.1&select=record`,
        { headers: { ...baseHeaders, 'Accept': 'application/json' } }
      );

      if (!upstream.ok) {
        return sendJson(res, upstream.status, { error: 'Failed to load data' });
      }

      const rows = await upstream.json();
      const record = Array.isArray(rows) && rows.length > 0 ? rows[0].record : null;

      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
      return sendJson(res, 200, { record: record ?? null });
    } catch (err) {
      return sendJson(res, 502, { error: `Failed to reach data store: ${err.message}` });
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
      const upstream = await fetch(tableUrl(url), {
        method: 'POST',
        headers: {
          ...baseHeaders,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          id: 1,
          record: payload,
          updated_at: new Date().toISOString(),
        }),
      });

      if (!upstream.ok) {
        return sendJson(res, upstream.status, { error: 'Failed to save data' });
      }

      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 502, { error: `Failed to reach data store: ${err.message}` });
    }
  }

  res.setHeader('Allow', 'GET, PUT');
  return sendJson(res, 405, { error: 'Method not allowed' });
};
