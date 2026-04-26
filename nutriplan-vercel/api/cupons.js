// api/cupons.js
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    // VALIDAR CUPOM
    if (action === 'validar' && req.method === 'POST') {
      const { codigo, usuario_id } = req.body;
      const c = await supa(`cupons?codigo=eq.${encodeURIComponent(codigo.toUpperCase())}&select=*`);
      if (!c.length) return res.status(404).json({ error: 'Cupom inválido' });
      const cupom = c[0];
      if (cupom.expira_em && new Date(cupom.expira_em) < new Date()) return res.status(400).json({ error: 'Cupom expirado' });
      if (cupom.usos_restantes !== null && cupom.usos_restantes <= 0) return res.status(400).json({ error: 'Cupom esgotado' });
      // Aplica créditos
      const u = await supa(`usuarios?id=eq.${usuario_id}&select=creditos`);
      if (!u.length) return res.status(404).json({ error: 'Usuário não encontrado' });
      const novoCred = u[0].creditos + (cupom.creditos === 999 ? 999 : cupom.creditos);
      await supa(`usuarios?id=eq.${usuario_id}`, 'PATCH', { creditos: novoCred });
      // Desconta uso
      if (cupom.usos_restantes !== null) {
        await supa(`cupons?id=eq.${cupom.id}`, 'PATCH', { usos_restantes: cupom.usos_restantes - 1 });
      }
      return res.status(200).json({ ok: true, creditos: cupom.creditos });
    }

    // CRIAR CUPOM (admin)
    if (action === 'criar' && req.method === 'POST') {
      const { codigo, creditos, expira_em, usos_restantes } = req.body;
      const novo = await supa('cupons', 'POST', { codigo: codigo.toUpperCase(), creditos, expira_em: expira_em || null, usos_restantes: usos_restantes || null });
      return res.status(200).json(novo[0]);
    }

    // LISTAR CUPONS (admin)
    if (action === 'listar' && req.method === 'GET') {
      const c = await supa('cupons?order=criado_em.desc&select=*');
      return res.status(200).json(c);
    }

    return res.status(400).json({ error: 'Ação inválida' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
