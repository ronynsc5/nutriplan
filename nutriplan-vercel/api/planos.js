// api/planos.js


const JWT_SECRET = process.env.JWT_SECRET || 'nutriplan-secret-change-me';

// HMAC-SHA256 via Node crypto — compatível com ES Module sem import
async function hmacSha256(secret, msg) {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Buffer.from(sig).toString('base64url');
}

function b64uDec(s) {
  s = s.replace(/-/g,'+').replace(/_/g,'/');
  while(s.length%4) s+='=';
  return Buffer.from(s,'base64').toString('utf8');
}

async function verificarToken(req) {
  try {
    const header = req.headers['authorization'] || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return null;
    const [h, b, sig] = token.split('.');
    const esperado = await hmacSha256(JWT_SECRET, h + '.' + b);
    if (sig !== esperado) return null;
    const payload = JSON.parse(b64uDec(b));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;

}


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

  // FIX: verificar response.ok antes de parsear
  if (!r.ok) {
    console.error(`Supabase error ${r.status} on ${method} ${path}:`, text.substring(0, 300));
    throw new Error(`Supabase ${r.status}: ${text.substring(0, 150)}`);
  }
  if (!text) return [];
  try { return JSON.parse(text); }
  catch (e) { console.error('Supa parse error:', text.substring(0, 200)); return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Auth: todas as rotas de planos exigem login ──
  const auth = await verificarToken(req);
  if (!auth) return res.status(401).json({ error: 'Não autenticado.' });

  const { action, usuario_id } = req.query;

  // Garantir que usuario_id da query bate com o token (ou é admin)
  if (usuario_id && usuario_id !== auth.sub && !auth.is_admin) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  try {

    // ── SALVAR plano gerado ──────────────────────────────────────────────────
    if (action === 'salvar' && req.method === 'POST') {
      const { usuario_id: uid, tipo, modo, dados_form, plano_gerado, expira_em } = req.body;
      if (!uid) return res.status(400).json({ error: 'usuario_id obrigatório' });

      const novo = await supa('planos', 'POST', {
        usuario_id: uid,
        tipo, modo, dados_form, plano_gerado,
        // Removido array pesos do plano — usar tabela progresso
        refeicoes_puladas: [],
        expira_em
      });

      // Descontar crédito
      try {
        const u = await supa(`usuarios?id=eq.${uid}&select=creditos`);
        if (u[0] && u[0].creditos < 999999) {
          await supa(`usuarios?id=eq.${uid}`, 'PATCH', {
            creditos: Math.max(0, u[0].creditos - 1)
          });
        }
      } catch (e) { console.warn('Erro ao descontar crédito:', e.message); }

      return res.status(200).json(novo[0] || {
        id: 'local', plano_gerado, dados_form, modo, tipo,
        refeicoes_puladas: [], expira_em
      });
    }

    // ── BUSCAR plano mais recente ────────────────────────────────────────────
    if ((action === 'buscar' || action === 'meu') && req.method === 'GET') {
      if (!usuario_id) return res.status(400).json({ error: 'usuario_id obrigatório' });
      const planos = await supa(
        `planos?usuario_id=eq.${usuario_id}&order=criado_em.desc&limit=1&select=*`
      );
      return res.status(200).json(planos || []);
    }

    // ── REFEIÇÕES PULADAS ────────────────────────────────────────────────────
    if (action === 'puladas' && req.method === 'PATCH') {
      const { id, refeicoes_puladas } = req.body;
      await supa(`planos?id=eq.${id}`, 'PATCH', { refeicoes_puladas });
      return res.status(200).json({ ok: true });
    }

    // ════════════════════════════════════════════════════════════════════════
    // MOTOR DE DECISÃO ADAPTATIVO v2
    // ════════════════════════════════════════════════════════════════════════

    if (action === 'analisar' && req.method === 'GET') {
      if (!usuario_id) return res.status(400).json({ error: 'usuario_id obrigatório' });

      // Buscar registros de peso dos últimos 14 dias
      const registros = await supa(
        `progresso?usuario_id=eq.${usuario_id}&peso=not.is.null&order=criado_em.desc&limit=20&select=peso,criado_em`
      );

      // Buscar plano atual
      const planos = await supa(
        `planos?usuario_id=eq.${usuario_id}&order=criado_em.desc&limit=1&select=*`
      );
      const plano = planos[0] || null;

      if (!registros.length || !plano) {
        return res.status(200).json({
          decisao: 'aguardando_dados',
          feedback: { tipo: 'info', mensagem: 'Registre seu peso diariamente para o sistema aprender e se adaptar ao seu metabolismo.' },
          indicadores: null,
          precisao: 0
        });
      }

      const indicadores = calcularIndicadores(registros, plano);
      const decisao     = tomarDecisao(indicadores, plano);

      return res.status(200).json({
        decisao:    decisao.tipo,
        ajuste:     decisao.ajuste,
        feedback:   decisao.feedback,
        indicadores,
        precisao:   calcularPrecisao(registros.length)
      });
    }

    return res.status(400).json({ error: `Ação inválida: ${action}` });

  } catch (err) {
    console.error('Planos error:', err);
    return res.status(500).json({ error: 'Erro interno', details: err.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CÁLCULO DE INDICADORES
// ════════════════════════════════════════════════════════════════════════════
function calcularIndicadores(registros, plano) {
  const pesos = registros.map(r => Number(r.peso));
  const datas = registros.map(r => new Date(r.criado_em));
  const n     = pesos.length;

  // Ritmo real em kg/semana (regressão linear simples)
  let ritmo = 0;
  if (n >= 2) {
    const dias = (datas[0] - datas[n-1]) / (1000 * 60 * 60 * 24);
    ritmo = dias > 0 ? ((pesos[0] - pesos[n-1]) / dias) * 7 : 0;
    ritmo = Math.round(ritmo * 100) / 100;
  }

  // Meta de ritmo pelo objetivo
  const obj = (plano?.dados_form?.objetivo || '').toLowerCase();
  let ritmoMeta = 0;
  if (obj.includes('secar'))                                  ritmoMeta = -0.5;
  else if (obj.includes('músculo') || obj.includes('ganhar')) ritmoMeta =  0.3;
  // recomposição/performance → manter peso (0)

  // Status — FIX: usar >= para capturar casos limítrofes
  let status = 'adequado';
  if (ritmoMeta < 0) {
    // Cutting: queremos número negativo (perder peso)
    if (ritmo >= ritmoMeta + 0.2)      status = 'lento';   // perdendo menos que meta
    else if (ritmo <= ritmoMeta - 0.3) status = 'rapido';  // perdendo demais
  } else if (ritmoMeta > 0) {
    // Bulking: queremos número positivo (ganhar peso)
    if (ritmo <= ritmoMeta - 0.1)      status = 'lento';   // ganhando menos que meta
    else if (ritmo >= ritmoMeta + 0.2) status = 'rapido';  // ganhando gordura demais
  }

  // Score de adesão — registros nos últimos 7 dias
  const seteDias   = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const reg7d      = datas.filter(d => d >= seteDias).length;
  const scoreAdesao = Math.min(100, Math.round((reg7d / 7) * 100));

  // Score de progresso
  const diffRitmo      = Math.abs(ritmo - ritmoMeta);
  const scoreProgresso = Math.max(0, Math.round(100 - diffRitmo * 120));

  // FIX: Fadiga melhorada — usa intervalos reais em dias entre registros
  // Exige pelo menos 4 registros nos últimos 14 dias para considerar fadiga
  const quatorze = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const reg14d   = registros.filter(r => new Date(r.criado_em) >= quatorze);
  let scoreFadiga = 0;
  if (reg14d.length >= 4) {
    let diasSemMelhora = 0;
    for (let i = 0; i < Math.min(pesos.length - 1, 7); i++) {
      // Calcular intervalo real em dias entre este e o próximo registro
      const diffDias = (datas[i+1] - datas[i]) / (1000 * 60 * 60 * 24); // negativo pois desc
      const melhora = ritmoMeta <= 0
        ? pesos[i] < pesos[i+1]   // cutting: peso caindo é melhora
        : pesos[i] > pesos[i+1];  // bulking: peso subindo é melhora
      if (!melhora) diasSemMelhora += Math.abs(diffDias);
      else break;
    }
    // Fadiga significativa a partir de 7 dias sem melhora
    scoreFadiga = Math.min(100, Math.round((diasSemMelhora / 7) * 60));
  }

  return {
    ritmo,
    ritmoMeta,
    status,
    scoreAdesao,
    scoreProgresso,
    scoreFadiga,
    pesoAtual:     pesos[0],
    pesoInicial:   pesos[n-1],
    variacaoTotal: Math.round((pesos[0] - pesos[n-1]) * 10) / 10,
    adesao:        scoreAdesao,
    progresso:     scoreProgresso
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TOMADA DE DECISÃO — suporte a cutting E bulking
// ════════════════════════════════════════════════════════════════════════════
function tomarDecisao(ind, plano) {
  const { status, scoreFadiga, scoreAdesao, ritmo, ritmoMeta } = ind;
  const calorias = plano?.plano_gerado?.calorias || 2000;

  // FIX: limiar mais alto — exige adesão mínima real (50% = ~3,5 registros/semana)
  if (scoreAdesao < 50) {
    return {
      tipo: 'aguardando_dados',
      ajuste: null,
      feedback: {
        tipo: 'info',
        mensagem: `Registre seu peso ao menos 4x por semana para ativar o sistema adaptativo (${ind.adesao}% de adesão atual).`
      }
    };
  }

  // FIX: ajuste percentual em vez de valor fixo
  const ajusteReducao  = Math.round(calorias * 0.06); // -6%
  const ajusteAumento  = Math.round(calorias * 0.05); // +5%
  const ajusteRefeed   = Math.round(calorias * 0.15); // +15%

  // Refeed — fadiga alta + ritmo lento (só faz sentido em cutting)
  if (scoreFadiga >= 60 && status === 'lento' && ritmoMeta < 0) {
    return {
      tipo: 'refeed',
      ajuste: { calorias: calorias + ajusteRefeed, duracao_dias: 2 },
      feedback: {
        tipo: 'refeed',
        mensagem: `🔄 Refeed ativado! Seu metabolismo desacelerou. Aumente para ${calorias + ajusteRefeed}kcal por 2 dias, depois retome o déficit.`
      }
    };
  }

  // ── CUTTING (ritmoMeta < 0) ──────────────────────────────────────────────
  if (ritmoMeta < 0) {
    if (status === 'lento') {
      return {
        tipo: 'ajustar_calorias',
        ajuste: { calorias: calorias - ajusteReducao, variacao: -ajusteReducao },
        feedback: {
          tipo: 'ajustado',
          mensagem: `📊 Ritmo lento (${ritmo.toFixed(2)}kg/sem, meta ${ritmoMeta}kg/sem). Reduzindo ${ajusteReducao}kcal → ${calorias - ajusteReducao}kcal.`
        }
      };
    }
    if (status === 'rapido') {
      return {
        tipo: 'ajustar_calorias',
        ajuste: { calorias: calorias + ajusteAumento, variacao: +ajusteAumento },
        feedback: {
          tipo: 'ajustado',
          mensagem: `⚠️ Perda muito rápida (${ritmo.toFixed(2)}kg/sem). Adicionando ${ajusteAumento}kcal → ${calorias + ajusteAumento}kcal para preservar músculo.`
        }
      };
    }
  }

  // ── BULKING (ritmoMeta > 0) — FIX: agora funciona ───────────────────────
  if (ritmoMeta > 0) {
    if (status === 'lento') {
      return {
        tipo: 'ajustar_calorias',
        ajuste: { calorias: calorias + ajusteAumento, variacao: +ajusteAumento },
        feedback: {
          tipo: 'ajustado',
          mensagem: `📊 Ganho lento (${ritmo.toFixed(2)}kg/sem, meta ${ritmoMeta}kg/sem). Aumentando ${ajusteAumento}kcal → ${calorias + ajusteAumento}kcal.`
        }
      };
    }
    if (status === 'rapido') {
      return {
        tipo: 'ajustar_calorias',
        ajuste: { calorias: calorias - ajusteReducao, variacao: -ajusteReducao },
        feedback: {
          tipo: 'ajustado',
          mensagem: `⚠️ Ganho rápido demais (${ritmo.toFixed(2)}kg/sem). Reduzindo ${ajusteReducao}kcal → ${calorias - ajusteReducao}kcal para minimizar gordura.`
        }
      };
    }
  }

  // Adequado — manter
  return {
    tipo: 'manter',
    ajuste: null,
    feedback: {
      tipo: 'mantido',
      mensagem: `✅ Plano no caminho certo! Ritmo: ${ritmo.toFixed(2)}kg/sem (meta: ${ritmoMeta}kg/sem). Continue assim!`
    }
  };
}

function calcularPrecisao(n) {
  if (n === 0)  return 0;
  if (n === 1)  return 15;
  if (n <= 3)   return 35;
  if (n <= 7)   return 60;
  if (n <= 10)  return 80;
  return 95;
}
