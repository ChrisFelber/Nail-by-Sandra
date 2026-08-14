import crypto from 'node:crypto';
import { sendGmailToSelf } from '../lib/gmail.js';
import { getDb } from '../lib/db.js';
import { findService, formatPrice } from '../lib/services.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TIME_ZONE = 'Europe/Zurich';
const SLOT_STARTS = ['09:00', '10:30', '12:00', '14:00', '15:30', '17:00'];

function base64Url(value) {return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');}
function parseServiceAccount(raw) {try {const account = JSON.parse(raw);if (!account.client_email || !account.private_key) throw new Error('Champs client_email/private_key manquants.');account.private_key = account.private_key.replace(/\\n/g, '\n').replace(/\\r/g, '\r');return account;} catch {throw new Error('SERVICE_ACCOUNT_JSON_INVALID');}}
function getServiceAccount() {const rawBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;if (rawBase64) {try {return parseServiceAccount(Buffer.from(rawBase64.trim(), 'base64').toString('utf8'));} catch (error) {if (error.message !== 'SERVICE_ACCOUNT_JSON_INVALID') throw error;}}const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;if (!raw) throw new Error('SERVICE_ACCOUNT_MISSING');return parseServiceAccount(raw.trim());}
async function getAccessToken() {const account = getServiceAccount();const now = Math.floor(Date.now() / 1000);const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));const claim = base64Url(JSON.stringify({iss: account.client_email,scope: 'https://www.googleapis.com/auth/calendar',aud: GOOGLE_TOKEN_URL,iat: now,exp: now + 3600}));const unsigned = `${header}.${claim}`;const signer = crypto.createSign('RSA-SHA256');signer.update(unsigned);signer.end();const signature = signer.sign(account.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');const response = await fetch(GOOGLE_TOKEN_URL, {method: 'POST',headers: { 'Content-Type': 'application/x-www-form-urlencoded' },body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion: `${unsigned}.${signature}`})});const data = await response.json();if (!response.ok || !data.access_token) throw new Error(`AUTH_${response.status}: ${data.error_description || data.error || 'Impossible d’obtenir le jeton Google.'}`);return data.access_token;}
function getCalendarId() {const id = process.env.GOOGLE_CALENDAR_ID;if (!id) throw new Error('CALENDAR_ID_MISSING');return id;}
function json(res, status, body) {res.setHeader('Content-Type', 'application/json; charset=utf-8');res.setHeader('Cache-Control', 'no-store');return res.status(status).json(body);}
function validDate(value) {return /^\d{4}-\d{2}-\d{2}$/.test(value || '');}
function validTime(value) {return /^\d{2}:\d{2}$/.test(value || '');}
function zonedLocalToDate(date, time) {const [year, month, day] = date.split('-').map(Number);const [hour, minute] = time.split(':').map(Number);const guess = Date.UTC(year, month - 1, day, hour, minute, 0);const formatter = new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE,year: 'numeric', month: '2-digit', day: '2-digit',hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));const representedAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);const offset = representedAsUtc - guess;return new Date(guess - offset);}
function addMinutes(date, minutes) {return new Date(date.getTime() + minutes * 60000);}
async function getBusy(token, calendarId, date) {const start = zonedLocalToDate(date, '00:00');const next = new Date(start.getTime() + 30 * 60 * 60 * 1000);const nextLocal = new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'}).format(next);const end = zonedLocalToDate(nextLocal, '00:00');const response = await fetch(`${CALENDAR_API}/freeBusy`, {method: 'POST',headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },body: JSON.stringify({timeMin: start.toISOString(),timeMax: end.toISOString(),timeZone: TIME_ZONE,items: [{ id: calendarId }]})});const data = await response.json();if (!response.ok) throw new Error(`CALENDAR_${response.status}: ${data.error?.message || 'Erreur Google Calendar.'}`);const calendar = data.calendars?.[calendarId];if (calendar?.errors?.length) throw new Error(`CALENDAR_ACCESS: ${calendar.errors[0].reason || 'Accès au calendrier refusé.'}`);return calendar?.busy || [];}
function overlapsBusy(start, end, busy) {return busy.some(item => start < new Date(item.end) && end > new Date(item.start));}
function weekday(date){const n=new Intl.DateTimeFormat('en-US',{timeZone:TIME_ZONE,weekday:'short'}).format(new Date(date+'T12:00:00Z'));return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(n)+1}
async function getRules(date){const sql=getDb();try{const [weekly,recurring]=await sql.transaction([sql`SELECT day_of_week,active,to_char(start_time,'HH24:MI') start_time,to_char(end_time,'HH24:MI') end_time FROM weekly_hours WHERE day_of_week=${weekday(date)}`,sql`SELECT to_char(start_time,'HH24:MI') start_time,to_char(end_time,'HH24:MI') end_time FROM recurring_unavailability WHERE weekday=${weekday(date)} AND start_date<=${date}::date AND (end_date IS NULL OR end_date>=${date}::date)`],{readOnly:true});return{weekly:weekly[0]||null,recurring}}catch(e){if(String(e.message||'').includes('does not exist'))return{weekly:null,recurring:[]};throw e}}
function insideWeekly(date,time,duration,weekly){if(!weekly)return true;if(!weekly.active)return false;const start=zonedLocalToDate(date,time),end=addMinutes(start,duration),ws=zonedLocalToDate(date,String(weekly.start_time).slice(0,5)),we=zonedLocalToDate(date,String(weekly.end_time).slice(0,5));return start>=ws&&end<=we}
function overlapsRecurring(date,time,duration,rows){const start=zonedLocalToDate(date,time),end=addMinutes(start,duration);return rows.some(r=>{const rs=zonedLocalToDate(date,String(r.start_time).slice(0,5)),re=zonedLocalToDate(date,String(r.end_time).slice(0,5));return start<re&&end>rs})}
function availableSlots(date, durationMinutes, busy, rules) {return SLOT_STARTS.filter(time => {const start = zonedLocalToDate(date, time);const end = addMinutes(start, durationMinutes);return insideWeekly(date,time,durationMinutes,rules.weekly)&&!overlapsRecurring(date,time,durationMinutes,rules.recurring)&&!overlapsBusy(start, end, busy);});}
function formatDateFr(date) {return new Intl.DateTimeFormat('fr-CH',{timeZone:TIME_ZONE,weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(date));}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {res.setHeader('Allow', 'GET, POST');return json(res, 405, { error: 'Méthode non autorisée.' });}
  try {
    const token = await getAccessToken();
    const calendarId = getCalendarId();
    if (req.method === 'GET') {
      const date = String(req.query.date || '');
      const durationMinutes = Math.max(15, Math.min(240, Number(req.query.duration || 60)));
      if (!validDate(date)) return json(res, 400, { error: 'Date invalide.' });
      const [busy,rules]=await Promise.all([getBusy(token, calendarId, date),getRules(date)]);
      return json(res, 200, {date,timeZone: TIME_ZONE,busy,available: availableSlots(date, durationMinutes, busy,rules)});
    }

    const body = req.body || {};
    const { service: serviceName, date, time, durationMinutes, customer, note } = body;
    const duration = Number(durationMinutes);
    if (!serviceName || !validDate(date) || !validTime(time) || !Number.isFinite(duration) || duration < 15 || !customer?.email || !customer?.firstName || !customer?.lastName || !customer?.phone) return json(res, 400, { error: 'Informations de réservation incomplètes.' });

    const service = findService(serviceName);
    if (!service) return json(res, 400, { error: 'Prestation inconnue.', code: 'UNKNOWN_SERVICE' });
    const price = formatPrice(service);

    const start = zonedLocalToDate(date, time);
    const end = addMinutes(start, duration);
    const [busy,rules]=await Promise.all([getBusy(token, calendarId, date),getRules(date)]);
    if (!insideWeekly(date,time,duration,rules.weekly)||overlapsRecurring(date,time,duration,rules.recurring)||overlapsBusy(start,end,busy)) return json(res, 409, { error: 'Ce créneau n’est plus disponible. Merci d’en choisir un autre.', code: 'SLOT_UNAVAILABLE' });

    const description = [`Cliente : ${customer.firstName} ${customer.lastName}`,`Téléphone : ${customer.phone}`,`E-mail : ${customer.email}`,`Tarif : ${price}`,note ? `Note : ${note}` : null,'Réservation effectuée via nail-by-sandra-4fon.vercel.app'].filter(Boolean).join('\n');
    const event = {summary: `Nail by Sandra — ${service.name}`,description,start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },end: { dateTime: end.toISOString(), timeZone: TIME_ZONE }};
    const response = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {method: 'POST',headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },body: JSON.stringify(event)});
    const data = await response.json();
    if (!response.ok) throw new Error(`EVENT_${response.status}: ${data.error?.message || 'Impossible de créer le rendez-vous.'}`);

    let notificationSent=false;
    try {
      const message=['Nouvelle réservation reçue 💅','',`Cliente : ${customer.firstName} ${customer.lastName}`,`Prestation : ${service.name}`,`Date : ${formatDateFr(start)}`,`Heure : ${time}`,`Prix : ${price}`,`Téléphone : ${customer.phone}`,`E-mail : ${customer.email}`,note ? `Message : ${note}` : null,'','Le rendez-vous a été ajouté à ton calendrier.'].filter(Boolean).join('\n');
      await sendGmailToSelf({subject:`Nouveau rendez-vous — ${customer.firstName} ${customer.lastName}`,body:message});notificationSent=true;
    } catch (emailError) {console.error('Booking notification email:', emailError);}
    return json(res, 201, { success: true, eventId: data.id, htmlLink: data.htmlLink, notificationSent });
  } catch (error) {
    console.error('Google Calendar:', error);
    return json(res, 500, {error: 'La connexion à Google Calendar a échoué.',code: 'GOOGLE_CALENDAR_ERROR',diagnostic: error?.message || 'Erreur inconnue.'});
  }
}
