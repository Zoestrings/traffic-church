const express = require('express');
const router = express.Router();
const db = require('../db');
const { optionalAuth, authenticate } = require('../middleware/auth');

// Auto-ensure attendance_logs table exists in PostgreSQL
async function ensureAttendanceTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        identity_id INT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
        event_name VARCHAR(150) NOT NULL,
        check_in_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        scanned_by INT REFERENCES users(id) ON DELETE SET NULL,
        organisation_id INT REFERENCES organisations(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attendance_identity ON attendance_logs(identity_id);
      CREATE INDEX IF NOT EXISTS idx_attendance_checkin ON attendance_logs(check_in_time);
    `);
  } catch (err) {
    // If table already exists or constraint differs, continue gracefully
  }
}
ensureAttendanceTable();

// 1. POST /api/attendance/check-in - Mark Attendance (Called when Admin/Officer scans or checks in)
router.post('/check-in', optionalAuth, async (req, res) => {
  try {
    const { identity_id, event_name } = req.body;
    const scanned_by = req.user ? req.user.id : null;
    const orgId = req.organisation?.id || req.user?.organisation_id || null;

    if (!identity_id) {
      return res.status(400).json({ error: "Identity ID is required." });
    }

    const eventName = (event_name || 'Sunday Service').trim();

    // Prevent duplicate check-in for the same event on the same day
    const existing = await db.query(
      `SELECT id FROM attendance_logs 
       WHERE identity_id = $1 
         AND LOWER(TRIM(event_name)) = LOWER(TRIM($2)) 
         AND check_in_time::date = CURRENT_DATE`,
      [identity_id, eventName]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Already marked present for this event today." });
    }

    const insertResult = await db.query(
      `INSERT INTO attendance_logs (identity_id, event_name, scanned_by, organisation_id) 
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [identity_id, eventName, scanned_by, orgId]
    );

    res.status(200).json({
      success: true,
      message: "Attendance logged successfully.",
      log: insertResult.rows[0]
    });
  } catch (err) {
    console.error('Attendance check-in error:', err);
    res.status(500).json({ error: "Failed to log attendance: " + err.message });
  }
});

// 2. GET /api/attendance/logs - Fetch All Attendance Logs (For the Dashboard)
router.get('/logs', optionalAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        a.id, 
        a.check_in_time, 
        a.event_name, 
        i.full_name, 
        i.id_number,
        COALESCE(u.full_name, 'Admin') AS scanned_by_name
      FROM attendance_logs a
      JOIN identities i ON a.identity_id = i.id
      LEFT JOIN users u ON a.scanned_by = u.id
      ORDER BY a.check_in_time DESC
      LIMIT 200
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Attendance fetch error:', err);
    res.status(500).json({ error: "Failed to fetch logs: " + err.message });
  }
});

module.exports = router;
