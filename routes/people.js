const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const qrcode = require('qrcode');
const path = require('path');
const os = require('os');
const multer = require('multer');
const db = require('../db');

function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL && !process.env.PUBLIC_BASE_URL.includes('localhost')) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  }
  if (req && req.headers && req.headers.host && !req.headers.host.includes('localhost')) {
    return `${req.protocol || 'http'}://${req.headers.host}`;
  }
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !name.toLowerCase().includes('vmware') && !name.toLowerCase().includes('vmnet')) {
        const port = process.env.PORT || 3000;
        return `http://${net.address}:${port}`;
      }
    }
  }
  return process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/$/, '') : 'http://localhost:3000';
}


// Multer storage for uploaded member photos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', 'public', 'uploads'));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'photo-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// POST /api/people (Supports both JSON and Multipart with 'photo' file upload)
router.post('/people', upload.single('photo'), async (req, res) => {
  try {
    let {
      fullName,
      firstName,
      lastName,
      preferredName,
      title,
      email,
      phone,
      whatsapp,
      bio,
      publicRoles,
      memberSince,
      membershipStatus,
      altContactName,
      altContactPhone
    } = req.body;

    if (!fullName && (firstName || lastName)) {
      fullName = `${firstName || ''} ${lastName || ''}`.trim();
    }

    let photoUrl = req.body.photoUrl;

    // If an image file was uploaded, use its static path
    if (req.file) {
      photoUrl = '/uploads/' + req.file.filename;
    }

    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ error: 'Full name is required' });
    }

    // Generate 24-byte hex token (48 characters)
    const profileToken = crypto.randomBytes(24).toString('hex');

    const result = await db.query(
      `INSERT INTO people (
        full_name,
        preferred_name,
        title,
        email,
        phone,
        whatsapp,
        photo_url,
        bio,
        public_roles,
        member_since,
        membership_status,
        alt_contact_name,
        alt_contact_phone,
        profile_token,
        profile_public
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, TRUE)
      RETURNING *`,
      [
        fullName.trim(),
        preferredName ? preferredName.trim() : null,
        (title && title !== 'None') ? title.trim() : null,
        email ? email.trim() : null,
        phone ? phone.trim() : null,
        whatsapp ? whatsapp.trim() : null,
        photoUrl ? photoUrl.trim() : null,
        bio ? bio.trim() : null,
        publicRoles ? publicRoles.trim() : null,
        memberSince ? parseInt(memberSince, 10) : null,
        membershipStatus || 'member',
        altContactName ? altContactName.trim() : null,
        altContactPhone ? altContactPhone.trim() : null,
        profileToken
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating person:', err);
    res.status(500).json({ error: 'Failed to create person' });
  }
});

// GET /api/people - list all members
router.get('/people', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM people ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching people:', err);
    res.status(500).json({ error: 'Failed to fetch people' });
  }
});

// GET /api/people/:id/qr -> PNG QR encoding ${PUBLIC_BASE_URL}/p/<token>
router.get('/people/:id/qr', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT profile_token FROM people WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Person not found');
    }

    const token = result.rows[0].profile_token;
    const baseUrl = getPublicBaseUrl(req);
    const profileUrl = `${baseUrl}/p/${token}`;

    res.type('png');
    await qrcode.toFileStream(res, profileUrl, {
      width: 280,
      margin: 2,
      color: {
        dark: '#0f1e3d',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('Error generating QR code:', err);
    if (!res.headersSent) {
      res.status(500).send('Error generating QR code');
    }
  }
});

// GET /api/people/:id/details -> { person, memberships, holdings }
router.get('/people/:id/details', async (req, res) => {
  try {
    const { id } = req.params;
    const personRes = await db.query('SELECT * FROM people WHERE id = $1', [id]);
    if (personRes.rows.length === 0) {
      return res.status(404).json({ error: 'Person not found' });
    }

    const membershipsRes = await db.query(`
      SELECT m.id, m.person_id, m.company_id, m.role, m.department, m.joined_at,
             c.name AS company_name, c.code AS company_code
      FROM memberships m
      JOIN companies c ON m.company_id = c.id
      WHERE m.person_id = $1
      ORDER BY m.id ASC
    `, [id]);

    const holdingsRes = await db.query(`
      SELECT h.id, h.membership_id, h.item_name, h.item_type, h.serial_number, h.status,
             c.name AS company_name, c.code AS company_code, m.role, m.department
      FROM holdings h
      JOIN memberships m ON h.membership_id = m.id
      JOIN companies c ON m.company_id = c.id
      WHERE m.person_id = $1
      ORDER BY h.id ASC
    `, [id]);

    res.json({
      person: personRes.rows[0],
      memberships: membershipsRes.rows,
      holdings: holdingsRes.rows
    });
  } catch (err) {
    console.error('Error fetching details:', err);
    res.status(500).json({ error: 'Failed to fetch details' });
  }
});

// POST /api/memberships {personId, companyId, role, department}
router.post('/memberships', async (req, res) => {
  try {
    const { personId, companyId, role, department } = req.body;
    if (!personId || !companyId) {
      return res.status(400).json({ error: 'personId and companyId are required' });
    }

    const result = await db.query(
      `INSERT INTO memberships (person_id, company_id, role, department)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (person_id, company_id)
       DO UPDATE SET role = EXCLUDED.role, department = EXCLUDED.department
       RETURNING *`,
      [personId, companyId, role || null, department || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating membership:', err);
    res.status(500).json({ error: 'Failed to create membership' });
  }
});

// POST /api/holdings {membershipId, itemName, itemType, serialNumber}
router.post('/holdings', async (req, res) => {
  try {
    const { membershipId, itemName, itemType, serialNumber } = req.body;
    if (!membershipId || !itemName || !itemName.trim()) {
      return res.status(400).json({ error: 'membershipId and itemName are required' });
    }

    const result = await db.query(
      `INSERT INTO holdings (membership_id, item_name, item_type, serial_number, status)
       VALUES ($1, $2, $3, $4, 'held')
       RETURNING *`,
      [membershipId, itemName.trim(), itemType ? itemType.trim() : null, serialNumber ? serialNumber.trim() : null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating holding:', err);
    res.status(500).json({ error: 'Failed to create holding' });
  }
});

// POST /api/people/:id/lost-card {active, message}
router.post('/people/:id/lost-card', async (req, res) => {
  try {
    const { active, message } = req.body;
    await db.query(
      `UPDATE people SET lost_card_active = $1, lost_card_message = $2 WHERE id = $3`,
      [!!active, message || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Error updating lost card status:', err);
    res.status(500).json({ error: 'Failed to update lost card status' });
  }
});

// POST /api/people/:id/privacy {showPhone, showEmail, showWhatsapp, showHoldings}
router.post('/people/:id/privacy', async (req, res) => {
  try {
    const { showPhone, showEmail, showWhatsapp, showHoldings } = req.body;
    await db.query(
      `UPDATE people SET
         show_phone = $1,
         show_email = $2,
         show_whatsapp = $3,
         show_holdings = $4
       WHERE id = $5`,
      [!!showPhone, !!showEmail, !!showWhatsapp, !!showHoldings, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Error updating privacy settings:', err);
    res.status(500).json({ error: 'Failed to update privacy settings' });
  }
});

// GET /api/companies (list assemblies/companies)
router.get('/companies', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM companies ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching companies:', err);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

module.exports = router;
