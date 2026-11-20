import React, { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

export const PWAUpdateBanner: React.FC = () => {
  const [updateReady, setUpdateReady] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const onNeedRefresh = () => setUpdateReady(true);
    window.addEventListener('fikaboda-sw-need-refresh', onNeedRefresh);
    return () => window.removeEventListener('fikaboda-sw-need-refresh', onNeedRefresh);
  }, []);

  if (!updateReady) return null;

  return (
    <div className="fixed bottom-16 lg:bottom-5 left-4 right-4 sm:left-auto sm:right-5 sm:w-80 z-50 bg-[#123C32] text-white rounded-xl p-3.5 shadow-lg border border-white/15 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-bold text-[#D5FF70]">Live Update Ready</p>
        <p className="text-[11px] text-white/80">
          A newer version of FikaBoda is available.
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          disabled={applying}
          onClick={() => {
            setApplying(true);
            window.dispatchEvent(new CustomEvent('fikaboda-sw-apply-update'));
            setTimeout(() => window.location.reload(), 400);
          }}
          className="px-3 py-1.5 rounded-lg bg-[#D5FF70] text-[#123C32] text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
        >
          <RefreshCw className={`w-3 h-3 ${applying ? 'animate-spin' : ''}`} />
          <span>Update</span>
        </button>
        <button
          type="button"
          onClick={() => setUpdateReady(false)}
          className="p-1 text-white/70 hover:text-white cursor-pointer"
          aria-label="Dismiss update notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
