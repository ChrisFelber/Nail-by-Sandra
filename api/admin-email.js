import { isAuthenticated } from './_admin-auth.js';
import { sendGmail } from '../lib/gmail.js';

function cleanHeader(value){return String(value||'').replace(/[\r\n]+/g,' ').trim()}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Méthode non autorisée.'});
  if(!isAuthenticated(req)) return res.status(401).json({error:'Non autorisé.'});
  try{
    const {to,subject,message,confirmed}=req.body||{};
    if(confirmed!==true) return res.status(400).json({error:'L’envoi doit être confirmé explicitement par Sandra.'});
    const recipient=cleanHeader(to),title=cleanHeader(subject),body=String(message||'').trim();
    if(!recipient||!recipient.includes('@')||!title||!body) return res.status(400).json({error:'E-mail incomplet.'});
    const d=await sendGmail({to:recipient,subject:title,body});
    return res.status(200).json({ok:true,messageId:d.id});
  }catch(e){console.error('Admin email:',e);return res.status(500).json({error:'Impossible d’envoyer l’e-mail.',diagnostic:e?.message||'Erreur inconnue.'})}
}
