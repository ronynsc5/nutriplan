// api/comentarios.js
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    // LISTAR COMENTÁRIOS DE UM POST
    if (action === 'listar' && req.method === 'GET') {
      const { progresso_id } = req.query;
      const c = await supa(`comentarios?progresso_id=eq.${progresso_id}&order=criado_em.asc&select=*,usuarios(nome)`);
      return res.status(200).json(c);
    }

    // ADICIONAR COMENTÁRIO
    if (action === 'adicionar' && req.method === 'POST') {
      const { progresso_id, usuario_id, texto } = req.body;
      if (!texto?.trim()) return res.status(400).json({ error: 'Texto obrigatório' });
      const novo = await supa('comentarios', 'POST', { progresso_id, usuario_id, texto: texto.trim() });
      return res.status(200).json(novo[0]);
    }

    // DELETAR COMENTÁRIO
    if (action === 'deletar' && req.method === 'DELETE') {
      const { id, usuario_id } = req.body;
      await supa(`comentarios?id=eq.${id}&usuario_id=eq.${usuario_id}`, 'DELETE');
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Ação inválida' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
