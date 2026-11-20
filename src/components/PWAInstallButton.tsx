import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, Share, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const checkInstalled = () => {
      const standalone = window.matchMedia('(display-mode: standalone)').matches;
      const iosStandalone = (window.navigator as any).standalone === true;
      setIsInstalled(standalone || iosStandalone);
    };
    checkInstalled();

    const ua = window.navigator.userAgent;
    const isIOSDevice = /iPhone|iPad|iPod/i.test(ua);
    const isWebKitSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
    setIsIOS(isIOSDevice && isWebKitSafari);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptToInstall = async () => {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
    return outcome === 'accepted';
  };

  return {
    canInstall: !isInstalled && (installPrompt !== null || isIOS),
    hasNativePrompt: !isInstalled && installPrompt !== null,
    isIOS,
    isInstalled,
    promptToInstall,
  };
}

export const PWAInstallButton: React.FC<{
  compact?: boolean;
  showWhenInstalled?: boolean;
}> = ({ compact = false, showWhenInstalled = false }) => {
  const { canInstall, hasNativePrompt, isIOS, isInstalled, promptToInstall } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [showBrowserGuide, setShowBrowserGuide] = useState(false);

  if (isInstalled) {
    if (!showWhenInstalled) return null;
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>Installed as App</span>
      </span>
    );
  }

  if (!canInstall && !showWhenInstalled) return null;

  const handleClick = async () => {
    if (hasNativePrompt) {
      await promptToInstall();
    } else if (isIOS) {
      setShowIOSGuide(true);
    } else {
      setShowBrowserGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg bg-[#D5FF70] text-[#123C32] text-xs font-semibold hover:bg-[#c8f75a] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-3.5 h-3.5" />
        <span>{compact ? 'Install' : 'Install App'}</span>
      </button>

      {showIOSGuide && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white border border-[#E3E7E2] rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display font-bold text-base text-[#17231F]">
                  Install FikaBoda on iPhone / iPad
                </h3>
                <p className="text-xs text-[#77827B] mt-0.5">
                  Add FikaBoda to your Home Screen for full-screen courier & dispatch access.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="p-1.5 rounded-lg text-[#77827B] hover:text-[#17231F] cursor-pointer"
                aria-label="Close install instructions"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="space-y-2.5 text-xs text-[#17231F] bg-[#F7F8F5] border border-[#E3E7E2] rounded-xl p-4">
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-[#123C32] text-[#D5FF70] font-bold flex items-center justify-center shrink-0">
                  1
                </span>
                <span>
                  Tap the <Share className="w-3.5 h-3.5 inline text-[#123C32] mx-0.5" />{' '}
                  <strong>Share</strong> button in Safari&apos;s toolbar.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-[#123C32] text-[#D5FF70] font-bold flex items-center justify-center shrink-0">
                  2
                </span>
                <span>
                  Scroll down and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong>.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-[#123C32] text-[#D5FF70] font-bold flex items-center justify-center shrink-0">
                  3
                </span>
                <span>
                  Tap <strong>Add</strong> in the top corner to install the FikaBoda app.
                </span>
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-[#123C32] text-white text-xs font-semibold cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {showBrowserGuide && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white border border-[#E3E7E2] rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display font-bold text-base text-[#17231F]">
                Install FikaBoda App
              </h3>
              <button
                type="button"
                onClick={() => setShowBrowserGuide(false)}
                className="p-1.5 rounded-lg text-[#77827B] hover:text-[#17231F] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#77827B] leading-relaxed">
              Open your browser menu (⋮ or address bar install icon) and select{' '}
              <strong>&ldquo;Install app&rdquo;</strong> or{' '}
              <strong>&ldquo;Add to Home screen&rdquo;</strong>.
            </p>
            <button
              type="button"
              onClick={() => setShowBrowserGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-[#123C32] text-white text-xs font-semibold cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};
