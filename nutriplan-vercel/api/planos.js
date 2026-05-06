// api/planos.js
// Inclui: gestão de planos + motor de decisão adaptativo

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
        tipo, modo, dados_form, plano_gerado,
        pesos: [{ semana: 1, data: new Date().toISOString(), peso: dados_form?.peso || 0 }],
        refeicoes_puladas: [],
        expira_em
      });

      // Descontar crédito
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

    // ── BUSCAR plano mais recente (action=buscar ou action=meu) ──────────────
    if ((action === 'buscar' || action === 'meu') && req.method === 'GET') {
      if (!usuario_id) return res.status(400).json({ error: 'usuario_id obrigatório' });
      const planos = await supa(
        `planos?usuario_id=eq.${usuario_id}&order=criado_em.desc&limit=1&select=*`
      );
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

    // ════════════════════════════════════════════════════════════════════════
    // MOTOR DE DECISÃO ADAPTATIVO
    // ════════════════════════════════════════════════════════════════════════

    // ── ANALISAR — calcula scores e retorna decisão ──────────────────────────
    if (action === 'analisar' && req.method === 'GET') {
      if (!usuario_id) return res.status(400).json({ error: 'usuario_id obrigatório' });

      // Buscar registros de peso
      const registros = await supa(
        `progresso?usuario_id=eq.${usuario_id}&peso=not.is.null&order=criado_em.desc&limit=14&select=peso,criado_em`
      );

      // Buscar plano atual
      const planos = await supa(
        `planos?usuario_id=eq.${usuario_id}&order=criado_em.desc&limit=1&select=*`
      );
      const plano = planos[0] || null;

      if (!registros.length || !plano) {
        return res.status(200).json({
          decisao: 'aguardando_dados',
          feedback: { tipo: 'info', mensagem: 'Registre seu peso para o sistema aprender e se adaptar.' },
          indicadores: null,
          precisao: 0
        });
      }

      const indicadores = calcularIndicadores(registros, plano);
      const decisao     = tomarDecisao(indicadores, plano);

      return res.status(200).json({
        decisao: decisao.tipo,
        ajuste:  decisao.ajuste,
        feedback: decisao.feedback,
        indicadores,
        precisao: calcularPrecisao(registros.length)
      });
    }

    return res.status(400).json({ error: `Ação inválida: ${action}` });

  } catch (err) {
    console.error('Planos error:', err);
    return res.status(500).json({ error: 'Erro interno', details: err.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FUNÇÕES DO MOTOR DE DECISÃO
// ════════════════════════════════════════════════════════════════════════════

function calcularIndicadores(registros, plano) {
  const pesos = registros.map(r => Number(r.peso));
  const datas = registros.map(r => new Date(r.criado_em));
  const n     = pesos.length;

  // Ritmo real em kg/semana
  let ritmo = 0;
  if (n >= 2) {
    const dias = (datas[0] - datas[n-1]) / (1000 * 60 * 60 * 24);
    ritmo = dias > 0 ? ((pesos[0] - pesos[n-1]) / dias) * 7 : 0;
  }

  // Meta de ritmo pelo objetivo
  const obj = (plano?.dados_form?.objetivo || '').toLowerCase();
  let ritmoMeta = 0;
  if (obj.includes('secar'))                                    ritmoMeta = -0.5;
  else if (obj.includes('músculo') || obj.includes('ganhar'))   ritmoMeta =  0.3;

  // Status
  let status = 'adequado';
  if (ritmoMeta < 0) {
    if (ritmo > ritmoMeta + 0.2)      status = 'lento';
    else if (ritmo < ritmoMeta - 0.3) status = 'rapido';
  } else if (ritmoMeta > 0) {
    if (ritmo < ritmoMeta - 0.1)      status = 'lento';
    else if (ritmo > ritmoMeta + 0.2) status = 'rapido';
  }

  // Score de adesão — registros nos últimos 7 dias
  const seteDias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const reg7d    = datas.filter(d => d >= seteDias).length;
  const scoreAdesao = Math.min(100, Math.round((reg7d / 7) * 100));

  // Score de progresso — quão próximo do ritmo ideal
  const diffRitmo    = Math.abs(ritmo - ritmoMeta);
  const scoreProgresso = Math.max(0, Math.round(100 - diffRitmo * 120));

  // Fadiga — dias consecutivos sem melhora
  let diasSemMelhora = 0;
  for (let i = 0; i < pesos.length - 1; i++) {
    const melhora = ritmoMeta < 0 ? pesos[i] < pesos[i+1] : pesos[i] > pesos[i+1];
    if (!melhora) diasSemMelhora++;
    else break;
  }
  const scoreFadiga = Math.min(100, diasSemMelhora * 15);

  return {
    ritmo:           Math.round(ritmo * 100) / 100,
    ritmoMeta,
    status,
    scoreAdesao,
    scoreProgresso,
    scoreFadiga,
    pesoAtual:       pesos[0],
    pesoInicial:     pesos[n-1],
    variacaoTotal:   Math.round((pesos[0] - pesos[n-1]) * 10) / 10,
    adesao:          scoreAdesao,
    progresso:       scoreProgresso
  };
}

function tomarDecisao(ind, plano) {
  const { status, scoreFadiga, scoreAdesao, ritmo, ritmoMeta } = ind;
  const calorias = plano?.plano_gerado?.calorias || 2000;

  // Dados insuficientes
  if (scoreAdesao < 30) {
    return {
      tipo: 'aguardando_dados',
      ajuste: null,
      feedback: {
        tipo: 'info',
        mensagem: `Registre seu peso ao menos 3x por semana para ativar o sistema adaptativo.`
      }
    };
  }

  // Refeed — fadiga alta + ritmo lento
  if (scoreFadiga >= 60 && status === 'lento') {
    return {
      tipo: 'refeed',
      ajuste: { calorias: Math.round(calorias * 1.15), duracao_dias: 2 },
      feedback: {
        tipo: 'refeed',
        mensagem: `🔄 Refeed ativado! Seu metabolismo precisa de uma pausa. Aumente as calorias por 2 dias, depois retome.`
      }
    };
  }

  // Ritmo lento → reduzir calorias
  if (status === 'lento' && ritmoMeta < 0) {
    return {
      tipo: 'ajustar_calorias',
      ajuste: { calorias: Math.round(calorias - 150), variacao: -150 },
      feedback: {
        tipo: 'ajustado',
        mensagem: `📊 Ritmo lento (${ritmo.toFixed(2)}kg/sem, meta ${ritmoMeta}kg/sem). Reduzindo 150kcal para acelerar.`
      }
    };
  }

  // Ritmo rápido → aumentar calorias
  if (status === 'rapido' && ritmoMeta < 0) {
    return {
      tipo: 'ajustar_calorias',
      ajuste: { calorias: Math.round(calorias + 100), variacao: +100 },
      feedback: {
        tipo: 'ajustado',
        mensagem: `⚠️ Perda muito rápida (${ritmo.toFixed(2)}kg/sem). Adicionando 100kcal para preservar músculo.`
      }
    };
  }

  // Tudo certo
  return {
    tipo: 'manter',
    ajuste: null,
    feedback: {
      tipo: 'mantido',
      mensagem: `✅ Plano no caminho certo! Ritmo: ${ritmo.toFixed(2)}kg/sem. Continue assim!`
    }
  };
}

function calcularPrecisao(n) {
  if (n === 0) return 0;
  if (n === 1) return 20;
  if (n <= 3)  return 40;
  if (n <= 7)  return 65;
  if (n <= 10) return 80;
  return 95;
}
