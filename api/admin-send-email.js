import { isAuthenticated } from '../lib/admin-auth.js';
import { sendGmail } from '../lib/gmail.js';

function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||''))}

export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Méthode non autorisée.'})}
  if(!isAuthenticated(req)) return res.status(401).json({error:'Non autorisé.'});
  try{
    const {confirmed,to,subject,body}=req.body||{};
    if(confirmed!==true) return res.status(400).json({error:'L’envoi doit être confirmé explicitement par Sandra.'});
    if(!validEmail(to)) return res.status(400).json({error:'Adresse e-mail de la cliente invalide ou manquante.'});
    if(!subject||!body) return res.status(400).json({error:'Objet ou message manquant.'});
    const d=await sendGmail({to,subject,body});
    return res.status(200).json({ok:true,id:d.id});
  }catch(error){console.error('Admin Gmail send:',error);return res.status(500).json({error:'L’e-mail n’a pas pu être envoyé.',diagnostic:error?.message||'Erreur inconnue.'})}
}
