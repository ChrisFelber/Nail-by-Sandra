import { neon } from '@neondatabase/serverless';

let client;

export function getDb() {
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (!connectionString) throw new Error('DATABASE_URL_MISSING');
  if (!client) client = neon(connectionString);
  return client;
}
