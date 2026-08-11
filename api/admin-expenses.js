import { isAuthenticated } from '../lib/admin-auth.js';
import { getDb } from '../lib/db.js';

function json(res,status,body){res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.status(status).json(body)}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))}

export default async function handler(req,res){
  if(!isAuthenticated(req))return json(res,401,{error:'Non autorisé.'});
  const sql=getDb();
  try{
    if(req.method==='POST'){
      const {date,category,description,amount_cents}=req.body||{};
      const amount=Number(amount_cents);
      if(!validDate(date)||!String(category||'').trim()||!String(description||'').trim()||!Number.isInteger(amount)||amount<=0)return json(res,400,{error:'Données de dépense invalides.'});
      const rows=await sql`INSERT INTO expenses(expense_date,category,description,amount_cents) VALUES(${date}::date,${String(category).trim()},${String(description).trim()},${amount}) RETURNING id,expense_date,category,description,amount_cents`;
      return json(res,201,{ok:true,expense:rows[0]});
    }
    if(req.method==='DELETE'){
      const id=Number(req.query?.id);
      if(!Number.isInteger(id)||id<=0)return json(res,400,{error:'Identifiant invalide.'});
      const rows=await sql`DELETE FROM expenses WHERE id=${id} RETURNING id`;
      if(!rows.length)return json(res,404,{error:'Dépense introuvable.'});
      return json(res,200,{ok:true,id});
    }
    res.setHeader('Allow','POST, DELETE');
    return json(res,405,{error:'Méthode non autorisée.'});
  }catch(error){
    console.error('Accounting expenses:',error);
    return json(res,500,{error:'Opération comptable impossible.',diagnostic:error?.message||'Erreur inconnue.'});
  }
}
