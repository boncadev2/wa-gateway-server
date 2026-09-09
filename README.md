# WhatsApp Gateway REST API & Web Dashboard

A fast, lightweight WhatsApp Gateway and REST API powered by Node.js, Express, Socket.io, and `@whiskeysockets/baileys`.

## Features

- **No Heavy Browser Required**: Uses WebSocket protocol via `@whiskeysockets/baileys` (low memory & fast).
- **Web Dashboard**: Modern dark-themed dashboard built with Tailwind CSS & FontAwesome.
- **Multi-device sessions**: Connect multiple WhatsApp accounts; each has a separate QR and `session_id`.
- **REST API with API Key Protection**: Authenticate via `x-api-key` header.
- **Single & Bulk Messaging**: Send single text/media messages or bulk broadcast with customizable delay intervals.
- **Webhook Forwarding**: Automatically forward incoming WhatsApp messages to your server in real-time.
- **SQLite Data Storage**: Stores message logs, settings, and API keys.

---

## Quick Start

### 1. Installation

```bash
cd "WA gateway"
npm install
```

### 2. Configuration

Copy `.env.example` to `.env`:

```env
PORT=3000
API_KEY=wagateway_secret_key_123
WEBHOOK_URL=
AUTO_READ_MESSAGES=true
SESSION_DIR=./sessions
UPLOAD_DIR=./uploads
DATA_DIR=./data
```

### 3. Run Application

```bash
# Production mode
npm start

# Development mode (auto-reload on edit)
npm run dev
```

Open your browser at **[http://localhost:3000](http://localhost:3000)** to access the Web Dashboard and scan the QR code.

---

## REST API Reference

All protected endpoints require the `x-api-key` HTTP header.

### 1. Get Connection Status
- **Method**: `GET`
- **URL**: `/api/status`

### 2. Send Text Message
- **Method**: `POST`
- **URL**: `/api/send-text`
- **Headers**: `x-api-key: YOUR_API_KEY`, `Content-Type: application/json`
- **Body**:
  ```json
  {
    "session_id": "sales_1",
    "to": "628123456789",
    "message": "Halo, ini pesan dari WA Gateway!"
  }
  ```

### Multi-device sessions

Create a session, then scan the QR returned through `GET /api/status?session_id=sales_1`:

```json
POST /api/sessions
{ "session_id": "sales_1" }
```

Use the same `session_id` in `/send-text`, `/send-media`, `/send-bulk`, `/pairing`, and logout requests. Omit it to keep using the original `default` session. List all connected accounts with `GET /api/sessions`.

### 3. Send Media Message
- **Method**: `POST`
- **URL**: `/api/send-media`
- **Headers**: `x-api-key: YOUR_API_KEY`
- **Body (JSON or Multipart Form Data)**:
  ```json
  {
    "to": "628123456789",
    "caption": "Foto Produk Terbaru",
    "media_url": "https://example.com/image.jpg"
  }
  ```

### 4. Send Bulk Broadcast
- **Method**: `POST`
- **URL**: `/api/send-bulk`
- **Headers**: `x-api-key: YOUR_API_KEY`, `Content-Type: application/json`
- **Body**:
  ```json
  {
    "numbers": ["628123456781", "628123456782", "628123456783"],
    "message": "Pengumuman Penting!",
    "delay": 2000
  }
  ```

### 5. Fetch Message Logs
- **Method**: `GET`
- **URL**: `/api/logs?limit=50&page=1`
- **Headers**: `x-api-key: YOUR_API_KEY`

---

## Webhook Specification

When a message is received on WhatsApp, a `POST` request is sent to your `WEBHOOK_URL` with payload:

```json
{
  "event": "message.received",
  "data": {
    "from": "628123456789",
    "jid": "628123456789@s.whatsapp.net",
    "message": "Halo Admin"
  },
  "timestamp": "2026-08-29T23:38:00.000Z"
}
```
