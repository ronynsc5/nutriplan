// api/usuarios.js — com autenticação JWT
import { createHmac } from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'nutriplan-secret-change-me';

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}
function verificarToken(req) {
  try {
    const header = req.headers['authorization'] || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return null;
    const [h, b, sig] = token.split('.');
    const esperado = createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
    if (sig !== esperado) return null;
    const payload = JSON.parse(b64urlDecode(b));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}


// ── Supabase helper ──────────────────────────────────────────────────────────
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
  if (!r.ok && method !== 'PATCH' && method !== 'DELETE') {
    throw new Error(`Supabase ${r.status}: ${text.substring(0, 150)}`);
  }
  if (!text) return [];
  try { return JSON.parse(text); } catch (e) { return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {

    // ════════════════════════════════════════════════════════════════════════
    // ROTAS PÚBLICAS (sem auth)
    // ════════════════════════════════════════════════════════════════════════

    // ── CADASTRAR ────────────────────────────────────────────────────────────
    if (action === 'cadastrar' && req.method === 'POST') {
      const { nome, email, senha, wpp } = req.body;
      if (!nome || !email || !senha)
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });

      const existe = await supa(`usuarios?email=eq.${encodeURIComponent(email)}&select=id`);
      if (existe.length > 0)
        return res.status(400).json({ error: 'Email já cadastrado' });

      const novo = await supa('usuarios', 'POST', {
        nome, email, senha, wpp: wpp || null, creditos: 0, is_admin: false
      });
      if (!novo[0]) return res.status(500).json({ error: 'Erro ao criar conta' });

      // Retornar usuário + token já no cadastro
      const token = gerarToken(novo[0]);
      return res.status(200).json({ ...novo[0], token });
    }

    // ── LOGIN ────────────────────────────────────────────────────────────────
    if (action === 'login' && req.method === 'POST') {
      const { email, senha } = req.body;
      if (!email || !senha)
        return res.status(400).json({ error: 'Email e senha obrigatórios' });

      const u = await supa(
        `usuarios?email=eq.${encodeURIComponent(email)}&senha=eq.${encodeURIComponent(senha)}&select=*`
      );
      if (!u.length)
        return res.status(401).json({ error: 'Email ou senha incorretos' });

      // Retornar usuário + token JWT
      const token = gerarToken(u[0]);
      return res.status(200).json({ ...u[0], token });
    }

    // ── CONFIG (chave pública MP — pública) ──────────────────────────────────
    if (action === 'config' && req.method === 'GET') {
      return res.status(200).json({ MP_PUBLIC_KEY: process.env.MP_PUBLIC_KEY || '' });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ROTAS PROTEGIDAS — verificar token
    // ════════════════════════════════════════════════════════════════════════
    const auth = verificarToken(req);
    if (!auth) return res.status(401).json({ error: 'Não autenticado. Faça login novamente.' });

    // ── BUSCAR PRÓPRIO PERFIL ─────────────────────────────────────────────────
    if (action === 'buscar' && req.method === 'GET') {
      const { email } = req.query;
      // Só pode buscar o próprio email (ou admin busca qualquer um)
      if (!auth.is_admin && email && email !== auth.email)
        return res.status(403).json({ error: 'Acesso negado.' });

      const consulta = email
        ? `usuarios?email=eq.${encodeURIComponent(email)}&select=*`
        : `usuarios?id=eq.${auth.sub}&select=*`;
      const u = await supa(consulta);
      if (!u.length) return res.status(404).json({ error: 'Não encontrado' });
      return res.status(200).json(u[0]);
    }

    // ── ATUALIZAR CRÉDITOS (admin only) ──────────────────────────────────────
    if (action === 'creditos' && req.method === 'PATCH') {
      if (!auth.is_admin) return res.status(403).json({ error: 'Acesso negado.' });
      const { id, creditos } = req.body;
      await supa(`usuarios?id=eq.${id}`, 'PATCH', { creditos });
      return res.status(200).json({ ok: true });
    }

    // ── LISTAR (admin only) ───────────────────────────────────────────────────
    if (action === 'listar' && req.method === 'GET') {
      if (!auth.is_admin) return res.status(403).json({ error: 'Acesso negado.' });
      const u = await supa(
        'usuarios?is_admin=eq.false&select=id,nome,email,creditos,modo,criado_em&order=criado_em.desc'
      );
      return res.status(200).json(u || []);
    }

    return res.status(400).json({ error: `Ação inválida: ${action}` });

  } catch (err) {
    console.error('Usuarios error:', err);
    return res.status(500).json({ error: 'Erro interno', details: err.message });
  }
}
