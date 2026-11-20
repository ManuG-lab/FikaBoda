import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bike,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  Search,
} from 'lucide-react';
import type { TrackingLink } from '../types/fikaboda';
import { subscribeToTrackingLink } from '../services/firestoreService';
import { formatTimestamp, sha256Hex, toDateSafe } from '../utils/crypto';
import { DELIVERY_STATUS_FLOW, getDeliveryStatusLabel } from '../utils/statusMachine';
import { FikaBodaLogo } from '../components/FikaBodaLogo';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { PullToRefresh } from '../components/PullToRefresh';
import { DeliveryStatusText } from '../components/StatusBadge';
import { DeliveryRouteMap } from '../components/Maps/DeliveryRouteMap';

interface CustomerTrackingPageProps {
  token: string;
  hasMapsKey: boolean;
  onNavigateToken: (token: string) => void;
  onBackHome: () => void;
}

export const CustomerTrackingPage: React.FC<CustomerTrackingPageProps> = ({
  token,
  hasMapsKey,
  onNavigateToken,
  onBackHome,
}) => {
  const [lookupInput, setLookupInput] = useState(token);
  const [link, setLink] = useState<TrackingLink | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [errorState, setErrorState] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    setLookupInput(token);
    if (!token) {
      setLink(null);
      setLoading(false);
      setErrorState(null);
      return;
    }

    let unsub: (() => void) | null = null;
    let active = true;
    setLoading(true);
    setErrorState(null);

    sha256Hex(token.trim()).then((hash) => {
      if (!active) return;
      unsub = subscribeToTrackingLink(
        hash,
        (data) => {
          setLoading(false);
          if (!data) {
            setLink(null);
            setErrorState('Tracking link not found, expired, or revoked.');
            return;
          }
          const exp = toDateSafe(data.expiresAt);
          if (!data.active || (exp && exp.getTime() < Date.now())) {
            setLink(null);
            setErrorState('This tracking link is no longer active or has expired.');
            return;
          }
          setLink(data);
        },
        () => {
          setLoading(false);
          setLink(null);
          setErrorState('Tracking link is invalid, expired, or revoked.');
        }
      );
    });

    return () => {
      active = false;
      if (unsub) unsub();
    };
  }, [token, refreshTick]);

  const handleRefresh = async () => {
    setRefreshTick((t) => t + 1);
  };

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = lookupInput.trim();
    if (!cleaned) return;
    const extracted = cleaned.includes('/track/')
      ? cleaned.split('/track/').pop()?.split(/[?#]/)[0] || ''
      : cleaned;
    if (extracted) onNavigateToken(extracted);
  };

  const currentIdx = link ? DELIVERY_STATUS_FLOW.indexOf(link.deliveryStatus) : -1;

  return (
    <div className="min-h-screen bg-[#F7F8F5] flex flex-col">
      <header className="bg-white border-b border-[#E3E7E2] sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <FikaBodaLogo />
          <div className="flex items-center gap-2.5">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={onBackHome}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#123C32] hover:underline cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Portal</span>
            </button>
          </div>
        </div>
      </header>

      <PullToRefresh onRefresh={handleRefresh} className="flex-1 flex flex-col">
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        <form
          onSubmit={handleLookup}
          className="bg-white border border-[#E3E7E2] rounded-xl p-4 flex flex-col sm:flex-row gap-2.5"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#77827B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={lookupInput}
              onChange={(e) => setLookupInput(e.target.value)}
              placeholder="Enter FikaBoda tracking token..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-[#F7F8F5] border border-[#E3E7E2] rounded-lg focus:outline-none focus:border-[#123C32] font-mono"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-[#123C32] text-white text-sm font-semibold hover:bg-[#0D2E26] whitespace-nowrap cursor-pointer"
          >
            Check Status
          </button>
        </form>

        {loading && (
          <div className="bg-white border border-[#E3E7E2] rounded-xl p-8 text-center text-sm text-[#77827B]">
            Loading live delivery status...
          </div>
        )}

        {!loading && errorState && (
          <div className="bg-white border border-[#E3E7E2] rounded-xl p-8 text-center space-y-3">
            <div className="w-11 h-11 rounded-full bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h2 className="font-display font-semibold text-base text-[#17231F]">
              Tracking Unavailable
            </h2>
            <p className="text-xs text-[#77827B] max-w-md mx-auto">{errorState}</p>
          </div>
        )}

        {!loading && !errorState && !link && (
          <div className="bg-white border border-[#E3E7E2] rounded-xl p-8 text-center space-y-2">
            <MapPin className="w-6 h-6 text-[#123C32] mx-auto" />
            <h2 className="font-display font-semibold text-base text-[#17231F]">
              Enter Your Tracking Token
            </h2>
            <p className="text-xs text-[#77827B] max-w-md mx-auto">
              Your merchant shares a secure tracking link after dispatching a FikaBoda rider. Paste the token above to view live progress.
            </p>
          </div>
        )}

        {!loading && link && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white border border-[#E3E7E2] rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-mono-tabular text-[#77827B]">{link.referenceCode}</p>
                    <h1 className="font-display text-lg font-bold text-[#17231F] mt-0.5">
                      {link.shopName}
                    </h1>
                  </div>
                  <DeliveryStatusText status={link.deliveryStatus} />
                </div>

                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[#E3E7E2] text-xs">
                  <div>
                    <p className="text-[#77827B]">Road Distance</p>
                    <p className="font-mono-tabular font-semibold text-[#17231F] mt-0.5">
                      {link.roadDistanceKm.toFixed(1)} km
                    </p>
                  </div>
                  <div>
                    <p className="text-[#77827B]">Estimated ETA</p>
                    <p className="font-mono-tabular font-semibold text-[#17231F] mt-0.5 inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-[#123C32]" />
                      {link.estimatedDuration} mins
                    </p>
                  </div>
                </div>

                <div className="space-y-2.5 pt-3 border-t border-[#E3E7E2] text-xs">
                  <div>
                    <p className="text-[#77827B]">Pickup</p>
                    <p className="font-medium text-[#17231F]">{link.pickupAddress}</p>
                  </div>
                  <div>
                    <p className="text-[#77827B]">Dropoff</p>
                    <p className="font-medium text-[#17231F]">{link.deliveryAddress}</p>
                  </div>
                </div>

                {link.riderName && (
                  <div className="pt-3 border-t border-[#E3E7E2] flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-lg bg-[#123C32] text-[#D5FF70] flex items-center justify-center shrink-0">
                        <Bike className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-[#17231F]">{link.riderName}</p>
                        <p className="text-[11px] text-[#77827B]">Assigned FikaBoda Rider</p>
                      </div>
                    </div>
                    {link.riderPhone && (
                      <a
                        href={`tel:${link.riderPhone}`}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E3E7E2] text-xs font-semibold text-[#123C32] hover:bg-[#F7F8F5]"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>Call</span>
                      </a>
                    )}
                  </div>
                )}

                <p className="text-[11px] font-mono-tabular text-[#77827B] pt-2 border-t border-[#E3E7E2]">
                  Last updated: {formatTimestamp(link.updatedAt)}
                </p>
              </div>

              <div className="bg-white border border-[#E3E7E2] rounded-xl p-5">
                <h3 className="font-display text-sm font-semibold text-[#17231F] mb-3">
                  Delivery Progress
                </h3>
                <ol className="space-y-2.5">
                  {DELIVERY_STATUS_FLOW.map((step, i) => {
                    const reached = currentIdx >= i;
                    const isCurrent = currentIdx === i;
                    return (
                      <li key={step} className="flex items-center gap-3 text-xs">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border ${
                            reached
                              ? 'bg-[#123C32] border-[#123C32] text-[#D5FF70]'
                              : 'bg-[#F7F8F5] border-[#E3E7E2] text-[#77827B]'
                          }`}
                        >
                          {reached ? <CheckCircle2 className="w-3 h-3" /> : i + 1}
                        </span>
                        <span
                          className={
                            isCurrent
                              ? 'font-semibold text-[#123C32]'
                              : reached
                                ? 'text-[#17231F]'
                                : 'text-[#77827B]'
                          }
                        >
                          {getDeliveryStatusLabel(step)}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>

            <div className="lg:col-span-7">
              <div className="bg-white border border-[#E3E7E2] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#17231F]">Live Route & Rider Position</span>
                  <span className="text-[#77827B]">
                    {link.riderLocation ? 'GPS active' : 'Awaiting rider GPS signal'}
                  </span>
                </div>
                <DeliveryRouteMap
                  hasMapsKey={hasMapsKey}
                  pickup={link.pickupCoordinates}
                  pickupLabel={`Pickup: ${link.shopName}`}
                  dropoff={link.deliveryCoordinates}
                  dropoffLabel={`Dropoff: ${link.deliveryAddress}`}
                  riderLocation={link.riderLocation || null}
                  riderLabel={link.riderName || 'FikaBoda Rider'}
                  heightClass="h-[300px] sm:h-[420px]"
                />
              </div>
            </div>
          </div>
        )}
      </main>
      </PullToRefresh>
    </div>
  );
};
