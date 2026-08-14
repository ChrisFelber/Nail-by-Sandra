import { createSessionToken, setSessionCookie, verifyPassword } from '../lib/admin-auth.js';
import { getDb } from '../lib/db.js';
import { checkRateLimit, recordFailedAttempt, clearAttempts } from '../lib/rate-limit.js';

const SCOPE = 'admin-login';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    const sql = getDb();
    const { limited, retryAfterSeconds } = await checkRateLimit(sql, req, { scope: SCOPE, limit: 8, windowMinutes: 15 });
    if (limited) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez plus tard.', retryAfterSeconds });
    }

    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Mot de passe requis.' });
    if (!verifyPassword(password)) {
      await recordFailedAttempt(sql, req, SCOPE);
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }

    await clearAttempts(sql, req, SCOPE);
    setSessionCookie(res, createSessionToken());
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Admin login:', error);
    const code = String(error?.message || 'ADMIN_LOGIN_ERROR');
    const known = ['ADMIN_PASSWORD_HASH_MISSING','ADMIN_PASSWORD_HASH_INVALID','ADMIN_SESSION_SECRET_MISSING'];
    return res.status(500).json({
      error: 'Connexion administratrice indisponible.',
      diagnostic: known.includes(code) ? code : 'ADMIN_LOGIN_ERROR'
    });
  }
}
