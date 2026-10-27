const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /p/:token - Public profile route
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Fetch person
    const personRes = await db.query(
      `SELECT * FROM people WHERE profile_token = $1`,
      [token]
    );

    if (personRes.rows.length === 0) {
      return res.status(404).render('notfound', {
        title: 'Profile Not Found',
        message: 'The requested ID card profile does not exist.'
      });
    }

    const person = personRes.rows[0];

    // Must be public
    if (!person.profile_public) {
      return res.status(404).render('notfound', {
        title: 'Profile Inactive',
        message: 'This identity profile is currently inactive or private.'
      });
    }

    // Audit log: record public scan event
    try {
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
      const userAgent = req.headers['user-agent'] || 'unknown';
      await db.query(
        `INSERT INTO scan_events (person_id, user_agent, ip, mode)
         VALUES ($1, $2, $3, 'public')`,
        [person.id, userAgent, typeof ip === 'string' ? ip.slice(0, 64) : 'unknown']
      );
    } catch (auditErr) {
      console.warn('Failed to record scan audit event:', auditErr.message);
    }

    // Fetch memberships with department
    const membershipsRes = await db.query(`
      SELECT m.id, m.role, m.department, m.joined_at,
             c.name AS company_name, c.code AS company_code
      FROM memberships m
      JOIN companies c ON m.company_id = c.id
      WHERE m.person_id = $1
      ORDER BY c.name ASC
    `, [person.id]);

    // Fetch holdings
    const holdingsRes = await db.query(`
      SELECT h.id, h.item_name, h.item_type, h.serial_number, h.status,
             c.name AS company_name, c.code AS company_code
      FROM holdings h
      JOIN memberships m ON h.membership_id = m.id
      JOIN companies c ON m.company_id = c.id
      WHERE m.person_id = $1
      ORDER BY h.id ASC
    `, [person.id]);

    const churchName = process.env.CHURCH_NAME || 'Grace Chapel International';

    res.render('profile', {
      person,
      memberships: membershipsRes.rows,
      holdings: holdingsRes.rows,
      showHoldings: person.show_holdings,
      churchName
    });
  } catch (err) {
    console.error('Error fetching public profile:', err);
    res.status(500).render('notfound', {
      title: 'Server Error',
      message: 'An error occurred while loading this identity profile.'
    });
  }
});

// POST /p/:token/reveal - Reveal contact fields respecting privacy settings & log reveal scan
router.post('/:token/reveal', async (req, res) => {
  try {
    const { token } = req.params;
    const { rows } = await db.query(
      `SELECT id, phone, email, whatsapp, alt_contact_name, alt_contact_phone,
              show_phone, show_email, show_whatsapp
       FROM people
       WHERE profile_token = $1 AND profile_public = TRUE`,
      [token]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const p = rows[0];

    // Audit log: record reveal scan event
    try {
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
      const userAgent = req.headers['user-agent'] || 'unknown';
      await db.query(
        `INSERT INTO scan_events (person_id, user_agent, ip, mode)
         VALUES ($1, $2, $3, 'reveal')`,
        [p.id, userAgent, typeof ip === 'string' ? ip.slice(0, 64) : 'unknown']
      );
    } catch (auditErr) {
      console.warn('Failed to record reveal audit event:', auditErr.message);
    }

    res.json({
      phone: p.show_phone ? p.phone : null,
      email: p.show_email ? p.email : null,
      whatsapp: p.show_whatsapp ? p.whatsapp : null,
      altContact: p.alt_contact_name
        ? { name: p.alt_contact_name, phone: p.alt_contact_phone }
        : null
    });
  } catch (err) {
    console.error('Error revealing contact details:', err);
    res.status(500).json({ error: 'Failed to reveal contact details' });
  }
});

module.exports = router;
