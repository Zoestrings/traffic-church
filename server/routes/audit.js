const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/audit/verifications - Filtered Scan History
router.get('/verifications', authenticate, async (req, res) => {
  try {
    const orgId = req.organisation.id;
    const { outcome, limit = 50 } = req.query;

    const params = [orgId];
    let whereClauses = ['ve.organisation_id = $1'];

    if (outcome && outcome !== 'all') {
      params.push(outcome);
      whereClauses.push(`ve.outcome = $${params.length}`);
    }

    params.push(parseInt(limit, 10));

    const result = await db.query(`
      SELECT ve.*,
             i.full_name AS person_name, i.id_number, i.department,
             c.card_number,
             u.full_name AS scanned_by_name
      FROM verification_events ve
      LEFT JOIN identities i ON ve.identity_id = i.id
      LEFT JOIN id_cards c ON ve.card_id = c.id
      LEFT JOIN users u ON ve.scanned_by_user_id = u.id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY ve.created_at DESC
      LIMIT $${params.length}
    `, params);

    return res.json(result.rows);
  } catch (err) {
    console.error('Verification history error:', err);
    return res.status(500).json({ error: 'Failed to retrieve verification history.' });
  }
});

// GET /api/audit/logs - Administrative Audit Logs
router.get('/logs', authenticate, requireRole(['super_admin']), async (req, res) => {
  try {
    const orgId = req.organisation.id;
    const { limit = 50 } = req.query;

    const result = await db.query(`
      SELECT al.*, u.full_name AS user_name, u.email AS user_email
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.organisation_id = $1
      ORDER BY al.created_at DESC
      LIMIT $2
    `, [orgId, parseInt(limit, 10)]);

    return res.json(result.rows);
  } catch (err) {
    console.error('Audit logs error:', err);
    return res.status(500).json({ error: 'Failed to retrieve audit logs.' });
  }
});

module.exports = router;
