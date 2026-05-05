// api/planos.js
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, usuario_id } = req.query;

  try {
    // ── SALVAR plano gerado ──────────────────────────────────────────────────
    if (action === 'salvar' && req.method === 'POST') {
      const { usuario_id: uid, tipo, modo, dados_form, plano_gerado, expira_em } = req.body;

      const novo = await supa('planos', 'POST', {
        usuario_id: uid,
        tipo,
        modo,
        dados_form,
        plano_gerado,
        pesos: [{ semana: 1, data: new Date().toISOString(), peso: dados_form?.peso || 0 }],
        refeicoes_puladas: [],
        expira_em
      });

      // Descontar crédito do usuário
      const u = await supa(`usuarios?id=eq.${uid}&select=creditos`);
      if (u[0] && u[0].creditos < 999999) {
        await supa(`usuarios?id=eq.${uid}`, 'PATCH', {
          creditos: Math.max(0, u[0].creditos - 1)
        });
      }

      return res.status(200).json(novo[0] || {
        id: 'local', plano_gerado, dados_form, modo, tipo,
        pesos: [], refeicoes_puladas: [], expira_em
      });
    }

    // ── BUSCAR plano mais recente (action=buscar OU action=meu) ─────────────
    if ((action === 'buscar' || action === 'meu') && req.method === 'GET') {
      if (!usuario_id) return res.status(400).json({ error: 'usuario_id obrigatório' });

      const planos = await supa(
        `planos?usuario_id=eq.${usuario_id}&order=criado_em.desc&limit=1&select=*`
      );

      // Retorna array (compatível com novo código do HTML)
      return res.status(200).json(planos || []);
    }

    // ── ATUALIZAR pesos semanais ─────────────────────────────────────────────
    if (action === 'pesos' && req.method === 'PATCH') {
      const { id, pesos } = req.body;
      await supa(`planos?id=eq.${id}`, 'PATCH', { pesos });
      return res.status(200).json({ ok: true });
    }

    // ── ATUALIZAR refeições puladas ──────────────────────────────────────────
    if (action === 'puladas' && req.method === 'PATCH') {
      const { id, refeicoes_puladas } = req.body;
      await supa(`planos?id=eq.${id}`, 'PATCH', { refeicoes_puladas });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: `Ação inválida: ${action}` });

  } catch (err) {
    console.error('Planos error:', err);
    return res.status(500).json({ error: 'Erro interno', details: err.message });
  }
}
