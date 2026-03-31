const express = require('express');
const path = require('path');
const QRCode = require('qrcode');
const pino = require('pino');

const logger = pino({ level: 'info' });
const app = express();
app.use(express.json());

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

let sock = null;
let currentQR = null;
let isConnected = false;
let isConnecting = false;

async function getBaileys() {
  return await import('@whiskeysockets/baileys');
}

async function connectToWhatsApp() {
  if (isConnecting) return;
  isConnecting = true;
  currentQR = null;

  try {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
    } = await getBaileys();

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      auth: state,
      printQRInTerminal: false,
      browser: ['Champions Academy', 'Chrome', '120.0.0'],
      generateHighQualityLinkPreview: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQR = qr;
        isConnected = false;
        logger.info('QR code generated, waiting for scan...');
      }

      if (connection === 'open') {
        isConnected = true;
        currentQR = null;
        isConnecting = false;
        logger.info('WhatsApp connected successfully!');
      }

      if (connection === 'close') {
        isConnected = false;
        isConnecting = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        logger.info(`Connection closed. Status: ${statusCode}. Reconnect: ${shouldReconnect}`);
        if (shouldReconnect) {
          setTimeout(connectToWhatsApp, 5000);
        } else {
          sock = null;
          currentQR = null;
        }
      }
    });
  } catch (err) {
    logger.error('Failed to connect:', err.message);
    isConnecting = false;
    setTimeout(connectToWhatsApp, 10000);
  }
}

app.get('/status', async (req, res) => {
  let qrDataUrl = null;
  if (currentQR && !isConnected) {
    try {
      qrDataUrl = await QRCode.toDataURL(currentQR);
    } catch (e) {
      logger.error('QR code generation error:', e.message);
    }
  }
  res.json({
    connected: isConnected,
    qr: qrDataUrl,
    connecting: isConnecting,
  });
});

app.post('/send', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'phone and message required' });
  }
  if (!isConnected || !sock) {
    return res.status(503).json({ success: false, error: 'WhatsApp not connected' });
  }
  try {
    await sock.sendMessage(phone, { text: message });
    logger.info(`Message sent to ${phone}`);
    res.json({ success: true });
  } catch (err) {
    logger.error(`Failed to send message to ${phone}:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/disconnect', async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
      sock = null;
    }
    isConnected = false;
    currentQR = null;
    isConnecting = false;
    const fs = require('fs');
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
    res.json({ success: true, message: 'Disconnected and session cleared' });
    setTimeout(connectToWhatsApp, 2000);
  } catch (err) {
    logger.error('Disconnect error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = 3001;
app.listen(PORT, '127.0.0.1', () => {
  logger.info(`WhatsApp service running on port ${PORT}`);
  connectToWhatsApp();
});
