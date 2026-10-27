require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');
const crypto = require('crypto');

async function migrate() {
  console.log('--- Applying Enterprise Schema V2 Migration ---');
  const sql = fs.readFileSync(path.join(__dirname, 'schema_v2.sql'), 'utf8');

  try {
    await db.query(sql);
    console.log('✓ Tables, constraints and indexes created successfully.');

    // Seed default organisation: Grace Chapel International
    const orgCheck = await db.query("SELECT id FROM organisations WHERE slug = 'gci'");
    let orgId;
    if (orgCheck.rows.length === 0) {
      const orgRes = await db.query(`
        INSERT INTO organisations (
          name, slug, logo_url, brand_color, accent_color, id_prefix, default_validity_days, contact_email, verification_instructions
        ) VALUES (
          'Grace Chapel International',
          'gci',
          'https://images.unsplash.com/photo-1548625361-195973d43d14?w=200&auto=format&fit=crop&q=80',
          '#0b132b',
          '#2563eb',
          'GCI',
          365,
          'security@gracechapel.org',
          'Official verification portal for Grace Chapel International and Marshal Command.'
        ) RETURNING id
      `);
      orgId = orgRes.rows[0].id;
      console.log('✓ Created default organization (GCI) with ID:', orgId);
    } else {
      orgId = orgCheck.rows[0].id;
      console.log('✓ Found existing organization (GCI) with ID:', orgId);
    }

    // Seed Super Admin User (password: admin123)
    // bcrypt hash of 'admin123'
    const defaultPasswordHash = '$2a$10$wT8m9aI0M1YqNq0tG9k6uea33F0F4vMhQZc7OQ9kZq33X1mI1lE4O'; // bcrypt for admin123
    const userCheck = await db.query("SELECT id FROM users WHERE email = 'admin@gracechapel.org'");
    let adminUserId;
    if (userCheck.rows.length === 0) {
      const userRes = await db.query(`
        INSERT INTO users (email, password_hash, full_name)
        VALUES ('admin@gracechapel.org', $1, 'Chief Security Administrator')
        RETURNING id
      `, [defaultPasswordHash]);
      adminUserId = userRes.rows[0].id;
      console.log('✓ Created default Super Admin user (admin@gracechapel.org) with ID:', adminUserId);
    } else {
      adminUserId = userCheck.rows[0].id;
      console.log('✓ Found existing Super Admin user with ID:', adminUserId);
    }

    // Ensure membership exists
    const memCheck = await db.query(
      'SELECT id FROM organisation_memberships WHERE organisation_id = $1 AND user_id = $2',
      [orgId, adminUserId]
    );
    if (memCheck.rows.length === 0) {
      await db.query(`
        INSERT INTO organisation_memberships (organisation_id, user_id, role)
        VALUES ($1, $2, 'super_admin')
      `, [orgId, adminUserId]);
      console.log('✓ Granted super_admin role to admin user in GCI.');
    }

    // Seed an initial identity if none exists
    const idCheck = await db.query('SELECT id FROM identities WHERE organisation_id = $1', [orgId]);
    if (idCheck.rows.length === 0) {
      const idRes = await db.query(`
        INSERT INTO identities (
          organisation_id, id_number, full_name, first_name, last_name, title, email, phone,
          department, position, photo_url, status, bio
        ) VALUES (
          $1, 'GCI-2026-001', 'David Olawale Oyedele', 'David', 'Oyedele', 'Pastor',
          'david.oyedele@gracechapel.org', '+234 802 345 6789',
          'Traffic Operations Directorate', 'Chief Traffic Marshal',
          'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
          'active',
          'Serving as Chief Traffic Marshal and Operations Lead since 2015.'
        ) RETURNING id
      `, [orgId]);
      const personId = idRes.rows[0].id;

      // Issue initial active ID card with cryptographically secure token
      const token = crypto.randomBytes(24).toString('hex');
      const today = new Date();
      const expiry = new Date();
      expiry.setDate(today.getDate() + 365);

      await db.query(`
        INSERT INTO id_cards (
          identity_id, organisation_id, card_number, verification_token, status, issue_date, expiry_date, is_current
        ) VALUES (
          $1, $2, 'CARD-GCI-001-A', $3, 'active', $4, $5, TRUE
        )
      `, [personId, orgId, token, today, expiry]);
      console.log('✓ Seeded initial member (David Olawale Oyedele) with active card token:', token);
    }

    console.log('\n--- Migration V2 completed successfully! ---');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
