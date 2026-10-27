const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/organisation/settings
router.get('/settings', authenticate, async (req, res) => {
  try {
    const orgRes = await db.query('SELECT * FROM organisations WHERE id = $1', [req.organisation.id]);
    if (orgRes.rows.length === 0) {
      return res.status(404).json({ error: 'Organisation not found.' });
    }
    return res.json(orgRes.rows[0]);
  } catch (err) {
    console.error('Get settings error:', err);
    return res.status(500).json({ error: 'Failed to retrieve settings.' });
  }
});

// PUT /api/organisation/settings - Update Branding & Policies
router.put('/settings', authenticate, requireRole(['super_admin']), async (req, res) => {
  try {
    const orgId = req.organisation.id;
    const {
      name,
      logoUrl,
      brandColor,
      accentColor,
      idPrefix,
      defaultValidityDays,
      contactEmail,
      contactPhone,
      verificationInstructions
    } = req.body;

    const result = await db.query(`
      UPDATE organisations SET
        name = COALESCE($1, name),
        logo_url = COALESCE($2, logo_url),
        brand_color = COALESCE($3, brand_color),
        accent_color = COALESCE($4, accent_color),
        id_prefix = COALESCE($5, id_prefix),
        default_validity_days = COALESCE($6, default_validity_days),
        contact_email = COALESCE($7, contact_email),
        contact_phone = COALESCE($8, contact_phone),
        verification_instructions = COALESCE($9, verification_instructions),
        updated_at = NOW()
      WHERE id = $10
      RETURNING *
    `, [
      name,
      logoUrl,
      brandColor,
      accentColor,
      idPrefix,
      defaultValidityDays ? parseInt(defaultValidityDays, 10) : null,
      contactEmail,
      contactPhone,
      verificationInstructions,
      orgId
    ]);

    await db.query(`
      INSERT INTO audit_logs (organisation_id, user_id, action, record_type, record_id, change_summary, ip_address)
      VALUES ($1, $2, 'ORGANISATION_SETTINGS_UPDATED', 'organisation', $1, 'Updated organisation branding & verification settings', $3)
    `, [orgId, req.user.id, req.ip || '127.0.0.1']);

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Update settings error:', err);
    return res.status(500).json({ error: 'Failed to update organisation settings.' });
  }
});

// GET /api/organisation/team - List Team Members
router.get('/team', authenticate, requireRole(['super_admin']), async (req, res) => {
  try {
    const orgId = req.organisation.id;
    const teamRes = await db.query(`
      SELECT om.id AS membership_id, om.role, om.created_at,
             u.id AS user_id, u.email, u.full_name, u.is_active
      FROM organisation_memberships om
      JOIN users u ON om.user_id = u.id
      WHERE om.organisation_id = $1
      ORDER BY om.id ASC
    `, [orgId]);

    return res.json(teamRes.rows);
  } catch (err) {
    console.error('List team error:', err);
    return res.status(500).json({ error: 'Failed to retrieve team accounts.' });
  }
});

// POST /api/organisation/team - Add Team Member
router.post('/team', authenticate, requireRole(['super_admin']), async (req, res) => {
  try {
    const orgId = req.organisation.id;
    const { email, fullName, password, role = 'verification_operator' } = req.body;

    if (!email || !fullName || !password) {
      return res.status(400).json({ error: 'Email, Full Name, and Password are required.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Create user or fetch existing
    let userId;
    const existingUser = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id;
    } else {
      const newUser = await db.query(`
        INSERT INTO users (email, password_hash, full_name)
        VALUES (LOWER($1), $2, $3)
        RETURNING id
      `, [email.trim(), passwordHash, fullName.trim()]);
      userId = newUser.rows[0].id;
    }

    // Add membership
    const memberRes = await db.query(`
      INSERT INTO organisation_memberships (organisation_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (organisation_id, user_id)
      DO UPDATE SET role = EXCLUDED.role
      RETURNING *
    `, [orgId, userId, role]);

    await db.query(`
      INSERT INTO audit_logs (organisation_id, user_id, action, record_type, record_id, change_summary, ip_address)
      VALUES ($1, $2, 'TEAM_MEMBER_ADDED', 'user', $3, $4, $5)
    `, [orgId, req.user.id, userId, `Added ${fullName} (${email}) with role ${role}`, req.ip || '127.0.0.1']);

    return res.status(201).json({ message: 'Team member added successfully.', membership: memberRes.rows[0] });
  } catch (err) {
    console.error('Add team error:', err);
    return res.status(500).json({ error: 'Failed to create team member.' });
  }
});

module.exports = router;
