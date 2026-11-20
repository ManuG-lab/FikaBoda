import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  calculateDeliveryQuote,
  DEFAULT_PRICING_RULES,
  DEFAULT_WESTLANDS_ZONE,
  isWithinServiceZones,
  WESTLANDS_CENTER,
} from '../utils/pricing';
import { canTransitionJobStatus, TERMINAL_DELIVERY_STATUSES } from '../utils/statusMachine';
import { formatKenyanPhone, isValidKenyanPhone, sha256Hex } from '../utils/crypto';
import type { PricingRule, ServiceZone } from '../types/fikaboda';

describe('FikaBoda Pricing & Westlands Zone Engine', () => {
  it('computes accurate KES pricing split where riderEarning + platformRevenue === deliveryFee', () => {
    const quote = calculateDeliveryQuote({
      roadDistanceKm: 4.6,
      packageSize: 'MEDIUM',
      specialHandling: 'FRAGILE',
      rules: DEFAULT_PRICING_RULES as PricingRule[],
      zoneId: 'westlands-nairobi',
    });

    expect(quote.deliveryFee).toBeGreaterThanOrEqual(280);
    expect(quote.riderEarning + quote.platformRevenue).toBe(quote.deliveryFee);
    expect(quote.riderPercentage).toBe(80);
  });

  it('approves coordinates inside Westlands & rejects far outside coordinates', () => {
    const westlandsSarit = { lat: -1.2611, lng: 36.8019 };
    const inside = isWithinServiceZones(westlandsSarit, [
      { ...DEFAULT_WESTLANDS_ZONE, createdAt: null } as ServiceZone,
    ]);
    expect(inside.supported).toBe(true);

    const mombasa = { lat: -4.0435, lng: 39.6682 };
    const outside = isWithinServiceZones(mombasa, [
      { ...DEFAULT_WESTLANDS_ZONE, createdAt: null } as ServiceZone,
    ]);
    expect(outside.supported).toBe(false);
    expect(outside.distanceFromCenterKm).toBeGreaterThan(300);
  });

  it('keeps WESTLANDS_CENTER centered in Nairobi Westlands', () => {
    expect(WESTLANDS_CENTER.lat).toBeCloseTo(-1.2674, 3);
    expect(WESTLANDS_CENTER.lng).toBeCloseTo(36.811, 3);
  });
});

describe('FikaBoda Delivery Status State Machine', () => {
  it('enforces valid forward transitions and blocks skipping PIN checkpoints', () => {
    expect(canTransitionJobStatus('PENDING_DISPATCH', 'ACCEPTED')).toBe(true);
    expect(canTransitionJobStatus('ACCEPTED', 'ARRIVED_AT_PICKUP')).toBe(true);
    expect(canTransitionJobStatus('ARRIVED_AT_PICKUP', 'PICKED_UP')).toBe(true);
    expect(canTransitionJobStatus('PICKED_UP', 'DELIVERED')).toBe(false);
    expect(canTransitionJobStatus('ARRIVED_AT_DESTINATION', 'DELIVERED')).toBe(true);
  });

  it('prevents transitions out of terminal states', () => {
    for (const terminal of TERMINAL_DELIVERY_STATUSES) {
      expect(canTransitionJobStatus(terminal, 'IN_TRANSIT')).toBe(false);
      expect(canTransitionJobStatus(terminal, 'CANCELLED')).toBe(false);
    }
  });
});

describe('FikaBoda Crypto & Kenyan Phone Utilities', () => {
  it('normalizes and validates Safaricom/Airtel Kenya mobile numbers', () => {
    expect(formatKenyanPhone('0712345678')).toBe('254712345678');
    expect(formatKenyanPhone('+254 722 987 654')).toBe('254722987654');
    expect(isValidKenyanPhone('0712345678')).toBe(true);
    expect(isValidKenyanPhone('0110123456')).toBe(true);
    expect(isValidKenyanPhone('12345')).toBe(false);
  });

  it('produces deterministic SHA-256 hashes for tracking tokens and PINs', async () => {
    const h1 = await sha256Hex('4829');
    const h2 = await sha256Hex('4829');
    const h3 = await sha256Hex('9999');
    expect(h1).toHaveLength(64);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

describe('Firestore Security Rules Hardening Checks', () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rulesText = fs.readFileSync(rulesPath, 'utf8');

  it('enforces global default deny and non-enumerable trackingLinks', () => {
    expect(rulesText).toContain('allow read, write: if false;');
    expect(rulesText).toMatch(/match \/trackingLinks\/\{tokenHash\}[\s\S]*allow list: if false;/);
  });

  it('blocks client self-escalation to ADMIN or PAID payment spoofing', () => {
    expect(rulesText).toContain("incoming().role in ['MERCHANT', 'RIDER']");
    expect(rulesText).toContain("incoming().paymentStatus in ['INITIATED', 'PENDING_STK', 'AWAITING_CONFIG']");
    expect(rulesText).toContain('incoming().pickupPinProofHash == existing().pickupPinHash');
    expect(rulesText).toContain('incoming().deliveryPinProofHash == existing().deliveryPinHash');
  });
});
