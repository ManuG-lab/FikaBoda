import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  ArrowRight,
  Bike,
  CheckCircle2,
  KeyRound,
  LogOut,
  MailCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
} from 'lucide-react';
import { auth } from '../firebase/config';
import { ensureUserProfile, setPendingAuthSeed } from '../services/firestoreService';
import { isValidKenyanPhone, formatKenyanPhone } from '../utils/crypto';
import { FikaBodaLogo } from '../components/FikaBodaLogo';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { PullToRefresh } from '../components/PullToRefresh';
import { useToast } from '../components/ToastProvider';

interface AuthPortalProps {
  onNavigateTrack: (token: string) => void;
  onPreferredRoleChosen: (role: 'MERCHANT' | 'RIDER') => void;
}

export const AuthPortal: React.FC<AuthPortalProps> = ({
  onNavigateTrack,
  onPreferredRoleChosen,
}) => {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [accountType, setAccountType] = useState<'MERCHANT' | 'RIDER'>('MERCHANT');
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [trackInput, setTrackInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const { pushToast } = useToast();

  const handleTrackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = trackInput.trim();
    if (!cleaned) return;
    // Allow pasting full URL or raw token
    const tokenPart = cleaned.includes('/track/')
      ? cleaned.split('/track/').pop()?.split(/[?#]/)[0] || ''
      : cleaned;
    if (tokenPart) onNavigateTrack(tokenPart);
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    if (mode === 'reset') {
      if (!email.trim()) {
        setErrorMsg('Enter your account email to receive a password reset link.');
        return;
      }
      setBusy(true);
      try {
        await sendPasswordResetEmail(auth, email.trim());
        setInfoMsg('Password reset link sent. Check your email inbox.');
      } catch (err: any) {
        setErrorMsg(err?.message || 'Could not send password reset email.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === 'signup') {
      if (fullName.trim().length < 2) {
        setErrorMsg('Enter your full name or business contact name.');
        return;
      }
      if (!isValidKenyanPhone(phoneNumber)) {
        setErrorMsg('Enter a valid Kenyan phone number (e.g. 0712345678 or 254712345678).');
        return;
      }
      if (password.length < 6) {
        setErrorMsg('Password must be at least 6 characters.');
        return;
      }
    }

    setBusy(true);
    try {
      onPreferredRoleChosen(accountType);
      if (mode === 'signup') {
        const formattedPhone = formatKenyanPhone(phoneNumber);
        setPendingAuthSeed({
          role: accountType,
          fullName: fullName.trim(),
          phoneNumber: formattedPhone,
        });
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(cred.user, { displayName: fullName.trim() });
        await ensureUserProfile(
          cred.user,
          accountType,
          fullName.trim(),
          formattedPhone
        );
        await sendEmailVerification(cred.user).catch(() => {});
        pushToast({
          kind: 'success',
          title: 'Account created',
          description: 'Verify your email address to submit your onboarding profile.',
        });
      } else {
        setPendingAuthSeed({ role: accountType });
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        await ensureUserProfile(cred.user, accountType);
      }
    } catch (err: any) {
      setPendingAuthSeed(null);
      const code = err?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setErrorMsg(
          'Email/Password sign-in is not yet enabled in Firebase Console -> Authentication -> Sign-in method. Use Google Sign-In or enable Email/Password.'
        );
      } else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        setErrorMsg('Incorrect email or password.');
      } else if (code === 'auth/email-already-in-use') {
        setErrorMsg('An account already exists with this email. Switch to Sign In.');
      } else {
        setErrorMsg(err?.message || 'Authentication failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleAuth = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      onPreferredRoleChosen(accountType);
      setPendingAuthSeed({ role: accountType });
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(auth, provider);
      await ensureUserProfile(cred.user, accountType);
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') {
        setErrorMsg('Google sign-in popup was closed before completion.');
      } else if (err?.code === 'auth/operation-not-allowed') {
        setErrorMsg('Google Sign-In is not enabled in Firebase Authentication Console.');
      } else {
        setErrorMsg(err?.message || 'Google Sign-In failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async () => {
    try {
      await fetch('/api/config/status');
    } catch {
      // ignore offline refresh probe
    }
  };

  return (
    <PullToRefresh onRefresh={handleRefresh} className="min-h-screen bg-[#F7F8F5] flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-[#E3E7E2] bg-white/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2 sm:gap-4">
          <FikaBodaLogo showTagline />
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span className="hidden md:inline text-xs text-[#77827B]">
              Westlands, Nairobi · Local Delivery. Tunadeliver.
            </span>
            <PWAInstallButton compact />
          </div>
        </div>
      </header>

      {/* Main Split Editorial Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Brand Operations Story + Public Tracking Lookup */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-[#123C32] text-white rounded-2xl overflow-hidden border border-[#0D2E26]">
            <div className="grid grid-cols-1 md:grid-cols-12">
              <div className="md:col-span-7 p-6 sm:p-8 flex flex-col justify-between space-y-6">
                <div className="space-y-3">
                  <p className="text-xs font-mono uppercase tracking-widest text-[#D5FF70]">
                    Westlands Dispatch Network
                  </p>
                  <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight">
                    Your Shop. Our Riders. Fika!
                  </h1>
                  <p className="text-sm text-white/80 leading-relaxed">
                    Hyperlocal boda boda delivery infrastructure built for independent Nairobi merchants, verified riders, and real-time customer transparency.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/15 text-xs">
                  <div>
                    <p className="text-[#D5FF70] font-mono-tabular font-semibold text-base">PIN</p>
                    <p className="text-white/75 mt-0.5">Pickup & dropoff handoff verification</p>
                  </div>
                  <div>
                    <p className="text-[#D5FF70] font-mono-tabular font-semibold text-base">80 / 20</p>
                    <p className="text-white/75 mt-0.5">Transparent rider & platform split</p>
                  </div>
                  <div>
                    <p className="text-[#D5FF70] font-mono-tabular font-semibold text-base">LIVE</p>
                    <p className="text-white/75 mt-0.5">Non-enumerable customer map links</p>
                  </div>
                </div>
              </div>

              <div className="md:col-span-5 min-h-[220px] bg-[#0D2E26] relative">
                <img
                  src="/src/assets/images/unbranded_nairobi_rider_1795092111563.jpg"
                  alt="FikaBoda rider in Westlands, Nairobi"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            </div>
          </div>

          {/* Public Customer Tracking Lookup */}
          <div className="bg-white border border-[#E3E7E2] rounded-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h2 className="font-display text-base font-semibold text-[#17231F]">
                  Track a FikaBoda Parcel
                </h2>
                <p className="text-xs text-[#77827B] mt-0.5">
                  Customers can paste their tracking token or link directly — no login required.
                </p>
              </div>
              <Search className="w-4 h-4 text-[#123C32] shrink-0 mt-1" />
            </div>
            <form onSubmit={handleTrackSubmit} className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={trackInput}
                onChange={(e) => setTrackInput(e.target.value)}
                placeholder="Paste tracking token or https://.../track/..."
                className="flex-1 px-3.5 py-2.5 text-sm bg-[#F7F8F5] border border-[#E3E7E2] rounded-lg focus:outline-none focus:border-[#123C32] font-mono"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#123C32] text-white text-sm font-medium hover:bg-[#0D2E26] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Track Parcel</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>

          {/* Role Architecture Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
              <Store className="w-4 h-4 text-[#123C32] mb-2" />
              <p className="text-sm font-semibold text-[#17231F]">Merchants</p>
              <p className="text-xs text-[#77827B] mt-1 leading-relaxed">
                Quote routes, initiate M-Pesa STK Push, print PDF statements, and share tracking links.
              </p>
            </div>
            <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
              <Bike className="w-4 h-4 text-[#123C32] mb-2" />
              <p className="text-sm font-semibold text-[#17231F]">Verified Riders</p>
              <p className="text-xs text-[#77827B] mt-1 leading-relaxed">
                Upload licence & insurance docs, claim jobs atomically, verify handoff PINs, track earnings.
              </p>
            </div>
            <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
              <ShieldCheck className="w-4 h-4 text-[#123C32] mb-2" />
              <p className="text-sm font-semibold text-[#17231F]">Dispatch Ops</p>
              <p className="text-xs text-[#77827B] mt-1 leading-relaxed">
                Approve shops & riders, monitor fleet GPS, assign jobs, and reconcile payouts.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Auth Card */}
        <div className="lg:col-span-5 bg-white border border-[#E3E7E2] rounded-2xl p-6 sm:p-8 space-y-5">
          {/* Mode Tabs */}
          <div className="flex border-b border-[#E3E7E2] gap-6">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              className={`pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                mode === 'signin'
                  ? 'border-[#123C32] text-[#123C32]'
                  : 'border-transparent text-[#77827B] hover:text-[#17231F]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              className={`pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                mode === 'signup'
                  ? 'border-[#123C32] text-[#123C32]'
                  : 'border-transparent text-[#77827B] hover:text-[#17231F]'
              }`}
            >
              Create Account
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('reset');
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              className={`pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                mode === 'reset'
                  ? 'border-[#123C32] text-[#123C32]'
                  : 'border-transparent text-[#77827B] hover:text-[#17231F]'
              }`}
            >
              Reset Password
            </button>
          </div>

          {/* Account Type Selector (Only Merchant / Rider — Admin is server-provisioned) */}
          {mode !== 'reset' && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-[#17231F]">
                {mode === 'signup' ? 'Register as' : 'New account default role (if first sign-in)'}
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setAccountType('MERCHANT')}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                    accountType === 'MERCHANT'
                      ? 'bg-[#123C32] text-white border-[#123C32]'
                      : 'bg-[#F7F8F5] text-[#17231F] border-[#E3E7E2] hover:border-[#123C32]'
                  }`}
                >
                  <Store className="w-4 h-4" />
                  <span>Shop / Merchant</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAccountType('RIDER')}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                    accountType === 'RIDER'
                      ? 'bg-[#123C32] text-white border-[#123C32]'
                      : 'bg-[#F7F8F5] text-[#17231F] border-[#E3E7E2] hover:border-[#123C32]'
                  }`}
                >
                  <Bike className="w-4 h-4" />
                  <span>Boda Rider</span>
                </button>
              </div>
              <p className="text-[11px] text-[#77827B]">
                Merchant & rider accounts require administrator verification before dispatching.
              </p>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 leading-relaxed">
              {errorMsg}
            </div>
          )}

          {infoMsg && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 leading-relaxed">
              {infoMsg}
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-3.5">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-[#17231F] mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={accountType === 'MERCHANT' ? 'Amina Wanjiku' : 'Brian Kiprop'}
                    className="w-full px-3.5 py-2.5 text-sm border border-[#E3E7E2] rounded-lg focus:outline-none focus:border-[#123C32]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#17231F] mb-1">
                    Kenyan Mobile Number (M-Pesa / Contact)
                  </label>
                  <input
                    type="tel"
                    required
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="0712 345 678"
                    className="w-full px-3.5 py-2.5 text-sm border border-[#E3E7E2] rounded-lg focus:outline-none focus:border-[#123C32] font-mono"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#17231F] mb-1">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@shop.co.ke"
                className="w-full px-3.5 py-2.5 text-sm border border-[#E3E7E2] rounded-lg focus:outline-none focus:border-[#123C32]"
              />
            </div>

            {mode !== 'reset' && (
              <div>
                <label className="block text-xs font-semibold text-[#17231F] mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 text-sm border border-[#E3E7E2] rounded-lg focus:outline-none focus:border-[#123C32]"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 px-4 rounded-lg bg-[#123C32] text-white text-sm font-semibold hover:bg-[#0D2E26] disabled:opacity-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              {mode === 'signin' && (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>{busy ? 'Signing in...' : 'Sign In'}</span>
                </>
              )}
              {mode === 'signup' && (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{busy ? 'Creating account...' : `Register as ${accountType === 'MERCHANT' ? 'Merchant' : 'Rider'}`}</span>
                </>
              )}
              {mode === 'reset' && <span>{busy ? 'Sending...' : 'Send Password Reset Email'}</span>}
            </button>
          </form>

          {mode !== 'reset' && (
            <>
              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-[#E3E7E2]" />
                <span className="shrink mx-3 text-[11px] uppercase tracking-wider text-[#77827B]">
                  or continue with
                </span>
                <div className="flex-grow border-t border-[#E3E7E2]" />
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleGoogleAuth()}
                className="w-full py-2.5 px-4 rounded-lg bg-white border border-[#E3E7E2] hover:border-[#123C32] text-sm font-medium text-[#17231F] transition-colors flex items-center justify-center gap-2.5 cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>
            </>
          )}
        </div>
      </main>
    </PullToRefresh>
  );
};

export const EmailVerificationGate: React.FC<{
  user: User;
  onVerified: () => void;
}> = ({ user, onVerified }) => {
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const { pushToast } = useToast();

  const handleResend = async () => {
    setSending(true);
    try {
      await sendEmailVerification(user);
      pushToast({
        kind: 'success',
        title: 'Verification email sent',
        description: `Check ${user.email} (including spam) and click the verification link.`,
      });
    } catch (err: any) {
      pushToast({
        kind: 'error',
        title: 'Unable to send verification email',
        description: err?.message || 'Try again in a minute.',
      });
    } finally {
      setSending(false);
    }
  };

  const handleReload = async () => {
    setChecking(true);
    try {
      await user.reload();
      await user.getIdToken(true);
      if (auth.currentUser?.emailVerified) {
        onVerified();
      } else {
        pushToast({
          kind: 'info',
          title: 'Email not verified yet',
          description: 'Click the link in your inbox first, then reload.',
        });
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F8F5] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-[#E3E7E2] rounded-2xl p-6 space-y-5">
        <FikaBodaLogo />
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#D5FF70]/40 text-[#123C32] flex items-center justify-center shrink-0">
            <MailCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display font-bold text-lg text-[#17231F]">
              Verify Your Email Address
            </h2>
            <p className="text-xs text-[#77827B] mt-1 leading-relaxed">
              FikaBoda security rules require a verified email before submitting shop/rider onboarding or dispatching parcels. Signed in as{' '}
              <span className="font-medium text-[#17231F]">{user.email}</span>.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            disabled={checking}
            onClick={() => void handleReload()}
            className="w-full py-2.5 px-4 rounded-lg bg-[#123C32] text-white text-sm font-semibold hover:bg-[#0D2E26] flex items-center justify-center gap-2 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            <span>I&apos;ve Verified — Continue</span>
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={() => void handleResend()}
            className="w-full py-2.5 px-4 rounded-lg border border-[#E3E7E2] text-[#17231F] text-sm font-medium hover:bg-[#F7F8F5] cursor-pointer"
          >
            {sending ? 'Sending...' : 'Resend Verification Email'}
          </button>
          <button
            type="button"
            onClick={() => void signOut(auth)}
            className="w-full py-2 text-xs text-[#77827B] hover:text-[#17231F] inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </div>
  );
};
