import { isAuthenticated } from '../lib/admin-auth.js';
import { getDb } from '../lib/db.js';

function csvCell(v){const s=String(v??'');return /[;"\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function monthBounds(value){const m=String(value||'').match(/^(\d{4})-(\d{2})$/);if(!m)throw new Error('MONTH_INVALID');const y=Number(m[1]),mo=Number(m[2]);if(mo<1||mo>12)throw new Error('MONTH_INVALID');return {start:`${m[1]}-${m[2]}-01`,next:mo===12?`${y+1}-01-01`:`${y}-${String(mo+1).padStart(2,'0')}-01`}}

export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Méthode non autorisée.'})}
  if(!isAuthenticated(req))return res.status(401).json({error:'Non autorisé.'});
  try{
    const month=String(req.query?.month||'');const {start,next}=monthBounds(month);const sql=getDb();
    const [revenues,expenses]=await sql.transaction([
      sql`SELECT appointment_date AS date,trim(customer_first_name||' '||customer_last_name) AS party,booked_service_name AS description,total_amount_cents AS amount_cents FROM appointments_accounting WHERE accounting_status='confirmed' AND appointment_date>=${start}::date AND appointment_date<${next}::date ORDER BY appointment_date,id`,
      sql`SELECT expense_date AS date,category AS party,description,amount_cents FROM expenses WHERE expense_date>=${start}::date AND expense_date<${next}::date ORDER BY expense_date,id`
    ],{readOnly:true});
    const rows=[['Date','Type','Cliente/Fournisseur','Description','Montant CHF']];
    revenues.forEach(r=>rows.push([String(r.date).slice(0,10),'Recette',r.party,r.description,(Number(r.amount_cents)/100).toFixed(2)]));
    expenses.forEach(r=>rows.push([String(r.date).slice(0,10),'Dépense',r.party,r.description,(-Number(r.amount_cents)/100).toFixed(2)]));
    const csv='\uFEFF'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="nail-by-sandra-comptabilite-${month}.csv"`);res.setHeader('Cache-Control','no-store');return res.status(200).send(csv);
  }catch(error){return res.status(error?.message==='MONTH_INVALID'?400:500).json({error:error?.message==='MONTH_INVALID'?'Mois invalide.':'Export impossible.'})}
}
