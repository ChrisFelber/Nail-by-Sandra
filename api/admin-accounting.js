import { isAuthenticated } from '../lib/admin-auth.js';
import { getDb } from '../lib/db.js';

function json(res,status,body){res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.status(status).json(body)}
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
  if(req.method!=='GET'){res.setHeader('Allow','GET');return json(res,405,{error:'Méthode non autorisée.'})}
  if(!isAuthenticated(req))return json(res,401,{error:'Non autorisé.'});
  try{
    const now=new Date();
    const defaultMonth=`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`;
    const month=String(req.query?.month||defaultMonth);
    const {start,nextMonth}=monthBounds(month);
    const sql=getDb();
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
  }catch(error){
    console.error('Accounting monthly:',error);
    return json(res,error?.message==='MONTH_INVALID'?400:500,{ok:false,error:error?.message==='MONTH_INVALID'?'Mois invalide.':'Impossible de charger la comptabilité.',diagnostic:error?.message||'Erreur inconnue.'});
  }
}
