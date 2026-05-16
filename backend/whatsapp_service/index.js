const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const pino = require('pino');
const { MongoClient } = require('mongodb');

const logger = pino({ level: 'info' });
const app = express();
app.use(express.json());

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const MONGO_URL = process.env.MONGO_URL;
// Mirrors the Python slug_to_db_name("default") convention so this service
// resolves to the same MongoDB database as the main app's default tenant
// (`champions_default`). Overridable via env for non-default deployments.
const TENANT_DB_PREFIX = process.env.TENANT_DB_PREFIX || 'champions_';
const DEFAULT_TENANT_SLUG = process.env.WHATSAPP_TENANT_SLUG || 'default';
const DB_NAME = process.env.WHATSAPP_DB_NAME || `${TENANT_DB_PREFIX}${DEFAULT_TENANT_SLUG}`;
const COLL_NAME = 'whatsapp_auth';
const _domain = process.env.REPLIT_DOMAINS || '';
const SESSION_ID = (_domain.includes('.replit.app') && !_domain.includes('pike')) ? 'session_prod' : 'session_dev';

let mongoClient = null;

async function getMongoCollection() {
  if (!MONGO_URL) return null;
  try {
    if (!mongoClient) {
      mongoClient = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 5000 });
      await mongoClient.connect();
    }
    return mongoClient.db(DB_NAME).collection(COLL_NAME);
  } catch (err) {
    logger.error('MongoDB connection failed:', err.message);
    return null;
  }
}

async function backupAuthToMongo() {
  try {
    if (!fs.existsSync(AUTH_DIR)) return;
    const files = fs.readdirSync(AUTH_DIR);
    if (!files.length) return;
    const data = {};
    for (const file of files) {
      const filePath = path.join(AUTH_DIR, file);
      data[file] = fs.readFileSync(filePath).toString('base64');
    }
    const col = await getMongoCollection();
    if (!col) return;
    await col.updateOne({ _id: SESSION_ID }, { $set: { files: data, updatedAt: new Date() } }, { upsert: true });
    logger.info('Auth session backed up to MongoDB');
  } catch (err) {
    logger.error('Failed to backup auth to MongoDB:', err.message);
  }
}

async function restoreAuthFromMongo() {
  try {
    const col = await getMongoCollection();
    if (!col) return false;
    const doc = await col.findOne({ _id: SESSION_ID });
    if (!doc || !doc.files || !Object.keys(doc.files).length) {
      logger.info('No saved session found in MongoDB');
      return false;
    }
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    for (const [filename, b64] of Object.entries(doc.files)) {
      fs.writeFileSync(path.join(AUTH_DIR, filename), Buffer.from(b64, 'base64'));
    }
    logger.info('Auth session restored from MongoDB');
    return true;
  } catch (err) {
    logger.error('Failed to restore auth from MongoDB:', err.message);
    return false;
  }
}

async function clearAuthFromMongo() {
  try {
    const col = await getMongoCollection();
    if (!col) return;
    await col.deleteOne({ _id: SESSION_ID });
    logger.info('Auth session cleared from MongoDB');
  } catch (err) {
    logger.error('Failed to clear auth from MongoDB:', err.message);
  }
}

let sock = null;
let currentQR = null;
let isConnected = false;
let isConnecting = false;
let backupTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_BEFORE_FRESH_QR = 3;

function scheduleBackup() {
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupAuthToMongo();
  }, 2000);
}

async function getBaileys() {
  return await import('@whiskeysockets/baileys');
}

async function clearLocalAuth() {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
  } catch (e) {
    logger.error('Failed to clear local auth:', e.message);
  }
}

async function connectToWhatsApp(forceNewQR = false) {
  if (isConnecting) return;
  isConnecting = true;
  if (forceNewQR) currentQR = null;

  try {
    // If forced fresh QR or too many reconnect attempts, clear old session
    if (forceNewQR || reconnectAttempts >= MAX_RECONNECT_BEFORE_FRESH_QR) {
      logger.info(`Clearing session (forceNewQR=${forceNewQR}, attempts=${reconnectAttempts})`);
      await clearLocalAuth();
      await clearAuthFromMongo();
      reconnectAttempts = 0;
    } else {
      await restoreAuthFromMongo();
    }

    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
    } = await getBaileys();

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // Use hardcoded version directly – fetchLatestBaileysVersion() hits GitHub
    // which hangs in restricted environments and delays QR generation.
    // Try quickly in background; always proceed immediately with the fallback.
    const FALLBACK_VERSION = [2, 3000, 1015901307];
    let version = FALLBACK_VERSION;
    try {
      const versionResult = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
      ]);
      version = versionResult.version;
      logger.info(`WA version from server: ${version}`);
    } catch {
      logger.info(`Using built-in WA version: ${FALLBACK_VERSION}`);
    }

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      auth: state,
      printQRInTerminal: false,
      browser: ['Champions Academy', 'Chrome', '120.0.0'],
      generateHighQualityLinkPreview: false,
    });

    sock.ev.on('creds.update', () => {
      saveCreds();
      scheduleBackup();
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQR = qr;
        isConnected = false;
        isConnecting = false;
        logger.info('QR code generated, waiting for scan...');
      }

      if (connection === 'open') {
        isConnected = true;
        currentQR = null;
        isConnecting = false;
        reconnectAttempts = 0;
        logger.info('WhatsApp connected successfully!');
        scheduleBackup();
      }

      if (connection === 'close') {
        isConnected = false;
        isConnecting = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        logger.info(`Connection closed. Status: ${statusCode}. Reconnect: ${shouldReconnect}, attempts: ${reconnectAttempts}`);
        if (shouldReconnect) {
          reconnectAttempts++;
          setTimeout(connectToWhatsApp, 5000);
        } else {
          sock = null;
          currentQR = null;
          reconnectAttempts = 0;
          await clearLocalAuth();
          await clearAuthFromMongo();
          setTimeout(connectToWhatsApp, 3000);
        }
      }
    });
  } catch (err) {
    logger.error('Failed to connect:', err.message);
    isConnecting = false;
    reconnectAttempts++;
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
  // Always respond success and reset regardless of logout outcome
  isConnected = false;
  currentQR = null;
  isConnecting = false;
  reconnectAttempts = 0;

  if (sock) {
    try { await sock.logout(); } catch (e) { logger.warn('Logout error (ignored):', e.message); }
    sock = null;
  }

  await clearLocalAuth();
  await clearAuthFromMongo();

  res.json({ success: true, message: 'Disconnected and session cleared' });
  setTimeout(() => connectToWhatsApp(true), 2000);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = 3001;
app.listen(PORT, '127.0.0.1', () => {
  logger.info(`WhatsApp service running on port ${PORT}`);
  connectToWhatsApp();
});
