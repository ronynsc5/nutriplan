// api/progresso.js
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
    // SALVAR PROGRESSO
    if (action === 'salvar' && req.method === 'POST') {
      const { usuario_id, tipo, conteudo, publico, foto_url, peso, nota, frase_motivacional, foto_antes } = req.body;
      const novo = await supa('progresso', 'POST', {
        usuario_id, tipo, conteudo, publico,
        foto_url: foto_url || null,
        peso: peso || null,
        nota: nota || null
      });
      return res.status(200).json(novo[0]);
    }

    // BUSCAR PROGRESSO DO USUÁRIO
    if (action === 'meu' && req.method === 'GET') {
      const { usuario_id } = req.query;
      const p = await supa(`progresso?usuario_id=eq.${usuario_id}&order=criado_em.desc&select=*`);
      return res.status(200).json(p);
    }

    // FEED PÚBLICO
    if (action === 'feed' && req.method === 'GET') {
      const p = await supa('progresso?publico=eq.true&order=criado_em.desc&limit=50&select=*,usuarios(nome)');
      return res.status(200).json(p);
    }

    // DELETAR
    if (action === 'deletar' && req.method === 'DELETE') {
      const { id, usuario_id } = req.body;
      await supa(`progresso?id=eq.${id}&usuario_id=eq.${usuario_id}`, 'DELETE');
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Ação inválida' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
