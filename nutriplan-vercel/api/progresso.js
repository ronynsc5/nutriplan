// api/progresso.js
// Inclui: registro de progresso/fotos + sistema de conquistas

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
        foto_url, peso, nota, foto_antes, foto_depois
      } = req.body;

      // Buscar nome se não veio
      let nomeUsuario = nome || null;
      if (!nomeUsuario && usuario_id) {
        const u = await supa(`usuarios?id=eq.${usuario_id}&select=nome`);
        nomeUsuario = u[0]?.nome || 'Usuário';
      }

      const novo = await supa('progresso', 'POST', {
        usuario_id,
        nome:        nomeUsuario,
        tipo:        tipo        || 'progresso',
        conteudo:    conteudo    || null,
        publico:     publico     ?? false,
        foto_url:    foto_url    || null,
        peso:        peso        || null,
        nota:        nota        || null,
        foto_antes:  foto_antes  || null,
        foto_depois: foto_depois || null
      });

      return res.status(200).json(novo[0] || { ok: true });
    }

    // ── BUSCAR MEU PROGRESSO ─────────────────────────────────────────────────
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
      const p = await supa(
        'progresso?publico=eq.true&order=criado_em.desc&limit=50&select=*'
      );
      // Preencher nome se ausente
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

    // ── VISIBILIDADE ─────────────────────────────────────────────────────────
    if (action === 'visibilidade' && req.method === 'PATCH') {
      const { id, usuario_id, publico } = req.body;
      await supa(`progresso?id=eq.${id}&usuario_id=eq.${usuario_id}`, 'PATCH', { publico });
      return res.status(200).json({ ok: true });
    }

    // ════════════════════════════════════════════════════════════════════════
    // SISTEMA DE CONQUISTAS
    // ════════════════════════════════════════════════════════════════════════

    if (action === 'conquistas' && req.method === 'GET') {
      const { usuario_id } = req.query;
      if (!usuario_id) return res.status(400).json({ error: 'usuario_id obrigatório' });

      // Buscar todos os registros do usuário
      const todos = await supa(
        `progresso?usuario_id=eq.${usuario_id}&order=criado_em.asc&select=*`
      );

      const conquistas = calcularConquistas(todos);
      return res.status(200).json(conquistas);
    }

    // ════════════════════════════════════════════════════════════════════════
    // RITMO SEMANAL (para indicadores)
    // ════════════════════════════════════════════════════════════════════════

    if (action === 'ritmo' && req.method === 'GET') {
      const { usuario_id } = req.query;
      if (!usuario_id) return res.status(400).json({ error: 'usuario_id obrigatório' });

      const registros = await supa(
        `progresso?usuario_id=eq.${usuario_id}&peso=not.is.null&order=criado_em.desc&limit=14&select=peso,criado_em`
      );

      if (registros.length < 2) {
        return res.status(200).json({ ritmo: null, mediaSemanal: null, registros: registros.length });
      }

      const pesos = registros.map(r => Number(r.peso));
      const datas = registros.map(r => new Date(r.criado_em));
      const n     = pesos.length;

      const dias  = (datas[0] - datas[n-1]) / (1000 * 60 * 60 * 24);
      const ritmo = dias > 0 ? ((pesos[0] - pesos[n-1]) / dias) * 7 : 0;

      // Média da última semana
      const seteDias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const da7d     = registros.filter(r => new Date(r.criado_em) >= seteDias);
      const media7d  = da7d.length
        ? da7d.reduce((s, r) => s + Number(r.peso), 0) / da7d.length
        : pesos[0];

      return res.status(200).json({
        ritmo:         Math.round(ritmo * 100) / 100,
        mediaSeteDias: Math.round(media7d * 10) / 10,
        pesoAtual:     pesos[0],
        pesoInicial:   pesos[n-1],
        variacao:      Math.round((pesos[0] - pesos[n-1]) * 10) / 10,
        registros:     n
      });
    }

    return res.status(400).json({ error: `Ação inválida: ${action}` });

  } catch (err) {
    console.error('Progresso error:', err);
    return res.status(500).json({ error: 'Erro interno', details: err.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CÁLCULO DE CONQUISTAS
// ════════════════════════════════════════════════════════════════════════════

function calcularConquistas(todos) {
  const pesos       = todos.filter(p => p.peso);
  const fotos       = todos.filter(p => p.foto_url);
  const adps        = todos.filter(p => p.tipo === 'antes_depois');
  const publicos    = todos.filter(p => p.publico);

  // Dias consecutivos com registro
  let diasConsec = 0;
  const hoje = new Date();
  hoje.setHours(0,0,0,0);
  for (let i = 0; i < 7; i++) {
    const dia = new Date(hoje);
    dia.setDate(dia.getDate() - i);
    const temRegistro = pesos.some(p => {
      const d = new Date(p.criado_em);
      d.setHours(0,0,0,0);
      return d.getTime() === dia.getTime();
    });
    if (temRegistro) diasConsec++;
    else if (i > 0) break;
  }

  // Variação de peso
  const variacaoKg = pesos.length >= 2
    ? Number(pesos[0].peso) - Number(pesos[pesos.length-1].peso)
    : 0;
  const perdeuUmKg  = variacaoKg <= -1;
  const perdeuCinco = variacaoKg <= -5;

  return [
    {
      id: 'primeiro-peso',
      nome: 'Primeira medição',
      desc: 'Registre seu peso pela primeira vez',
      icone: '⚖️',
      desbloqueada: pesos.length >= 1,
      progresso: Math.min(1, pesos.length),
      total: 1,
      label: '1'
    },
    {
      id: 'semana-completa',
      nome: 'Semana completa',
      desc: '7 dias consecutivos de registro',
      icone: '📅',
      desbloqueada: diasConsec >= 7,
      progresso: diasConsec,
      total: 7,
      label: '7 dias'
    },
    {
      id: 'primeiro-kilo',
      nome: 'Primeiro quilo',
      desc: 'Perca 1kg em relação ao início',
      icone: '🔥',
      desbloqueada: perdeuUmKg,
      progresso: Math.min(1, Math.max(0, Math.abs(Math.min(0, variacaoKg)))),
      total: 1,
      label: '1kg'
    },
    {
      id: 'cinco-kilos',
      nome: 'Cinco quilos',
      desc: 'Perca 5kg em relação ao início',
      icone: '💪',
      desbloqueada: perdeuCinco,
      progresso: Math.min(5, Math.max(0, Math.abs(Math.min(0, variacaoKg)))),
      total: 5,
      label: '5kg'
    },
    {
      id: 'antes-depois',
      nome: 'Transformação',
      desc: 'Publique seu primeiro antes & depois',
      icone: '✨',
      desbloqueada: adps.length >= 1,
      progresso: Math.min(1, adps.length),
      total: 1,
      label: '1'
    },
    {
      id: 'comunidade',
      nome: 'Membro da comunidade',
      desc: 'Publique no feed público',
      icone: '🌍',
      desbloqueada: publicos.length >= 1,
      progresso: Math.min(1, publicos.length),
      total: 1,
      label: '1'
    },
    {
      id: 'dez-fotos',
      nome: 'Álbum fitness',
      desc: 'Registre 10 fotos de progresso',
      icone: '📸',
      desbloqueada: fotos.length >= 10,
      progresso: Math.min(10, fotos.length),
      total: 10,
      label: '10 fotos'
    }
  ];
}
