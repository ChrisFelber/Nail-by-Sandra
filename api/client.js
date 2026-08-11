import crypto from 'node:crypto';
import { getDb } from '../lib/db.js';
import { isAuthenticated } from '../lib/admin-auth.js';

const COOKIE='nbs_client';
function json(res,status,body){res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.status(status).json(body)}
function b64(v){return Buffer.from(v).toString('base64url')}
function unb64(v){return Buffer.from(v,'base64url').toString('utf8')}
function secret(){return String(process.env.ADMIN_SESSION_SECRET||'').trim()}
function sign(v){return crypto.createHmac('sha256',secret()).update(v).digest('base64url')}
function cookie(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2))}
function session(req){try{const raw=cookie(req)[COOKIE];if(!raw||!secret())return null;const [payload,sig]=raw.split('.');if(!payload||!sig||!crypto.timingSafeEqual(Buffer.from(sign(payload)),Buffer.from(sig)))return null;const d=JSON.parse(unb64(payload));if(!d.id||!d.exp||Date.now()>d.exp)return null;return d}catch{return null}}
function setSession(res,user){const payload=b64(JSON.stringify({id:user.id,email:user.email,exp:Date.now()+1000*60*60*24*30}));res.setHeader('Set-Cookie',`${COOKIE}=${encodeURIComponent(payload+'.'+sign(payload))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`)}
function clearSession(res){res.setHeader('Set-Cookie',`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`)}
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){return `${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`}
function verify(password,stored){try{const [salt,hex]=String(stored).split(':');const a=Buffer.from(hex,'hex'),b=crypto.scryptSync(password,salt,64);return a.length===b.length&&crypto.timingSafeEqual(a,b)}catch{return false}}
function cleanEmail(v){return String(v||'').trim().toLowerCase()}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
async function ensure(sql){await sql`CREATE TABLE IF NOT EXISTS client_accounts (id BIGSERIAL PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`}

export default async function handler(req,res){
 try{const sql=getDb();await ensure(sql);const action=String(req.query?.action||req.body?.action||'session');
  if(req.method==='GET'&&action==='admin_clients'){
   if(!isAuthenticated(req))return json(res,401,{error:'Non autorisé.'});
   const rows=await sql`
    WITH emails AS (
      SELECT lower(email) email FROM client_accounts
      UNION
      SELECT lower(customer_email) email FROM appointments_accounting WHERE customer_email IS NOT NULL AND trim(customer_email)<>''
    ), hist AS (
      SELECT lower(customer_email) email, count(*)::int appointment_count,
        max(appointment_date) last_appointment,
        coalesce(sum(total_amount_cents) FILTER (WHERE accounting_status='confirmed'),0)::bigint total_spent_cents,
        (array_agg(trim(customer_first_name||' '||customer_last_name) ORDER BY appointment_date DESC,id DESC))[1] last_name_value,
        (array_agg(customer_phone ORDER BY appointment_date DESC,id DESC))[1] last_phone
      FROM appointments_accounting WHERE customer_email IS NOT NULL AND trim(customer_email)<>'' GROUP BY lower(customer_email)
    )
    SELECT e.email,a.id account_id,a.first_name,a.last_name,a.phone,a.created_at,
      coalesce(h.appointment_count,0) appointment_count,h.last_appointment,
      coalesce(h.total_spent_cents,0) total_spent_cents,h.last_name_value,h.last_phone
    FROM emails e LEFT JOIN client_accounts a ON lower(a.email)=e.email LEFT JOIN hist h ON h.email=e.email
    ORDER BY coalesce(h.last_appointment,a.created_at::date) DESC NULLS LAST,e.email`;
   return json(res,200,{ok:true,clients:rows});
  }
  if(req.method==='GET'&&action==='admin_client_history'){
   if(!isAuthenticated(req))return json(res,401,{error:'Non autorisé.'});const email=cleanEmail(req.query?.email);if(!validEmail(email))return json(res,400,{error:'Adresse e-mail invalide.'});
   const rows=await sql`SELECT id,appointment_date,appointment_start_time,booked_service_name,total_amount_cents,accounting_status,confirmed_at FROM appointments_accounting WHERE lower(customer_email)=${email} ORDER BY appointment_date DESC,appointment_start_time DESC NULLS LAST LIMIT 100`;
   return json(res,200,{ok:true,history:rows});
  }
  if(req.method==='POST'&&action==='register'){
   const first=String(req.body?.first_name||'').trim().slice(0,80),last=String(req.body?.last_name||'').trim().slice(0,80),email=cleanEmail(req.body?.email),phone=String(req.body?.phone||'').trim().slice(0,40),password=String(req.body?.password||'');
   if(!first||!last||!validEmail(email)||password.length<8)return json(res,400,{error:'Renseignez vos informations et un mot de passe d’au moins 8 caractères.'});
   const exists=await sql`SELECT id FROM client_accounts WHERE email=${email}`;if(exists.length)return json(res,409,{error:'Un compte existe déjà avec cette adresse e-mail.'});
   const rows=await sql`INSERT INTO client_accounts(first_name,last_name,email,phone,password_hash) VALUES(${first},${last},${email},${phone||null},${hashPassword(password)}) RETURNING id,first_name,last_name,email,phone`;setSession(res,rows[0]);return json(res,201,{ok:true,user:rows[0]});
  }
  if(req.method==='POST'&&action==='login'){
   const email=cleanEmail(req.body?.email),password=String(req.body?.password||''),rows=await sql`SELECT id,first_name,last_name,email,phone,password_hash FROM client_accounts WHERE email=${email}`;if(!rows[0]||!verify(password,rows[0].password_hash))return json(res,401,{error:'E-mail ou mot de passe incorrect.'});setSession(res,rows[0]);const {password_hash,...user}=rows[0];return json(res,200,{ok:true,user});
  }
  if(req.method==='POST'&&action==='logout'){clearSession(res);return json(res,200,{ok:true})}
  const s=session(req);if(!s)return json(res,401,{authenticated:false});const users=await sql`SELECT id,first_name,last_name,email,phone FROM client_accounts WHERE id=${s.id}`;if(!users[0]){clearSession(res);return json(res,401,{authenticated:false})}
  if(req.method==='GET'&&action==='session')return json(res,200,{authenticated:true,user:users[0]});
  if(req.method==='GET'&&action==='appointments'){
   const rows=await sql`SELECT appointment_date,appointment_start_time,booked_service_name,total_amount_cents,accounting_status FROM appointments_accounting WHERE lower(customer_email)=lower(${users[0].email}) ORDER BY appointment_date DESC,appointment_start_time DESC NULLS LAST LIMIT 100`;
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return json(res,200,{ok:true,appointments:rows.map(r=>({...r,is_upcoming:String(r.appointment_date).slice(0,10)>=today}))});
  }
  res.setHeader('Allow','GET, POST');return json(res,405,{error:'Méthode non autorisée.'});
 }catch(e){console.error('Client API:',e);return json(res,500,{error:'Espace cliente momentanément indisponible.',diagnostic:e?.message||'Erreur inconnue.'})}
}