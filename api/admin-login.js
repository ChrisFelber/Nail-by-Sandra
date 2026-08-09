import { createSessionToken, setSessionCookie, verifyPassword } from './_admin-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Mot de passe requis.' });
    if (!verifyPassword(password)) return res.status(401).json({ error: 'Mot de passe incorrect.' });

    setSessionCookie(res, createSessionToken());
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Admin login:', error);
    return res.status(500).json({ error: 'Connexion administratrice indisponible.' });
  }
}
