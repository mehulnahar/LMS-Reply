/**
 * WhatsApp Routes
 *
 * GET  /api/whatsapp/qr       - Get QR code to scan (base64 image)
 * GET  /api/whatsapp/status   - Connection status
 * POST /api/whatsapp/config   - Save phone number
 * GET  /api/whatsapp/config   - Get current config
 * POST /api/whatsapp/test     - Send test message now
 * POST /api/whatsapp/report   - Trigger morning report manually
 */

const express = require('express');
const QRCode = require('qrcode');
const { requireAuth } = require('../middleware/auth');
const { getQR, getStatus, sendMessage } = require('../utils/whatsapp');
const { generateMorningReport } = require('../utils/morningReport');
const pool = require('../config/db');

const router = express.Router();

// ── GET /api/whatsapp/qr ──
router.get('/qr', requireAuth, async (req, res) => {
  const qr = getQR();
  if (!qr) {
    return res.json({ qr: null, status: getStatus(), message: 'No QR available - already connected or not yet initialised' });
  }
  try {
    const qrImage = await QRCode.toDataURL(qr);
    res.json({ qr: qrImage, status: getStatus() });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate QR image' });
  }
});

// ── GET /api/whatsapp/status ──
router.get('/status', requireAuth, (req, res) => {
  res.json({ status: getStatus() });
});

// ── POST /api/whatsapp/config ──
router.post('/config', requireAuth, async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber required' });

  // Sanitise: remove +, spaces, dashes
  const cleaned = phoneNumber.replace(/[\s+\-()]/g, '');

  try {
    await pool.query(
      `INSERT INTO whatsapp_config (user_id, phone_number)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET phone_number = $2, updated_at = NOW()`,
      [req.user.id, cleaned]
    );
    res.json({ success: true, phoneNumber: cleaned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/whatsapp/config ──
router.get('/config', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT phone_number, is_active, updated_at FROM whatsapp_config WHERE user_id = $1',
    [req.user.id]
  );
  res.json(rows[0] || null);
});

// ── POST /api/whatsapp/test ──
router.post('/test', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT phone_number FROM whatsapp_config WHERE user_id = $1',
    [req.user.id]
  );
  if (!rows.length) return res.status(400).json({ error: 'No phone number configured' });

  try {
    await sendMessage(rows[0].phone_number, '✅ LMS Reply WhatsApp connected successfully!');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/whatsapp/report ──
// Manually trigger the morning report (for testing)
router.post('/report', requireAuth, async (req, res) => {
  try {
    const report = await generateMorningReport(req.user.id);
    const { rows } = await pool.query(
      'SELECT phone_number FROM whatsapp_config WHERE user_id = $1',
      [req.user.id]
    );
    if (!rows.length) {
      // Return preview even if no number configured
      return res.json({ success: true, preview: report, sent: false, reason: 'No phone number configured' });
    }
    await sendMessage(rows[0].phone_number, report);
    res.json({ success: true, preview: report, sent: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
