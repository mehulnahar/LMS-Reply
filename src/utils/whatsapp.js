/**
 * WhatsApp Client - whatsapp-web.js singleton
 *
 * - RemoteAuth with PostgreSQL session storage
 * - Two-way bot: handles incoming commands
 * - QR code exposed via getQR() for API endpoint
 */

const { Client, RemoteAuth } = require('whatsapp-web.js');
const pool = require('../config/db');

// ─────────────────────────────────────────
// PostgreSQL session store for RemoteAuth
// ─────────────────────────────────────────
class PgSessionStore {
  async sessionExists({ session }) {
    const { rows } = await pool.query(
      'SELECT id FROM whatsapp_sessions WHERE id = $1',
      [session]
    );
    return rows.length > 0;
  }

  async save({ session, data }) {
    await pool.query(
      `INSERT INTO whatsapp_sessions (id, session_data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET session_data = $2, updated_at = NOW()`,
      [session, JSON.stringify(data)]
    );
  }

  async extract({ session }) {
    const { rows } = await pool.query(
      'SELECT session_data FROM whatsapp_sessions WHERE id = $1',
      [session]
    );
    if (!rows.length) return null;
    return JSON.parse(rows[0].session_data);
  }

  async delete({ session }) {
    await pool.query('DELETE FROM whatsapp_sessions WHERE id = $1', [session]);
  }
}

// ─────────────────────────────────────────
// State
// ─────────────────────────────────────────
let client = null;
let qrCode = null;
let status = 'disconnected'; // disconnected | qr_ready | authenticated | ready | error
let messageHandler = null;   // injected by bot layer

// ─────────────────────────────────────────
// Init
// ─────────────────────────────────────────
function initWhatsApp() {
  if (client) return client;

  console.log('[WhatsApp] Initialising client...');

  client = new Client({
    authStrategy: new RemoteAuth({
      store: new PgSessionStore(),
      backupSyncIntervalMs: 300000, // sync session every 5 min
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
      ],
    },
  });

  client.on('qr', (qr) => {
    qrCode = qr;
    status = 'qr_ready';
    console.log('[WhatsApp] QR code ready - scan via /api/whatsapp/qr');
  });

  client.on('authenticated', () => {
    qrCode = null;
    status = 'authenticated';
    console.log('[WhatsApp] Authenticated');
  });

  client.on('ready', () => {
    status = 'ready';
    console.log('[WhatsApp] Client ready');
  });

  client.on('disconnected', (reason) => {
    status = 'disconnected';
    qrCode = null;
    console.log('[WhatsApp] Disconnected:', reason);
    client = null;
    // Auto-reconnect after 10s
    setTimeout(initWhatsApp, 10000);
  });

  client.on('auth_failure', (msg) => {
    status = 'error';
    console.error('[WhatsApp] Auth failure:', msg);
  });

  client.on('message', async (msg) => {
    if (messageHandler) {
      try {
        await messageHandler(msg);
      } catch (e) {
        console.error('[WhatsApp] Message handler error:', e.message);
      }
    }
  });

  client.initialize().catch((e) => {
    status = 'error';
    console.error('[WhatsApp] Init error:', e.message);
  });

  return client;
}

// ─────────────────────────────────────────
// Send message
// ─────────────────────────────────────────
async function sendMessage(to, text) {
  if (!client || status !== 'ready') {
    throw new Error(`WhatsApp not ready (status: ${status})`);
  }
  // Ensure number format: 919XXXXXXXXXX@c.us
  const chatId = to.includes('@') ? to : `${to}@c.us`;
  await client.sendMessage(chatId, text);
  console.log(`[WhatsApp] Message sent to ${chatId}`);
}

// ─────────────────────────────────────────
// Getters
// ─────────────────────────────────────────
function getQR() { return qrCode; }
function getStatus() { return status; }
function getClient() { return client; }
function setMessageHandler(fn) { messageHandler = fn; }

module.exports = {
  initWhatsApp,
  sendMessage,
  getQR,
  getStatus,
  getClient,
  setMessageHandler,
};
