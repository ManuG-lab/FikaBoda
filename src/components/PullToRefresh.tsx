import React, { useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  className?: string;
}

const TRIGGER_PX = 64;
const MAX_PULL_PX = 96;

export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  onRefresh,
  children,
  className = '',
}) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullingRef = useRef(false);

  const isAtScrollTop = (target: EventTarget | null): boolean => {
    if (typeof window !== 'undefined' && window.scrollY > 2) {
      return false;
    }
    let el = target as HTMLElement | null;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 2 && el.scrollTop > 2) {
        return false;
      }
      el = el.parentElement;
    }
    return true;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (refreshing || e.touches.length !== 1) return;
    if (!isAtScrollTop(e.target)) {
      startYRef.current = null;
      return;
    }
    startYRef.current = e.touches[0].clientY;
    pullingRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (refreshing || startYRef.current === null || e.touches.length !== 1) return;
    const delta = e.touches[0].clientY - startYRef.current;
    if (delta <= 0) {
      if (pullingRef.current) {
        setPullDistance(0);
      }
      return;
    }
    if (!isAtScrollTop(e.target) && !pullingRef.current) {
      startYRef.current = null;
      return;
    }
    pullingRef.current = true;
    // Rubber-band damping for native mobile feel
    const damped = Math.min(MAX_PULL_PX, Math.round(delta * 0.52));
    setPullDistance(damped);
  };

  const handleTouchEnd = async () => {
    if (startYRef.current === null) return;
    startYRef.current = null;
    const shouldTrigger = pullDistance >= TRIGGER_PX;
    pullingRef.current = false;

    if (!shouldTrigger) {
      setPullDistance(0);
      return;
    }

    setRefreshing(true);
    setPullDistance(52);
    try {
      window.dispatchEvent(new CustomEvent('fikaboda-sw-check-update'));
      await onRefresh();
      setJustSynced(true);
      setTimeout(() => setJustSynced(false), 1200);
    } finally {
      setRefreshing(false);
      setPullDistance(0);
    }
  };

  const active = pullDistance > 6 || refreshing || justSynced;
  const readyToRelease = pullDistance >= TRIGGER_PX;

  return (
    <div
      className={`relative ${className}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={() => void handleTouchEnd()}
      onTouchCancel={() => {
        startYRef.current = null;
        pullingRef.current = false;
        setPullDistance(0);
      }}
    >
      <div
        className="overflow-hidden transition-[height,opacity] duration-200 flex items-center justify-center bg-[#F7F8F5]"
        style={{
          height: refreshing ? 46 : pullDistance > 0 ? pullDistance : justSynced ? 34 : 0,
          opacity: active ? 1 : 0,
        }}
        aria-live="polite"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-[#E3E7E2] shadow-xs text-[11px] font-semibold text-[#123C32]">
          <RefreshCw
            className={`w-3.5 h-3.5 transition-transform ${
              refreshing
                ? 'animate-spin'
                : readyToRelease
                  ? 'rotate-180 text-[#123C32]'
                  : 'text-[#77827B]'
            }`}
          />
          <span>
            {refreshing
              ? 'Syncing live updates...'
              : justSynced
                ? 'Live data updated'
                : readyToRelease
                  ? 'Release to refresh'
                  : 'Pull down to refresh'}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
};
