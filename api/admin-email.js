import { isAuthenticated } from './_admin-auth.js';

function cleanHeader(value){return String(value||'').replace(/[\r\n]+/g,' ').trim()}
function base64url(value){return Buffer.from(value).toString('base64url')}
function encodedSubject(subject){return `=?UTF-8?B?${Buffer.from(subject,'utf8').toString('base64')}?=`}

async function accessToken(){
  const clientId=process.env.GOOGLE_CLIENT_ID;
  const clientSecret=process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken=process.env.GMAIL_REFRESH_TOKEN;
  if(!clientId||!clientSecret||!refreshToken) throw new Error('GMAIL_NOT_CONFIGURED');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})});
  const d=await r.json();
  if(!r.ok||!d.access_token) throw new Error(d.error_description||d.error||'GMAIL_TOKEN_FAILED');
  return d.access_token;
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Méthode non autorisée.'});
  if(!isAuthenticated(req)) return res.status(401).json({error:'Non autorisé.'});
  try{
    const {to,subject,message,confirmed}=req.body||{};
    if(confirmed!==true) return res.status(400).json({error:'L’envoi doit être confirmé explicitement par Sandra.'});
    const recipient=cleanHeader(to),title=cleanHeader(subject),body=String(message||'').trim();
    if(!recipient||!recipient.includes('@')||!title||!body) return res.status(400).json({error:'E-mail incomplet.'});
    const raw=[`To: ${recipient}`,`Subject: ${encodedSubject(title)}`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit','',body].join('\r\n');
    const token=await accessToken();
    const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw:base64url(raw)})});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error?.message||'GMAIL_SEND_FAILED');
    return res.status(200).json({ok:true,messageId:d.id});
  }catch(e){console.error('Admin email:',e);return res.status(500).json({error:'Impossible d’envoyer l’e-mail.',diagnostic:e?.message||'Erreur inconnue.'})}
}
