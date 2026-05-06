// api/gerar-plano.js — Groq + Auth JWT


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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_API_KEY não configurada no Vercel' });

  const d = req.body;
  if (!d) return res.status(400).json({ error: 'Body vazio' });

  // Normalizar campos — aceita tanto os nomes novos quanto os antigos
  const peso   = Number(d.peso)   || 75;
  const altura = Number(d.altura) || 170;
  const idade  = Number(d.idade)  || 25;
  const numRef = Number(d.numRef || d.refeicoes) || 4;
  const horTreino    = d.horTreino    || d.htreino    || 'Manhã';
  const tempoPreparo = d.tempoPreparo || d.tempo      || '~30min';
  const naoGosta     = d.naoGosta     || d.nao_gosta  || 'nada';
  const saude        = d.saude        || 'nenhuma';
  const treinos      = Array.isArray(d.treinos) ? d.treinos.join(', ') : (d.treino || 'Não treino');
  const restricoes   = Array.isArray(d.restricoes) ? d.restricoes.join(', ') : (d.restricoes || 'Nenhuma');

  const hc   = d.modo === 'hardcore';
  const prem = d.plano === 'premium';
  const tmb  = calcTMB({ ...d, peso, altura, idade });

  const prompt = `Você é especialista em nutrição esportiva. Crie um plano alimentar PERSONALIZADO.

PACIENTE: ${d.nome||'Usuário'}|${d.sexo||'masculino'}|${idade}a|${peso}kg|${altura}cm|gordura:${d.gordura||'Não sei'}
OBJETIVO: ${d.objetivo||'Secar'}|atividade:${d.atividade||'Levemente ativo'}|treinos:${treinos}|horTreino:${horTreino}
RESTRIÇÕES: ${restricoes}|naoGosta:${naoGosta}|saude:${saude}
ROTINA: ${d.acorda||'07:00'}→${d.dorme||'23:00'}|${numRef} refeições|preparo:${tempoPreparo}
MODO: ${hc?'HARDCORE':'SAUDÁVEL'} | PLANO: ${prem?'PREMIUM(salmão,quinoa,whey,ovos caipiras,aveia,batata-doce)':'ECONÔMICO(arroz,feijão,frango,ovos,atum,banana)'}
TDEE: ~${tmb}kcal

${hc
  ? `HARDCORE: Déficit 500-700kcal(secar)/superávit 400-500kcal(ganhar). Proteína 2.4-3.0g/kg. Carbo SOMENTE peri-treino. Hidratação ${Math.round(peso*40)}ml/dia.`
  : `SAUDÁVEL: Déficit 300-400kcal(secar)/superávit 200kcal(ganhar). Proteína 1.6-2.0g/kg. Carbo distribuído. Aeróbico 3-4x/sem.`
}

Responda APENAS com JSON válido, sem markdown, sem explicações:
{"calorias":n,"proteinas":n,"carboidratos":n,"gorduras":n,"agua_litros":n,"estrategia":"texto","modo":"str","refeicoes":[{"nome":"str","hora":"HH:MM","funcao":"str","calorias_estimadas":n,"itens":[{"alimento":"str","quantidade":"str","funcao":"str"}]}],"suplementos":[""],"termogenicos":[""],"ciclos":[""],"multivitaminico":true,"aerobico":"str","principios":["x5"],"dicas_performance":["x3"],"ajuste_semanal":"str"}

GERE EXATAMENTE ${numRef} refeições entre ${d.acorda||'07:00'} e ${d.dorme||'23:00'}. Seja específico e personalizado.`;

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.7,
        max_tokens: 4000,
        messages: [
          {
            role: 'system',
            content: 'Você é um nutricionista esportivo especializado. Responda SEMPRE apenas com JSON válido, sem markdown, sem texto adicional.'
          },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Groq HTTP error:', resp.status, errText);
      return res.status(500).json({ error: `Groq retornou ${resp.status}`, details: errText.substring(0, 200) });
    }

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

    const txt = data.choices?.[0]?.message?.content || '';
    if (!txt) throw new Error('Groq retornou resposta vazia');

    // Limpar markdown se houver
    const clean = txt.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    let plano;
    try {
      plano = JSON.parse(clean);
    } catch (parseErr) {
      console.error('JSON parse error. Raw txt:', txt.substring(0, 300));
      throw new Error('Resposta da IA não é JSON válido: ' + parseErr.message);
    }

    // Salvar no banco via progresso (opcional — só registra uso)
    return res.status(200).json(plano);

  } catch (err) {
    console.error('Erro gerar-plano:', err.message);
    return res.status(500).json({ error: 'Erro ao gerar plano', details: err.message });
  }
}

function calcTMB(d) {
  const peso   = Number(d.peso)   || 75;
  const altura = Number(d.altura) || 170;
  const idade  = Number(d.idade)  || 25;

  let tmb = d.sexo === 'feminino'
    ? 655 + (9.6 * peso) + (1.8 * altura) - (4.7 * idade)
    : 66  + (13.7 * peso) + (5 * altura)  - (6.8 * idade);

  const fat = {
    'Sedentário': 1.2,
    'Levemente':  1.375,
    'Moderado':   1.55,
    'Muito':      1.725,
    'Atleta':     1.9
  };
  const k = Object.keys(fat).find(k => d.atividade && d.atividade.startsWith(k)) || 'Levemente';
  tmb *= fat[k];

  const obj = (d.objetivo || '').toLowerCase();
  if (obj.includes('secar'))                              tmb -= 400;
  else if (obj.includes('músculo') || obj.includes('ganhar')) tmb += 300;

  return Math.round(tmb);
}
