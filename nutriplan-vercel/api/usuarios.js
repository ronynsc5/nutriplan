// api/usuarios.js
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;

async function supa(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, opts);
  const text = await r.text();
  if (!text) return [];
  try { return JSON.parse(text); }
  catch (e) { console.error('Supa parse error:', text.substring(0, 200)); return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    // ── CADASTRAR ────────────────────────────────────────────────────────────
    if (action === 'cadastrar' && req.method === 'POST') {
      const { nome, email, senha, wpp } = req.body;
      if (!nome || !email || !senha) return res.status(400).json({ error: 'Campos obrigatórios faltando' });

      const existe = await supa(`usuarios?email=eq.${encodeURIComponent(email)}&select=id`);
      if (existe.length > 0) return res.status(400).json({ error: 'Email já cadastrado' });

      const novo = await supa('usuarios', 'POST', {
        nome, email, senha, wpp: wpp || null,
        creditos: 0, is_admin: false
      });
      if (!novo[0]) return res.status(500).json({ error: 'Erro ao criar conta' });
      return res.status(200).json(novo[0]);
    }

    // ── LOGIN ────────────────────────────────────────────────────────────────
    if (action === 'login' && req.method === 'POST') {
      const { email, senha } = req.body;
      if (!email || !senha) return res.status(400).json({ error: 'Email e senha obrigatórios' });

      const u = await supa(
        `usuarios?email=eq.${encodeURIComponent(email)}&senha=eq.${encodeURIComponent(senha)}&select=*`
      );
      if (!u.length) return res.status(401).json({ error: 'Email ou senha incorretos' });
      return res.status(200).json(u[0]);
    }

    // ── BUSCAR POR EMAIL (sessão) ─────────────────────────────────────────────
    if (action === 'buscar' && req.method === 'GET') {
      const { email } = req.query;
      if (!email) return res.status(400).json({ error: 'Email obrigatório' });

      const u = await supa(`usuarios?email=eq.${encodeURIComponent(email)}&select=*`);
      if (!u.length) return res.status(404).json({ error: 'Não encontrado' });
      return res.status(200).json(u[0]);
    }

    // ── ATUALIZAR CRÉDITOS ───────────────────────────────────────────────────
    if (action === 'creditos' && req.method === 'PATCH') {
      const { id, creditos } = req.body;
      await supa(`usuarios?id=eq.${id}`, 'PATCH', { creditos });
      return res.status(200).json({ ok: true });
    }

    // ── LISTAR (admin) ───────────────────────────────────────────────────────
    if (action === 'listar' && req.method === 'GET') {
      const u = await supa('usuarios?is_admin=eq.false&select=id,nome,email,creditos,modo,criado_em&order=criado_em.desc');
      return res.status(200).json(u || []);
    }

    // ── CONFIG (chave pública MP) ────────────────────────────────────────────
    if (action === 'config' && req.method === 'GET') {
      return res.status(200).json({ MP_PUBLIC_KEY: process.env.MP_PUBLIC_KEY || '' });
    }

    return res.status(400).json({ error: `Ação inválida: ${action}` });

  } catch (err) {
    console.error('Usuarios error:', err);
    return res.status(500).json({ error: 'Erro interno', details: err.message });
  }
}
