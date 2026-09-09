import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { dbGet, dbAll, dbRun } from '../config/database.js';
import { userAuth, requireAdmin } from '../middlewares/userAuth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'wagateway_jwt_secret_super_secure_key';

// 1. User Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      status: false,
      message: 'Username dan password wajib diisi.'
    });
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [username.trim()]);
    if (!user) {
      return res.status(401).json({
        status: false,
        message: 'Username atau password salah.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        status: false,
        message: 'Username atau password salah.'
      });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, name: user.name, role: user.role, session_id: user.session_id || null },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set cookie for browser session
    res.cookie('token', token, {
      httpOnly: false,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return res.json({
      status: true,
      message: 'Login berhasil!',
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        session_id: user.session_id || null
      }
    });
  } catch (err) {
    logger.error({ err }, 'Login error');
    return res.status(500).json({ status: false, message: 'Server error: ' + err.message });
  }
});

// 2. Get Current User Profile
router.get('/me', userAuth, (req, res) => {
  return res.json({
    status: true,
    user: req.user
  });
});

// 3. User Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  return res.json({
    status: true,
    message: 'Logout berhasil.'
  });
});

// 4. List All Users (Admin only)
router.get('/users', userAuth, requireAdmin, async (req, res) => {
  try {
    const users = await dbAll('SELECT id, username, name, role, session_id, created_at FROM users ORDER BY id ASC');
    return res.json({
      status: true,
      data: users
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
});

// 5. Create New User (Admin only)
router.post('/users', userAuth, requireAdmin, async (req, res) => {
  const { username, password, name, role = 'operator', session_id = null } = req.body;

  if (!username || !password || !name) {
    return res.status(400).json({
      status: false,
      message: 'Username, password, dan nama wajib diisi.'
    });
  }

  try {
    const existing = await dbGet('SELECT id FROM users WHERE username = ?', [username.trim()]);
    if (existing) {
      return res.status(400).json({
        status: false,
        message: 'Username sudah digunakan, silakan pilih username lain.'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await dbRun(
      'INSERT INTO users (username, password, name, role, session_id) VALUES (?, ?, ?, ?, ?)',
      [username.trim(), hashedPassword, name.trim(), role, session_id || null]
    );

    return res.json({
      status: true,
      message: 'Pengguna baru berhasil ditambahkan!',
      data: { id: result.lastID, username, name, role, session_id: session_id || null }
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
});

// 6. Update User (Admin only)
router.put('/users/:id', userAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, role, password, session_id } = req.body;

  try {
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ status: false, message: 'Pengguna tidak ditemukan.' });
    }

    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      await dbRun(
        'UPDATE users SET name = ?, role = ?, session_id = ?, password = ? WHERE id = ?',
        [name || user.name, role || user.role, session_id ?? user.session_id, hashedPassword, id]
      );
    } else {
      await dbRun(
        'UPDATE users SET name = ?, role = ?, session_id = ? WHERE id = ?',
        [name || user.name, role || user.role, session_id ?? user.session_id, id]
      );
    }

    return res.json({
      status: true,
      message: 'Data pengguna berhasil diperbarui!'
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
});

// 7. Delete User (Admin only)
router.delete('/users/:id', userAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        status: false,
        message: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.'
      });
    }

    const totalUsers = await dbGet('SELECT COUNT(*) as count FROM users WHERE role = "admin"');
    const targetUser = await dbGet('SELECT role FROM users WHERE id = ?', [id]);

    if (!targetUser) {
      return res.status(404).json({ status: false, message: 'Pengguna tidak ditemukan.' });
    }

    if (targetUser.role === 'admin' && totalUsers.count <= 1) {
      return res.status(400).json({
        status: false,
        message: 'Tidak dapat menghapus admin utama terakhir.'
      });
    }

    await dbRun('DELETE FROM users WHERE id = ?', [id]);
    return res.json({
      status: true,
      message: 'Pengguna berhasil dihapus!'
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
});

export default router;
