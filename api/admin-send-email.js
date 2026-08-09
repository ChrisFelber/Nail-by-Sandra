import { isAuthenticated } from './_admin-auth.js';

function b64url(value){return Buffer.from(value,'utf8').toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||''))}

async function gmailAccessToken(){
  const clientId=process.env.GOOGLE_CLIENT_ID;
  const clientSecret=process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken=process.env.GMAIL_REFRESH_TOKEN;
  if(!clientId||!clientSecret||!refreshToken) throw new Error('GMAIL_CONFIG_MISSING');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})});
  const d=await r.json();
  if(!r.ok||!d.access_token) throw new Error(d.error_description||d.error||'GMAIL_TOKEN_FAILED');
  return d.access_token;
}

export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Méthode non autorisée.'})}
  if(!isAuthenticated(req)) return res.status(401).json({error:'Non autorisé.'});
  try{
    const {confirmed,to,subject,body}=req.body||{};
    if(confirmed!==true) return res.status(400).json({error:'L’envoi doit être confirmé explicitement par Sandra.'});
    if(!validEmail(to)) return res.status(400).json({error:'Adresse e-mail de la cliente invalide ou manquante.'});
    if(!subject||!body) return res.status(400).json({error:'Objet ou message manquant.'});
    const token=await gmailAccessToken();
    const raw=[`To: ${to}`,'From: Nail by Sandra',`Subject: =?UTF-8?B?${Buffer.from(String(subject),'utf8').toString('base64')}?=`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit','',String(body)].join('\r\n');
    const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw:b64url(raw)})});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error?.message||'GMAIL_SEND_FAILED');
    return res.status(200).json({ok:true,id:d.id});
  }catch(error){console.error('Admin Gmail send:',error);return res.status(500).json({error:'L’e-mail n’a pas pu être envoyé.',diagnostic:error?.message||'Erreur inconnue.'})}
}
