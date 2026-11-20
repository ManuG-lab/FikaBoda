import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import { calculateDeliveryQuote, DEFAULT_PRICING_RULES } from './src/utils/pricing.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId;

// ==================================================
// In-Memory Rate Limiter & M-Pesa Idempotency Store
// ==================================================

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket.count >= maxRequests) {
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment before retrying.',
      });
    }
    bucket.count += 1;
    return next();
  };
}

interface MpesaTxRecord {
  paymentId: string;
  jobId: string;
  checkoutRequestId: string;
  merchantRequestId: string;
  amount: number;
  phoneNumber: string;
  status: 'PENDING_STK' | 'PAID' | 'FAILED' | 'TIMEOUT';
  mpesaReceiptNumber?: string;
  resultDesc?: string;
  callbackProcessed: boolean;
  updatedAt: string;
}

const mpesaTransactions = new Map<string, MpesaTxRecord>();

// ==================================================
// Firebase ID Token Cryptographic Verification (No IAM needed)
// ==================================================

let cachedCerts: Record<string, string> | null = null;
let certsExpiresAt = 0;

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  if (cachedCerts && Date.now() < certsExpiresAt) {
    return cachedCerts;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!resp.ok) {
    throw new Error('Failed to fetch Firebase public keys');
  }
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = (await resp.json()) as Record<string, string>;
  certsExpiresAt = Date.now() + maxAgeSec * 1000;
  return cachedCerts;
}

interface VerifiedFirebaseUser {
  uid: string;
  email?: string;
  email_verified?: boolean;
}

async function verifyFirebaseBearerToken(req: Request): Promise<VerifiedFirebaseUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const nowSec = Math.floor(Date.now() / 1000);

    if (payload.aud !== PROJECT_ID) return null;
    if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) return null;
    if (!payload.sub || typeof payload.sub !== 'string') return null;
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;

    const certs = await getGooglePublicCerts();
    const cert = certs[header.kid];
    if (!cert) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    const valid = verifier.verify(cert, parts[2], 'base64url');
    if (!valid) return null;

    return {
      uid: payload.sub,
      email: payload.email,
      email_verified: Boolean(payload.email_verified),
    };
  } catch {
    return null;
  }
}

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await verifyFirebaseBearerToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Valid Firebase authentication token required.' });
  }
  (req as any).firebaseUser = user;
  return next();
}

// ==================================================
// Helpers for Daraja & Notifications Config Checks
// ==================================================

function isConfiguredSecret(val: string | undefined): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('your-') || trimmed.startsWith('MY_')) return false;
  return true;
}

function getDarajaConfig() {
  const env = process.env.DARAJA_ENV === 'production' ? 'production' : 'sandbox';
  const consumerKey = process.env.DARAJA_CONSUMER_KEY;
  const consumerSecret = process.env.DARAJA_CONSUMER_SECRET;
  const shortcode = process.env.DARAJA_SHORTCODE;
  const passkey = process.env.DARAJA_PASSKEY;
  const callbackUrl =
    process.env.DARAJA_CALLBACK_URL ||
    (process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/api/mpesa/callback` : '');

  const configured =
    isConfiguredSecret(consumerKey) &&
    isConfiguredSecret(consumerSecret) &&
    isConfiguredSecret(shortcode) &&
    isConfiguredSecret(passkey) &&
    Boolean(callbackUrl && !callbackUrl.includes('your-domain.com'));

  const baseUrl =
    env === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

  return {
    env,
    baseUrl,
    consumerKey: consumerKey || '',
    consumerSecret: consumerSecret || '',
    shortcode: shortcode || '',
    passkey: passkey || '',
    callbackUrl,
    configured,
  };
}

function normalizeKenyanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) return `254${digits}`;
  return digits;
}

// ==================================================
// Express App Boot
// ==================================================

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // 1. Integration readiness endpoint (honest configuration status)
  app.get('/api/config/status', (_req, res) => {
    const daraja = getDarajaConfig();
    const whatsappConfigured =
      isConfiguredSecret(process.env.WHATSAPP_ACCESS_TOKEN) &&
      isConfiguredSecret(process.env.WHATSAPP_PHONE_NUMBER_ID);
    const smsConfigured = isConfiguredSecret(process.env.AFRICASTALKING_API_KEY);
    const mapsConfigured =
      isConfiguredSecret(process.env.VITE_GOOGLE_MAPS_API_KEY) ||
      isConfiguredSecret(process.env.GOOGLE_MAPS_API_KEY);

    res.json({
      firebase: {
        configured: Boolean(PROJECT_ID && PROJECT_ID !== 'remixed-project-id'),
        projectId: PROJECT_ID,
      },
      googleMaps: {
        configured: mapsConfigured,
      },
      daraja: {
        configured: daraja.configured,
        env: daraja.env,
        callbackUrlConfigured: Boolean(daraja.callbackUrl && !daraja.callbackUrl.includes('your-domain.com')),
      },
      whatsapp: { configured: whatsappConfigured },
      sms: { configured: smsConfigured },
      fcm: { configured: isConfiguredSecret(process.env.VITE_FIREBASE_VAPID_KEY) },
      appCheck: {
        configured:
          isConfiguredSecret(process.env.VITE_FIREBASE_APPCHECK_SITE_KEY) ||
          Boolean(firebaseConfig.recaptchaSiteKey),
      },
    });
  });

  // 2. Authoritative Server-Side Pricing Endpoint
  app.post('/api/pricing/calculate', rateLimit(60, 60_000), requireAuth, (req, res) => {
    const { roadDistanceKm, packageSize, specialHandling, zoneId } = req.body || {};
    if (typeof roadDistanceKm !== 'number' || roadDistanceKm <= 0 || roadDistanceKm > 250) {
      return res.status(400).json({ error: 'Invalid roadDistanceKm value.' });
    }
    if (!['SMALL', 'MEDIUM', 'LARGE'].includes(packageSize)) {
      return res.status(400).json({ error: 'Invalid packageSize value.' });
    }
    const quote = calculateDeliveryQuote({
      roadDistanceKm,
      packageSize,
      specialHandling,
      rules: DEFAULT_PRICING_RULES as any,
      zoneId,
    });
    return res.json(quote);
  });

  // 3. Daraja M-Pesa STK Push Initiation (No Simulated Success!)
  app.post('/api/mpesa/stk-push', rateLimit(15, 60_000), requireAuth, async (req, res) => {
    const { paymentId, jobId, phoneNumber, amount, accountReference } = req.body || {};
    if (!paymentId || !jobId || !phoneNumber || typeof amount !== 'number' || amount < 1) {
      return res.status(400).json({ error: 'Missing required STK Push parameters.' });
    }

    const formattedPhone = normalizeKenyanPhone(String(phoneNumber));
    if (!/^254(7|1)\d{8}$/.test(formattedPhone)) {
      return res.status(400).json({
        error: 'Enter a valid Kenyan Safaricom/Airtel mobile number (e.g. 0712345678 or 254712345678).',
      });
    }

    const daraja = getDarajaConfig();
    if (!daraja.configured) {
      return res.status(200).json({
        status: 'AWAITING_CONFIG',
        configured: false,
        message:
          'Safaricom Daraja credentials (DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET, DARAJA_SHORTCODE, DARAJA_PASSKEY, DARAJA_CALLBACK_URL) are not configured. No payment was simulated.',
      });
    }

    try {
      const authBytes = Buffer.from(`${daraja.consumerKey}:${daraja.consumerSecret}`).toString('base64');
      const tokenResp = await fetch(
        `${daraja.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        {
          headers: { Authorization: `Basic ${authBytes}` },
        }
      );

      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        return res.status(502).json({
          status: 'FAILED',
          configured: true,
          error: `Daraja OAuth failed (${tokenResp.status}): ${errText.slice(0, 160)}`,
        });
      }

      const tokenData = (await tokenResp.json()) as { access_token?: string };
      if (!tokenData.access_token) {
        return res.status(502).json({
          status: 'FAILED',
          configured: true,
          error: 'Daraja OAuth did not return an access token.',
        });
      }

      const now = new Date();
      const timestamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
      ].join('');

      const password = Buffer.from(
        `${daraja.shortcode}${daraja.passkey}${timestamp}`
      ).toString('base64');

      const stkPayload = {
        BusinessShortCode: daraja.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: formattedPhone,
        PartyB: daraja.shortcode,
        PhoneNumber: formattedPhone,
        CallBackURL: daraja.callbackUrl,
        AccountReference: String(accountReference || jobId).slice(0, 12),
        TransactionDesc: `FikaBoda Delivery ${String(accountReference || jobId).slice(0, 13)}`,
      };

      const stkResp = await fetch(`${daraja.baseUrl}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(stkPayload),
      });

      const stkJson = (await stkResp.json()) as {
        CheckoutRequestID?: string;
        MerchantRequestID?: string;
        ResponseCode?: string;
        CustomerMessage?: string;
        errorMessage?: string;
      };

      if (!stkResp.ok || stkJson.ResponseCode !== '0' || !stkJson.CheckoutRequestID) {
        return res.status(502).json({
          status: 'FAILED',
          configured: true,
          error: stkJson.errorMessage || 'Daraja STK Push request was rejected.',
        });
      }

      mpesaTransactions.set(stkJson.CheckoutRequestID, {
        paymentId,
        jobId,
        checkoutRequestId: stkJson.CheckoutRequestID,
        merchantRequestId: stkJson.MerchantRequestID || '',
        amount: Math.round(amount),
        phoneNumber: formattedPhone,
        status: 'PENDING_STK',
        callbackProcessed: false,
        updatedAt: new Date().toISOString(),
      });

      return res.json({
        status: 'PENDING_STK',
        configured: true,
        checkoutRequestId: stkJson.CheckoutRequestID,
        merchantRequestId: stkJson.MerchantRequestID,
        customerMessage: stkJson.CustomerMessage,
        message: 'STK Push sent to phone. Awaiting customer PIN confirmation via Safaricom callback.',
      });
    } catch (err) {
      return res.status(500).json({
        status: 'FAILED',
        configured: true,
        error: err instanceof Error ? err.message : 'Daraja network error',
      });
    }
  });

  // 4. Safaricom Daraja Callback Webhook (with Idempotency Guard)
  app.post('/api/mpesa/callback', rateLimit(120, 60_000), (req, res) => {
    const callbackToken = process.env.DARAJA_CALLBACK_SECRET;
    if (isConfiguredSecret(callbackToken) && req.headers['x-fikaboda-callback-token'] !== callbackToken) {
      return res.status(403).json({ ResultCode: 1, ResultDesc: 'Forbidden' });
    }

    const stkCallback = req.body?.Body?.stkCallback;
    if (!stkCallback || !stkCallback.CheckoutRequestID) {
      return res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback payload' });
    }

    const checkoutRequestId = String(stkCallback.CheckoutRequestID);
    const existing = mpesaTransactions.get(checkoutRequestId);

    // Duplicate callback protection
    if (existing?.callbackProcessed) {
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted (idempotent duplicate)' });
    }

    const resultCode = Number(stkCallback.ResultCode);
    const resultDesc = String(stkCallback.ResultDesc || '');
    const items: Array<{ Name: string; Value?: unknown }> =
      stkCallback.CallbackMetadata?.Item || [];
    const receipt = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value;

    const nextStatus = resultCode === 0 ? 'PAID' : resultCode === 1037 ? 'TIMEOUT' : 'FAILED';

    mpesaTransactions.set(checkoutRequestId, {
      paymentId: existing?.paymentId || '',
      jobId: existing?.jobId || '',
      checkoutRequestId,
      merchantRequestId: String(stkCallback.MerchantRequestID || existing?.merchantRequestId || ''),
      amount: existing?.amount || 0,
      phoneNumber: existing?.phoneNumber || '',
      status: nextStatus,
      mpesaReceiptNumber: receipt ? String(receipt) : undefined,
      resultDesc,
      callbackProcessed: true,
      updatedAt: new Date().toISOString(),
    });

    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  });

  app.get('/api/mpesa/status/:checkoutRequestId', requireAuth, (req, res) => {
    const record = mpesaTransactions.get(String(req.params.checkoutRequestId));
    if (!record) {
      return res.status(404).json({ error: 'CheckoutRequestID not found in session store.' });
    }
    return res.json(record);
  });

  // 5. WhatsApp & SMS Notification Interface (Honest Unconfigured State)
  app.post('/api/notifications/dispatch', rateLimit(30, 60_000), requireAuth, async (req, res) => {
    const { channel, phoneNumber, message } = req.body || {};
    if (!['WHATSAPP', 'SMS'].includes(channel) || !phoneNumber || !message) {
      return res.status(400).json({ error: 'Invalid notification dispatch payload.' });
    }
    const formattedPhone = normalizeKenyanPhone(String(phoneNumber));

    if (channel === 'WHATSAPP') {
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      if (!isConfiguredSecret(token) || !isConfiguredSecret(phoneId)) {
        return res.json({
          delivered: false,
          status: 'AWAITING_PROVIDER_CONFIG',
          message:
            'WhatsApp Business Cloud API credentials (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID) are not configured. No message was sent.',
        });
      }
      try {
        const resp = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: formattedPhone,
            type: 'text',
            text: { body: String(message).slice(0, 1000) },
          }),
        });
        if (!resp.ok) {
          const text = await resp.text();
          return res.status(502).json({ delivered: false, status: 'PROVIDER_ERROR', message: text });
        }
        return res.json({ delivered: true, status: 'SENT', message: 'WhatsApp notification sent.' });
      } catch (err) {
        return res.status(502).json({
          delivered: false,
          status: 'NETWORK_ERROR',
          message: err instanceof Error ? err.message : 'WhatsApp dispatch failed',
        });
      }
    }

    const atUser = process.env.AFRICASTALKING_USERNAME;
    const atKey = process.env.AFRICASTALKING_API_KEY;
    if (!isConfiguredSecret(atKey) || !atUser) {
      return res.json({
        delivered: false,
        status: 'AWAITING_PROVIDER_CONFIG',
        message:
          "Africa's Talking SMS credentials (AFRICASTALKING_USERNAME, AFRICASTALKING_API_KEY) are not configured. No SMS was sent.",
      });
    }
    try {
      const body = new URLSearchParams({
        username: atUser,
        to: `+${formattedPhone}`,
        message: String(message).slice(0, 480),
        ...(process.env.AFRICASTALKING_SENDER_ID ? { from: process.env.AFRICASTALKING_SENDER_ID } : {}),
      });
      const resp = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: {
          apiKey: atKey!,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });
      if (!resp.ok) {
        const text = await resp.text();
        return res.status(502).json({ delivered: false, status: 'PROVIDER_ERROR', message: text });
      }
      return res.json({ delivered: true, status: 'SENT', message: 'SMS dispatched.' });
    } catch (err) {
      return res.status(502).json({
        delivered: false,
        status: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'SMS dispatch failed',
      });
    }
  });

  // ==================================================
  // Vite Middleware (Dev) or Static Assets (Prod)
  // ==================================================
  const httpServer = http.createServer(app);

  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(__dirname, 'dist', 'index.html'));
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, ws: { server: httpServer } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`FikaBoda server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
