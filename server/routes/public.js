const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');

function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL && !process.env.PUBLIC_BASE_URL.includes('localhost')) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  }
  if (req && req.headers && req.headers.host && !req.headers.host.includes('localhost')) {
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : (req.protocol || 'https'));
    return `${proto}://${req.headers.host}`;
  }
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
      errorCorrectionLevel: 'H', // High error correction for large scale print & outdoor posters
      margin: 2,                 // Clean quiet zone
      width: 800,                // 800px ultra high-res for banners, screens, flyers
      color: {
        dark: '#090d16',         // Obsidian Deep Navy
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

    res.type('png');
    res.setHeader('Content-Disposition', 'inline; filename="GCI_Registration_QR.png"');
    await QRCode.toFileStream(res, registrationUrl, {
      width: 800,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#090d16',
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
