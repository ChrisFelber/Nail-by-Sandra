import crypto from 'node:crypto';
import { isAuthenticated } from '../lib/admin-auth.js';

const REDIRECT_URI = 'https://nail-by-sandra-4fon.vercel.app/api/gmail-auth-callback';
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

function secret(){
  const value=process.env.ADMIN_SESSION_SECRET;
  if(!value||value.length<32) throw new Error('ADMIN_SESSION_SECRET_MISSING');
  return value;
}
function sign(payload){return crypto.createHmac('sha256',secret()).update(payload).digest('base64url')}
function createState(){
  const payload=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+600,nonce:crypto.randomBytes(12).toString('hex')})).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Méthode non autorisée.'});
  if(!isAuthenticated(req)) return res.status(401).json({error:'Connectez-vous d’abord à l’Espace Sandra.'});
  const clientId=process.env.GOOGLE_CLIENT_ID;
  if(!clientId) return res.status(500).json({error:'GOOGLE_CLIENT_ID manquant dans Vercel.'});
  const params=new URLSearchParams({
    client_id:clientId,
    redirect_uri:REDIRECT_URI,
    response_type:'code',
    scope:SCOPE,
    access_type:'offline',
    prompt:'consent',
    include_granted_scopes:'true',
    state:createState()
  });
  res.redirect(302,`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
