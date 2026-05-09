// api/usuarios.js
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'nutriplan-secret-change-me';

async function hmac(msg) {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw', enc.encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const buf = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Buffer.from(buf).toString('base64url');
}
function b64u(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function b64uDec(s) {
  s = s.replace(/-/g,'+').replace(/_/g,'/');
  while(s.length%4) s+='=';
  return Buffer.from(s,'base64').toString('utf8');
}
async function gerarToken(u) {
  const h = b64u(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const b = b64u(JSON.stringify({sub:u.id,email:u.email,is_admin:u.is_admin||false,exp:Math.floor(Date.now()/1000)+60*60*24*30}));
  return h+'.'+b+'.'+(await hmac(h+'.'+b));
}
async function verificarToken(req) {
  try {
    const h = (req.headers['authorization']||'');
    const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
    if(!tok) return null;
    const [hh,b,sig] = tok.split('.');
    if((await hmac(hh+'.'+b))!==sig) return null;
    const p = JSON.parse(b64uDec(b));
    if(p.exp && Date.now()/1000>p.exp) return null;
    return p;
  } catch(e){ return null; }
}

async function supa(path, method='GET', body=null) {
  const opts = { method, headers: {
    'Content-Type':'application/json',
    'apikey':SUPA_KEY,
    'Authorization':`Bearer ${SUPA_KEY}`,
    'Prefer':method==='POST'?'return=representation':'return=minimal'
  }};
  if(body) opts.body=JSON.stringify(body);
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, opts);
  const t = await r.text();
  if(!r.ok && method!=='PATCH' && method!=='DELETE') throw new Error(`Supabase ${r.status}`);
  if(!t) return [];
  try{ return JSON.parse(t); }catch(e){ return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(200).end();
  const { action } = req.query;
  try {
    if(action==='cadastrar' && req.method==='POST') {
      const {nome,email,senha,wpp} = req.body;
      if(!nome||!email||!senha) return res.status(400).json({error:'Campos obrigatórios faltando'});
      const existe = await supa(`usuarios?email=eq.${encodeURIComponent(email)}&select=id`);
      if(existe.length>0) return res.status(400).json({error:'Email já cadastrado'});
      const novo = await supa('usuarios','POST',{nome,email,senha,wpp:wpp||null,creditos:0,is_admin:false});
      if(!novo[0]) return res.status(500).json({error:'Erro ao criar conta'});
      
      // 🆕 Notifica n8n sobre novo cadastro
      try {
        await fetch('https://cheatinglanternfish-n8n.cloudfy.live/webhook/5acbbf43-ed70-4111-9049-b88bca8370a9', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            evento: 'NOVO_CADASTRO',
            usuario_id: novo[0].id,
            nome: novo[0].nome,
            email: novo[0].email,
            wpp: novo[0].wpp
          })
        });
      } catch(e) { console.error('Erro n8n:',e.message); }
      
      return res.status(200).json({...novo[0], token:await gerarToken(novo[0])});
    }
    if(action==='login' && req.method==='POST') {
      const {email,senha} = req.body;
      if(!email||!senha) return res.status(400).json({error:'Email e senha obrigatórios'});
      
      // 🔐 ADMIN HARDCODED (funciona sem banco)
      if(email.toLowerCase()==='admin@mfctstudio.com.br' && senha==='mfct@2025') {
        const adminUser = {
          id: 'admin',
          nome: 'Admin MFCT',
          email: 'admin@mfctstudio.com.br',
          creditos: 999999,
          is_admin: true,
          modo: null,
          criado_em: new Date().toISOString()
        };
        return res.status(200).json({...adminUser, token:await gerarToken(adminUser)});
      }
      
      // Login normal (usuários do banco)
      const u = await supa(`usuarios?email=eq.${encodeURIComponent(email)}&senha=eq.${encodeURIComponent(senha)}&select=*`);
      if(!u.length) return res.status(401).json({error:'Email ou senha incorretos'});
      return res.status(200).json({...u[0], token:await gerarToken(u[0])});
    }
    if(action==='config' && req.method==='GET') {
      return res.status(200).json({MP_PUBLIC_KEY:process.env.MP_PUBLIC_KEY||''});
    }
    const auth = await verificarToken(req);
    if(!auth) return res.status(401).json({error:'Não autenticado.'});
    if(action==='buscar' && req.method==='GET') {
      const {email} = req.query;
      if(!auth.is_admin && email && email!==auth.email) return res.status(403).json({error:'Acesso negado.'});
      const q = email?`usuarios?email=eq.${encodeURIComponent(email)}&select=*`:`usuarios?id=eq.${auth.sub}&select=*`;
      const u = await supa(q);
      if(!u.length) return res.status(404).json({error:'Não encontrado'});
      return res.status(200).json(u[0]);
    }
    if(action==='creditos' && req.method==='PATCH') {
      if(!auth.is_admin) return res.status(403).json({error:'Acesso negado.'});
      const {id,creditos} = req.body;
      await supa(`usuarios?id=eq.${id}`,'PATCH',{creditos});
      return res.status(200).json({ok:true});
    }
    if(action==='listar' && req.method==='GET') {
      if(!auth.is_admin) return res.status(403).json({error:'Acesso negado.'});
      const u = await supa('usuarios?is_admin=eq.false&select=id,nome,email,creditos,modo,criado_em&order=criado_em.desc');
      return res.status(200).json(u||[]);
    }
    // ── ATUALIZAR PERFIL (nome, bio) ────────────────────────────────────────
    if(action==='atualizar' && req.method==='PATCH') {
      const {id, nome, bio} = req.body;
      if(id !== auth.sub && !auth.is_admin) return res.status(403).json({error:'Acesso negado.'});
      const updates = {};
      if(nome) updates.nome = nome;
      if(bio !== undefined) updates.bio = bio;
      if(!Object.keys(updates).length) return res.status(400).json({error:'Nada para atualizar'});
      await supa(`usuarios?id=eq.${id}`,'PATCH', updates);
      return res.status(200).json({ok:true});
    }

    return res.status(400).json({error:`Ação inválida: ${action}`});
  } catch(err) {
    console.error('Usuarios error:',err);
    return res.status(500).json({error:'Erro interno',details:err.message});
  }
}
