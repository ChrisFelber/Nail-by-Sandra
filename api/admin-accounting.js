import { isAuthenticated } from '../lib/admin-auth.js';
import { getDb } from '../lib/db.js';

function json(res,status,body){res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.status(status).json(body)}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))}
function csvCell(v){const s=String(v??'');return /[;"\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function monthBounds(value){
  const match=String(value||'').match(/^(\d{4})-(\d{2})$/);
  if(!match) throw new Error('MONTH_INVALID');
  const year=Number(match[1]),month=Number(match[2]);
  if(month<1||month>12) throw new Error('MONTH_INVALID');
  const start=`${match[1]}-${match[2]}-01`;
  const nextMonth=month===12?`${year+1}-01-01`:`${year}-${String(month+1).padStart(2,'0')}-01`;
  return {start,nextMonth};
}

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

    if(req.method==='GET'){
      const now=new Date();
      const defaultMonth=`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`;
      const month=String(req.query?.month||defaultMonth);
      const {start,nextMonth}=monthBounds(month);

      if(String(req.query?.format||'').toLowerCase()==='csv'){
        const [revenues,expenses]=await sql.transaction([
          sql`SELECT appointment_date AS date,trim(customer_first_name||' '||customer_last_name) AS party,booked_service_name AS description,total_amount_cents AS amount_cents FROM appointments_accounting WHERE accounting_status='confirmed' AND appointment_date>=${start}::date AND appointment_date<${nextMonth}::date ORDER BY appointment_date,id`,
          sql`SELECT expense_date AS date,category AS party,description,amount_cents FROM expenses WHERE expense_date>=${start}::date AND expense_date<${nextMonth}::date ORDER BY expense_date,id`
        ],{readOnly:true});
        const rows=[['Date','Type','Cliente/Fournisseur','Description','Montant CHF']];
        revenues.forEach(r=>rows.push([String(r.date).slice(0,10),'Recette',r.party,r.description,(Number(r.amount_cents)/100).toFixed(2)]));
        expenses.forEach(r=>rows.push([String(r.date).slice(0,10),'Dépense',r.party,r.description,(-Number(r.amount_cents)/100).toFixed(2)]));
        const csv='\uFEFF'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');
        res.setHeader('Content-Type','text/csv; charset=utf-8');
        res.setHeader('Content-Disposition',`attachment; filename="nail-by-sandra-comptabilite-${month}.csv"`);
        res.setHeader('Cache-Control','no-store');
        return res.status(200).send(csv);
      }

      const [appointments,expenses]=await sql.transaction([
        sql`SELECT a.id,a.calendar_event_id,a.appointment_date,a.appointment_start_time,a.customer_first_name,a.customer_last_name,a.booked_service_name,a.booked_service_amount_cents,a.total_amount_cents,a.confirmed_at,
          COALESCE(json_agg(json_build_object('id',i.id,'name',i.item_name,'amount_cents',i.amount_cents,'quantity',i.quantity,'source',i.source) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL),'[]'::json) AS items
          FROM appointments_accounting a
          LEFT JOIN appointment_items i ON i.appointment_accounting_id=a.id
          WHERE a.accounting_status='confirmed' AND a.appointment_date>=${start}::date AND a.appointment_date<${nextMonth}::date
          GROUP BY a.id ORDER BY a.appointment_date DESC,a.appointment_start_time DESC NULLS LAST`,
        sql`SELECT id,expense_date,category,description,amount_cents,created_at FROM expenses WHERE expense_date>=${start}::date AND expense_date<${nextMonth}::date ORDER BY expense_date DESC,id DESC`
      ],{readOnly:true});
      const revenueCents=appointments.reduce((s,r)=>s+Number(r.total_amount_cents||0),0);
      const expenseCents=expenses.reduce((s,r)=>s+Number(r.amount_cents||0),0);
      return json(res,200,{ok:true,month,summary:{revenue_cents:revenueCents,expense_cents:expenseCents,balance_cents:revenueCents-expenseCents},appointments,expenses});
    }

    res.setHeader('Allow','GET, POST, DELETE');
    return json(res,405,{error:'Méthode non autorisée.'});
  }catch(error){
    console.error('Accounting API:',error);
    const invalidMonth=error?.message==='MONTH_INVALID';
    return json(res,invalidMonth?400:500,{ok:false,error:invalidMonth?'Mois invalide.':'Opération comptable impossible.',diagnostic:error?.message||'Erreur inconnue.'});
  }
}
