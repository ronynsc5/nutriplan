// api/progresso.js

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
    const esperado = createHmac('sha256', JWT_SECRET)
      .update(h + '.' + b).digest('base64url');
    if (sig !== esperado) return null;
    const payload = JSON.parse(b64urlDecode(b));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}

const JWT_SECRET = process.env.JWT_SECRET || 'nutriplan-secret-change-me';

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

// Inclui: registro de progresso/fotos + sistema de conquistas (v2)

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;

}


// FIX: verificar response.ok antes de parsear
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

  if (!r.ok && r.status !== 404) {
    console.error(`Supabase ${r.status} on ${method} ${path}:`, text.substring(0, 200));
    // Não lançar erro em DELETE (pode já não existir)
    if (method !== 'DELETE') throw new Error(`Supabase ${r.status}`);
  }
  if (!text) return [];
  try { return JSON.parse(text); }
  catch (e) { return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action     = req.query.action;
  const usuario_id = req.query.usuario_id || req.body?.usuario_id;

  // Rotas públicas (sem auth)
  const PUBLICAS = ['feed'];
  if (!PUBLICAS.includes(action)) {
    const auth = verificarToken(req);
    if (!auth) return res.status(401).json({ error: 'Não autenticado.' });
    // Validar que usuario_id pertence ao token
    const uid = usuario_id || req.body?.usuario_id;
    if (uid && uid !== auth.sub && !auth.is_admin) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
  }

  try {

    // ── SALVAR PROGRESSO ─────────────────────────────────────────────────────
    if (action === 'salvar' && req.method === 'POST') {
      const {
        usuario_id: uid, nome, tipo, conteudo, publico,
        foto_url, peso, nota, foto_antes, foto_depois
      } = req.body;

      if (!uid) return res.status(400).json({ error: 'usuario_id obrigatório' });

      // Buscar nome se não veio
      let nomeUsuario = nome || null;
      if (!nomeUsuario) {
        try {
          const u = await supa(`usuarios?id=eq.${uid}&select=nome`);
          nomeUsuario = u[0]?.nome || 'Usuário';
        } catch (e) { nomeUsuario = 'Usuário'; }
      }

      const novo = await supa('progresso', 'POST', {
        usuario_id:  uid,
        nome:        nomeUsuario,
        tipo:        tipo        || 'progresso',
        conteudo:    conteudo    || null,
        publico:     publico     ?? false,
        foto_url:    foto_url    || null,
        peso:        peso        ? Number(peso) : null,
        nota:        nota        || null,
        foto_antes:  foto_antes  || null,
        foto_depois: foto_depois || null
      });

      return res.status(200).json(novo[0] || { ok: true });
    }

    // ── BUSCAR MEU PROGRESSO ─────────────────────────────────────────────────
    if (action === 'meu' && req.method === 'GET') {
      if (!usuario_id) return res.status(400).json({ error: 'usuario_id obrigatório' });
      const p = await supa(
        `progresso?usuario_id=eq.${usuario_id}&order=criado_em.desc&select=*`
      );
      return res.status(200).json(p || []);
    }

    // ── FEED PÚBLICO — FIX: sem N+1, nome já desnormalizado na tabela ────────
    if (action === 'feed' && req.method === 'GET') {
      const p = await supa(
        'progresso?publico=eq.true&order=criado_em.desc&limit=50&select=*'
      );

      // Fallback somente para posts sem nome (legado)
      const semNome = (p || []).filter(post => !post.nome);
      if (semNome.length > 0) {
        // Buscar todos os usuários necessários em UMA query
        const ids = [...new Set(semNome.map(p => p.usuario_id))];
        const usuarios = await supa(
          `usuarios?id=in.(${ids.join(',')})&select=id,nome`
        ).catch(() => []);
        const nomeMap = {};
        usuarios.forEach(u => { nomeMap[u.id] = u.nome; });
        p.forEach(post => {
          if (!post.nome) post.nome = nomeMap[post.usuario_id] || 'Usuário';
        });
      }

      return res.status(200).json(p || []);
    }

    // ── DELETAR — FIX: aceita id via query string também ────────────────────
    if (action === 'deletar' && req.method === 'DELETE') {
      const id          = req.query.id     || req.body?.id;
      const uid         = req.query.uid    || req.body?.usuario_id;
      if (!id || !uid) return res.status(400).json({ error: 'id e usuario_id obrigatórios' });
      await supa(`progresso?id=eq.${id}&usuario_id=eq.${uid}`, 'DELETE');
      return res.status(200).json({ ok: true });
    }

    // ── VISIBILIDADE — FIX: aceita id via query string ───────────────────────
    if (action === 'visibilidade' && req.method === 'PATCH') {
      const id  = req.query.id  || req.body?.id;
      const uid = req.query.uid || req.body?.usuario_id;
      const pub = req.body?.publico;
      if (!id || !uid) return res.status(400).json({ error: 'id e usuario_id obrigatórios' });
      await supa(`progresso?id=eq.${id}&usuario_id=eq.${uid}`, 'PATCH', { publico: pub });
      return res.status(200).json({ ok: true });
    }

    // ── CONQUISTAS ────────────────────────────────────────────────────────────
    if (action === 'conquistas' && req.method === 'GET') {
      if (!usuario_id) return res.status(400).json({ error: 'usuario_id obrigatório' });
      const todos = await supa(
        `progresso?usuario_id=eq.${usuario_id}&order=criado_em.asc&select=*`
      );
      return res.status(200).json(calcularConquistas(todos || []));
    }

    // ── RITMO SEMANAL ─────────────────────────────────────────────────────────
    if (action === 'ritmo' && req.method === 'GET') {
      if (!usuario_id) return res.status(400).json({ error: 'usuario_id obrigatório' });
      const registros = await supa(
        `progresso?usuario_id=eq.${usuario_id}&peso=not.is.null&order=criado_em.desc&limit=14&select=peso,criado_em`
      );
      if (registros.length < 2) {
        return res.status(200).json({ ritmo: null, registros: registros.length });
      }
      const pesos = registros.map(r => Number(r.peso));
      const datas = registros.map(r => new Date(r.criado_em));
      const n     = pesos.length;
      const dias  = (datas[0] - datas[n-1]) / (1000 * 60 * 60 * 24);
      const ritmo = dias > 0 ? ((pesos[0] - pesos[n-1]) / dias) * 7 : 0;
      return res.status(200).json({
        ritmo:       Math.round(ritmo * 100) / 100,
        pesoAtual:   pesos[0],
        pesoInicial: pesos[n-1],
        variacao:    Math.round((pesos[0] - pesos[n-1]) * 10) / 10,
        registros:   n
      });
    }

    return res.status(400).json({ error: `Ação inválida: ${action}` });

  } catch (err) {
    console.error('Progresso error:', err);
    return res.status(500).json({ error: 'Erro interno', details: err.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CONQUISTAS — lógica corrigida
// ════════════════════════════════════════════════════════════════════════════
function calcularConquistas(todos) {
  const comPeso  = todos.filter(p => p.peso);
  const fotos    = todos.filter(p => p.foto_url);
  const adps     = todos.filter(p => p.tipo === 'antes_depois');
  const publicos = todos.filter(p => p.publico);

  // FIX: variação correta — primeiro registro (mais antigo) vs último (mais recente)
  // todos está em ordem ASC, então [0] = mais antigo, [last] = mais recente
  const pesoInicial = comPeso.length > 0 ? Number(comPeso[0].peso) : null;
  const pesoAtual   = comPeso.length > 0 ? Number(comPeso[comPeso.length - 1].peso) : null;
  // variacaoKg positivo = perdeu peso (pesoInicial > pesoAtual)
  const variacaoKg  = pesoInicial && pesoAtual ? pesoInicial - pesoAtual : 0;

  // FIX: dias consecutivos — conta QUALQUER tipo de registro (não só peso)
  let diasConsec = 0;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    const dia = new Date(hoje);
    dia.setDate(dia.getDate() - i);
    const diaStr = dia.toISOString().slice(0, 10);
    const temRegistro = todos.some(p => p.criado_em && p.criado_em.slice(0, 10) === diaStr);
    if (temRegistro) diasConsec++;
    else if (i > 0) break; // sequência quebrada
  }

  return [
    {
      id: 'primeiro-peso',
      nome: 'Primeira medição',
      desc: 'Registre seu peso pela primeira vez',
      icone: '⚖️',
      desbloqueada: comPeso.length >= 1,
      progresso: Math.min(1, comPeso.length),
      total: 1,
      label: '1'
    },
    {
      id: 'semana-completa',
      nome: 'Semana completa',
      desc: '7 dias consecutivos de atividade',
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
      // FIX: variacaoKg positivo = perdeu peso
      desbloqueada: variacaoKg >= 1,
      progresso: Math.min(1, Math.max(0, variacaoKg)),
      total: 1,
      label: '1kg'
    },
    {
      id: 'cinco-kilos',
      nome: 'Cinco quilos',
      desc: 'Perca 5kg em relação ao início',
      icone: '💪',
      desbloqueada: variacaoKg >= 5,
      progresso: Math.min(5, Math.max(0, variacaoKg)),
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
