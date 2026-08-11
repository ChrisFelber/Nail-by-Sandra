import { isAuthenticated } from '../lib/admin-auth.js';
import { getDb } from '../lib/db.js';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Méthode non autorisée.' });
  }
  if (!isAuthenticated(req)) return json(res, 401, { error: 'Non autorisé.' });

  try {
    const sql = getDb();
    const [appointments, expenses, tables] = await sql.transaction([
      sql`SELECT COUNT(*)::int AS count, COALESCE(SUM(total_amount_cents), 0)::int AS total_cents FROM appointments_accounting WHERE accounting_status = 'confirmed'`,
      sql`SELECT COUNT(*)::int AS count, COALESCE(SUM(amount_cents), 0)::int AS total_cents FROM expenses`,
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('appointments_accounting', 'appointment_items', 'expenses') ORDER BY table_name`
    ], { readOnly: true });

    return json(res, 200, {
      ok: true,
      database: {
        tables: tables.map(row => row.table_name),
        appointments: appointments[0],
        expenses: expenses[0]
      }
    });
  } catch (error) {
    console.error('Accounting database:', error);
    return json(res, 500, {
      ok: false,
      error: 'La connexion à la base comptable a échoué.',
      diagnostic: error?.message || 'Erreur inconnue.'
    });
  }
}
