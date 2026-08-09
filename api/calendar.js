import crypto from 'node:crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TIME_ZONE = 'Europe/Zurich';

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function getServiceAccount() {
  // Prefer base64 to avoid JSON/newline formatting problems in Vercel.
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  const raw = encoded
    ? Buffer.from(encoded.trim(), 'base64').toString('utf8')
    : process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!raw) throw new Error('SERVICE_ACCOUNT_MISSING');

  let account;
  try {
    account = JSON.parse(raw);
  } catch (error) {
    throw new Error(`SERVICE_ACCOUNT_JSON_INVALID: ${error.message}`);
  }

  if (!account.client_email || !account.private_key) {
    throw new Error('SERVICE_ACCOUNT_INCOMPLETE');
  }

  account.private_key = account.private_key.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  return account;
}

async function getAccessToken() {
  const account = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(account.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`AUTH_${response.status}: ${data.error_description || data.error || 'TOKEN_ERROR'}`);
  }
  return data.access_token;
}

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { error: 'Méthode non autorisée.' });
  }

  try {
    const token = await getAccessToken();
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) throw new Error('CALENDAR_ID_MISSING');

    if (req.method === 'GET') {
      const { date, timeMin, timeMax } = req.query;
      if (!date && (!timeMin || !timeMax)) return json(res, 400, { error: 'Indiquez une date ou timeMin/timeMax.' });
      const start = timeMin || `${date}T00:00:00+02:00`;
      const end = timeMax || `${date}T23:59:59+02:00`;
      const response = await fetch(`${CALENDAR_API}/freeBusy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeMin: start, timeMax: end, timeZone: TIME_ZONE, items: [{ id: calendarId }] })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`CALENDAR_${response.status}: ${data.error?.message || 'CALENDAR_ERROR'}`);
      return json(res, 200, { timeZone: TIME_ZONE, busy: data.calendars?.[calendarId]?.busy || [] });
    }

    const { summary, description, start, end, customer } = req.body || {};
    if (!summary || !start || !end || !customer?.email) return json(res, 400, { error: 'Informations de réservation incomplètes.' });
    const event = {
      summary: `Nail by Sandra — ${summary}`,
      description: description || '',
      start: { dateTime: start, timeZone: TIME_ZONE },
      end: { dateTime: end, timeZone: TIME_ZONE },
      attendees: [{ email: customer.email, displayName: customer.name || undefined }]
    };
    const response = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`EVENT_${response.status}: ${data.error?.message || 'EVENT_ERROR'}`);
    return json(res, 201, { success: true, eventId: data.id, htmlLink: data.htmlLink });
  } catch (error) {
    console.error('Google Calendar:', error);
    return json(res, 500, { error: 'La connexion à Google Calendar a échoué.', code: 'GOOGLE_CALENDAR_ERROR', diagnostic: error?.message || 'UNKNOWN_ERROR' });
  }
}
