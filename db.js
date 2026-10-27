const { Pool } = require('pg');
require('dotenv').config();

// Use direct connection URL (or pooled fallback)
const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_POOLED;

const isSsl = connectionString && (
  connectionString.includes('sslmode=require') ||
  connectionString.includes('neon.tech') ||
  connectionString.includes('supabase.co') ||
  process.env.NODE_ENV === 'production'
);

const pool = new Pool({
  connectionString,
  ssl: isSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
