// api/curtidas.js
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;

async function supa(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : ''
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, opts);
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { progresso_id } = req.body;
    // Incrementa curtidas
    const atual = await supa(`progresso?id=eq.${progresso_id}&select=curtidas`);
    const curtidas = (atual[0]?.curtidas || 0) + 1;
    await supa(`progresso?id=eq.${progresso_id}`, 'PATCH', { curtidas });
    return res.status(200).json({ curtidas });
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno' });
  }
}
