import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import cookieParser from 'cookie-parser';
import apiRouter from './routes/api.js';
import authRouter from './routes/auth.js';
import { initSavedSessions, setSocketIO, getStatus, listSessions } from './whatsapp/client.js';
import { logger } from './utils/logger.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static frontend dashboard
app.use(express.static(path.join(__dirname, '../public')));

// Register API Routes
app.use('/api', apiRouter);
app.use('/api/auth', authRouter);
app.use('/api', authRouter);

// Pass Socket.io instance to WhatsApp engine module
setSocketIO(io);

// Socket.io Connection Event
io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, 'Web Dashboard client connected to Socket.io');

  // Immediately send current status to the newly connected client
  socket.emit('sessions-update', listSessions());
  const defaultStatus = getStatus();
  if (defaultStatus) socket.emit('status-update', defaultStatus);

  socket.on('disconnect', () => {
    logger.info({ socketId: socket.id }, 'Web Dashboard client disconnected from Socket.io');
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled Server Error');
  res.status(500).json({
    status: false,
    message: 'Internal Server Error: ' + err.message
  });
});

// Start Server & Initialize WhatsApp Socket
httpServer.listen(PORT, async () => {
  logger.info(`=================================================`);
  logger.info(`🚀 WhatsApp Gateway is running on http://localhost:${PORT}`);
  logger.info(`=================================================`);

  try {
    await initSavedSessions();
  } catch (err) {
    logger.error({ err }, 'Failed to initialize WhatsApp Engine');
  }
});
