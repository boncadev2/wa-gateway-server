import { dbGet } from '../config/database.js';

export const apiKeyAuth = async (req, res, next) => {
  try {
    const headerKey = req.headers['x-api-key'];
    const authHeader = req.headers['authorization'];
    const queryKey = req.query.api_key;

    let providedKey = headerKey || queryKey;
    if (!providedKey && authHeader && authHeader.startsWith('Bearer ')) {
      providedKey = authHeader.split(' ')[1];
    }

    if (!providedKey) {
      return res.status(401).json({
        status: false,
        message: 'Unauthorized: Missing API key in header (x-api-key) or query parameter (api_key)'
      });
    }

    // The target account is supplied by the request body, query, or X-Session-ID header.
    const sessionId = req.body?.session_id || req.query.session_id || req.headers['x-session-id'] || 'default';
    const setting = await dbGet("SELECT value FROM settings WHERE key = ?", [`session:${sessionId}:api_key`]);
    const legacySetting = sessionId === 'default' ? await dbGet("SELECT value FROM settings WHERE key = 'api_key'") : null;
    const validApiKey = setting?.value || legacySetting?.value || process.env.API_KEY || 'wagateway_secret_key_123';

    if (providedKey !== validApiKey) {
      return res.status(403).json({
        status: false,
        message: 'Forbidden: Invalid API key provided'
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: 'Internal Auth Error: ' + error.message
    });
  }
};
