const express = require('express');
const router = express.Router();
const db = require('../db');
const { optionalAuth, authenticate } = require('../middleware/auth');

// Auto-ensure attendance tables exist in PostgreSQL
async function ensureAttendanceTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id SERIAL PRIMARY KEY,
        event_name VARCHAR(150) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_by INT REFERENCES users(id) ON DELETE SET NULL,
        organisation_id INT REFERENCES organisations(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_attendance_sessions_active ON attendance_sessions(is_active);

      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        session_id INT REFERENCES attendance_sessions(id) ON DELETE SET NULL,
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
    // Continue gracefully if already present
  }
}
ensureAttendanceTables();

// 1. POST /api/attendance/sessions - Start a new Attendance Session (Roll-call list)
router.post('/sessions', optionalAuth, async (req, res) => {
  try {
    const { event_name } = req.body;
    if (!event_name || !event_name.trim()) {
      return res.status(400).json({ error: "Event name is required." });
    }

    const created_by = req.user ? req.user.id : null;
    const orgId = req.organisation?.id || req.user?.organisation_id || null;

    // Deactivate any currently active sessions first
    await db.query(`UPDATE attendance_sessions SET is_active = false WHERE is_active = true`);

    const newSession = await db.query(
      `INSERT INTO attendance_sessions (event_name, created_by, organisation_id, is_active) 
       VALUES ($1, $2, $3, true) 
       RETURNING *`,
      [event_name.trim(), created_by, orgId]
    );

    res.status(201).json({ success: true, session: newSession.rows[0] });
  } catch (err) {
    console.error('Start session error:', err);
    res.status(500).json({ error: "Failed to start session: " + err.message });
  }
});

// 2. GET /api/attendance/sessions/active - Fetch currently active session
router.get('/sessions/active', optionalAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM attendance_sessions WHERE is_active = true ORDER BY created_at DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No active session" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Fetch active session error:', err);
    res.status(500).json({ error: "Failed to fetch active session." });
  }
});

// 3. POST /api/attendance/sessions/close - Deactivate/close current active session
router.post('/sessions/close', optionalAuth, async (req, res) => {
  try {
    await db.query(`UPDATE attendance_sessions SET is_active = false WHERE is_active = true`);
    res.json({ success: true, message: "Active session closed successfully." });
  } catch (err) {
    console.error('Close session error:', err);
    res.status(500).json({ error: "Failed to close session: " + err.message });
  }
});

// 4. POST /api/attendance/check-in - Mark Attendance (Auto-attaches to active session if event_name omitted)
router.post('/check-in', optionalAuth, async (req, res) => {
  try {
    const { identity_id, event_name } = req.body;
    const scanned_by = req.user ? req.user.id : null;
    const orgId = req.organisation?.id || req.user?.organisation_id || null;

    if (!identity_id) {
      return res.status(400).json({ error: "Identity ID is required." });
    }

    // Determine event name: use passed event_name or fallback to active session
    let eventName = (event_name || '').trim();
    let sessionId = null;

    const activeSessionRes = await db.query(
      `SELECT id, event_name FROM attendance_sessions WHERE is_active = true ORDER BY created_at DESC LIMIT 1`
    );

    if (activeSessionRes.rows.length > 0) {
      sessionId = activeSessionRes.rows[0].id;
      if (!eventName) {
        eventName = activeSessionRes.rows[0].event_name;
      }
    }

    if (!eventName) {
      eventName = 'Sunday Service';
    }

    // Prevent duplicate check-in for the same event on the same day
    const existing = await db.query(
      `SELECT id FROM attendance_logs 
       WHERE identity_id = $1 
         AND LOWER(TRIM(event_name)) = LOWER(TRIM($2)) 
         AND check_in_time::date = CURRENT_DATE`,
      [identity_id, eventName]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: `Already marked present for "${eventName}" today.` });
    }

    const insertResult = await db.query(
      `INSERT INTO attendance_logs (session_id, identity_id, event_name, scanned_by, organisation_id) 
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [sessionId, identity_id, eventName, scanned_by, orgId]
    );

    res.status(200).json({
      success: true,
      message: `Marked present for "${eventName}".`,
      event_name: eventName,
      log: insertResult.rows[0]
    });
  } catch (err) {
    console.error('Attendance check-in error:', err);
    res.status(500).json({ error: "Failed to log attendance: " + err.message });
  }
});

// 5. GET /api/attendance/logs - Fetch All Attendance Logs
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
