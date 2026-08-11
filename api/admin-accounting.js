import { Readable } from 'node:stream';
import { put, get } from '@vercel/blob';
import { isAuthenticated } from '../lib/admin-auth.js';
import { getDb } from '../lib/db.js';

function json(res,status,body){res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.status(status).json(body)}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))}
function csvCell(v){const s=String(v??'');return /[;"\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function monthBounds(value){const m=String(value||'').match(/^(\d{4})-(\d{2})$/);if(!m)throw new Error('MONTH_INVALID');const y=Number(m[1]),mo=Number(m[2]);if(mo<1||mo>12)throw new Error('MONTH_INVALID');return{start:`${m[1]}-${m[2]}-01`,nextMonth:mo===12?`${y+1}-01-01`:`${y}-${String(mo+1).padStart(2,'0')}-01`,year:y}}
function yearBounds(value){const y=Number(value);if(!Number.isInteger(y)||y<2000||y>2200)throw new Error('YEAR_INVALID');return{start:`${y}-01-01`,nextYear:`${y+1}-01-01`,year:y}}
async function snapshot(sql,id){const a=await sql`SELECT a.*,COALESCE(json_agg(json_build_object('id',i.id,'name',i.item_name,'amount_cents',i.amount_cents,'quantity',i.quantity,'source',i.source) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL),'[]'::json) items FROM appointments_accounting a LEFT JOIN appointment_items i ON i.appointment_accounting_id=a.id WHERE a.id=${id} GROUP BY a.id`;return a[0]||null}
function safeFileName(value){return String(value||'justificatif').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100)||'justificatif'}

export default async function handler(req,res){
 if(!isAuthenticated(req))return json(res,401,{error:'Non autorisé.'});
 try{
  if(req.method==='GET'&&req.query?.receipt){
   const result=await get(String(req.query.receipt),{access:'private'});if(!result||result.statusCode!==200)return res.status(404).send('Justificatif introuvable.');
   res.setHeader('Content-Type',result.blob.contentType||'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');if(result.blob.etag)res.setHeader('ETag',result.blob.etag);Readable.fromWeb(result.stream).pipe(res);return;
  }
  const sql=getDb();
  if(req.method==='POST'){
   const action=String(req.body?.action||'expense');
   if(action==='receipt_upload'){
    const data=String(req.body?.data_url||''),name=safeFileName(req.body?.name),m=data.match(/^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);if(!m)return json(res,400,{error:'Format de justificatif non pris en charge.'});
    const buffer=Buffer.from(m[2],'base64');if(!buffer.length||buffer.length>3000000)return json(res,400,{error:'Le justificatif doit faire moins de 3 Mo.'});
    const blob=await put(`receipts/${Date.now()}-${name}`,buffer,{access:'private',contentType:m[1],addRandomSuffix:true});return json(res,201,{ok:true,url:blob.url,name:req.body?.name||name});
   }
   if(action==='expense'){
    const {date,category,description,amount_cents,receipt_url,receipt_name}=req.body||{},amount=Number(amount_cents);
    if(!validDate(date)||!String(category||'').trim()||!String(description||'').trim()||!Number.isInteger(amount)||amount<=0)return json(res,400,{error:'Données de dépense invalides.'});
    const rows=await sql`INSERT INTO expenses(expense_date,category,description,amount_cents,receipt_url,receipt_name) VALUES(${date}::date,${String(category).trim()},${String(description).trim()},${amount},${String(receipt_url||'').trim()||null},${String(receipt_name||'').trim()||null}) RETURNING *`;return json(res,201,{ok:true,expense:rows[0]});
   }
   if(action==='category'){
    const name=String(req.body?.name||'').trim().slice(0,80);if(!name)return json(res,400,{error:'Nom de catégorie requis.'});const rows=await sql`INSERT INTO expense_categories(name) VALUES(${name}) ON CONFLICT(name) DO UPDATE SET active=TRUE RETURNING id,name,active`;return json(res,201,{ok:true,category:rows[0]});
   }
   if(action==='appointment_update'){
    const id=Number(req.body?.id),reason=String(req.body?.reason||'').trim().slice(0,300),service=String(req.body?.service_name||'').trim().slice(0,120),amount=Number(req.body?.service_amount_cents);if(!Number.isInteger(id)||id<=0||!service||!Number.isInteger(amount)||amount<0||!reason)return json(res,400,{error:'Correction invalide ou motif manquant.'});
    const before=await snapshot(sql,id);if(!before)return json(res,404,{error:'Prestation introuvable.'});const manual=(before.items||[]).filter(i=>i.source==='manual').reduce((s,i)=>s+Number(i.amount_cents||0)*Number(i.quantity||1),0),total=amount+manual;
    await sql.transaction([sql`UPDATE appointments_accounting SET booked_service_name=${service},booked_service_amount_cents=${amount},total_amount_cents=${total},updated_at=NOW() WHERE id=${id}`,sql`UPDATE appointment_items SET item_name=${service},amount_cents=${amount} WHERE appointment_accounting_id=${id} AND source='booked'`]);const after=await snapshot(sql,id);await sql`INSERT INTO accounting_audit_log(appointment_accounting_id,action,reason,before_data,after_data) VALUES(${id},'corrected',${reason},${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb)`;return json(res,200,{ok:true,appointment:after});
   }
   if(action==='appointment_reverse'){
    const id=Number(req.body?.id),reason=String(req.body?.reason||'').trim().slice(0,300);if(!Number.isInteger(id)||id<=0||!reason)return json(res,400,{error:'Motif d’annulation requis.'});const before=await snapshot(sql,id);if(!before)return json(res,404,{error:'Prestation introuvable.'});await sql`UPDATE appointments_accounting SET accounting_status='reversed',reversed_at=NOW(),updated_at=NOW() WHERE id=${id}`;const after=await snapshot(sql,id);await sql`INSERT INTO accounting_audit_log(appointment_accounting_id,action,reason,before_data,after_data) VALUES(${id},'reversed',${reason},${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb)`;return json(res,200,{ok:true});
   }
   return json(res,400,{error:'Action inconnue.'});
  }
  if(req.method==='DELETE'){
   const id=Number(req.query?.id);if(!Number.isInteger(id)||id<=0)return json(res,400,{error:'Identifiant invalide.'});const rows=await sql`DELETE FROM expenses WHERE id=${id} RETURNING id`;if(!rows.length)return json(res,404,{error:'Dépense introuvable.'});return json(res,200,{ok:true,id});
  }
  if(req.method==='GET'){
   const now=new Date(),defaultMonth=`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`,month=String(req.query?.month||defaultMonth),mb=monthBounds(month),yb=yearBounds(req.query?.year||mb.year),annual=String(req.query?.scope||'')==='year';const start=annual?yb.start:mb.start,end=annual?yb.nextYear:mb.nextMonth;
   if(String(req.query?.format||'').toLowerCase()==='csv'){
    const [revenues,expenses]=await sql.transaction([sql`SELECT appointment_date date,trim(customer_first_name||' '||customer_last_name) party,booked_service_name description,total_amount_cents amount_cents FROM appointments_accounting WHERE accounting_status='confirmed' AND appointment_date>=${start}::date AND appointment_date<${end}::date ORDER BY appointment_date,id`,sql`SELECT expense_date date,category party,description,amount_cents FROM expenses WHERE expense_date>=${start}::date AND expense_date<${end}::date ORDER BY expense_date,id`],{readOnly:true});const rows=[['Date','Type','Cliente/Catégorie','Description','Montant CHF']];revenues.forEach(r=>rows.push([String(r.date).slice(0,10),'Recette',r.party,r.description,(Number(r.amount_cents)/100).toFixed(2)]));expenses.forEach(r=>rows.push([String(r.date).slice(0,10),'Dépense',r.party,r.description,(-Number(r.amount_cents)/100).toFixed(2)]));const csv='\uFEFF'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="nail-by-sandra-comptabilite-${annual?yb.year:month}.csv"`);res.setHeader('Cache-Control','no-store');return res.status(200).send(csv);
   }
   const [appointments,expenses,categories,audit,annualRows]=await sql.transaction([
    sql`SELECT a.id,a.appointment_date,a.appointment_start_time,a.customer_first_name,a.customer_last_name,a.booked_service_name,a.booked_service_amount_cents,a.total_amount_cents,a.confirmed_at,COALESCE(json_agg(json_build_object('id',i.id,'name',i.item_name,'amount_cents',i.amount_cents,'quantity',i.quantity,'source',i.source) ORDER BY i.id) FILTER(WHERE i.id IS NOT NULL),'[]'::json) items FROM appointments_accounting a LEFT JOIN appointment_items i ON i.appointment_accounting_id=a.id WHERE a.accounting_status='confirmed' AND a.appointment_date>=${mb.start}::date AND a.appointment_date<${mb.nextMonth}::date GROUP BY a.id ORDER BY a.appointment_date DESC,a.appointment_start_time DESC NULLS LAST`,
    sql`SELECT id,expense_date,category,description,amount_cents,receipt_url,receipt_name,created_at FROM expenses WHERE expense_date>=${mb.start}::date AND expense_date<${mb.nextMonth}::date ORDER BY expense_date DESC,id DESC`,sql`SELECT id,name FROM expense_categories WHERE active=TRUE ORDER BY name`,sql`SELECT id,appointment_accounting_id,action,reason,created_at FROM accounting_audit_log ORDER BY created_at DESC LIMIT 50`,sql`SELECT 'revenue' type,COALESCE(SUM(total_amount_cents),0)::bigint total FROM appointments_accounting WHERE accounting_status='confirmed' AND appointment_date>=${yb.start}::date AND appointment_date<${yb.nextYear}::date UNION ALL SELECT 'expense',COALESCE(SUM(amount_cents),0)::bigint FROM expenses WHERE expense_date>=${yb.start}::date AND expense_date<${yb.nextYear}::date`
   ],{readOnly:true});const revenueCents=appointments.reduce((s,r)=>s+Number(r.total_amount_cents||0),0),expenseCents=expenses.reduce((s,r)=>s+Number(r.amount_cents||0),0),ar=Object.fromEntries(annualRows.map(r=>[r.type,Number(r.total||0)]));return json(res,200,{ok:true,month,year:yb.year,summary:{revenue_cents:revenueCents,expense_cents:expenseCents,balance_cents:revenueCents-expenseCents},annual_summary:{revenue_cents:ar.revenue||0,expense_cents:ar.expense||0,balance_cents:(ar.revenue||0)-(ar.expense||0)},appointments,expenses,categories,audit});
  }
  res.setHeader('Allow','GET, POST, DELETE');return json(res,405,{error:'Méthode non autorisée.'});
 }catch(error){console.error('Accounting API:',error);const bad=['MONTH_INVALID','YEAR_INVALID'].includes(error?.message);return json(res,bad?400:500,{ok:false,error:bad?'Période invalide.':'Opération comptable impossible.',diagnostic:error?.message||'Erreur inconnue.'})}
}