export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Méthode non autorisée');

  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`Google OAuth : ${error}`);
  if (!code || !state) return res.status(400).send('Réponse OAuth incomplète.');

  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));

  if (!cookies.oauth_state || cookies.oauth_state !== state) {
    return res.status(400).send('État OAuth invalide. Veuillez recommencer la connexion.');
  }

  const params = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: `${process.env.APP_URL}/api/auth/callback`,
    grant_type: 'authorization_code'
  });

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok) {
    return res.status(502).json({ error: 'Google n’a pas accepté l’autorisation.', details: tokens });
  }

  res.setHeader('Set-Cookie', 'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  res.status(200).send(`Autorisation Google réussie.\n\nRefresh token reçu : ${tokens.refresh_token ? 'oui' : 'non'}\n\nAjoute le refresh token dans Vercel sous GOOGLE_REFRESH_TOKEN. Ne le publie jamais dans GitHub.`);
}
