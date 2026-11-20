import { auth } from '../firebase/config';
import type { IntegrationReadiness, PackageSize } from '../types/fikaboda';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const user = auth.currentUser;
  if (user) {
    try {
      const token = await user.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    } catch {
      // Ignore if unavailable
    }
  }
  return headers;
}

export async function fetchIntegrationStatus(): Promise<IntegrationReadiness> {
  const res = await fetch('/api/config/status');
  if (!res.ok) {
    throw new Error('Unable to load integration status');
  }
  return res.json();
}

export async function calculateServerQuote(params: {
  roadDistanceKm: number;
  packageSize: PackageSize;
  specialHandling?: string;
  zoneId?: string;
}) {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/pricing/calculate', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to calculate quote');
  }
  return res.json();
}

export interface StkPushResponse {
  status: 'PENDING_STK' | 'AWAITING_CONFIG' | 'FAILED';
  configured: boolean;
  checkoutRequestId?: string;
  merchantRequestId?: string;
  customerMessage?: string;
  message: string;
}

export async function initiateMpesaStkPush(params: {
  paymentId: string;
  jobId: string;
  phoneNumber: string;
  amount: number;
  accountReference: string;
}): Promise<StkPushResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/mpesa/stk-push', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'M-Pesa STK Push initiation failed');
  }
  return data;
}

export async function checkMpesaCallbackStatus(checkoutRequestId: string) {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/mpesa/status/${encodeURIComponent(checkoutRequestId)}`, {
    headers,
  });
  if (!res.ok) {
    throw new Error('Failed to check M-Pesa transaction status');
  }
  return res.json();
}

export async function dispatchExternalNotification(params: {
  channel: 'WHATSAPP' | 'SMS';
  phoneNumber: string;
  message: string;
  jobId?: string;
}): Promise<{ delivered: boolean; status: string; message: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/notifications/dispatch', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  return res.json();
}
