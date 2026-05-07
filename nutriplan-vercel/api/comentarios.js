// api/comentarios.js
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;

async function supa(path, method='GET', body=null) {
  const opts = { method, headers: {
    'Content-Type':'application/json',
    'apikey':SUPA_KEY,
    'Authorization':`Bearer ${SUPA_KEY}`,
    'Prefer':method==='POST'?'return=representation':'return=minimal'
  }};
  if(body) opts.body=JSON.stringify(body);
  const r=await fetch(`${SUPA_URL}/rest/v1/${path}`,opts);
  const t=await r.text();
  if(!t) return [];
  try{return JSON.parse(t);}catch(e){return [];}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(200).end();

  const {action} = req.query;

  try {
    if(action==='salvar' && req.method==='POST') {
      const {usuario_id, nome, texto} = req.body;
      const progresso_id = req.body.progresso_id || req.body.post_id;
      if(!usuario_id || !nome || !texto || !progresso_id)
        return res.status(400).json({error:'Campos obrigatórios: usuario_id, nome, texto, progresso_id'});
      const novo = await supa('comentarios','POST',{
        progresso_id, usuario_id, nome, texto,
        criado_em: new Date().toISOString()
      });
      return res.status(200).json(novo[0]||{ok:true});
    }

    if(action==='buscar' && req.method==='GET') {
      const {progresso_id, post_id} = req.query;
      const pid = progresso_id || post_id;
      if(!pid) return res.status(400).json({error:'progresso_id obrigatório'});
      const coms = await supa(`comentarios?progresso_id=eq.${pid}&order=criado_em.asc&select=*`);
      return res.status(200).json(coms||[]);
    }

    if(action==='deletar' && req.method==='DELETE') {
      const {id, usuario_id} = req.body;
      await supa(`comentarios?id=eq.${id}&usuario_id=eq.${usuario_id}`,'DELETE');
      return res.status(200).json({ok:true});
    }

    return res.status(400).json({error:`Ação inválida: ${action}`});
  } catch(err) {
    console.error('Comentarios error:',err);
    return res.status(500).json({error:'Erro interno',details:err.message});
  }
}
