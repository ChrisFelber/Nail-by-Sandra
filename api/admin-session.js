import { isAuthenticated } from '../lib/admin-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }
  return res.status(200).json({ authenticated: isAuthenticated(req) });
}
