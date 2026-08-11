import crypto from 'node:crypto';
import { isAuthenticated } from '../lib/admin-auth.js';
import { getDb } from '../lib/db.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TIME_ZONE = 'Europe/Zurich';

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function parseServiceAccount(raw) {
  const account = JSON.parse(raw);
  if (!account.client_email || !account.private_key) throw new Error('SERVICE_ACCOUNT_INVALID');
  account.private_key = account.private_key.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  return account;
}
function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) return parseServiceAccount(raw.trim());
  const rawBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (rawBase64) return parseServiceAccount(Buffer.from(rawBase64.trim(), 'base64').toString('utf8'));
  throw new Error('SERVICE_ACCOUNT_MISSING');
}
async function getAccessToken() {
  const account = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/calendar', aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned); signer.end();
  const signature = signer.sign(account.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const response = await fetch(GOOGLE_TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${signature}`})});
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || 'AUTH_FAILED');
  return data.access_token;
}
function calendarId(){const id=process.env.GOOGLE_CALENDAR_ID;if(!id)throw new Error('CALENDAR_ID_MISSING');return id}

export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Méthode non autorisée.'})}
  if(!isAuthenticated(req))return res.status(401).json({error:'Non autorisé.'});
  try{
    const token=await getAccessToken(),now=new Date();
    const past=new Date(now.getTime()-30*24*60*60*1000),horizon=new Date(now.getTime()+21*24*60*60*1000);
    const params=new URLSearchParams({timeMin:past.toISOString(),timeMax:horizon.toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'200',timeZone:TIME_ZONE});
    const response=await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId())}/events?${params}`,{headers:{Authorization:`Bearer ${token}`}}),data=await response.json();
    if(!response.ok)throw new Error(data.error?.message||'CALENDAR_EVENTS_FAILED');

    const sql=getDb();
    const accountingRows=await sql`SELECT calendar_event_id, accounting_status FROM appointments_accounting`;
    const accountingMap=new Map(accountingRows.map(r=>[r.calendar_event_id,r.accounting_status]));

    const events=(data.items||[])
      .filter(e=>e.status!=='cancelled'&&e.extendedProperties?.private?.nbsType!=='unavailability')
      .map(e=>({
        id:e.id,
        summary:e.summary||'Rendez-vous',
        description:e.description||'',
        start:e.start?.dateTime||e.start?.date||null,
        end:e.end?.dateTime||e.end?.date||null,
        htmlLink:e.htmlLink||'',
        accountingStatus:accountingMap.get(e.id)||null
      }));
    return res.status(200).json({timeZone:TIME_ZONE,events});
  }catch(error){console.error('Admin events:',error);return res.status(500).json({error:'Impossible de charger les rendez-vous.',diagnostic:error?.message||'Erreur inconnue.'})}
}
