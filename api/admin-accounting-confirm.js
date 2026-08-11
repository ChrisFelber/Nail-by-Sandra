import crypto from 'node:crypto';
import { isAuthenticated } from '../lib/admin-auth.js';
import { getDb } from '../lib/db.js';

const GOOGLE_TOKEN_URL='https://oauth2.googleapis.com/token';
const CALENDAR_API='https://www.googleapis.com/calendar/v3';
const TIME_ZONE='Europe/Zurich';

function base64Url(value){return Buffer.from(value).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
function parseServiceAccount(raw){const a=JSON.parse(raw);if(!a.client_email||!a.private_key)throw new Error('SERVICE_ACCOUNT_INVALID');a.private_key=a.private_key.replace(/\\n/g,'\n').replace(/\\r/g,'\r');return a}
function getServiceAccount(){const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;if(raw)return parseServiceAccount(raw.trim());const raw64=process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;if(raw64)return parseServiceAccount(Buffer.from(raw64.trim(),'base64').toString('utf8'));throw new Error('SERVICE_ACCOUNT_MISSING')}
async function getAccessToken(){const a=getServiceAccount(),now=Math.floor(Date.now()/1000),header=base64Url(JSON.stringify({alg:'RS256',typ:'JWT'})),claim=base64Url(JSON.stringify({iss:a.client_email,scope:'https://www.googleapis.com/auth/calendar',aud:GOOGLE_TOKEN_URL,iat:now,exp:now+3600})),unsigned=`${header}.${claim}`,signer=crypto.createSign('RSA-SHA256');signer.update(unsigned);signer.end();const signature=signer.sign(a.private_key,'base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');const r=await fetch(GOOGLE_TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${signature}`})}),d=await r.json();if(!r.ok||!d.access_token)throw new Error(d.error_description||d.error||'AUTH_FAILED');return d.access_token}
function calendarId(){const id=process.env.GOOGLE_CALENDAR_ID;if(!id)throw new Error('CALENDAR_ID_MISSING');return id}
function field(description,label){const m=String(description||'').match(new RegExp('^'+label+'\\s*:\\s*(.+)$','mi'));return m?m[1].trim():''}
function serviceName(summary){return String(summary||'Rendez-vous').replace(/^Nail by Sandra\s*[—-]\s*/i,'').trim()||'Rendez-vous'}
function priceCents(description){const raw=field(description,'Tarif'),m=raw.match(/(\d+(?:[.,]\d{1,2})?)/);if(!m)return 0;return Math.round(Number(m[1].replace(',','.'))*100)}
function localParts(value){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]))}
function splitName(full){const parts=String(full||'Cliente').trim().split(/\s+/).filter(Boolean);return {first:parts.shift()||'Cliente',last:parts.join(' ')||'-'}}
function cleanExtras(items){if(!Array.isArray(items))return[];return items.slice(0,20).map(item=>({name:String(item?.name||'').trim().slice(0,120),amount_cents:Math.round(Number(item?.amount_cents))})).filter(item=>item.name&&Number.isInteger(item.amount_cents)&&item.amount_cents>=0)}

export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Méthode non autorisée.'})}
  if(!isAuthenticated(req))return res.status(401).json({error:'Non autorisé.'});
  try{
    const eventId=String(req.body?.eventId||'').trim();
    const extras=cleanExtras(req.body?.extras);
    if(!eventId)return res.status(400).json({error:'Rendez-vous manquant.'});

    const token=await getAccessToken();
    const r=await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId())}/events/${encodeURIComponent(eventId)}`,{headers:{Authorization:`Bearer ${token}`}});
    const ev=await r.json();
    if(!r.ok)throw new Error(ev.error?.message||'CALENDAR_EVENT_FAILED');
    if(ev.status==='cancelled'||ev.extendedProperties?.private?.nbsType==='unavailability')return res.status(400).json({error:'Ce rendez-vous ne peut pas être comptabilisé.'});

    const start=ev.start?.dateTime||ev.start?.date;
    if(!start)return res.status(400).json({error:'Date du rendez-vous manquante.'});
    const p=localParts(start),customer=splitName(field(ev.description,'Cliente'));
    const bookedAmount=priceCents(ev.description);
    const total=bookedAmount+extras.reduce((sum,item)=>sum+item.amount_cents,0);
    const bookedName=serviceName(ev.summary);
    const sql=getDb();

    const queries=[
      sql`INSERT INTO appointments_accounting (
        calendar_event_id, appointment_date, appointment_start_time,
        customer_first_name, customer_last_name, customer_email, customer_phone,
        booked_service_name, booked_service_amount_cents, total_amount_cents,
        accounting_status, confirmed_at, reversed_at, updated_at
      ) VALUES (
        ${eventId}, ${`${p.year}-${p.month}-${p.day}`}, ${`${p.hour}:${p.minute}`},
        ${customer.first}, ${customer.last}, ${field(ev.description,'E-mail')||field(ev.description,'Email')||null}, ${field(ev.description,'Téléphone')||null},
        ${bookedName}, ${bookedAmount}, ${total}, 'confirmed', NOW(), NULL, NOW()
      )
      ON CONFLICT (calendar_event_id) DO UPDATE SET
        accounting_status='confirmed', reversed_at=NULL, confirmed_at=NOW(), updated_at=NOW(),
        appointment_date=EXCLUDED.appointment_date, appointment_start_time=EXCLUDED.appointment_start_time,
        customer_first_name=EXCLUDED.customer_first_name, customer_last_name=EXCLUDED.customer_last_name,
        customer_email=EXCLUDED.customer_email, customer_phone=EXCLUDED.customer_phone,
        booked_service_name=EXCLUDED.booked_service_name,
        booked_service_amount_cents=EXCLUDED.booked_service_amount_cents,
        total_amount_cents=EXCLUDED.total_amount_cents
      RETURNING id`,
      sql`DELETE FROM appointment_items WHERE appointment_accounting_id=(SELECT id FROM appointments_accounting WHERE calendar_event_id=${eventId})`,
      sql`INSERT INTO appointment_items (appointment_accounting_id,item_name,amount_cents,quantity,source)
          SELECT id, ${bookedName}, ${bookedAmount}, 1, 'booked' FROM appointments_accounting WHERE calendar_event_id=${eventId}`,
      ...extras.map(item=>sql`INSERT INTO appointment_items (appointment_accounting_id,item_name,amount_cents,quantity,source)
          SELECT id, ${item.name}, ${item.amount_cents}, 1, 'manual' FROM appointments_accounting WHERE calendar_event_id=${eventId}`)
    ];
    await sql.transaction(queries);
    return res.status(200).json({ok:true,eventId,total_amount_cents:total,extras_count:extras.length});
  }catch(error){console.error('Accounting confirm:',error);return res.status(500).json({error:'Impossible de confirmer cette prestation.',diagnostic:error?.message||'Erreur inconnue.'})}
}
