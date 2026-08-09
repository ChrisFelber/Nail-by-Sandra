// Vercel serverless function for Nail by Sandra.
// Google Calendar credentials are intentionally read from environment variables.
// Required variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_CALENDAR_ID.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date invalide. Format attendu : AAAA-MM-JJ.' });
  }

  // Google Calendar connection will be activated once the OAuth credentials
  // are configured in Vercel. Until then, return a clear configuration error
  // rather than exposing credentials or using fake availability.
  const configured = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REFRESH_TOKEN',
    'GOOGLE_CALENDAR_ID'
  ].every((key) => process.env[key]);

  if (!configured) {
    return res.status(503).json({
      error: 'Google Calendar n’est pas encore configuré.',
      code: 'GOOGLE_CALENDAR_NOT_CONFIGURED'
    });
  }

  return res.status(501).json({
    error: 'La connexion Google Calendar doit être activée après la configuration OAuth.',
    date
  });
}
