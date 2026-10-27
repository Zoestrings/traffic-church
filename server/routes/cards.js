const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const qrcode = require('qrcode');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL && !process.env.PUBLIC_BASE_URL.includes('localhost')) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  }
  if (req && req.headers && req.headers.host && !req.headers.host.includes('localhost')) {
    return `${req.protocol || 'http'}://${req.headers.host}`;
  }
  return process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/$/, '') : 'http://localhost:3000';
}

// POST /api/cards/:id/revoke - Revoke a card
router.post('/:id/revoke', authenticate, requireRole(['super_admin', 'identity_manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = 'Revoked by administrator' } = req.body;
    const orgId = req.organisation.id;

    const result = await db.query(`
      UPDATE id_cards
      SET status = 'revoked',
          revoked_at = NOW(),
          revocation_reason = $1
      WHERE id = $2 AND organisation_id = $3
      RETURNING *
    `, [reason, id, orgId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found.' });
    }

    const card = result.rows[0];

    // Audit log
    await db.query(`
      INSERT INTO audit_logs (organisation_id, user_id, action, record_type, record_id, change_summary, ip_address)
      VALUES ($1, $2, 'CARD_REVOKED', 'card', $3, $4, $5)
    `, [orgId, req.user.id, id, `Revoked card ${card.card_number}: ${reason}`, req.ip || '127.0.0.1']);

    return res.json({ message: 'Card successfully revoked.', card });
  } catch (err) {
    console.error('Revoke card error:', err);
    return res.status(500).json({ error: 'Failed to revoke card.' });
  }
});

// POST /api/cards/:id/suspend
router.post('/:id/suspend', authenticate, requireRole(['super_admin', 'identity_manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.organisation.id;

    const result = await db.query(`
      UPDATE id_cards SET status = 'suspended'
      WHERE id = $1 AND organisation_id = $2
      RETURNING *
    `, [id, orgId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found.' });
    }

    await db.query(`
      INSERT INTO audit_logs (organisation_id, user_id, action, record_type, record_id, change_summary, ip_address)
      VALUES ($1, $2, 'CARD_SUSPENDED', 'card', $3, 'Card suspended temporarily', $4)
    `, [orgId, req.user.id, id, req.ip || '127.0.0.1']);

    return res.json({ message: 'Card suspended.', card: result.rows[0] });
  } catch (err) {
    console.error('Suspend card error:', err);
    return res.status(500).json({ error: 'Failed to suspend card.' });
  }
});

// POST /api/cards/:id/activate
router.post('/:id/activate', authenticate, requireRole(['super_admin', 'identity_manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.organisation.id;

    const result = await db.query(`
      UPDATE id_cards SET status = 'active'
      WHERE id = $1 AND organisation_id = $2
      RETURNING *
    `, [id, orgId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found.' });
    }

    await db.query(`
      INSERT INTO audit_logs (organisation_id, user_id, action, record_type, record_id, change_summary, ip_address)
      VALUES ($1, $2, 'CARD_ACTIVATED', 'card', $3, 'Card reactivated', $4)
    `, [orgId, req.user.id, id, req.ip || '127.0.0.1']);

    return res.json({ message: 'Card activated.', card: result.rows[0] });
  } catch (err) {
    console.error('Activate card error:', err);
    return res.status(500).json({ error: 'Failed to activate card.' });
  }
});

// POST /api/identities/:identityId/reissue-card
router.post('/reissue/:identityId', authenticate, requireRole(['super_admin', 'identity_manager']), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { identityId } = req.params;
    const orgId = req.organisation.id;
    const { reason = 'Card replacement / renewal' } = req.body;

    const idRes = await client.query('SELECT * FROM identities WHERE id = $1 AND organisation_id = $2', [identityId, orgId]);
    if (idRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Identity not found.' });
    }
    const identity = idRes.rows[0];

    // Mark previous current cards as revoked/replaced
    const currentCardRes = await client.query(`
      SELECT id, card_number FROM id_cards
      WHERE identity_id = $1 AND organisation_id = $2 AND is_current = TRUE
    `, [identityId, orgId]);

    let previousCardId = null;
    if (currentCardRes.rows.length > 0) {
      previousCardId = currentCardRes.rows[0].id;
      await client.query(`
        UPDATE id_cards
        SET is_current = FALSE,
            status = 'revoked',
            revoked_at = NOW(),
            revocation_reason = $1
        WHERE id = $2
      `, [`Replaced by new card reissuance (${reason})`, previousCardId]);
    }

    // Determine sequence number for card
    const allCardsCountRes = await client.query(
      'SELECT COUNT(*) FROM id_cards WHERE identity_id = $1',
      [identityId]
    );
    const seq = parseInt(allCardsCountRes.rows[0].count, 10) + 1;
    const newCardNumber = `CRD-${identity.id_number}-${String(seq).padStart(2, '0')}`;
    const newToken = crypto.randomBytes(24).toString('hex');
    const issueDate = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(issueDate.getDate() + 365);

    const newCardRes = await client.query(`
      INSERT INTO id_cards (
        identity_id, organisation_id, card_number, verification_token,
        status, issue_date, expiry_date, is_current, reissued_from_card_id
      ) VALUES (
        $1, $2, $3, $4, 'active', $5, $6, TRUE, $7
      ) RETURNING *
    `, [identityId, orgId, newCardNumber, newToken, issueDate, expiryDate, previousCardId]);

    await client.query(`
      INSERT INTO audit_logs (organisation_id, user_id, action, record_type, record_id, change_summary, ip_address)
      VALUES ($1, $2, 'CARD_REISSUED', 'card', $3, $4, $5)
    `, [orgId, req.user.id, newCardRes.rows[0].id, `Reissued new card ${newCardNumber} for ${identity.full_name}`, req.ip || '127.0.0.1']);

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Card successfully reissued.',
      newCard: newCardRes.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reissue card error:', err);
    return res.status(500).json({ error: 'Failed to reissue card.' });
  } finally {
    client.release();
  }
});

// GET /api/cards/:id/qr - High-res PNG QR Code with quiet zone
router.get('/:id/qr', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT verification_token FROM id_cards WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).send('Card not found.');
    }

    const token = result.rows[0].verification_token;
    const baseUrl = getPublicBaseUrl(req);
    const verifyUrl = `${baseUrl}/verify/${token}`;

    res.type('png');
    await qrcode.toFileStream(res, verifyUrl, {
      width: 340,
      margin: 3,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#0b132b',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('Card QR error:', err);
    if (!res.headersSent) {
      res.status(500).send('Error generating QR code.');
    }
  }
});

module.exports = router;
