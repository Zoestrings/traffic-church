const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');

function getPublicBaseUrl(req) {
  // 1. Explicit origin query parameter sent from verified client browser
  if (req && req.query && req.query.origin) {
    try {
      const url = new URL(req.query.origin);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.origin;
      }
    } catch (e) { }
  }

  // 2. Explicit public base URL environment variable
  if (process.env.PUBLIC_BASE_URL && !process.env.PUBLIC_BASE_URL.includes('localhost')) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  }

  // 3. Vercel System production / deployment URL
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, '')}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`;
  }

  // 4. Request headers (with reverse-proxy and multi-hop proto sanitization)
  if (req && req.headers) {
    const rawHost = req.headers['x-forwarded-host'] || req.headers.host;
    if (rawHost) {
      const host = rawHost.split(',')[0].trim();
      if (!host.includes('localhost') && !host.startsWith('127.0.0.1')) {
        let proto = req.headers['x-forwarded-proto']
          ? req.headers['x-forwarded-proto'].split(',')[0].trim()
          : (req.secure ? 'https' : 'http');

        if (host.includes('vercel.app') || process.env.VERCEL === '1') {
          proto = 'https';
        }
        return `${proto}://${host}`;
      }
    }
  }

  // 5. Fallback
  return process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/$/, '') : 'http://localhost:3000';
}

// GET /api/public/registration-qr
// Generates a high-res QR code that points to the public enrollment form
router.get('/registration-qr', async (req, res) => {
  try {
    const baseUrl = getPublicBaseUrl(req);
    // Point to /#register which opens the public self-registration form directly
    const registrationUrl = `${baseUrl}/#register`;

    const qrDataUrl = await QRCode.toDataURL(registrationUrl, {
      errorCorrectionLevel: 'M', // 15% recovery, larger dots for instant phone camera focus
      margin: 4,                 // ISO standard 4-module quiet zone
      width: 800,                // 800px ultra high-res for banners, screens, flyers
      color: {
        dark: '#000000',         // Pure black for 21:1 maximum optical contrast
        light: '#ffffff'         // Crisp white
      }
    });

    return res.json({
      success: true,
      url: registrationUrl,
      qrImage: qrDataUrl
    });
  } catch (err) {
    console.error('Registration QR error:', err);
    return res.status(500).json({ error: 'Failed to generate registration QR code.' });
  }
});

// GET /api/public/registration-qr/image - Direct PNG download/stream
router.get('/registration-qr/image', async (req, res) => {
  try {
    const baseUrl = getPublicBaseUrl(req);
    const registrationUrl = `${baseUrl}/#register`;

    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.type('png');
    res.setHeader('Content-Disposition', 'inline; filename="GCI_Registration_QR.png"');
    await QRCode.toFileStream(res, registrationUrl, {
      width: 800,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('Registration QR stream error:', err);
    if (!res.headersSent) {
      res.status(500).send('Error streaming registration QR.');
    }
  }
});

module.exports = router;
