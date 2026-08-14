// Simple DB-backed rate limiter for login endpoints.
// Serverless functions have no shared memory between invocations, so counters
// live in Postgres (same DB already used for everything else) instead of RAM.

async function ensure(sql) {
  await sql`CREATE TABLE IF NOT EXISTS login_attempts (
    id BIGSERIAL PRIMARY KEY,
    ip TEXT NOT NULL,
    scope TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS login_attempts_ip_scope_idx ON login_attempts (ip, scope, created_at)`;
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

/**
 * Checks whether a given IP has exceeded the allowed number of failed
 * attempts for a scope (e.g. 'admin-login', 'client-login') within a
 * rolling time window. Does NOT record an attempt by itself.
 *
 * Returns { limited: boolean, retryAfterSeconds: number }
 */
async function checkRateLimit(sql, req, { scope, limit = 8, windowMinutes = 15 }) {
  await ensure(sql);
  const ip = clientIp(req);
  const rows = await sql`
    SELECT count(*)::int AS attempts, min(created_at) AS oldest
    FROM login_attempts
    WHERE ip = ${ip} AND scope = ${scope} AND created_at > NOW() - (${windowMinutes} || ' minutes')::interval
  `;
  const attempts = rows[0]?.attempts || 0;
  if (attempts < limit) return { limited: false, ip };
  const oldest = rows[0].oldest ? new Date(rows[0].oldest) : new Date();
  const retryAfterSeconds = Math.max(1, Math.ceil((oldest.getTime() + windowMinutes * 60000 - Date.now()) / 1000));
  return { limited: true, retryAfterSeconds, ip };
}

/** Records a failed login attempt for an IP + scope. */
async function recordFailedAttempt(sql, req, scope) {
  await ensure(sql);
  const ip = clientIp(req);
  await sql`INSERT INTO login_attempts (ip, scope) VALUES (${ip}, ${scope})`;
}

/** Clears attempts for an IP + scope, e.g. after a successful login. */
async function clearAttempts(sql, req, scope) {
  const ip = clientIp(req);
  await sql`DELETE FROM login_attempts WHERE ip = ${ip} AND scope = ${scope}`;
}

export { checkRateLimit, recordFailedAttempt, clearAttempts, clientIp };
