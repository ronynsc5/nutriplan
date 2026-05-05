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
    // ── SALVAR PROGRESSO ─────────────────────────────────────────────────────
    if (action === 'salvar' && req.method === 'POST') {
      const {
        usuario_id, nome, tipo, conteudo, publico,
        foto_url, peso, nota,
        foto_antes, foto_depois   // ← campos do slider antes/depois
      } = req.body;

      // Buscar nome do usuário se não veio no body
      let nomeUsuario = nome || null;
      if (!nomeUsuario && usuario_id) {
        const u = await supa(`usuarios?id=eq.${usuario_id}&select=nome`);
        nomeUsuario = u[0]?.nome || 'Usuário';
      }

      const novo = await supa('progresso', 'POST', {
        usuario_id,
        nome: nomeUsuario,
        tipo:       tipo       || 'progresso',
        conteudo:   conteudo   || null,
        publico:    publico    ?? false,
        foto_url:   foto_url   || null,
        peso:       peso       || null,
        nota:       nota       || null,
        foto_antes: foto_antes || null,   // ← slider
        foto_depois: foto_depois || null  // ← slider
      });

      return res.status(200).json(novo[0] || { ok: true });
    }

    // ── BUSCAR PROGRESSO DO USUÁRIO ──────────────────────────────────────────
    if (action === 'meu' && req.method === 'GET') {
      const { usuario_id } = req.query;
      if (!usuario_id) return res.status(400).json({ error: 'usuario_id obrigatório' });

      const p = await supa(
        `progresso?usuario_id=eq.${usuario_id}&order=criado_em.desc&select=*`
      );
      return res.status(200).json(p || []);
    }

    // ── FEED PÚBLICO ─────────────────────────────────────────────────────────
    if (action === 'feed' && req.method === 'GET') {
      // Busca progresso público com nome já salvo na tabela
      const p = await supa(
        'progresso?publico=eq.true&order=criado_em.desc&limit=50&select=*'
      );

      // Se nome não estiver na tabela, busca do usuário (fallback)
      const posts = await Promise.all((p || []).map(async post => {
        if (!post.nome && post.usuario_id) {
          const u = await supa(`usuarios?id=eq.${post.usuario_id}&select=nome`);
          post.nome = u[0]?.nome || 'Usuário';
        }
        return post;
      }));

      return res.status(200).json(posts);
    }

    // ── DELETAR ──────────────────────────────────────────────────────────────
    if (action === 'deletar' && req.method === 'DELETE') {
      const { id, usuario_id } = req.body;
      await supa(`progresso?id=eq.${id}&usuario_id=eq.${usuario_id}`, 'DELETE');
      return res.status(200).json({ ok: true });
    }

    // ── ALTERAR VISIBILIDADE ──────────────────────────────────────────────────
    if (action === 'visibilidade' && req.method === 'PATCH') {
      const { id, usuario_id, publico } = req.body;
      await supa(`progresso?id=eq.${id}&usuario_id=eq.${usuario_id}`, 'PATCH', { publico });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: `Ação inválida: ${action}` });

  } catch (err) {
    console.error('Progresso error:', err);
    return res.status(500).json({ error: 'Erro interno', details: err.message });
  }
}
