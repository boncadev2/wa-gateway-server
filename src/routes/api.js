import express from 'express';
import multer from 'multer';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { apiKeyAuth } from '../middlewares/auth.js';
import { userAuth } from '../middlewares/userAuth.js';
import {
  getStatus,
  listSessions,
  initWhatsApp,
  requestPairing,
  sendTextMessage,
  sendMediaMessage,
  logoutSession
} from '../whatsapp/client.js';
import { dbAll, dbGet, dbRun } from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

const ownedSessionOnly = async (req, res, next) => {
  if (req.user.role === 'admin') return next();
  const sessionId = req.body?.session_id || req.query.session_id || req.headers['x-session-id'] || 'default';
  const owned = await dbGet('SELECT session_id FROM whatsapp_sessions WHERE session_id = ? AND owner_user_id = ?', [sessionId, req.user.id]);
  if (!owned) return res.status(403).json({ status: false, message: 'Sesi WhatsApp ini bukan milik akun Anda.' });
  next();
};

const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max
});

// Local webhook receiver. Use http://YOUR_HOST:PORT/api/webhook when another
// system needs to deliver events to this gateway, or for testing a webhook URL.
router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body || {};
    await dbRun(
      'INSERT INTO webhook_events (event, session_id, payload) VALUES (?, ?, ?)',
      [payload.event || 'webhook.received', payload.session_id || payload.data?.session_id || null, JSON.stringify(payload)]
    );
    logger.info({ event: payload.event, sessionId: payload.session_id || payload.data?.session_id }, 'Webhook received');
    return res.status(200).json({ status: true, message: 'Webhook diterima' });
  } catch (err) {
    logger.error({ err }, 'Failed to store incoming webhook');
    return res.status(500).json({ status: false, message: 'Gagal menerima webhook' });
  }
});

// 1. Status & Session Management (Public or Dashboard accessible)
router.get('/status', (req, res) => {
  const sessionId = req.query.session_id || 'default';
  return res.json({
    status: true,
    data: getStatus(sessionId)
  });
});

// Each session is an independent WhatsApp account and has separate credentials/QR.
router.get('/sessions', userAuth, (req, res) => {
  if (req.user.role === 'admin') return res.json({ status: true, data: listSessions() });
  dbAll('SELECT session_id FROM whatsapp_sessions WHERE owner_user_id = ?', [req.user.id])
    .then(rows => res.json({ status: true, data: listSessions().filter(session => rows.some(row => row.session_id === session.session_id)) }))
    .catch(err => res.status(500).json({ status: false, message: err.message }));
});
router.post('/sessions', userAuth, async (req, res) => {
  try {
    const sessionId = req.body.session_id || `device_${Date.now()}`;
    const existing = await dbGet('SELECT owner_user_id FROM whatsapp_sessions WHERE session_id = ?', [sessionId]);
    if (existing) return res.status(400).json({ status: false, message: 'Nama sesi sudah digunakan. Gunakan nama lain.' });
    await initWhatsApp(sessionId);
    await dbRun('INSERT INTO whatsapp_sessions (session_id, owner_user_id) VALUES (?, ?)', [sessionId, req.user.id]);
    const apiKey = `wagateway_${randomUUID().replace(/-/g, '')}`;
    await dbRun(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [`session:${sessionId}:api_key`, apiKey]);
    await dbRun(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, '')`, [`session:${sessionId}:webhook_url`]);
    return res.json({ status: true, message: 'Sesi baru dibuat. Scan QR untuk menghubungkan HP.', data: getStatus(sessionId), api_key: apiKey });
  } catch (err) { return res.status(400).json({ status: false, message: err.message }); }
});

router.get('/qr', (req, res) => {
  const currentStatus = getStatus(req.query.session_id || 'default');
  if (!currentStatus) return res.status(404).json({ status: false, message: 'Sesi tidak ditemukan' });
  if (!currentStatus.qr) {
    return res.status(404).json({
      status: false,
      message: 'QR Code not available. Status is: ' + currentStatus.status
    });
  }
  return res.json({
    status: true,
    qr: currentStatus.qr
  });
});

router.post('/qr/refresh', userAuth, ownedSessionOnly, async (req, res) => {
  try {
    const sessionId = req.body.session_id || 'default';
    await logoutSession(sessionId);
    await initWhatsApp(sessionId);
    return res.json({ status: true, message: 'Menghasilkan QR Code baru...' });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
});

router.post('/pairing', apiKeyAuth, async (req, res) => {
  const { phone_number, session_id = 'default' } = req.body;
  if (!phone_number) {
    return res.status(400).json({ status: false, message: 'phone_number parameter is required' });
  }
  try {
    const code = await requestPairing(session_id, phone_number);
    return res.json({ status: true, message: 'Pairing code generated', pairingCode: code });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
});

router.post('/session/logout', userAuth, ownedSessionOnly, async (req, res) => {
  try {
    await logoutSession(req.body.session_id || 'default');
    await dbRun('DELETE FROM whatsapp_sessions WHERE session_id = ?', [req.body.session_id || 'default']);
    return res.json({ status: true, message: 'WhatsApp session disconnected successfully' });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
});

router.post('/logout', userAuth, ownedSessionOnly, async (req, res) => {
  try {
    const sessionId = req.body.session_id || 'default';
    await logoutSession(sessionId);
    await dbRun('DELETE FROM whatsapp_sessions WHERE session_id = ?', [sessionId]);
    return res.json({ status: true, message: 'WhatsApp session disconnected successfully' });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
});

// 2. Send Text Message
router.post('/send-text', apiKeyAuth, async (req, res) => {
  const { to, message, session_id = 'default' } = req.body;

  if (!to || !message) {
    return res.status(400).json({
      status: false,
      message: 'Both "to" and "message" parameters are required.'
    });
  }

  try {
    const result = await sendTextMessage(session_id, to, message);
    return res.json({
      status: true,
      message: 'Message queued and sent successfully',
      data: result
    });
  } catch (err) {
    return res.status(500).json({
      status: false,
      message: 'Failed to send text message: ' + err.message
    });
  }
});

// 3. Send Media Message (File upload or Media URL)
router.post('/send-media', apiKeyAuth, upload.single('file'), async (req, res) => {
  const { to, caption, media_url, session_id = 'default' } = req.body;

  if (!to) {
    return res.status(400).json({ status: false, message: 'Parameter "to" is required.' });
  }

  if (!req.file && (!media_url || media_url.trim() === '')) {
    return res.status(400).json({
      status: false,
      message: 'Please provide either a file upload or a valid "media_url".'
    });
  }

  try {
    let mediaBuffer;
    let mimetype;
    let filename;

    if (req.file) {
      mediaBuffer = fs.readFileSync(req.file.path);
      mimetype = req.file.mimetype;
      filename = req.file.originalname;

      // Clean up temp file asynchronously
      fs.unlink(req.file.path, () => {});
    } else {
      // Download from media_url
      const response = await axios.get(media_url, { responseType: 'arraybuffer' });
      mediaBuffer = Buffer.from(response.data);
      mimetype = response.headers['content-type'] || 'application/octet-stream';
      filename = path.basename(new URL(media_url).pathname) || 'file';
    }

    const result = await sendMediaMessage(session_id, to, mediaBuffer, mimetype, filename, caption || '');
    return res.json({
      status: true,
      message: 'Media message sent successfully',
      data: result
    });
  } catch (err) {
    return res.status(500).json({
      status: false,
      message: 'Failed to send media message: ' + err.message
    });
  }
});

// 4. Send Bulk Messages with Custom Delay
router.post('/send-bulk', apiKeyAuth, async (req, res) => {
  const { numbers, message, delay = 2000, session_id = 'default' } = req.body;

  if (!numbers || !message) {
    return res.status(400).json({
      status: false,
      message: 'Both "numbers" (array or comma-separated string) and "message" are required.'
    });
  }

  let phoneList = [];
  if (Array.isArray(numbers)) {
    phoneList = numbers;
  } else if (typeof numbers === 'string') {
    phoneList = numbers.split(',').map(n => n.trim()).filter(Boolean);
  }

  if (phoneList.length === 0) {
    return res.status(400).json({ status: false, message: 'No valid phone numbers provided.' });
  }

  // Process bulk sending asynchronously
  res.json({
    status: true,
    message: `Bulk message broadcasting started for ${phoneList.length} numbers with ${delay}ms delay.`,
    total: phoneList.length
  });

  // Background broadcast loop
  (async () => {
    for (const num of phoneList) {
      try {
        await sendTextMessage(session_id, num, message);
        logger.info({ to: num }, 'Bulk message sent successfully');
      } catch (err) {
        logger.error({ to: num, err: err.message }, 'Failed sending bulk message to recipient');
      }
      // Wait for delay
      await new Promise(resolve => setTimeout(resolve, parseInt(delay) || 2000));
    }
  })();
});

// 5. Message Logs
router.get('/logs', apiKeyAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    const sessionId = req.query.session_id;
    const where = sessionId ? 'WHERE session_id = ?' : '';
    const params = sessionId ? [sessionId, limit, offset] : [limit, offset];
    const logs = await dbAll(`SELECT * FROM logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, params);

    const totalRow = await dbGet(`SELECT COUNT(*) as count FROM logs ${where}`, sessionId ? [sessionId] : []);

    return res.json({
      status: true,
      data: logs,
      pagination: {
        total: totalRow?.count || 0,
        page,
        limit
      }
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
});

// 6. Settings Management (Accessible for Dashboard & API)
router.get('/settings', userAuth, ownedSessionOnly, async (req, res) => {
  try {
    const sessionId = req.query.session_id || 'default';
    const api = await dbGet(`SELECT value FROM settings WHERE key = ?`, [`session:${sessionId}:api_key`]);
    const webhook = await dbGet(`SELECT value FROM settings WHERE key = ?`, [`session:${sessionId}:webhook_url`]);
    const legacyApi = sessionId === 'default' ? await dbGet(`SELECT value FROM settings WHERE key = 'api_key'`) : null;
    const legacyWebhook = sessionId === 'default' ? await dbGet(`SELECT value FROM settings WHERE key = 'webhook_url'`) : null;
    const formatted = { session_id: sessionId, api_key: api?.value || legacyApi?.value || '', webhook_url: webhook?.value || legacyWebhook?.value || '' };

    return res.json({
      status: true,
      data: formatted
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
});

router.post('/settings', userAuth, ownedSessionOnly, async (req, res) => {
  const { api_key, webhook_url, session_id = 'default' } = req.body;

  try {
    if (api_key && api_key.trim() !== '') {
      await dbRun(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [`session:${session_id}:api_key`, api_key.trim()]);
    }
    if (webhook_url !== undefined) {
      await dbRun(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [`session:${session_id}:webhook_url`, webhook_url.trim()]);
    }

    return res.json({
      status: true,
      message: 'Settings updated successfully'
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
});

export default router;
