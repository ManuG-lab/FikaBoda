import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getMessaging, isSupported as isMessagingSupported, getToken } from 'firebase/messaging';
import firebaseConfig from '../../firebase-applet-config.json';

function validEnv(val: string | undefined, fallback: string): string {
  const trimmed = (val || '').trim();
  if (!trimmed || trimmed.startsWith('your-') || trimmed.startsWith('MY_')) return fallback;
  return trimmed;
}

const resolvedConfig = {
  apiKey: validEnv(import.meta.env.VITE_FIREBASE_API_KEY, firebaseConfig.apiKey),
  authDomain: validEnv(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, firebaseConfig.authDomain),
  projectId: validEnv(import.meta.env.VITE_FIREBASE_PROJECT_ID, firebaseConfig.projectId),
  storageBucket: validEnv(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, firebaseConfig.storageBucket),
  messagingSenderId: validEnv(
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    firebaseConfig.messagingSenderId
  ),
  appId: validEnv(import.meta.env.VITE_FIREBASE_APP_ID, firebaseConfig.appId),
};

export const app = getApps().length ? getApp() : initializeApp(resolvedConfig);

export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export const auth = getAuth(app);
export const storage = getStorage(app);
storage.maxUploadRetryTime = 8000;
storage.maxOperationRetryTime = 8000;

export const FIREBASE_PROJECT_ID = resolvedConfig.projectId;

let appCheckInitialized = false;
export function initAppCheckIfConfigured(): boolean {
  if (appCheckInitialized) return true;
  const siteKey =
    import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY || firebaseConfig.recaptchaSiteKey;
  if (!siteKey) return false;
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckInitialized = true;
    return true;
  } catch (err) {
    console.warn('Firebase App Check initialization skipped:', err);
    return false;
  }
}

export async function requestFcmTokenIfConfigured(): Promise<{
  token: string | null;
  status: 'ENABLED' | 'AWAITING_VAPID_KEY' | 'UNSUPPORTED' | 'PERMISSION_DENIED';
}> {
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    return { token: null, status: 'AWAITING_VAPID_KEY' };
  }
  const supported = await isMessagingSupported().catch(() => false);
  if (!supported || typeof Notification === 'undefined') {
    return { token: null, status: 'UNSUPPORTED' };
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { token: null, status: 'PERMISSION_DENIED' };
  }
  try {
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey });
    return { token: token || null, status: 'ENABLED' };
  } catch (err) {
    console.warn('FCM token request failed:', err);
    return { token: null, status: 'UNSUPPORTED' };
  }
}

export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();
