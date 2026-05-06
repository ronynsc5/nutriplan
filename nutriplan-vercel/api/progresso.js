// api/progresso.js
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'nutriplan-secret-change-me';

async function hmac(msg) {
  const enc=new TextEncoder();
  const key=await globalThis.crypto.subtle.importKey('raw',enc.encode(JWT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
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
  }catch(e){return null;}
}
async function supa(path,method='GET',body=null) {
  const opts={method,headers:{'Content-Type':'application/json','apikey':SUPA_KEY,'Authorization':`Bearer ${SUPA_KEY}`,'Prefer':method==='POST'?'return=representation':'return=minimal'}};
  if(body) opts.body=JSON.stringify(body);
  const r=await fetch(`${SUPA_URL}/rest/v1/${path}`,opts);
  const t=await r.text();
  if(!t) return [];
  try{return JSON.parse(t);}catch(e){return [];}
}

export default async function handler(req,res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(200).end();
  const action=req.query.action;
  const usuario_id=req.query.usuario_id||req.body?.usuario_id;
  const PUBLICAS=['feed'];
  if(!PUBLICAS.includes(action)) {
    const auth=await verificarToken(req);
    if(!auth) return res.status(401).json({error:'Não autenticado.'});
    const uid=usuario_id;
    if(uid&&uid!==auth.sub&&!auth.is_admin) return res.status(403).json({error:'Acesso negado.'});
  }
  try {
    if(action==='salvar'&&req.method==='POST') {
      const {usuario_id:uid,nome,tipo,conteudo,publico,foto_url,peso,nota,foto_antes,foto_depois}=req.body;
      if(!uid) return res.status(400).json({error:'usuario_id obrigatório'});
      let nomeU=nome||null;
      if(!nomeU){try{const u=await supa(`usuarios?id=eq.${uid}&select=nome`);nomeU=u[0]?.nome||'Usuário';}catch(e){nomeU='Usuário';}}
      const novo=await supa('progresso','POST',{usuario_id:uid,nome:nomeU,tipo:tipo||'progresso',conteudo:conteudo||null,publico:publico??false,foto_url:foto_url||null,peso:peso?Number(peso):null,nota:nota||null,foto_antes:foto_antes||null,foto_depois:foto_depois||null});
      return res.status(200).json(novo[0]||{ok:true});
    }
    if(action==='meu'&&req.method==='GET') {
      if(!usuario_id) return res.status(400).json({error:'usuario_id obrigatório'});
      return res.status(200).json(await supa(`progresso?usuario_id=eq.${usuario_id}&order=criado_em.desc&select=*`)||[]);
    }
    if(action==='feed'&&req.method==='GET') {
      const p=await supa('progresso?publico=eq.true&order=criado_em.desc&limit=50&select=*');
      const semNome=(p||[]).filter(x=>!x.nome);
      if(semNome.length>0) {
        const ids=[...new Set(semNome.map(x=>x.usuario_id))];
        const us=await supa(`usuarios?id=in.(${ids.join(',')})&select=id,nome`).catch(()=>[]);
        const map={};us.forEach(u=>{map[u.id]=u.nome;});
        p.forEach(x=>{if(!x.nome)x.nome=map[x.usuario_id]||'Usuário';});
      }
      return res.status(200).json(p||[]);
    }
    if(action==='deletar'&&req.method==='DELETE') {
      const id=req.query.id||req.body?.id;
      const uid=req.query.uid||req.body?.usuario_id;
      if(!id||!uid) return res.status(400).json({error:'id e usuario_id obrigatórios'});
      await supa(`progresso?id=eq.${id}&usuario_id=eq.${uid}`,'DELETE');
      return res.status(200).json({ok:true});
    }
    if(action==='visibilidade'&&req.method==='PATCH') {
      const id=req.query.id||req.body?.id;
      const uid=req.query.uid||req.body?.usuario_id;
      if(!id||!uid) return res.status(400).json({error:'id e usuario_id obrigatórios'});
      await supa(`progresso?id=eq.${id}&usuario_id=eq.${uid}`,'PATCH',{publico:req.body?.publico});
      return res.status(200).json({ok:true});
    }
    if(action==='conquistas'&&req.method==='GET') {
      if(!usuario_id) return res.status(400).json({error:'usuario_id obrigatório'});
      const todos=await supa(`progresso?usuario_id=eq.${usuario_id}&order=criado_em.asc&select=*`);
      return res.status(200).json(calcularConquistas(todos||[]));
    }
    if(action==='ritmo'&&req.method==='GET') {
      if(!usuario_id) return res.status(400).json({error:'usuario_id obrigatório'});
      const reg=await supa(`progresso?usuario_id=eq.${usuario_id}&peso=not.is.null&order=criado_em.desc&limit=14&select=peso,criado_em`);
      if(reg.length<2) return res.status(200).json({ritmo:null,registros:reg.length});
      const pesos=reg.map(r=>Number(r.peso)),datas=reg.map(r=>new Date(r.criado_em)),n=pesos.length;
      const dias=(datas[0]-datas[n-1])/(1000*60*60*24);
      return res.status(200).json({ritmo:Math.round(((pesos[0]-pesos[n-1])/dias)*7*100)/100,pesoAtual:pesos[0],pesoInicial:pesos[n-1],variacao:Math.round((pesos[0]-pesos[n-1])*10)/10,registros:n});
    }
    return res.status(400).json({error:`Ação inválida: ${action}`});
  }catch(err){console.error('Progresso error:',err);return res.status(500).json({error:'Erro interno',details:err.message});}
}

function calcularConquistas(todos) {
  const comPeso=todos.filter(p=>p.peso),fotos=todos.filter(p=>p.foto_url),adps=todos.filter(p=>p.tipo==='antes_depois'),pub=todos.filter(p=>p.publico);
  const pI=comPeso.length>0?Number(comPeso[0].peso):null,pA=comPeso.length>0?Number(comPeso[comPeso.length-1].peso):null;
  const vKg=pI&&pA?pI-pA:0;
  let dias=0;const hoje=new Date();hoje.setHours(0,0,0,0);
  for(let i=0;i<7;i++){const d=new Date(hoje);d.setDate(d.getDate()-i);const ds=d.toISOString().slice(0,10);if(todos.some(p=>p.criado_em&&p.criado_em.slice(0,10)===ds))dias++;else if(i>0)break;}
  return [
    {id:'primeiro-peso',nome:'Primeira medição',desc:'Registre seu peso pela primeira vez',icone:'⚖️',desbloqueada:comPeso.length>=1,progresso:Math.min(1,comPeso.length),total:1,label:'1'},
    {id:'semana-completa',nome:'Semana completa',desc:'7 dias consecutivos de atividade',icone:'📅',desbloqueada:dias>=7,progresso:dias,total:7,label:'7 dias'},
    {id:'primeiro-kilo',nome:'Primeiro quilo',desc:'Perca 1kg em relação ao início',icone:'🔥',desbloqueada:vKg>=1,progresso:Math.min(1,Math.max(0,vKg)),total:1,label:'1kg'},
    {id:'cinco-kilos',nome:'Cinco quilos',desc:'Perca 5kg em relação ao início',icone:'💪',desbloqueada:vKg>=5,progresso:Math.min(5,Math.max(0,vKg)),total:5,label:'5kg'},
    {id:'antes-depois',nome:'Transformação',desc:'Publique seu primeiro antes & depois',icone:'✨',desbloqueada:adps.length>=1,progresso:Math.min(1,adps.length),total:1,label:'1'},
    {id:'comunidade',nome:'Membro da comunidade',desc:'Publique no feed público',icone:'🌍',desbloqueada:pub.length>=1,progresso:Math.min(1,pub.length),total:1,label:'1'},
    {id:'dez-fotos',nome:'Álbum fitness',desc:'Registre 10 fotos de progresso',icone:'📸',desbloqueada:fotos.length>=10,progresso:Math.min(10,fotos.length),total:10,label:'10 fotos'}
  ];
}
