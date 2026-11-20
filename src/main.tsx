import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import { initAppCheckIfConfigured } from './firebase/config';

// Tier 1 Google Maps Platform Demo Key Quota & Auth Failure Handlers
(window as any).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  origConsoleError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
};

// Register PWA Service Worker with live update polling
let swRegistrationRef: ServiceWorkerRegistration | undefined;
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent('fikaboda-sw-need-refresh'));
  },
  onRegisteredSW(_swUrl, registration) {
    swRegistrationRef = registration;
    if (registration) {
      setInterval(() => {
        void registration.update().catch(() => {});
      }, 60 * 1000);
    }
  },
});

window.addEventListener('fikaboda-sw-check-update', () => {
  void swRegistrationRef?.update().catch(() => {});
});
window.addEventListener('fikaboda-sw-apply-update', () => {
  void updateSW(true);
});

initAppCheckIfConfigured();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
