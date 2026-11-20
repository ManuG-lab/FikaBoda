import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="bg-amber-950 text-amber-100 px-4 py-2 text-xs font-medium flex items-center justify-center gap-2 sticky top-0 z-50">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Offline mode — cached screens remain available; live dispatch sync resumes on reconnect.</span>
    </div>
  );
};
