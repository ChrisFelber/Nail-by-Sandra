import { clearSessionCookie } from '../lib/admin-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }
  clearSessionCookie(res);
  return res.status(200).json({ success: true });
}
