const db = require('./server/db');

async function upgradeGciSchema() {
  console.log('--- Upgrading GCI Personnel & Credential Schema ---');

  try {
    // 1. Add branch and approval_status to identities if not existing
    await db.query(`
      ALTER TABLE identities
      ADD COLUMN IF NOT EXISTS branch VARCHAR(150) DEFAULT 'Main Sanctuary',
      ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) DEFAULT 'approved';
    `);
    console.log('✓ Added branch and approval_status columns to identities table.');

    // 2. Add previous_values, new_values, and reason to audit_logs if not existing
    await db.query(`
      ALTER TABLE audit_logs
      ADD COLUMN IF NOT EXISTS previous_values JSONB,
      ADD COLUMN IF NOT EXISTS new_values JSONB,
      ADD COLUMN IF NOT EXISTS reason TEXT;
    `);
    console.log('✓ Added previous_values, new_values, and reason columns to audit_logs table.');

    // 3. Update existing seed records to have default branch
    await db.query(`
      UPDATE identities
      SET branch = 'Main Sanctuary (Headquarters)'
      WHERE branch IS NULL OR branch = 'Main Sanctuary';
    `);
    console.log('✓ Updated existing personnel records with branch information.');

    console.log('\n--- GCI Schema Upgrade Complete! ---');
    process.exit(0);
  } catch (err) {
    console.error('Schema upgrade error:', err);
    process.exit(1);
  }
}

upgradeGciSchema();
