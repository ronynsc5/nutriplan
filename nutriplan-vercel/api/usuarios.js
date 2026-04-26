// api/usuarios.js
// CRUD de usuários via Supabase

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    // CADASTRO
    if (action === 'cadastrar' && req.method === 'POST') {
      const { nome, email, senha, wpp } = req.body;
      // Verifica se já existe
      const existe = await supa(`usuarios?email=eq.${encodeURIComponent(email)}&select=id`);
      if (existe.length > 0) return res.status(400).json({ error: 'Email já cadastrado' });
      const novo = await supa('usuarios', 'POST', { nome, email, senha, wpp, creditos: 0, is_admin: false });
      return res.status(200).json(novo[0]);
    }

    // LOGIN
    if (action === 'login' && req.method === 'POST') {
      const { email, senha } = req.body;
      const u = await supa(`usuarios?email=eq.${encodeURIComponent(email)}&senha=eq.${encodeURIComponent(senha)}&select=*`);
      if (!u.length) return res.status(401).json({ error: 'Email ou senha incorretos' });
      return res.status(200).json(u[0]);
    }

    // BUSCAR USUÁRIO
    if (action === 'buscar' && req.method === 'GET') {
      const { email } = req.query;
      const u = await supa(`usuarios?email=eq.${encodeURIComponent(email)}&select=*`);
      if (!u.length) return res.status(404).json({ error: 'Não encontrado' });
      return res.status(200).json(u[0]);
    }

    // ATUALIZAR CRÉDITOS
    if (action === 'creditos' && req.method === 'PATCH') {
      const { id, creditos } = req.body;
      await supa(`usuarios?id=eq.${id}`, 'PATCH', { creditos });
      return res.status(200).json({ ok: true });
    }

    // LISTAR TODOS (admin)
    if (action === 'listar' && req.method === 'GET') {
      const u = await supa('usuarios?is_admin=eq.false&select=id,nome,email,creditos,modo,criado_em');
      return res.status(200).json(u);
    }

    return res.status(400).json({ error: 'Ação inválida' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
