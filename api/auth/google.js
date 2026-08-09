import crypto from 'node:crypto';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Méthode non autorisée');

  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
  if (!required.every((key) => process.env[key])) {
    return res.status(503).send('Google OAuth n’est pas encore configuré sur Vercel.');
  }

  const state = crypto.randomBytes(24).toString('hex');
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${process.env.APP_URL}/api/auth/callback`,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/calendar'
  });

  res.setHeader('Set-Cookie', `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  params.set('state', state);
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
