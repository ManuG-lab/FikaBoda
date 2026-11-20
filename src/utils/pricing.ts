import type { LatLng, PackageSize, PricingRule, ServiceZone } from '../types/fikaboda';

export const WESTLANDS_CENTER: LatLng = { lat: -1.2674, lng: 36.811 };

export const DEFAULT_WESTLANDS_ZONE: Omit<ServiceZone, 'createdAt'> = {
  zoneId: 'westlands-nairobi',
  zoneName: 'Westlands & Environs',
  center: WESTLANDS_CENTER,
  radiusKm: 18,
  coverageBoundary: {
    type: 'circle',
    center: WESTLANDS_CENTER,
    radiusKm: 18,
    description: 'Westlands, Parklands, Kilimani, Lavington, Kileleshwa, Riverside, CBD & Upper Hill',
  },
  active: true,
};

export const DEFAULT_PRICING_RULES: Omit<PricingRule, 'updatedAt'>[] = [
  {
    ruleId: 'westlands-tier-1',
    zoneId: 'westlands-nairobi',
    zoneName: 'Westlands & Environs',
    minimumDistance: 0,
    maximumDistance: 3,
    baseFee: 180,
    perKmFee: 0,
    deliveryFee: 180,
    riderPercentage: 80,
    platformPercentage: 20,
    fragileSurcharge: 50,
    active: true,
  },
  {
    ruleId: 'westlands-tier-2',
    zoneId: 'westlands-nairobi',
    zoneName: 'Westlands & Environs',
    minimumDistance: 3,
    maximumDistance: 7,
    baseFee: 180,
    perKmFee: 35,
    deliveryFee: 280,
    riderPercentage: 80,
    platformPercentage: 20,
    fragileSurcharge: 50,
    active: true,
  },
  {
    ruleId: 'westlands-tier-3',
    zoneId: 'westlands-nairobi',
    zoneName: 'Westlands & Environs',
    minimumDistance: 7,
    maximumDistance: 15,
    baseFee: 250,
    perKmFee: 40,
    deliveryFee: 450,
    riderPercentage: 80,
    platformPercentage: 20,
    fragileSurcharge: 80,
    active: true,
  },
  {
    ruleId: 'westlands-tier-4',
    zoneId: 'westlands-nairobi',
    zoneName: 'Westlands & Environs',
    minimumDistance: 15,
    maximumDistance: 35,
    baseFee: 350,
    perKmFee: 45,
    deliveryFee: 750,
    riderPercentage: 80,
    platformPercentage: 20,
    fragileSurcharge: 100,
    active: true,
  },
];

export function computeHaversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const x =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinDLng * sinDLng;
  return R * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

export function isWithinServiceZones(
  point: LatLng,
  zones: ServiceZone[]
): { supported: boolean; zone: ServiceZone | null; distanceFromCenterKm: number } {
  const activeZones = zones.filter((z) => z.active);
  if (activeZones.length === 0) {
    const dist = computeHaversineKm(point, WESTLANDS_CENTER);
    return {
      supported: dist <= 18,
      zone: null,
      distanceFromCenterKm: Number(dist.toFixed(2)),
    };
  }

  for (const z of activeZones) {
    const center = z.center || z.coverageBoundary?.center || WESTLANDS_CENTER;
    const radius = z.radiusKm || z.coverageBoundary?.radiusKm || 18;
    const dist = computeHaversineKm(point, center);
    if (dist <= radius) {
      return {
        supported: true,
        zone: z,
        distanceFromCenterKm: Number(dist.toFixed(2)),
      };
    }
  }

  const firstCenter = activeZones[0].center || WESTLANDS_CENTER;
  return {
    supported: false,
    zone: null,
    distanceFromCenterKm: Number(computeHaversineKm(point, firstCenter).toFixed(2)),
  };
}

export interface DeliveryQuote {
  roadDistanceKm: number;
  deliveryFee: number;
  riderEarning: number;
  platformRevenue: number;
  riderPercentage: number;
  platformPercentage: number;
  appliedRuleId: string;
  surcharges: number;
}

export function calculateDeliveryQuote(params: {
  roadDistanceKm: number;
  packageSize: PackageSize;
  specialHandling?: string;
  rules: PricingRule[];
  zoneId?: string;
}): DeliveryQuote {
  const dist = Math.max(0.2, Number(params.roadDistanceKm.toFixed(2)));
  const activeRules = (params.rules.length > 0 ? params.rules : (DEFAULT_PRICING_RULES as PricingRule[]))
    .filter((r) => r.active && (!params.zoneId || r.zoneId === params.zoneId))
    .sort((a, b) => a.minimumDistance - b.minimumDistance);

  const matchedRule =
    activeRules.find((r) => dist >= r.minimumDistance && dist <= r.maximumDistance) ||
    activeRules[activeRules.length - 1] ||
    (DEFAULT_PRICING_RULES[1] as PricingRule);

  // Use base + perKm if configured cleanly, or band flat fee, floored by rule.deliveryFee
  let base = matchedRule.deliveryFee;
  if (typeof matchedRule.baseFee === 'number' && typeof matchedRule.perKmFee === 'number' && matchedRule.perKmFee > 0) {
    const dynamicFee = Math.round((matchedRule.baseFee + dist * matchedRule.perKmFee) / 10) * 10;
    base = Math.max(matchedRule.deliveryFee, dynamicFee);
  }

  let surcharges = 0;
  if (params.packageSize === 'LARGE') {
    surcharges += 60;
  } else if (params.packageSize === 'MEDIUM') {
    surcharges += 20;
  }
  if (params.specialHandling && params.specialHandling !== 'NONE') {
    surcharges += matchedRule.fragileSurcharge ?? 50;
  }

  const deliveryFee = Math.round((base + surcharges) / 10) * 10;
  const riderPct = matchedRule.riderPercentage;
  const riderEarning = Math.round((deliveryFee * riderPct) / 100);
  const platformRevenue = deliveryFee - riderEarning; // Guarantees riderEarning + platformRevenue === deliveryFee

  return {
    roadDistanceKm: dist,
    deliveryFee,
    riderEarning,
    platformRevenue,
    riderPercentage: riderPct,
    platformPercentage: matchedRule.platformPercentage,
    appliedRuleId: matchedRule.ruleId,
    surcharges,
  };
}
