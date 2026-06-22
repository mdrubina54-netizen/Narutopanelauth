// netlify/functions/db.mjs
// Reads/writes db.json in a private GitHub repo via the GitHub API.
// No database needed — free forever.

const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_REPO  = process.env.GITHUB_REPO;   // e.g. yourname/dangerpanel-data
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

export default async (req) => {
  if (DP_KEY && req.headers.get('x-dp-key') !== DP_KEY)
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_H });

  if (req.method === 'GET') {
    try {
      const { content } = await ghRead();
      return new Response(JSON.stringify(content), { headers: JSON_H });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: JSON_H });
    }
  }

  if (req.method === 'PUT') {
    try {
      const data = await req.json();
      const { sha } = await ghRead();
      await ghWrite(data, sha);
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_H });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: JSON_H });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: JSON_H });
};

export const config = { path: '/api/db' };
        
