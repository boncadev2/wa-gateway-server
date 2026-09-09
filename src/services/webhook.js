import axios from 'axios';
import { dbGet } from '../config/database.js';
import { logger } from '../utils/logger.js';

export const sendWebhook = async (event, data) => {
  try {
    const sessionId = data.session_id || 'default';
    const setting = await dbGet("SELECT value FROM settings WHERE key = ?", [`session:${sessionId}:webhook_url`]);
    const legacySetting = sessionId === 'default' ? await dbGet("SELECT value FROM settings WHERE key = 'webhook_url'") : null;
    const webhookUrl = setting?.value || legacySetting?.value || process.env.WEBHOOK_URL;

    if (!webhookUrl || webhookUrl.trim() === '') {
      return;
    }

    logger.info({ webhookUrl, event }, 'Sending webhook notification');

    await axios.post(webhookUrl, {
      event,
      data,
      timestamp: new Date().toISOString()
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WA-Gateway-Webhook/1.0'
      },
      timeout: 10000
    });
  } catch (error) {
    logger.error({ err: error.message, event }, 'Failed to trigger webhook notification');
  }
};
