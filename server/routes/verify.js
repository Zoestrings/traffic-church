const express = require('express');
const router = express.Router();
const db = require('../db');
const { optionalAuth } = require('../middleware/auth');

// GET /api/verify/:token - Core Verification Engine
router.get('/:token', optionalAuth, async (req, res) => {
  try {
    const { token } = req.params;
    const clientIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const scannedByUserId = req.user ? req.user.id : null;

    if (!token || token.length < 16) {
      return res.status(400).json({
        status: 'INVALID',
        message: 'Invalid verification token format.'
      });
    }

    // Lookup card with linked identity and organisation
    const cardRes = await db.query(`
      SELECT c.*,
             i.full_name, i.title, i.department, i.branch, i.position, i.photo_url,
             i.status AS identity_status, i.approval_status, i.email, i.phone,
             i.emergency_contact_name, i.emergency_contact_phone, i.bio,
             i.id_number,
             o.id AS org_id, o.name AS organisation_name, o.logo_url AS organisation_logo,
             o.brand_color, o.accent_color, o.contact_email AS organisation_email,
             o.contact_phone AS organisation_phone,
             o.verification_instructions,
             o.verification_visibility_settings
      FROM id_cards c
      JOIN identities i ON c.identity_id = i.id
      JOIN organisations o ON c.organisation_id = o.id
      WHERE c.verification_token = $1
      LIMIT 1
    `, [token]);

    // Handle Unknown Token (INVALID)
    if (cardRes.rows.length === 0) {
      // Find fallback org or default
      const defaultOrgRes = await db.query('SELECT id FROM organisations LIMIT 1');
      const fallbackOrgId = defaultOrgRes.rows[0]?.id || 1;

      await db.query(`
        INSERT INTO verification_events (
          organisation_id, outcome, scanned_by_user_id, token_used, ip_address, user_agent, failure_category
        ) VALUES ($1, 'invalid', $2, $3, $4, $5, 'TOKEN_NOT_FOUND')
      `, [fallbackOrgId, scannedByUserId, token, clientIp, userAgent]);

      return res.status(404).json({
        status: 'INVALID',
        outcome: 'invalid',
        headline: 'Invalid / Unrecognized Credential',
        message: 'This QR code does not correspond to any issued credential in the database.',
        verified: false
      });
    }

    const row = cardRes.rows[0];
    const orgId = row.org_id;
    const today = new Date();
    const expiry = row.expiry_date ? new Date(row.expiry_date) : null;

    let outcome = 'verified';
    let headline = 'Verified Active Credential';
    let message = 'This identity card is authentic, active, and officially registered.';
    let failureCategory = null;

    if (row.approval_status === 'pending') {
      outcome = 'suspended';
      headline = 'Registration Pending Approval';
      message = 'This identity profile has been submitted but is pending official administrator verification and approval.';
      failureCategory = 'APPROVAL_PENDING';
    } else if (row.status === 'revoked') {
      outcome = 'revoked';
      headline = 'Card Revoked / Cancelled';
      message = row.revocation_reason
        ? `This card was cancelled or replaced: "${row.revocation_reason}". It is no longer valid.`
        : 'This card has been officially cancelled by administration and must not be accepted.';
      failureCategory = 'CARD_REVOKED';
    } else if (row.status === 'suspended' || row.identity_status === 'suspended') {
      outcome = 'suspended';
      headline = 'Credential Temporarily Suspended';
      message = 'This identity or card is temporarily disabled pending administrative review.';
      failureCategory = 'CARD_SUSPENDED';
    } else if (row.status === 'expired' || (expiry && expiry < today)) {
      outcome = 'expired';
      headline = 'Credential Expired';
      message = `This card expired on ${expiry ? expiry.toISOString().split('T')[0] : 'record'}. Renewal required.`;
      failureCategory = 'CARD_EXPIRED';
    }

    // Log Verification Event
    await db.query(`
      INSERT INTO verification_events (
        organisation_id, card_id, identity_id, outcome, scanned_by_user_id,
        token_used, ip_address, user_agent, failure_category
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      orgId,
      row.id,
      row.identity_id,
      outcome,
      scannedByUserId,
      token,
      clientIp,
      userAgent,
      failureCategory
    ]);

    // Role-based visibility filtering (Least Privilege)
    const isOfficer = req.user && req.membership && req.membership.organisation_id === orgId;

    const profileData = {
      outcome,
      headline,
      message,
      verified: outcome === 'verified',
      timestamp: new Date().toISOString(),
      card: {
        cardNumber: row.card_number,
        status: row.status,
        issueDate: row.issue_date,
        expiryDate: row.expiry_date,
        isCurrent: row.is_current,
        revokedAt: row.revoked_at,
        revocationReason: row.revocation_reason
      },
      identity: {
        idNumber: row.id_number,
        fullName: row.full_name,
        title: row.title,
        department: row.department,
        branch: row.branch || 'Main Sanctuary',
        position: row.position,
        photoUrl: row.photo_url,
        bio: row.bio,
        status: row.identity_status,
        approvalStatus: row.approval_status,
        // Sensitive contact fields restricted on server:
        phone: isOfficer ? row.phone : undefined,
        email: isOfficer ? row.email : undefined,
        emergencyContactName: isOfficer ? row.emergency_contact_name : undefined,
        emergencyContactPhone: isOfficer ? row.emergency_contact_phone : undefined
      },
      organisation: {
        name: row.organisation_name,
        logoUrl: row.organisation_logo,
        brandColor: row.brand_color,
        accentColor: row.accent_color,
        contactEmail: row.organisation_email,
        contactPhone: row.organisation_phone,
        verificationInstructions: row.verification_instructions
      },
      viewer: {
        isAuthenticated: !!req.user,
        role: req.membership ? req.membership.role : 'public'
      }
    };

    return res.json(profileData);
  } catch (err) {
    console.error('Verification error:', err);
    return res.status(500).json({
      status: 'NETWORK_ERROR',
      outcome: 'network_error',
      headline: 'Verification Unavailable',
      message: 'Verification could not be completed due to a temporary server error.',
      verified: false
    });
  }
});

module.exports = router;
