import jwt from 'jsonwebtoken';
import { dbGet } from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'wagateway_jwt_secret_super_secure_key';

export const userAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const cookieToken = req.cookies?.token;
  const queryToken = req.query?.token;

  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (cookieToken) {
    token = cookieToken;
  } else if (queryToken) {
    token = queryToken;
  }

  if (!token) {
    return res.status(401).json({
      status: false,
      message: 'Unauthorized: Sesi login tidak ditemukan. Silakan login terlebih dahulu.'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Read current assignment from DB so a changed assignment takes effect immediately.
    const user = await dbGet('SELECT id, username, name, role, session_id FROM users WHERE id = ?', [decoded.id]);
    if (!user) throw new Error('User tidak ditemukan');
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      status: false,
      message: 'Unauthorized: Sesi kedaluwarsa atau token tidak valid.'
    });
  }
};

export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      status: false,
      message: 'Forbidden: Hanya admin yang memiliki akses ke menu ini.'
    });
  }
  next();
};
