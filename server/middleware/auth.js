const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'apex-identity-enterprise-secret-2026-key';

// Authenticate user from cookie or Authorization header
async function authenticate(req, res, next) {
  try {
    let token = null;

    if (req.cookies && req.cookies.auth_token) {
      token = req.cookies.auth_token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userRes = await db.query(
      'SELECT id, email, full_name, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userRes.rows.length === 0 || !userRes.rows[0].is_active) {
      return res.status(401).json({ error: 'User account not found or deactivated.' });
    }

    req.user = userRes.rows[0];

    // Determine target organisation context
    // Derived from active membership or requested org
    let orgId = req.headers['x-organisation-id'] || decoded.orgId;

    const memRes = await db.query(`
      SELECT om.role, om.organisation_id, o.name AS organisation_name, o.slug AS organisation_slug,
             o.brand_color, o.accent_color, o.id_prefix, o.logo_url
      FROM organisation_memberships om
      JOIN organisations o ON om.organisation_id = o.id
      WHERE om.user_id = $1 ${orgId ? 'AND om.organisation_id = $2' : ''}
      LIMIT 1
    `, orgId ? [req.user.id, orgId] : [req.user.id]);

    if (memRes.rows.length === 0) {
      return res.status(403).json({ error: 'No active organisation membership found for this account.' });
    }

    req.membership = memRes.rows[0];
    req.organisation = {
      id: memRes.rows[0].organisation_id,
      name: memRes.rows[0].organisation_name,
      slug: memRes.rows[0].organisation_slug,
      brand_color: memRes.rows[0].brand_color,
      accent_color: memRes.rows[0].accent_color,
      id_prefix: memRes.rows[0].id_prefix,
      logo_url: memRes.rows[0].logo_url
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    }
    console.error('Auth error:', err);
    return res.status(500).json({ error: 'Internal authentication error.' });
  }
}

// Optional auth for public verification endpoints
async function optionalAuth(req, res, next) {
  try {
    let token = req.cookies?.auth_token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      const userRes = await db.query('SELECT id, email, full_name FROM users WHERE id = $1 AND is_active = TRUE', [decoded.userId]);
      if (userRes.rows.length > 0) {
        req.user = userRes.rows[0];
        const memRes = await db.query('SELECT role, organisation_id FROM organisation_memberships WHERE user_id = $1 LIMIT 1', [req.user.id]);
        if (memRes.rows.length > 0) {
          req.membership = memRes.rows[0];
        }
      }
    }
  } catch (e) {
    // Ignore invalid tokens for optional auth
  }
  next();
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.membership || !allowedRoles.includes(req.membership.role)) {
      return res.status(403).json({
        error: `Access denied. Requires one of the following roles: ${allowedRoles.join(', ')}.`
      });
    }
    next();
  };
}

module.exports = {
  authenticate,
  optionalAuth,
  requireRole,
  JWT_SECRET
};
