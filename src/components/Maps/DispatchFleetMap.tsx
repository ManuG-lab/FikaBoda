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
import { Bike, MapPin } from 'lucide-react';
import type { DeliveryJob, Rider } from '../../types/fikaboda';
import { WESTLANDS_CENTER } from '../../utils/pricing';
import { getDeliveryStatusLabel } from '../../utils/statusMachine';

interface DispatchFleetMapProps {
  hasMapsKey: boolean;
  riders: Rider[];
  jobs: DeliveryJob[];
  selectedJob: DeliveryJob | null;
  onSelectJob: (job: DeliveryJob) => void;
}

const SelectedRouteOverlay: React.FC<{ job: DeliveryJob | null }> = ({ job }) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<any[]>([]);

  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    if (!job || !routesLib || !map || !(routesLib as any).Route?.computeRoutes) return;

    let cancelled = false;
    (routesLib as any).Route.computeRoutes({
      origin: job.pickupCoordinates,
      destination: job.deliveryCoordinates,
      travelMode: 'DRIVING',
      fields: ['path', 'viewport'],
    })
      .then((res: { routes?: any[] }) => {
        if (cancelled) return;
        const route = res?.routes?.[0];
        if (!route) return;
        if (typeof route.createPolylines === 'function') {
          const pls = route.createPolylines();
          pls.forEach((pl: any) => {
            pl.setOptions({ strokeColor: '#123C32', strokeWeight: 5, strokeOpacity: 0.9 });
            pl.setMap(map);
          });
          polylinesRef.current = pls;
        }
        if (route.viewport && typeof map.fitBounds === 'function') {
          map.fitBounds(route.viewport, 60);
        }
      })
      .catch((err: unknown) => {
        const msg = String(err || '');
        if (
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('429')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [job?.jobId, routesLib, map]);

  return null;
};

const RiderPin: React.FC<{ rider: Rider }> = ({ rider }) => {
  const [open, setOpen] = useState(false);
  const [ref, marker] = useAdvancedMarkerRef();
  if (!rider.currentLocation) return null;

  const isOnline = rider.availabilityStatus === 'ONLINE';
  const isBusy = rider.availabilityStatus === 'ON_DELIVERY';

  return (
    <>
      <AdvancedMarker
        ref={ref}
        position={rider.currentLocation}
        onClick={() => setOpen((v) => !v)}
        title={`${rider.fullName} (${rider.availabilityStatus})`}
      >
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shadow-md border-2 ${
            isOnline
              ? 'bg-[#D5FF70] border-[#123C32] text-[#123C32]'
              : isBusy
                ? 'bg-[#123C32] border-[#A6E65B] text-[#D5FF70]'
                : 'bg-slate-200 border-slate-500 text-slate-700'
          }`}
        >
          <Bike className="w-4 h-4" />
        </div>
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow anchor={marker} onCloseClick={() => setOpen(false)}>
          <div className="text-xs space-y-0.5 text-[#17231F]">
            <p className="font-semibold">{rider.fullName}</p>
            <p className="font-mono-tabular text-[#77827B]">{rider.motorcycleRegistration}</p>
            <p className="font-medium">{rider.availabilityStatus} · {rider.phoneNumber}</p>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

export const DispatchFleetMap: React.FC<DispatchFleetMapProps> = ({
  hasMapsKey,
  riders,
  jobs,
  selectedJob,
  onSelectJob,
}) => {
  const activeJobs = jobs.filter(
    (j) => !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(j.deliveryStatus)
  );
  const ridersWithLocation = riders.filter((r) => r.currentLocation);

  if (!hasMapsKey) {
    return (
      <div className="h-[460px] w-full rounded-xl border border-[#E3E7E2] bg-[#EFF2EC] flex flex-col items-center justify-center p-6 text-center">
        <MapPin className="w-7 h-7 text-[#123C32] mb-2" />
        <p className="text-sm font-semibold text-[#17231F]">Live Dispatch Map Awaiting API Key</p>
        <p className="text-xs text-[#77827B] max-w-md mt-1">
          Configure <code className="font-mono">VITE_GOOGLE_MAPS_API_KEY</code> to display live Westlands rider markers and active job polylines. Use the right-hand dispatch panel to assign or manage active orders.
        </p>
        <div className="mt-4 text-xs font-mono-tabular text-[#123C32]">
          {activeJobs.length} active jobs · {ridersWithLocation.length} riders reporting GPS
        </div>
      </div>
    );
  }

  return (
    <div className="h-[480px] lg:h-[580px] w-full rounded-xl overflow-hidden border border-[#E3E7E2] relative">
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={WESTLANDS_CENTER}
        defaultZoom={13}
        gestureHandling="greedy"
        streetViewControl={false}
        mapTypeControl={false}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
      >
        {ridersWithLocation.map((r) => (
          <RiderPin key={r.riderId} rider={r} />
        ))}

        {activeJobs.map((job) => {
          const isSelected = selectedJob?.jobId === job.jobId;
          const isUnassigned = job.deliveryStatus === 'PENDING_DISPATCH';
          return (
            <AdvancedMarker
              key={job.jobId}
              position={job.pickupCoordinates}
              title={`${job.referenceCode} · ${job.shopName} (${getDeliveryStatusLabel(job.deliveryStatus)})`}
              onClick={() => onSelectJob(job)}
            >
              <Pin
                background={isSelected ? '#D5FF70' : isUnassigned ? '#D97706' : '#123C32'}
                borderColor="#0A241E"
                glyphColor={isSelected ? '#123C32' : '#FFFFFF'}
                scale={isSelected ? 1.25 : 1}
              />
            </AdvancedMarker>
          );
        })}

        {selectedJob && (
          <AdvancedMarker
            position={selectedJob.deliveryCoordinates}
            title={`Dropoff: ${selectedJob.customerName} — ${selectedJob.deliveryAddress}`}
          >
            <Pin
              background="#A6E65B"
              borderColor="#123C32"
              glyphColor="#123C32"
              glyph="D"
            />
          </AdvancedMarker>
        )}

        <SelectedRouteOverlay job={selectedJob} />
      </GoogleMap>

      {/* Map legend */}
      <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-sm border border-[#E3E7E2] rounded-lg px-3 py-2 text-[11px] flex flex-wrap items-center gap-3 shadow-sm">
        <span className="inline-flex items-center gap-1.5 text-[#17231F]">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-600 inline-block" /> Unassigned Pickup
        </span>
        <span className="inline-flex items-center gap-1.5 text-[#17231F]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#123C32] inline-block" /> Assigned / Active
        </span>
        <span className="inline-flex items-center gap-1.5 text-[#17231F]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#D5FF70] border border-[#123C32] inline-block" /> Online Rider
        </span>
      </div>
    </div>
  );
};
