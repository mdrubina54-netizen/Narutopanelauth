// netlify/functions/auth.js
// NarutoAuth API — handles init/login/register from C# apps
// Called by narutoauth.cs with type=init/login/register

const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_REPO  = process.env.GITHUB_REPO;
const GH_FILE  = process.env.GITHUB_FILE || 'db.json';
const GH_API   = `https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE}`;
const GH_HEADERS = {
  'Authorization': `Bearer ${GH_TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
};

async function ghRead() {
  const r = await fetch(GH_API, { headers: GH_HEADERS });
  if (r.status === 404) return { content: null, sha: null };
  if (!r.ok) throw new Error(`GitHub GET ${r.status}`);
  const j = await r.json();
  return { content: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha };
}

async function ghWrite(data, sha) {
  const body = { message: `auth sync ${new Date().toISOString()}`, content: Buffer.from(JSON.stringify(data)).toString('base64') };
  if (sha) body.sha = sha;
  const r = await fetch(GH_API, { method: 'PUT', headers: GH_HEADERS, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`GitHub PUT ${r.status}`);
}

function ok(data)    { return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ success: true,  ...data }) }; }
function fail(msg)   { return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ success: false, message: msg }) }; }
function genSession(){ return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } };

  let params = {};
  try {
    const raw = event.body || '';
    // Support both form-encoded (from C#) and JSON
    if (raw.startsWith('{')) {
      params = JSON.parse(raw);
    } else {
      raw.split('&').forEach(p => { const [k, v] = p.split('='); if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
    }
  } catch (e) { return fail('Invalid request body'); }

  const { type, name, ownerid, ver, username, pass, key, sessionid, hwid } = params;

  try {
    const { content: DB, sha } = await ghRead();
    if (!DB) return fail('Panel database not found. Register an account on the panel first.');

    const app = (DB.apps || []).find(a => a.name === name && a.ownerid === ownerid);
    if (!app) return fail('Application not found. Check your Name and OwnerId.');

    const users = DB.users[app.id] || [];
    const licenses = DB.licenses[app.id] || [];

    // ── INIT ──────────────────────────────────────────────────────────
    if (type === 'init') {
      const session = genSession();
      return ok({ sessionid: session, message: 'Session initialized' });
    }

    // ── LOGIN ──────────────────────────────────────────────────────────
    if (type === 'login') {
      if (!username || !pass) return fail('Username and password required.');
      const user = users.find(u => u.username === username);
      if (!user) return fail('User not found.');
      if (user.password !== pass) return fail('Invalid password.');
      if (user.status === 'banned') return fail('This account has been banned.');
      if (user.status === 'inactive') return fail('This account is inactive.');
      // HWID check
      if (user.hwLock) {
        if (!user.hwid) {
          // First login — bind HWID
          user.hwid = hwid || 'UNKNOWN';
          const { sha: s2 } = await ghRead();
          await ghWrite(DB, s2);
        } else if (hwid && user.hwid !== hwid) {
          return fail('Hardware ID mismatch. Contact support to reset.');
        }
      }
      // Expiry check
      if (user.expiry && user.expiry !== 'Never') {
        if (new Date(user.expiry) < new Date()) return fail('Account has expired.');
      }
      return ok({ message: 'Logged in successfully', username: user.username });
    }

    // ── REGISTER ──────────────────────────────────────────────────────
    if (type === 'register') {
      if (!username || !pass || !key) return fail('Username, password and license key required.');
      if (users.find(u => u.username === username)) return fail('Username already taken. Try another.');
      // Find unused license key
      const lic = licenses.find(l => l.key === key && !l.used);
      if (!lic) return fail('Invalid or already used license key.');
      // Create user
      const newUser = {
        id: Math.random().toString(36).slice(2),
        username, password: pass,
        status: 'active',
        hwLock: false, hwid: null,
        expiry: lic.expiry || 'Never',
        createdAt: new Date().toISOString().slice(0, 10)
      };
      DB.users[app.id].push(newUser);
      // Mark license as used
      lic.used = true; lic.usedBy = username;
      // Save
      const { sha: s3 } = await ghRead();
      await ghWrite(DB, s3);
      return ok({ message: 'Account created successfully!' });
    }

    return fail('Unknown request type.');
  } catch (e) {
    console.error('auth error:', e);
    return fail('Server error: ' + e.message);
  }
};
