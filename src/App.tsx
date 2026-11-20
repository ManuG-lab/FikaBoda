import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { APIProvider } from '@vis.gl/react-google-maps';
import { ShieldAlert, LogOut } from 'lucide-react';
import { auth } from './firebase/config';
import type { UserProfile } from './types/fikaboda';
import { ensureUserProfile, subscribeToUserProfile } from './services/firestoreService';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ToastProvider';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAUpdateBanner } from './components/PWAUpdateBanner';
import { AuthPortal, EmailVerificationGate } from './pages/AuthPortal';
import { CustomerTrackingPage } from './pages/CustomerTrackingPage';
import { MerchantPortal } from './portals/MerchantPortal';
import { RiderPortal } from './portals/RiderPortal';
import { AdminPortal } from './portals/AdminPortal';

const GOOGLE_MAPS_API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
const HAS_MAPS_KEY =
  Boolean(GOOGLE_MAPS_API_KEY) &&
  !GOOGLE_MAPS_API_KEY.startsWith('your-') &&
  !GOOGLE_MAPS_API_KEY.startsWith('MY_');

function parsePath(pathname: string): { route: 'root' | 'track' | 'portal'; token: string } {
  if (pathname === '/track' || pathname === '/track/') {
    return { route: 'track', token: '' };
  }
  if (pathname.startsWith('/track/')) {
    const token = decodeURIComponent(pathname.slice('/track/'.length).split('/')[0] || '');
    return { route: 'track', token };
  }
  if (
    pathname.startsWith('/merchant') ||
    pathname.startsWith('/rider') ||
    pathname.startsWith('/admin')
  ) {
    return { route: 'portal', token: '' };
  }
  return { route: 'root', token: '' };
}

const FikaBodaAppContent: React.FC = () => {
  const [pathname, setPathname] = useState<string>(
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [preferredRole, setPreferredRole] = useState<'MERCHANT' | 'RIDER'>('MERCHANT');
  const preferredRoleRef = useRef<'MERCHANT' | 'RIDER'>('MERCHANT');
  preferredRoleRef.current = preferredRole;
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [, setVerifiedTick] = useState(0);

  // Listen for Google Maps Demo Key quota exceeded events
  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  // Listen for browser back/forward navigation & live PWA visibility sync
  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        window.dispatchEvent(new CustomEvent('fikaboda-sw-check-update'));
      }
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const navigate = (nextPath: string) => {
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
      setPathname(nextPath);
    }
  };

  // Firebase Auth & Firestore User Profile Sync
  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      setFirebaseUser(user);
      if (!user) {
        setProfile(null);
        setAuthReady(true);
        return;
      }

      try {
        await ensureUserProfile(user, preferredRoleRef.current);
      } catch (err) {
        console.error('Failed ensuring user profile:', err);
      }

      unsubProfile = subscribeToUserProfile(user.uid, (p) => {
        setProfile(p);
        setAuthReady(true);
      });
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const parsed = parsePath(pathname);

  const renderMainView = () => {
    // Public Customer Tracking Route (No Auth Required)
    if (parsed.route === 'track') {
      return (
        <CustomerTrackingPage
          token={parsed.token}
          hasMapsKey={HAS_MAPS_KEY}
          onNavigateToken={(t) => navigate(`/track/${encodeURIComponent(t)}`)}
          onBackHome={() => navigate('/')}
        />
      );
    }

    if (!authReady) {
      return (
        <div className="min-h-screen bg-[#F7F8F5] flex items-center justify-center text-sm text-[#77827B]">
          Initializing FikaBoda...
        </div>
      );
    }

    if (!firebaseUser) {
      return (
        <AuthPortal
          onNavigateTrack={(t) => navigate(`/track/${encodeURIComponent(t)}`)}
          onPreferredRoleChosen={setPreferredRole}
        />
      );
    }

    if (!firebaseUser.emailVerified) {
      return (
        <EmailVerificationGate
          user={firebaseUser}
          onVerified={() => setVerifiedTick((v) => v + 1)}
        />
      );
    }

    if (!profile) {
      return (
        <div className="min-h-screen bg-[#F7F8F5] flex items-center justify-center text-sm text-[#77827B]">
          Loading FikaBoda profile...
        </div>
      );
    }

    if (profile.accountStatus === 'SUSPENDED' || profile.accountStatus === 'REJECTED') {
      return (
        <div className="min-h-screen bg-[#F7F8F5] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#E3E7E2] rounded-2xl p-6 space-y-4">
            <div className="w-10 h-10 rounded-xl bg-red-50 text-red-700 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <h1 className="font-display text-lg font-bold text-[#17231F]">
              Account {profile.accountStatus}
            </h1>
            <p className="text-xs text-[#77827B] leading-relaxed">
              Your FikaBoda account ({profile.email}) has been {profile.accountStatus.toLowerCase()} by an administrator. Contact support to resolve this status.
            </p>
            <button
              type="button"
              onClick={() => void signOut(auth)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E3E7E2] text-xs font-semibold cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      );
    }

    if (
      profile.role === 'SUPER_ADMIN' ||
      profile.role === 'ADMIN' ||
      profile.role === 'DISPATCHER'
    ) {
      return <AdminPortal profile={profile} hasMapsKey={HAS_MAPS_KEY} />;
    }

    if (profile.role === 'RIDER') {
      return <RiderPortal profile={profile} hasMapsKey={HAS_MAPS_KEY} />;
    }

    return (
      <MerchantPortal
        profile={profile}
        hasMapsKey={HAS_MAPS_KEY}
        onNavigateTrack={(t) => navigate(`/track/${encodeURIComponent(t)}`)}
      />
    );
  };

  return (
    <>
      <OfflineIndicator />
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}
      {renderMainView()}
      <PWAUpdateBanner />
    </>
  );
};

export default function App() {
  const inner = (
    <ErrorBoundary>
      <ToastProvider>
        <FikaBodaAppContent />
      </ToastProvider>
    </ErrorBoundary>
  );

  if (!HAS_MAPS_KEY) {
    return inner;
  }

  return (
    <APIProvider
      apiKey={GOOGLE_MAPS_API_KEY}
      region="KE"
      language="en"
      libraries={['places', 'routes', 'marker']}
    >
      {inner}
    </APIProvider>
  );
}
