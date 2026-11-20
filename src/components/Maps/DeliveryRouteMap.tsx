import React, { useEffect, useRef, useState } from 'react';
import {
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { MapPin, Navigation } from 'lucide-react';
import type { LatLng } from '../../types/fikaboda';
import { computeHaversineKm, WESTLANDS_CENTER } from '../../utils/pricing';

interface RouteComputationResult {
  distanceKm: number;
  durationMinutes: number;
  source: 'GOOGLE_ROUTES' | 'HAVERSINE_ESTIMATE';
}

interface DeliveryRouteMapProps {
  hasMapsKey: boolean;
  pickup?: LatLng | null;
  pickupLabel?: string;
  dropoff?: LatLng | null;
  dropoffLabel?: string;
  riderLocation?: LatLng | null;
  riderLabel?: string;
  heightClass?: string;
  onMapClick?: (coords: LatLng) => void;
  onRouteComputed?: (result: RouteComputationResult) => void;
}

function checkQuotaError(err: unknown): boolean {
  const msg = String(err || '');
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('429') ||
    msg.includes('QuotaExceededError')
  );
}

const RouteCalculatorEffect: React.FC<{
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  onRouteComputed?: (result: RouteComputationResult) => void;
}> = ({ pickup, dropoff, onRouteComputed }) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<any[]>([]);
  const callbackRef = useRef(onRouteComputed);
  callbackRef.current = onRouteComputed;

  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!pickup || !dropoff) return;

    const emitFallback = () => {
      const straight = computeHaversineKm(pickup, dropoff);
      const roadEstimate = Math.max(0.5, Number((straight * 1.28).toFixed(2)));
      const durationMinutes = Math.max(5, Math.round(roadEstimate * 3.1));
      callbackRef.current?.({
        distanceKm: roadEstimate,
        durationMinutes,
        source: 'HAVERSINE_ESTIMATE',
      });
    };

    if (!routesLib || !map || !(routesLib as any).Route?.computeRoutes) {
      emitFallback();
      return;
    }

    let cancelled = false;

    const request = {
      origin: pickup,
      destination: dropoff,
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs'],
    };

    (routesLib as any).Route.computeRoutes(request)
      .then((res: { routes?: any[] }) => {
        if (cancelled) return;
        const primaryRoute = res?.routes?.[0];
        if (!primaryRoute) {
          emitFallback();
          return;
        }

        if (typeof primaryRoute.createPolylines === 'function') {
          const newPolylines = primaryRoute.createPolylines();
          newPolylines.forEach((pl: any) => {
            pl.setOptions({
              strokeColor: '#123C32',
              strokeWeight: 5,
              strokeOpacity: 0.92,
            });
            pl.setMap(map);
          });
          polylinesRef.current = newPolylines;
        }

        if (primaryRoute.viewport && typeof map.fitBounds === 'function') {
          map.fitBounds(primaryRoute.viewport, 48);
        }

        const distKm = Math.max(0.4, Number(((primaryRoute.distanceMeters || 0) / 1000).toFixed(2)));
        const durMins = Math.max(4, Math.round((primaryRoute.durationMillis || 0) / 60000));
        callbackRef.current?.({
          distanceKm: distKm,
          durationMinutes: durMins,
          source: 'GOOGLE_ROUTES',
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (checkQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        emitFallback();
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [routesLib, map, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  return null;
};

const PinWithInfo: React.FC<{
  position: LatLng;
  title: string;
  background: string;
  borderColor: string;
  glyphColor: string;
  glyphText: string;
}> = ({ position, title, background, borderColor, glyphColor, glyphText }) => {
  const [open, setOpen] = useState(false);
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={position}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        <Pin
          background={background}
          borderColor={borderColor}
          glyphColor={glyphColor}
          glyph={glyphText}
        />
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow anchor={marker} onCloseClick={() => setOpen(false)}>
          <div className="text-xs font-medium text-[#17231F] px-0.5 py-0.5">{title}</div>
        </InfoWindow>
      )}
    </>
  );
};

export const DeliveryRouteMap: React.FC<DeliveryRouteMapProps> = ({
  hasMapsKey,
  pickup,
  pickupLabel = 'Pickup Shop',
  dropoff,
  dropoffLabel = 'Customer Dropoff',
  riderLocation,
  riderLabel = 'FikaBoda Rider',
  heightClass = 'h-72',
  onMapClick,
  onRouteComputed,
}) => {
  useEffect(() => {
    if (!hasMapsKey && pickup && dropoff && onRouteComputed) {
      const straight = computeHaversineKm(pickup, dropoff);
      const roadEstimate = Math.max(0.5, Number((straight * 1.28).toFixed(2)));
      onRouteComputed({
        distanceKm: roadEstimate,
        durationMinutes: Math.max(5, Math.round(roadEstimate * 3.1)),
        source: 'HAVERSINE_ESTIMATE',
      });
    }
  }, [hasMapsKey, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  if (!hasMapsKey) {
    return (
      <div
        className={`${heightClass} w-full rounded-xl border border-[#E3E7E2] bg-[#EFF2EC] flex flex-col items-center justify-center p-5 text-center`}
      >
        <MapPin className="w-6 h-6 text-[#123C32] mb-2" />
        <p className="text-sm font-semibold text-[#17231F]">
          Google Maps Platform Key Not Loaded in Browser
        </p>
        <p className="text-xs text-[#77827B] max-w-sm mt-1">
          Provide <code className="font-mono">VITE_GOOGLE_MAPS_API_KEY</code> to render interactive Nairobi maps and Google Routes. Distance calculations continue via Haversine road-factor estimate.
        </p>
        {pickup && dropoff && (
          <div className="mt-3 text-xs font-mono-tabular text-[#123C32] flex items-center gap-3">
            <span>Pickup: {pickup.lat.toFixed(4)}, {pickup.lng.toFixed(4)}</span>
            <span>→</span>
            <span>Dropoff: {dropoff.lat.toFixed(4)}, {dropoff.lng.toFixed(4)}</span>
          </div>
        )}
      </div>
    );
  }

  const center = riderLocation || pickup || dropoff || WESTLANDS_CENTER;

  return (
    <div className={`${heightClass} w-full rounded-xl overflow-hidden border border-[#E3E7E2] relative`}>
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={center}
        defaultZoom={13}
        gestureHandling="greedy"
        disableDefaultUI={false}
        streetViewControl={false}
        mapTypeControl={false}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        onClick={(ev) => {
          if (onMapClick && ev.detail?.latLng) {
            onMapClick({
              lat: Number(ev.detail.latLng.lat),
              lng: Number(ev.detail.latLng.lng),
            });
          }
        }}
      >
        {pickup && (
          <PinWithInfo
            position={pickup}
            title={pickupLabel}
            background="#123C32"
            borderColor="#0A241E"
            glyphColor="#D5FF70"
            glyphText="P"
          />
        )}

        {dropoff && (
          <PinWithInfo
            position={dropoff}
            title={dropoffLabel}
            background="#A6E65B"
            borderColor="#123C32"
            glyphColor="#123C32"
            glyphText="D"
          />
        )}

        {riderLocation && (
          <AdvancedMarker position={riderLocation} title={riderLabel}>
            <div className="w-9 h-9 rounded-full bg-[#123C32] border-2 border-[#D5FF70] shadow-md flex items-center justify-center text-[#D5FF70]">
              <Navigation className="w-4 h-4" />
            </div>
          </AdvancedMarker>
        )}

        <RouteCalculatorEffect
          pickup={pickup}
          dropoff={dropoff}
          onRouteComputed={onRouteComputed}
        />
      </GoogleMap>
    </div>
  );
};
