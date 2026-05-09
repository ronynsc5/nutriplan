// api/planos.js
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'nutriplan-secret-change-me';

async function hmac(msg) {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey('raw',enc.encode(JWT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Buffer.from(await globalThis.crypto.subtle.sign('HMAC',key,enc.encode(msg))).toString('base64url');
}
function b64uDec(s) {
  s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';
  return Buffer.from(s,'base64').toString('utf8');
}
async function verificarToken(req) {
  try {
    const tok=(req.headers['authorization']||'').replace('Bearer ','');
    if(!tok) return null;
    const [h,b,sig]=tok.split('.');
    if((await hmac(h+'.'+b))!==sig) return null;
    const p=JSON.parse(b64uDec(b));
    if(p.exp&&Date.now()/1000>p.exp) return null;
    return p;
  }catch(e){return null;}
}
async function supa(path,method='GET',body=null) {
  const opts={method,headers:{'Content-Type':'application/json','apikey':SUPA_KEY,'Authorization':`Bearer ${SUPA_KEY}`,'Prefer':method==='POST'?'return=representation':'return=minimal'}};
  if(body) opts.body=JSON.stringify(body);
  const r=await fetch(`${SUPA_URL}/rest/v1/${path}`,opts);
  const t=await r.text();
  if(!r.ok) console.error(`Supabase ${r.status}`,t.substring(0,200));
  if(!t) return [];
  try{return JSON.parse(t);}catch(e){return [];}
}

export default async function handler(req,res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(200).end();
  const auth=await verificarToken(req);
  if(!auth) return res.status(401).json({error:'Não autenticado.'});
  const {action,usuario_id}=req.query;
  if(usuario_id&&usuario_id!==auth.sub&&!auth.is_admin) return res.status(403).json({error:'Acesso negado.'});
  try {
    if(action==='salvar'&&req.method==='POST') {
      const {usuario_id:uid,tipo,modo,dados_form,plano_gerado,expira_em}=req.body;
      const novo=await supa('planos','POST',{usuario_id:uid,tipo,modo,dados_form,plano_gerado,refeicoes_puladas:[],expira_em});
      try{const u=await supa(`usuarios?id=eq.${uid}&select=creditos`);if(u[0]&&u[0].creditos<999999)await supa(`usuarios?id=eq.${uid}`,'PATCH',{creditos:Math.max(0,u[0].creditos-1)});}catch(e){}
      
      // 🆕 Notifica n8n sobre plano criado
      try {
        const usuario = await supa(`usuarios?id=eq.${uid}&select=nome,wpp`);
        const horarios = plano_gerado?.refeicoes?.map(r => ({nome: r.nome, hora: r.hora})) || [];
        await fetch('https://cheatinglanternfish-n8n.cloudfy.live/webhook/5acbbf43-ed70-4111-9049-b88bca8370a9', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            evento: 'PLANO_CRIADO',
            usuario_id: uid,
            plano_id: novo[0]?.id || 'local',
            nome: usuario[0]?.nome || 'Usuário',
            wpp: usuario[0]?.wpp,
            tipo: tipo,
            modo: modo,
            horarios: horarios,
            expira_em: expira_em,
            link_plano: `https://nutriplan.app/plano/${novo[0]?.id || 'local'}`
          })
        });
      } catch(e) { console.error('Erro n8n:',e.message); }
      
      return res.status(200).json(novo[0]||{id:'local',plano_gerado,dados_form,modo,tipo,expira_em});
    }
    if((action==='buscar'||action==='meu')&&req.method==='GET') {
      if(!usuario_id) return res.status(400).json({error:'usuario_id obrigatório'});
      return res.status(200).json(await supa(`planos?usuario_id=eq.${usuario_id}&order=criado_em.desc&limit=1&select=*`)||[]);
    }
    if(action==='puladas'&&req.method==='PATCH') {
      const {id,refeicoes_puladas}=req.body;
      await supa(`planos?id=eq.${id}`,'PATCH',{refeicoes_puladas});
      return res.status(200).json({ok:true});
    }
    if(action==='analisar'&&req.method==='GET') {
      if(!usuario_id) return res.status(400).json({error:'usuario_id obrigatório'});
      const registros=await supa(`progresso?usuario_id=eq.${usuario_id}&peso=not.is.null&order=criado_em.desc&limit=20&select=peso,criado_em`);
      const planos=await supa(`planos?usuario_id=eq.${usuario_id}&order=criado_em.desc&limit=1&select=*`);
      const plano=planos[0]||null;
      if(!registros.length||!plano) return res.status(200).json({decisao:'aguardando_dados',feedback:{tipo:'info',mensagem:'Registre seu peso diariamente para o sistema aprender.'},indicadores:null,precisao:0});
      const ind=calcularIndicadores(registros,plano);
      const dec=tomarDecisao(ind,plano);
      return res.status(200).json({decisao:dec.tipo,ajuste:dec.ajuste,feedback:dec.feedback,indicadores:ind,precisao:calcularPrecisao(registros.length)});
    }
    return res.status(400).json({error:`Ação inválida: ${action}`});
  }catch(err){console.error('Planos error:',err);return res.status(500).json({error:'Erro interno',details:err.message});}
}

function calcularIndicadores(registros,plano) {
  const pesos=registros.map(r=>Number(r.peso));
  const datas=registros.map(r=>new Date(r.criado_em));
  const n=pesos.length;
  let ritmo=0;
  if(n>=2){const dias=(datas[0]-datas[n-1])/(1000*60*60*24);ritmo=dias>0?((pesos[0]-pesos[n-1])/dias)*7:0;ritmo=Math.round(ritmo*100)/100;}
  const obj=(plano?.dados_form?.objetivo||'').toLowerCase();
  let ritmoMeta=0;
  if(obj.includes('secar'))ritmoMeta=-0.5;
  else if(obj.includes('músculo')||obj.includes('ganhar'))ritmoMeta=0.3;
  let status='adequado';
  if(ritmoMeta<0){if(ritmo>=ritmoMeta+0.2)status='lento';else if(ritmo<=ritmoMeta-0.3)status='rapido';}
  else if(ritmoMeta>0){if(ritmo<=ritmoMeta-0.1)status='lento';else if(ritmo>=ritmoMeta+0.2)status='rapido';}
  const seteDias=new Date(Date.now()-7*24*60*60*1000);
  const scoreAdesao=Math.min(100,Math.round((datas.filter(d=>d>=seteDias).length/7)*100));
  const scoreProgresso=Math.max(0,Math.round(100-Math.abs(ritmo-ritmoMeta)*120));
  const q14=new Date(Date.now()-14*24*60*60*1000);
  let scoreFadiga=0;
  if(registros.filter(r=>new Date(r.criado_em)>=q14).length>=4){
    let dias=0;
    for(let i=0;i<Math.min(n-1,7);i++){const m=ritmoMeta<=0?pesos[i]<pesos[i+1]:pesos[i]>pesos[i+1];if(!m)dias+=Math.abs((datas[i+1]-datas[i])/(1000*60*60*24));else break;}
    scoreFadiga=Math.min(100,Math.round((dias/7)*60));
  }
  return {ritmo,ritmoMeta,status,scoreAdesao,scoreProgresso,scoreFadiga,pesoAtual:pesos[0],pesoInicial:pesos[n-1],variacaoTotal:Math.round((pesos[0]-pesos[n-1])*10)/10,adesao:scoreAdesao,progresso:scoreProgresso};
}

function tomarDecisao(ind,plano) {
  const {status,scoreFadiga,scoreAdesao,ritmo,ritmoMeta}=ind;
  const cal=plano?.plano_gerado?.calorias||2000;
  const red=Math.round(cal*0.06),aum=Math.round(cal*0.05),ref=Math.round(cal*0.15);
  if(scoreAdesao<50) return {tipo:'aguardando_dados',ajuste:null,feedback:{tipo:'info',mensagem:`Registre seu peso ao menos 4x por semana (${ind.adesao}% atual).`}};
  if(scoreFadiga>=60&&status==='lento'&&ritmoMeta<0) return {tipo:'refeed',ajuste:{calorias:cal+ref,duracao_dias:2},feedback:{tipo:'refeed',mensagem:`🔄 Refeed ativado! Aumente para ${cal+ref}kcal por 2 dias.`}};
  if(ritmoMeta<0){
    if(status==='lento') return {tipo:'ajustar_calorias',ajuste:{calorias:cal-red,variacao:-red},feedback:{tipo:'ajustado',mensagem:`📊 Ritmo lento (${ritmo.toFixed(2)}kg/sem). Reduzindo ${red}kcal → ${cal-red}kcal.`}};
    if(status==='rapido') return {tipo:'ajustar_calorias',ajuste:{calorias:cal+aum,variacao:+aum},feedback:{tipo:'ajustado',mensagem:`⚠️ Perda rápida. Adicionando ${aum}kcal → ${cal+aum}kcal.`}};
  }
  if(ritmoMeta>0){
    if(status==='lento') return {tipo:'ajustar_calorias',ajuste:{calorias:cal+aum,variacao:+aum},feedback:{tipo:'ajustado',mensagem:`📊 Ganho lento. Aumentando ${aum}kcal → ${cal+aum}kcal.`}};
    if(status==='rapido') return {tipo:'ajustar_calorias',ajuste:{calorias:cal-red,variacao:-red},feedback:{tipo:'ajustado',mensagem:`⚠️ Ganho rápido. Reduzindo ${red}kcal → ${cal-red}kcal.`}};
  }
  return {tipo:'manter',ajuste:null,feedback:{tipo:'mantido',mensagem:`✅ Ritmo ideal: ${ritmo.toFixed(2)}kg/sem. Continue!`}};
}

function calcularPrecisao(n){if(n===0)return 0;if(n<=3)return 35;if(n<=7)return 60;if(n<=10)return 80;return 95;}
