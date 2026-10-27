const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// Setup photo upload storage (in-memory for serverless & cloud persistence)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, PNG, WebP) are allowed.'));
    }
  }
});

// Helper to generate next unique ID Number: <PREFIX>-<YEAR>-<SEQ>
async function generateIdNumber(client, orgId, prefix) {
  const year = new Date().getFullYear();
  const searchPattern = `${prefix}-${year}-%`;

  const seqRes = await client.query(`
    SELECT id_number FROM identities
    WHERE organisation_id = $1 AND id_number LIKE $2
    ORDER BY id DESC LIMIT 1
  `, [orgId, searchPattern]);

  let nextSeq = 1;
  if (seqRes.rows.length > 0) {
    const parts = seqRes.rows[0].id_number.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) {
      nextSeq = lastNum + 1;
    }
  }

  return `${prefix}-${year}-${String(nextSeq).padStart(3, '0')}`;
}

// GET /api/identities - List & Search
router.get('/', authenticate, async (req, res) => {
  try {
    const orgId = req.organisation.id;
    const { search, status, department, page = 1, limit = 15 } = req.query;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [orgId];
    let whereClauses = ['i.organisation_id = $1'];

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      whereClauses.push(`(i.full_name ILIKE $${params.length} OR i.id_number ILIKE $${params.length} OR i.email ILIKE $${params.length})`);
    }

    if (status && status !== 'all') {
      params.push(status);
      whereClauses.push(`i.status = $${params.length}`);
    }

    if (department && department !== 'all') {
      params.push(department);
      whereClauses.push(`i.department = $${params.length}`);
    }

    const whereSql = whereClauses.join(' AND ');

    // Total count query
    const countRes = await db.query(`SELECT COUNT(*) FROM identities i WHERE ${whereSql}`, params);
    const totalCount = parseInt(countRes.rows[0].count, 10);

    // List query with current active card join
    params.push(parseInt(limit, 10));
    params.push(offset);
    const listRes = await db.query(`
      SELECT i.*,
             c.id AS current_card_id,
             c.card_number,
             c.status AS card_status,
             c.verification_token,
             c.issue_date,
             c.expiry_date
      FROM identities i
      LEFT JOIN id_cards c ON i.id = c.identity_id AND c.is_current = TRUE
      WHERE ${whereSql}
      ORDER BY i.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return res.json({
      identities: listRes.rows,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit, 10))
      }
    });
  } catch (err) {
    console.error('List identities error:', err);
    return res.status(500).json({ error: 'Failed to retrieve identities.' });
  }
});

// GET /api/identities/:id - Details & Card History
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.organisation.id;

    const personRes = await db.query(
      'SELECT * FROM identities WHERE id = $1 AND organisation_id = $2',
      [id, orgId]
    );

    if (personRes.rows.length === 0) {
      return res.status(404).json({ error: 'Identity record not found.' });
    }

    // Retrieve all cards ever issued to this person
    const cardsRes = await db.query(`
      SELECT * FROM id_cards
      WHERE identity_id = $1 AND organisation_id = $2
      ORDER BY created_at DESC
    `, [id, orgId]);

    // Retrieve recent scans for this identity
    const scansRes = await db.query(`
      SELECT ve.*, u.full_name AS scanned_by_name
      FROM verification_events ve
      LEFT JOIN users u ON ve.scanned_by_user_id = u.id
      WHERE ve.identity_id = $1 AND ve.organisation_id = $2
      ORDER BY ve.created_at DESC
      LIMIT 10
    `, [id, orgId]);

    return res.json({
      identity: personRes.rows[0],
      cards: cardsRes.rows,
      recentScans: scansRes.rows
    });
  } catch (err) {
    console.error('Get identity error:', err);
    return res.status(500).json({ error: 'Failed to retrieve identity details.' });
  }
});

// POST /api/identities - Register New Person & Issue Card (Transaction)
router.post(
  '/',
  authenticate,
  requireRole(['super_admin', 'identity_manager']),
  upload.single('photo'),
  async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const orgId = req.organisation.id;
      let {
        fullName,
        firstName,
        lastName,
        title,
        email,
        phone,
        department,
        branch = 'Main Sanctuary',
        position,
        dateOfBirth,
        emergencyContactName,
        emergencyContactPhone,
        bio,
        status = 'active',
        approvalStatus = 'approved'
      } = req.body;

      if (!fullName && (firstName || lastName)) {
        fullName = `${firstName || ''} ${lastName || ''}`.trim();
      }

      if (!fullName || !fullName.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Full legal name is required.' });
      }

      let photoUrl = req.body.photoUrl || null;
      if (req.file) {
        photoUrl = `data:${req.file.mimetype || 'image/jpeg'};base64,${req.file.buffer.toString('base64')}`;
      }

      // Generate unique ID number for organization
      const idNumber = await generateIdNumber(client, orgId, req.organisation.id_prefix || 'GCI');

      // 1. Insert Identity (Permanent Person Record)
      const identityRes = await client.query(`
        INSERT INTO identities (
          organisation_id, id_number, full_name, first_name, last_name, title,
          email, phone, date_of_birth, department, branch, position, photo_url,
          status, approval_status, emergency_contact_name, emergency_contact_phone, bio
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        ) RETURNING *
      `, [
        orgId,
        idNumber,
        fullName.trim(),
        firstName ? firstName.trim() : null,
        lastName ? lastName.trim() : null,
        title ? title.trim() : null,
        email ? email.trim() : null,
        phone ? phone.trim() : null,
        dateOfBirth || null,
        department ? department.trim() : null,
        branch ? branch.trim() : 'Main Sanctuary',
        position ? position.trim() : null,
        photoUrl,
        status,
        approvalStatus,
        emergencyContactName ? emergencyContactName.trim() : null,
        emergencyContactPhone ? emergencyContactPhone.trim() : null,
        bio ? bio.trim() : null
      ]);

      const identity = identityRes.rows[0];

      // 2. Issue Initial Active Physical ID Card
      const verificationToken = crypto.randomBytes(24).toString('hex');
      const cardNumber = `CRD-${idNumber}-01`;
      const issueDate = new Date();
      const expiryDate = new Date();
      expiryDate.setDate(issueDate.getDate() + 365); // 1 year validity

      const cardRes = await client.query(`
        INSERT INTO id_cards (
          identity_id, organisation_id, card_number, verification_token,
          status, issue_date, expiry_date, is_current
        ) VALUES (
          $1, $2, $3, $4, 'active', $5, $6, TRUE
        ) RETURNING *
      `, [identity.id, orgId, cardNumber, verificationToken, issueDate, expiryDate]);

      // 3. Audit Log
      await client.query(`
        INSERT INTO audit_logs (organisation_id, user_id, action, record_type, record_id, change_summary, ip_address)
        VALUES ($1, $2, 'IDENTITY_REGISTERED', 'identity', $3, $4, $5)
      `, [
        orgId,
        req.user.id,
        identity.id,
        `Registered ${identity.full_name} (${identity.id_number}) and issued card ${cardNumber}`,
        req.ip || '127.0.0.1'
      ]);

      await client.query('COMMIT');

      return res.status(201).json({
        identity,
        card: cardRes.rows[0]
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Identity creation error:', err);
      return res.status(500).json({ error: 'Failed to create identity record.' });
    } finally {
      client.release();
    }
  }
);

// PUT /api/identities/:id - Update Identity
router.put(
  '/:id',
  authenticate,
  requireRole(['super_admin', 'identity_manager']),
  upload.single('photo'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const orgId = req.organisation.id;

      // 1. Fetch current record for historical diff tracking
      const currentRes = await db.query(
        'SELECT * FROM identities WHERE id = $1 AND organisation_id = $2',
        [id, orgId]
      );
      if (currentRes.rows.length === 0) {
        return res.status(404).json({ error: 'Identity not found.' });
      }
      const prev = currentRes.rows[0];

      let {
        fullName,
        title,
        email,
        phone,
        department,
        branch,
        position,
        dateOfBirth,
        emergencyContactName,
        emergencyContactPhone,
        bio,
        status,
        approvalStatus,
        reason = 'Administrative correction of personnel profile'
      } = req.body;

      let photoUrl = req.body.photoUrl;
      if (req.file) {
        photoUrl = `data:${req.file.mimetype || 'image/jpeg'};base64,${req.file.buffer.toString('base64')}`;
      }

      const updateRes = await db.query(`
        UPDATE identities SET
          full_name = COALESCE($1, full_name),
          title = COALESCE($2, title),
          email = COALESCE($3, email),
          phone = COALESCE($4, phone),
          department = COALESCE($5, department),
          branch = COALESCE($6, branch),
          position = COALESCE($7, position),
          date_of_birth = COALESCE($8, date_of_birth),
          emergency_contact_name = COALESCE($9, emergency_contact_name),
          emergency_contact_phone = COALESCE($10, emergency_contact_phone),
          bio = COALESCE($11, bio),
          status = COALESCE($12, status),
          approval_status = COALESCE($13, approval_status),
          photo_url = COALESCE($14, photo_url),
          updated_at = NOW()
        WHERE id = $15 AND organisation_id = $16
        RETURNING *
      `, [
        fullName,
        title,
        email,
        phone,
        department,
        branch,
        position,
        dateOfBirth || null,
        emergencyContactName,
        emergencyContactPhone,
        bio,
        status,
        approvalStatus,
        photoUrl || null,
        id,
        orgId
      ]);

      const updated = updateRes.rows[0];

      // Prepare audit log diff
      const previousValues = {
        fullName: prev.full_name,
        title: prev.title,
        department: prev.department,
        branch: prev.branch,
        position: prev.position,
        status: prev.status,
        approvalStatus: prev.approval_status,
        photoUrl: prev.photo_url
      };

      const newValues = {
        fullName: updated.full_name,
        title: updated.title,
        department: updated.department,
        branch: updated.branch,
        position: updated.position,
        status: updated.status,
        approvalStatus: updated.approval_status,
        photoUrl: updated.photo_url
      };

      await db.query(`
        INSERT INTO audit_logs (
          organisation_id, user_id, action, record_type, record_id,
          change_summary, previous_values, new_values, reason, ip_address
        ) VALUES ($1, $2, 'PERSONNEL_CORRECTION', 'identity', $3, $4, $5, $6, $7, $8)
      `, [
        orgId,
        req.user.id,
        id,
        `Super Admin corrected personnel profile for ${updated.full_name} (${updated.id_number}): ${reason}`,
        JSON.stringify(previousValues),
        JSON.stringify(newValues),
        reason,
        req.ip || '127.0.0.1'
      ]);

      return res.json(updated);
    } catch (err) {
      console.error('Update identity error:', err);
      return res.status(500).json({ error: 'Failed to update identity.' });
    }
  }
);

module.exports = router;
