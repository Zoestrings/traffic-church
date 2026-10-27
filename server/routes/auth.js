const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const userRes = await db.query(
      'SELECT id, email, password_hash, full_name, avatar_url, is_active FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = userRes.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'This staff account has been deactivated.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Retrieve user's organisation membership
    const memRes = await db.query(`
      SELECT om.role, om.organisation_id, o.name AS organisation_name, o.slug AS organisation_slug,
             o.brand_color, o.accent_color, o.id_prefix, o.logo_url
      FROM organisation_memberships om
      JOIN organisations o ON om.organisation_id = o.id
      WHERE om.user_id = $1
      ORDER BY om.id ASC
      LIMIT 1
    `, [user.id]);

    if (memRes.rows.length === 0) {
      return res.status(403).json({ error: 'Your account is not assigned to any organisation.' });
    }

    const membership = memRes.rows[0];

    // Issue JWT Token (valid for 7 days)
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        orgId: membership.organisation_id,
        role: membership.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set HTTP-Only Cookie
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? (process.env.COOKIE_SAMESITE || 'lax') : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Log administrative login audit
    await db.query(`
      INSERT INTO audit_logs (organisation_id, user_id, action, record_type, record_id, change_summary, ip_address)
      VALUES ($1, $2, 'USER_LOGIN', 'user', $2, 'Staff signed in successfully', $3)
    `, [membership.organisation_id, user.id, req.ip || '127.0.0.1']);

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        avatarUrl: user.avatar_url
      },
      organisation: {
        id: membership.organisation_id,
        name: membership.organisation_name,
        slug: membership.organisation_slug,
        role: membership.role,
        brandColor: membership.brand_color,
        accentColor: membership.accent_color,
        idPrefix: membership.id_prefix,
        logoUrl: membership.logo_url
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'An unexpected authentication error occurred.' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  return res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      fullName: req.user.full_name,
      avatarUrl: req.user.avatar_url
    },
    organisation: req.organisation,
    role: req.membership.role
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? (process.env.COOKIE_SAMESITE || 'lax') : 'lax'
  });
  return res.json({ message: 'Signed out successfully' });
});

module.exports = router;
