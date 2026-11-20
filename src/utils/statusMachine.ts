import type { DeliveryStatus, PaymentStatus } from '../types/fikaboda';

export const DELIVERY_STATUS_FLOW: DeliveryStatus[] = [
  'PENDING_DISPATCH',
  'ASSIGNED',
  'ACCEPTED',
  'ARRIVED_AT_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED_AT_DESTINATION',
  'DELIVERED',
];

export const TERMINAL_DELIVERY_STATUSES: DeliveryStatus[] = ['DELIVERED', 'CANCELLED', 'RETURNED'];

export const RIDER_NEXT_STATUS: Partial<Record<DeliveryStatus, DeliveryStatus>> = {
  ASSIGNED: 'ACCEPTED',
  ACCEPTED: 'ARRIVED_AT_PICKUP',
  ARRIVED_AT_PICKUP: 'PICKED_UP',
  PICKED_UP: 'IN_TRANSIT',
  IN_TRANSIT: 'ARRIVED_AT_DESTINATION',
  ARRIVED_AT_DESTINATION: 'DELIVERED',
};

export const VALID_JOB_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  PENDING_DISPATCH: ['ASSIGNED', 'ACCEPTED', 'CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'PENDING_DISPATCH', 'CANCELLED'],
  ACCEPTED: ['ARRIVED_AT_PICKUP', 'CANCELLED', 'PENDING_DISPATCH'],
  ARRIVED_AT_PICKUP: ['PICKED_UP', 'CANCELLED', 'FAILED'],
  PICKED_UP: ['IN_TRANSIT', 'FAILED', 'RETURN_REQUIRED'],
  IN_TRANSIT: ['ARRIVED_AT_DESTINATION', 'FAILED', 'RETURN_REQUIRED'],
  ARRIVED_AT_DESTINATION: ['DELIVERED', 'FAILED', 'RETURN_REQUIRED'],
  DELIVERED: [],
  CANCELLED: [],
  FAILED: ['RETURN_REQUIRED', 'PENDING_DISPATCH'],
  RETURN_REQUIRED: ['RETURNED'],
  RETURNED: [],
};

export function canTransitionJobStatus(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return VALID_JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getDeliveryStatusLabel(status: DeliveryStatus): string {
  const labels: Record<DeliveryStatus, string> = {
    PENDING_DISPATCH: 'Awaiting Rider',
    ASSIGNED: 'Rider Assigned',
    ACCEPTED: 'Rider En Route to Shop',
    ARRIVED_AT_PICKUP: 'At Pickup Shop',
    PICKED_UP: 'Parcel Collected',
    IN_TRANSIT: 'In Transit',
    ARRIVED_AT_DESTINATION: 'At Dropoff',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
    FAILED: 'Delivery Failed',
    RETURN_REQUIRED: 'Return Required',
    RETURNED: 'Returned to Shop',
  };
  return labels[status] || status;
}

export function getPaymentStatusLabel(status: PaymentStatus): string {
  const labels: Record<PaymentStatus, string> = {
    INITIATED: 'Initiated',
    UNPAID: 'Unpaid',
    PENDING_STK: 'M-Pesa STK Pending',
    AWAITING_CONFIG: 'Daraja Config Needed',
    PAID: 'Paid (M-Pesa)',
    FAILED: 'Payment Failed',
    CANCELLED: 'Cancelled',
    TIMEOUT: 'Timed Out',
    REFUNDED: 'Refunded',
  };
  return labels[status] || status;
}
