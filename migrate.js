const fs = require('fs');
const path = require('path');
const db = require('./db');

async function runMigration() {
  try {
    console.log('Connecting to database...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Executing schema.sql...');
    await db.query(sql);

    console.log('Database migration applied successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    console.error('\nPlease verify your DATABASE_URL in .env:');
    console.error('- If using Neon/Supabase: copy your connection string with ?sslmode=require');
    console.error('- If running locally: ensure PostgreSQL service is installed and running.');
    process.exit(1);
  }
}

runMigration();
