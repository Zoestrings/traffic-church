const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

// In-memory cache keyed by organisation_id (TTL: 2 minutes for full stats, 5 minutes for chart)
const statsCache = new Map();
const chartCache = new Map();
const STATS_CACHE_TTL = 2 * 60 * 1000;  // 2 minutes
const CHART_CACHE_TTL = 5 * 60 * 1000;  // 5 minutes

function invalidateDashboardCache(orgId) {
  if (orgId) {
    statsCache.delete(orgId);
    chartCache.delete(orgId);
  } else {
    statsCache.clear();
    chartCache.clear();
  }
}

// GET /api/dashboard/chart-data - 7-day timeline volume (5-minute cache)
router.get('/chart-data', authenticate, async (req, res) => {
  try {
    const orgId = req.organisation.id;
    const now = Date.now();
    const cached = chartCache.get(orgId);

    if (cached && (now - cached.timestamp < CHART_CACHE_TTL) && req.query.refresh !== '1') {
      return res.json(cached.data);
    }

    const dailyScansRes = await db.query(`
      SELECT 
        TO_CHAR(d.day, 'Mon DD') as label,
        d.day::date as date,
        COUNT(ve.id)::int as count,
        COUNT(ve.id) FILTER (WHERE ve.outcome = 'verified')::int as verified_count
      FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day'::interval) d(day)
      LEFT JOIN verification_events ve 
        ON DATE(ve.created_at) = d.day::date AND ve.organisation_id = $1
      GROUP BY d.day
      ORDER BY d.day ASC
    `, [orgId]).catch(() => ({ rows: [] }));

    const chartData = dailyScansRes.rows || [];
    chartCache.set(orgId, { data: chartData, timestamp: now });

    return res.json(chartData);
  } catch (err) {
    console.error('Chart data error:', err);
    return res.status(500).json({ error: 'Failed to retrieve chart telemetry.' });
  }
});

// GET /api/dashboard/stats
router.get('/stats', authenticate, async (req, res) => {
  try {
    const orgId = req.organisation.id;
    const now = Date.now();
    const cached = statsCache.get(orgId);

    if (cached && (now - cached.timestamp < STATS_CACHE_TTL) && req.query.refresh !== '1') {
      return res.json(cached.data);
    }

    // 1. Identity breakdown
    const idStatsRes = await db.query(`
      SELECT
        COUNT(*) AS total_identities,
        COUNT(*) FILTER (WHERE status = 'active') AS active_identities,
        COUNT(*) FILTER (WHERE status = 'suspended') AS suspended_identities,
        COUNT(*) FILTER (WHERE status = 'expired') AS expired_identities,
        COUNT(*) FILTER (WHERE status = 'archived') AS archived_identities
      FROM identities
      WHERE organisation_id = $1
    `, [orgId]);

    // 2. Card breakdown
    const cardStatsRes = await db.query(`
      SELECT
        COUNT(*) AS total_cards,
        COUNT(*) FILTER (WHERE status = 'active' AND is_current = TRUE) AS active_cards,
        COUNT(*) FILTER (WHERE status = 'revoked') AS revoked_cards,
        COUNT(*) FILTER (WHERE status = 'expired') AS expired_cards,
        COUNT(*) FILTER (WHERE status = 'suspended') AS suspended_cards
      FROM id_cards
      WHERE organisation_id = $1
    `, [orgId]);

    // 3. Verification breakdown (last 30 days)
    const verifStatsRes = await db.query(`
      SELECT
        COUNT(*) AS total_scans,
        COUNT(*) FILTER (WHERE outcome = 'verified') AS verified_scans,
        COUNT(*) FILTER (WHERE outcome = 'revoked') AS revoked_scans,
        COUNT(*) FILTER (WHERE outcome = 'expired') AS expired_scans,
        COUNT(*) FILTER (WHERE outcome = 'invalid') AS invalid_scans
      FROM verification_events
      WHERE organisation_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
    `, [orgId]);

    // 4. Recent verification activity
    const recentVerifsRes = await db.query(`
      SELECT ve.id, ve.outcome, ve.created_at, ve.ip_address, ve.failure_category,
             i.full_name AS person_name, i.id_number,
             u.full_name AS scanned_by_name
      FROM verification_events ve
      LEFT JOIN identities i ON ve.identity_id = i.id
      LEFT JOIN users u ON ve.scanned_by_user_id = u.id
      WHERE ve.organisation_id = $1
      ORDER BY ve.created_at DESC
      LIMIT 8
    `, [orgId]);

    // 5. Recently registered people
    const recentPeopleRes = await db.query(`
      SELECT i.id, i.id_number, i.full_name, i.title, i.department, i.position,
             i.photo_url, i.status, i.created_at,
             c.card_number, c.status AS card_status, c.verification_token
      FROM identities i
      LEFT JOIN id_cards c ON i.id = c.identity_id AND c.is_current = TRUE
      WHERE i.organisation_id = $1
      ORDER BY i.created_at DESC
      LIMIT 8
    `, [orgId]);

    // 6. Active attendance session
    const activeSessionRes = await db.query(`
      SELECT * FROM attendance_sessions WHERE is_active = true ORDER BY created_at DESC LIMIT 1
    `).catch(() => ({ rows: [] }));

    // 7. 7-day verification timeline for the Helios volume chart
    const dailyScansRes = await db.query(`
      SELECT 
        TO_CHAR(d.day, 'Mon DD') as label,
        d.day::date as date,
        COUNT(ve.id)::int as count,
        COUNT(ve.id) FILTER (WHERE ve.outcome = 'verified')::int as verified_count
      FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day'::interval) d(day)
      LEFT JOIN verification_events ve 
        ON DATE(ve.created_at) = d.day::date AND ve.organisation_id = $1
      GROUP BY d.day
      ORDER BY d.day ASC
    `, [orgId]).catch(() => ({ rows: [] }));

    const idStats = idStatsRes.rows[0] || {};
    const cardStats = cardStatsRes.rows[0] || {};
    const verifStats = verifStatsRes.rows[0] || {};

    const responseData = {
      metrics: {
        totalIdentities: parseInt(idStats.total_identities || 0, 10),
        activeIdentities: parseInt(idStats.active_identities || 0, 10),
        suspendedIdentities: parseInt(idStats.suspended_identities || 0, 10),
        expiredIdentities: parseInt(idStats.expired_identities || 0, 10),
        totalCards: parseInt(cardStats.total_cards || 0, 10),
        activeCards: parseInt(cardStats.active_cards || 0, 10),
        revokedCards: parseInt(cardStats.revoked_cards || 0, 10),
        totalScans30Days: parseInt(verifStats.total_scans || 0, 10),
        verifiedScans30Days: parseInt(verifStats.verified_scans || 0, 10),
        revokedScans30Days: parseInt(verifStats.revoked_scans || 0, 10)
      },
      activeSession: activeSessionRes.rows[0] || null,
      dailyVolume: dailyScansRes.rows || [],
      recentVerifications: recentVerifsRes.rows || [],
      recentPeople: recentPeopleRes.rows || []
    };

    // Store in cache
    statsCache.set(orgId, { data: responseData, timestamp: now });
    chartCache.set(orgId, { data: responseData.dailyVolume, timestamp: now });

    return res.json(responseData);
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return res.status(500).json({ error: 'Failed to retrieve dashboard metrics.' });
  }
});

module.exports = router;
module.exports.invalidateDashboardCache = invalidateDashboardCache;
