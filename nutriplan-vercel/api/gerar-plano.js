// api/gerar-plano.js — Calculadora Nutricional v2
// Lógica: Sistema calcula todos os números → IA só organiza as refeições

const GROQ_KEY = process.env.GROQ_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'nutriplan-secret-change-me';

async function hmac(msg) {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey('raw',enc.encode(JWT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Buffer.from(await globalThis.crypto.subtle.sign('HMAC',key,enc.encode(msg))).toString('base64url');
}
function b64uDec(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Buffer.from(s,'base64').toString('utf8');}
async function verificarToken(req) {
  try {
    const tok=(req.headers['authorization']||'').replace('Bearer ','');
    if(!tok) return null;
    const [h,b,sig]=tok.split('.');
    if((await hmac(h+'.'+b))!==sig) return null;
    const p=JSON.parse(b64uDec(b));
    if(p.exp&&Date.now()/1000>p.exp) return null;
    return p;
  } catch(e){return null;}
}

function calcTMB(peso, altura, idade, sexo) {
  if (sexo === 'feminino') return (10*peso)+(6.25*altura)-(5*idade)-161;
  return (10*peso)+(6.25*altura)-(5*idade)+5;
}

function fatorAtividade(atividade) {
  const f={'sedentario':1.2,'leve':1.375,'moderado':1.55,'intenso':1.725,'muito_intenso':1.9,'atleta':2.0};
  const k=Object.keys(f).find(k=>(atividade||'').toLowerCase().includes(k));
  return f[k]||1.375;
}

function ajusteObjetivo(objetivo) {
  const o=(objetivo||'').toLowerCase();
  if(o.includes('emagrecer_suave')) return {deficit:-300,prot:1.8,carb:0.40,gord:0.25,nome:'Emagrecimento Saudável'};
  if(o.includes('emagrecer')||o.includes('cutting_moderado')) return {deficit:-500,prot:2.2,carb:0.30,gord:0.20,nome:'Cutting Moderado'};
  if(o.includes('cutting_agressivo')) return {deficit:-750,prot:2.6,carb:0.20,gord:0.20,nome:'Cutting Agressivo'};
  if(o.includes('cutting_competitivo')||o.includes('peak')) return {deficit:-1000,prot:3.0,carb:0.10,gord:0.15,nome:'Cutting Competitivo'};
  if(o.includes('recomposicao')) return {deficit:-100,prot:2.2,carb:0.40,gord:0.25,nome:'Recomposição Corporal'};
  if(o.includes('manutencao')) return {deficit:0,prot:1.6,carb:0.45,gord:0.25,nome:'Manutenção'};
  if(o.includes('ganhar_suave')||o.includes('bulking_limpo')) return {deficit:+250,prot:1.8,carb:0.50,gord:0.25,nome:'Bulking Limpo'};
  if(o.includes('bulking_moderado')||o.includes('ganhar')) return {deficit:+400,prot:2.0,carb:0.55,gord:0.25,nome:'Bulking Moderado'};
  if(o.includes('bulking_agressivo')) return {deficit:+700,prot:2.2,carb:0.55,gord:0.25,nome:'Bulking Agressivo'};
  if(o.includes('atleta_resistencia')) return {deficit:+100,prot:1.6,carb:0.60,gord:0.20,nome:'Atleta Resistência'};
  if(o.includes('atleta_forca')) return {deficit:+200,prot:2.4,carb:0.45,gord:0.20,nome:'Atleta Força'};
  return {deficit:-400,prot:2.0,carb:0.35,gord:0.25,nome:'Emagrecimento Moderado'};
}

function calcMacros(kcal, protGkg, peso, carbPct, gordPct) {
  const protG=Math.round(protGkg*peso);
  const rest=kcal-(protG*4);
  const carbG=Math.round((rest*(carbPct/(carbPct+gordPct)))/4);
  const gordG=Math.round((rest*(gordPct/(carbPct+gordPct)))/9);
  return {protG,carbG,gordG,kcalReal:Math.round(protG*4+carbG*4+gordG*9)};
}

function distribuirRefeicoes(n, kcal, macros) {
  const s={3:[0.30,0.40,0.30],4:[0.25,0.30,0.20,0.25],5:[0.20,0.15,0.30,0.15,0.20],6:[0.20,0.10,0.25,0.15,0.15,0.15]};
  const nm={3:['Café da manhã','Almoço','Jantar'],4:['Café da manhã','Almoço','Lanche da tarde','Jantar'],5:['Café da manhã','Lanche manhã','Almoço','Pré-treino','Jantar'],6:['Café da manhã','Lanche manhã','Almoço','Lanche tarde','Pré-treino','Jantar']};
  const p=s[n]||s[4];
  return p.map((pct,i)=>({nome:(nm[n]||nm[4])[i],kcal:Math.round(kcal*pct),prot:Math.round(macros.protG*pct),carb:Math.round(macros.carbG*pct),gord:Math.round(macros.gordG*pct)}));
}

function precisaMultivit(macros, kcal, obj, rest) {
  const r=[];
  if(kcal<1500)r.push('dieta hipocalórica');
  if((rest||[]).length>=3)r.push('muitas restrições');
  if((obj||'').includes('cutting_competitivo')||(obj||'').includes('peak'))r.push('protocolo competitivo');
  if(macros.carbG<50)r.push('carb muito baixo');
  return r;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({error:'Método não permitido'});
  if(!GROQ_KEY) return res.status(500).json({error:'GROQ_API_KEY não configurada'});
  const auth=await verificarToken(req);
  if(!auth) return res.status(401).json({error:'Não autenticado.'});
  const d=req.body;
  if(!d||!d.peso||!d.altura) return res.status(400).json({error:'Dados incompletos'});

  const peso=Number(d.peso),altura=Number(d.altura),idade=Number(d.idade)||25;
  const tmb=calcTMB(peso,altura,idade,d.sexo);
  const tdee=Math.round(tmb*fatorAtividade(d.atividade));
  const aj=ajusteObjetivo(d.objetivo);
  const kcalMeta=Math.max(1000,tdee+aj.deficit);
  const macros=calcMacros(kcalMeta,aj.prot,peso,aj.carb,aj.gord);
  const refs=distribuirRefeicoes(Number(d.numRef)||4,kcalMeta,macros);
  const mv=precisaMultivit(macros,kcalMeta,d.objetivo,d.restricoes);
  const prem=d.plano==='premium';

  const prompt=`Você é nutricionista esportivo. APENAS organize refeições com alimentos reais brasileiros.

NÚMEROS CALCULADOS (NÃO ALTERE): TMB:${Math.round(tmb)} TDEE:${tdee} META:${kcalMeta}kcal P:${macros.protG}g C:${macros.carbG}g G:${macros.gordG}g
Objetivo: ${aj.nome}
PERFIL: ${d.nome||'Usuário'}, ${d.sexo||'masculino'}, ${idade}a, ${peso}kg, ${altura}cm, gordura:${d.gordura||'N/I'}, nível:${d.nivel||'intermediário'}
Atividade:${d.atividade||'moderada'} treino:${d.horTreino||'manhã'} restrições:${(d.restricoes||[]).join(',')||'nenhuma'} não gosta:${d.naoGosta||'nada'}
Suplementos:${(d.suplementos||[]).join(',')||'nenhum'} ergogênicos:${d.ergogenicos||'não usa'} preparo:${d.tempoPreparo||'~30min'}

DISTRIBUIÇÃO:
${refs.map((r,i)=>`${i+1}.${r.nome}: ${r.kcal}kcal P:${r.prot}g C:${r.carb}g G:${r.gord}g`).join('\n')}

REGRAS:
1.Café: SEMPRE proteína+carb+gordura. NUNCA só aveia/fruta.
2.Pré-treino: carb médio IG+proteína leve. SEM gordura.
3.Pós-treino: proteína rápida+carb simples.
4.Jantar: proteína+vegetais. Carb reduzido se secar.
5.Alimentos BRASILEIROS: arroz,feijão,frango,carne,ovo,batata-doce.
6.${prem?'PREMIUM: 2-3 OPÇÕES EQUIVALENTES por item (mesmo macros).':'ECONÔMICO: 1 alimento, baixo custo.'}
7.Quantidades em gramas/medidas caseiras.
8.NÃO invente calorias. Quantidades corretas para bater macros.
${mv.length?`9.Recomende multivitamínico: ${mv.join(', ')}.`:''}

JSON (sem markdown):
{"calorias":${kcalMeta},"proteinas":${macros.protG},"carboidratos":${macros.carbG},"gorduras":${macros.gordG},"agua_litros":${Math.round(peso*0.035*10)/10},"tmb":${Math.round(tmb)},"tdee":${tdee},"objetivo_nome":"${aj.nome}","estrategia":"texto 2 linhas","refeicoes":[{"nome":"str","hora":"HH:MM","funcao":"str","kcal_alvo":n,"prot_alvo":n,"carb_alvo":n,"gord_alvo":n,"itens":[{"alimento":"str","quantidade":"str","kcal":n,"prot":n,"carb":n,"gord":n,${prem?'"opcoes":[{"alimento":"str","quantidade":"str","kcal":n,"prot":n,"carb":n,"gord":n}],':''}"funcao":"str"}]}],"suplementos":[""],"multivitaminico":${mv.length>0},"razao_multivit":${JSON.stringify(mv)},"aerobico":"str","dicas":["x3"],"ajuste_semanal":"str"}

Gere ${Number(d.numRef)||4} refeições entre ${d.acorda||'07:00'} e ${d.dorme||'23:00'}.`;

  try {
    const resp=await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+GROQ_KEY},
      body:JSON.stringify({model:'llama-3.3-70b-versatile',temperature:0.3,max_tokens:4000,
        messages:[{role:'system',content:'Nutricionista esportivo. JSON válido apenas, sem markdown. NUNCA altere valores calculados.'},{role:'user',content:prompt}]})
    });
    if(!resp.ok){const e=await resp.text();return res.status(500).json({error:'Groq '+resp.status,details:e.substring(0,200)});}
    const data=await resp.json();
    if(data.error) throw new Error(data.error.message);
    const txt=data.choices?.[0]?.message?.content||'';
    const clean=txt.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
    let plano;
    try{plano=JSON.parse(clean);}catch(e){throw new Error('IA retornou JSON inválido');}
    plano.calorias=kcalMeta;plano.proteinas=macros.protG;plano.carboidratos=macros.carbG;plano.gorduras=macros.gordG;
    plano.tmb=Math.round(tmb);plano.tdee=tdee;plano.objetivo_nome=aj.nome;plano.agua_litros=Math.round(peso*0.035*10)/10;
    return res.status(200).json(plano);
  } catch(err) {
    console.error('Erro gerar-plano:',err.message);
    return res.status(500).json({error:'Erro ao gerar plano',details:err.message});
  }
}
