// netlify/functions/db.mjs
const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_REPO  = process.env.GITHUB_REPO;
const GH_FILE  = process.env.GITHUB_FILE || 'db.json';
const DP_KEY   = process.env.DP_API_KEY  || '';

const GH_API = `https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE}`;
const GH_HEADERS = {
  'Authorization': `Bearer ${GH_TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
};

async function ghRead() {
  const r = await fetch(GH_API, { headers: GH_HEADERS });
  if (r.status === 404) return { content: null, sha: null };
  if (!r.ok) throw new Error(`GitHub GET ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return {
    content: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')),
    sha: j.sha,
  };
}

async function ghWrite(data, sha) {
  const body = {
    message: `panel sync ${new Date().toISOString()}`,
    content: Buffer.from(JSON.stringify(data)).toString('base64'),
  };
  if (sha) body.sha = sha;
  const r = await fetch(GH_API, { method: 'PUT', headers: GH_HEADERS, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`GitHub PUT ${r.status}: ${await r.text()}`);
}

const JSON_H = { 'Content-Type': 'application/json' };

exports.handler = async function(event) {
  if (DP_KEY && event.headers['x-dp-key'] !== DP_KEY)
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  if (event.httpMethod === 'GET') {
    try {
      const { content } = await ghRead();
      return { statusCode: 200, headers: JSON_H, body: JSON.stringify(content) };
    } catch (e) {
      return { statusCode: 500, headers: JSON_H, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (event.httpMethod === 'PUT') {
    try {
      const data = JSON.parse(event.body);
      const { sha } = await ghRead();
      await ghWrite(data, sha);
      return { statusCode: 200, headers: JSON_H, body: JSON.stringify({ ok: true }) };
    } catch (e) {
      return { statusCode: 500, headers: JSON_H, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
};
