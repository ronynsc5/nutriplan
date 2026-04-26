// api/gerar-plano.js — Groq (ultra rápido e gratuito)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'API key não configurada' });

  const d = req.body;
  if (!d || !d.peso || !d.altura) return res.status(400).json({ error: 'Dados incompletos' });

  const hc = d.modo === 'hardcore';
  const prem = d.plano === 'premium';
  const tmb = calcTMB(d);

  const prompt = `Você é especialista em nutrição esportiva. Crie um plano alimentar PERSONALIZADO.

PACIENTE: ${d.nome}|${d.sexo}|${d.idade}a|${d.peso}kg|${d.altura}cm|gordura:${d.gordura}
OBJETIVO: ${d.objetivo}|atividade:${d.atividade}|treinos:${(d.treinos||[]).join(',')}|horTreino:${d.horTreino}
RESTRIÇÕES: ${(d.restricoes||[]).join(',')}|naoGosta:${d.naoGosta||'nada'}|saude:${d.saude||'nenhuma'}
ROTINA: ${d.acorda}→${d.dorme}|${d.numRef} refeições|preparo:${d.tempoPreparo}
MODO: ${hc?'HARDCORE':'SAUDÁVEL'} | PLANO: ${prem?'PREMIUM(salmão,quinoa,whey,ovos caipiras,aveia,batata-doce)':'ECONÔMICO(arroz,feijão,frango,ovos,atum,banana)'}
TDEE: ~${tmb}kcal

${hc?`HARDCORE: Déficit 500-700kcal(secar)/superávit 400-500kcal(ganhar). Proteína 2.4-3.0g/kg. Carbo SOMENTE peri-treino. Termogênicos em jejum. Hidratação ${Math.round(d.peso*40)}ml/dia. Multivitamínico OBRIGATÓRIO.`:`SAUDÁVEL: Déficit 300-400kcal(secar)/superávit 200kcal(ganhar). Proteína 1.6-2.0g/kg. Carbo distribuído. Aeróbico 3-4x/sem.`}

Responda APENAS com JSON válido, sem markdown, sem explicações:
{"calorias":n,"proteinas":n,"carboidratos":n,"gorduras":n,"agua_litros":n,"estrategia":"texto","modo":"str","refeicoes":[{"nome":"str","hora":"HH:MM","funcao":"str","calorias_estimadas":n,"itens":[{"alimento":"str","quantidade":"str","funcao":"str"}]}],"suplementos":[""],"termogenicos":[""],"ciclos":[""],"multivitaminico":bool,"aerobico":"str","principios":["x5"],"dicas_performance":["x3"],"ajuste_semanal":"str"}

GERE EXATAMENTE ${d.numRef} refeições entre ${d.acorda} e ${d.dorme}. Seja específico e personalizado.`;

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
          { role: 'system', content: 'Você é um nutricionista esportivo especializado. Responda SEMPRE apenas com JSON válido, sem markdown, sem texto adicional.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);

    const txt = data.choices?.[0]?.message?.content || '';
    const clean = txt.replace(/```json|```/g, '').trim();
    const plano = JSON.parse(clean);
    return res.status(200).json(plano);
  } catch (err) {
    console.error('Erro Groq:', err.message);
    return res.status(500).json({ error: 'Erro ao gerar plano', details: err.message });
  }
}

function calcTMB(d) {
  let tmb = d.sexo === 'feminino'
    ? 655 + (9.6 * d.peso) + (1.8 * d.altura) - (4.7 * d.idade)
    : 66 + (13.7 * d.peso) + (5 * d.altura) - (6.8 * d.idade);
  const fat = { 'Sedentário': 1.2, 'Levemente': 1.375, 'Moderado': 1.55, 'Muito': 1.725, 'Atleta': 1.9 };
  const k = Object.keys(fat).find(k => d.atividade && d.atividade.startsWith(k)) || 'Levemente';
  tmb *= fat[k];
  const obj = (d.objetivo || '').toLowerCase();
  if (obj.includes('secar')) tmb -= 400;
  else if (obj.includes('músculo') || obj.includes('ganhar')) tmb += 300;
  return Math.round(tmb);
}
