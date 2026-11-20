# FikaBoda — Hyperlocal Boda Boda Delivery Platform (Nairobi)

**Your Shop. Our Riders. Fika!** · *Local Delivery. Tunadeliver.*

FikaBoda is a production-oriented B2B2C hyperlocal delivery dispatch, fleet tracking, and payment management web application & PWA built for independent shops and verified boda boda riders starting in **Westlands, Nairobi**.

---

## Architecture Overview

- **Frontend / PWA**: React 19, TypeScript, Tailwind CSS v4, `@vis.gl/react-google-maps`, `vite-plugin-pwa`, `jsPDF`
- **Firebase Project**: `fika-boda` (`firebase-applet-config.json`)
  - **Authentication**: Google Sign-In (`signInWithPopup`), Email/Password, email verification enforcement, password reset
  - **Cloud Firestore**: Database `ai-studio-d9b327f4-3a53-402a-a6d3-8e8eab87448d` with Eight-Pillars `firestore.rules`
  - **Firebase Storage**: Private verification documents (`rider-docs/{uid}/...`) and pickup parcel photos (`delivery-evidence/{jobId}/...`)
  - **Firebase Cloud Functions v2 (`/functions`)**: Daraja M-Pesa webhook, authoritative pricing, role assignment, and notification triggers (requires Blaze plan)
- **Backend Proxy (`server.ts`)**: Express + Vite middleware on port 3000 with sliding-window rate limiting, cryptographic Firebase ID token verification, Safaricom Daraja STK Push / callback idempotency, WhatsApp Cloud API, and Africa's Talking SMS dispatch.

---

## User Portals & Roles

1. **Public Customer Tracking (`/track/:token`)**: No login required. Resolves SHA-256 hashed non-enumerable `trackingLinks/{tokenHash}` documents with real-time map route, rider contact, and delivery timeline.
2. **Merchant Portal**: Shop onboarding, pending approval gate, route/distance quoting, Westlands zone verification, M-Pesa STK Push initiation, one-time Pickup & Delivery PIN generation, active dispatch tracking, and downloadable PDF statements.
3. **Rider Portal (Mobile-First Courier Console)**: Onboarding with private document uploads, Online/Offline availability toggle, foreground browser GPS sync, atomic single-rider job claim, PIN-verified Pickup & Delivery progression, and earnings settlements.
4. **Admin / Dispatch Console (`SUPER_ADMIN`, `ADMIN`, `DISPATCHER`)**: Live fleet map (`DispatchFleetMap`), manual rider assignment/reassignment, merchant & rider verification approval, payment reconciliation, rider settlement payouts, distance pricing tiers, service zone boundaries, audit logs, and live integration readiness monitor.

---

## Setup & Configuration Checklist

### 1. Environment Variables
Copy `.env.example` to `.env` and populate secrets as you activate external providers:
- `VITE_GOOGLE_MAPS_API_KEY`: Browser HTTP-referrer restricted Google Maps key (Maps JS API, Places API New, Routes API).
- `DARAJA_ENV`, `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_SHORTCODE`, `DARAJA_PASSKEY`, `DARAJA_CALLBACK_URL`: Safaricom Daraja M-Pesa credentials (never simulated when absent).
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`: Meta WhatsApp Cloud API.
- `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY`: Africa's Talking SMS gateway.
- `VITE_FIREBASE_VAPID_KEY` & `VITE_FIREBASE_APPCHECK_SITE_KEY`: Optional FCM Web Push & reCAPTCHA v3 App Check.

### 2. Firebase Authentication Setup (`fika-boda`)
In Firebase Console -> **Authentication -> Sign-in method** for project `fika-boda`:
- Verify **Google** is enabled.
- Enable **Email/Password** if you want merchants and riders to register with email/password.
- Confirm your deployment domains are listed under **Authorized domains**.

### 3. Bootstrapping First Super Admin
The initial Super Admin account is bootstrapped in `firestore.rules` and `src/services/firestoreService.ts` for verified sign-in as `gmannu2055@gmail.com`. Once signed in:
1. Open the Admin Console -> **Overview** and click **Seed Westlands Defaults** to populate the Westlands zone and default KES pricing tiers.
2. Open **Settings** to assign `ADMIN` or `DISPATCHER` roles to additional team members.

### 4. Security Rules Verification
Lint security rules locally:
```bash
npx eslint firestore.rules
```
> **Important**: Please review `firestore.rules` and `storage.rules`, and test edge-case permissions against the Firebase Emulator Suite before broad production rollout.

### 5. Cloud Functions Deployment (Blaze Plan)
```bash
cd functions && npm install && npm run build
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```
