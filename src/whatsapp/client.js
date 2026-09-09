import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { logger } from '../utils/logger.js';
import { dbRun } from '../config/database.js';
import { sendWebhook } from '../services/webhook.js';

const sessions = new Map(); let ioInstance = null;
const sessionsDir = process.env.SESSION_DIR || './sessions'; fs.mkdirSync(sessionsDir, { recursive: true });
const idOf = (id = 'default') => { const value = String(id).trim() || 'default'; if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new Error('session_id tidak valid'); return value; };
// Keep the original default credentials in ./sessions so upgrades do not log out the first HP.
const dirOf = id => idOf(id) === 'default' ? sessionsDir : path.join(sessionsDir, idOf(id));
const clearAuth = id => {
  const dir = dirOf(id);
  if (idOf(id) === 'default') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) fs.rmSync(path.join(dir, entry.name), { force: true });
    }
  } else fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
};
const view = s => ({ session_id: s.id, status: s.status, qr: s.qr, pairingCode: s.pairingCode, user: s.user });
const emit = s => ioInstance?.emit('status-update', view(s));
const jidOf = to => String(to).includes('@') ? String(to) : `${String(to).replace(/[^0-9]/g, '').replace(/^0/, '62')}@s.whatsapp.net`;

export const setSocketIO = io => { ioInstance = io; };
export const listSessions = () => [...sessions.values()].map(view);
export const getStatus = (id = 'default') => { const session = sessions.get(idOf(id)); return session ? view(session) : null; };
export const initSavedSessions = async () => {
  const ids = fs.readdirSync(sessionsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^[a-zA-Z0-9_-]{1,64}$/.test(entry.name))
    .map(entry => entry.name);
  await Promise.all(['default', ...ids].map(id => initWhatsApp(id)));
};

export const initWhatsApp = async (requestedId = 'default') => {
  const id = idOf(requestedId); let s = sessions.get(id);
  if (s?.initializing) return s.socket;
  if (!s) { s = { id, socket: null, status: 'DISCONNECTED', qr: null, pairingCode: null, user: null, initializing: false, manualLogout: false }; sessions.set(id, s); }
  s.initializing = true; s.status = 'CONNECTING'; emit(s);
  try {
    fs.mkdirSync(dirOf(id), { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(dirOf(id));
    const { version } = await fetchLatestBaileysVersion(); const silent = pino({ level: 'silent' });
    const sock = makeWASocket({ version, logger: silent, auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, silent) }, printQRInTerminal: true, browser: ['WA Gateway', 'Chrome', '1.0.0'], generateHighQualityLinkPreview: true });
    s.socket = sock; sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (s.socket !== sock) return;
      if (qr) { s.qr = await QRCode.toDataURL(qr); s.status = 'QR_READY'; emit(s); }
      if (connection === 'open') { const waJid = sock.user?.id; s.status = 'CONNECTED'; s.qr = null; s.pairingCode = null; s.user = { phone: waJid?.split(':')[0] || 'Unknown', name: sock.user?.name || 'WA Gateway User', jid: waJid }; emit(s); logger.info({ sessionId: id }, 'WhatsApp session connected'); }
      if (connection === 'close') { s.status = 'DISCONNECTED'; s.qr = null; s.pairingCode = null; s.user = null; emit(s); const code = lastDisconnect?.error?.output?.statusCode; const loggedOut = code === DisconnectReason.loggedOut || code === 401; if (loggedOut) try { clearAuth(id); } catch {} if (!s.manualLogout && s.socket === sock) setTimeout(() => initWhatsApp(id), loggedOut ? 2000 : 4000); }
    });
    sock.ev.on('messages.upsert', async m => { if (m.type !== 'notify') return; for (const msg of m.messages) { if (!msg.message || msg.key.fromMe) continue; const sender = msg.key.remoteJid; const phone = sender.replace('@s.whatsapp.net', '').replace('@g.us', ''); const content = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '[Media/Other Message]'; await dbRun('INSERT INTO logs (session_id, phone_number, message, type, status) VALUES (?, ?, ?, ?, ?)', [id, phone, content, 'received', 'success']).catch(err => logger.error({ err }, 'Failed to log incoming')); ioInstance?.emit('new-message', { session_id: id, from: phone, message: content, timestamp: new Date(Number(msg.messageTimestamp) * 1000).toISOString() }); sendWebhook('message.received', { session_id: id, from: phone, jid: sender, message: content, rawMessage: msg }); } });
    return sock;
  } catch (err) { s.status = 'DISCONNECTED'; emit(s); logger.error({ err, sessionId: id }, 'Error initializing WhatsApp session'); throw err; } finally { s.initializing = false; }
};

export const requestPairing = async (id, phone) => { if (phone === undefined) { phone = id; id = 'default'; } const s = sessions.get(idOf(id)); if (!s?.socket) throw new Error('Sesi WhatsApp belum diinisialisasi'); if (s.status === 'CONNECTED') throw new Error('Sesi WhatsApp sudah terhubung'); s.pairingCode = await s.socket.requestPairingCode(String(phone).replace(/[^0-9]/g, '')); emit(s); return s.pairingCode; };
const send = async (id, to, payload, log) => { const s = sessions.get(idOf(id)); if (!s?.socket || s.status !== 'CONNECTED') throw new Error(`Sesi "${id}" belum terhubung.`); const phone = String(to).replace(/[^0-9]/g, ''); try { const out = await s.socket.sendMessage(jidOf(to), payload); await dbRun('INSERT INTO logs (session_id, phone_number, message, type, status) VALUES (?, ?, ?, ?, ?)', [s.id, phone, log, 'sent', 'success']); return out; } catch (err) { await dbRun('INSERT INTO logs (session_id, phone_number, message, type, status, error) VALUES (?, ?, ?, ?, ?, ?)', [s.id, phone, log, 'sent', 'failed', err.message]); throw err; } };
export const sendTextMessage = (id, to, message) => message === undefined ? send('default', id, { text: to }, to) : send(id, to, { text: message }, message);
export const sendMediaMessage = (id, to, buffer, mimetype, filename, caption = '') => { const payload = mimetype.startsWith('image/') ? { image: buffer, caption } : mimetype.startsWith('video/') ? { video: buffer, caption } : mimetype.startsWith('audio/') ? { audio: buffer, mimetype: 'audio/mp4', ptt: true } : { document: buffer, mimetype, fileName: filename || 'file', caption }; return send(id, to, payload, `[Media: ${filename || mimetype}] ${caption}`); };
export const logoutSession = async (requestedId = 'default') => { const id = idOf(requestedId); const s = sessions.get(id); if (!s) return true; s.manualLogout = true; try { s.socket?.ev.removeAllListeners(); await s.socket?.logout().catch(() => {}); s.socket?.end(); } catch {} sessions.delete(id); try { clearAuth(id); } catch {} ioInstance?.emit('session-removed', { session_id: id }); return true; };
