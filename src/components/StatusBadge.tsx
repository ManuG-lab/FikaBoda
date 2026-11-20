import React from 'react';
import {
  CheckCircle2,
  Clock,
  Navigation,
  Package,
  Truck,
  XCircle,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import type { DeliveryStatus, PaymentStatus } from '../types/fikaboda';
import { getDeliveryStatusLabel, getPaymentStatusLabel } from '../utils/statusMachine';

export const DeliveryStatusText: React.FC<{ status: DeliveryStatus }> = ({ status }) => {
  let colorClass = 'text-[#17231F]';
  let Icon = Clock;

  switch (status) {
    case 'DELIVERED':
      colorClass = 'text-emerald-800';
      Icon = CheckCircle2;
      break;
    case 'IN_TRANSIT':
    case 'ARRIVED_AT_DESTINATION':
      colorClass = 'text-[#123C32]';
      Icon = Navigation;
      break;
    case 'PICKED_UP':
    case 'ARRIVED_AT_PICKUP':
    case 'ACCEPTED':
      colorClass = 'text-[#123C32]';
      Icon = Truck;
      break;
    case 'ASSIGNED':
    case 'PENDING_DISPATCH':
      colorClass = 'text-amber-800';
      Icon = Package;
      break;
    case 'CANCELLED':
    case 'FAILED':
      colorClass = 'text-red-700';
      Icon = XCircle;
      break;
    case 'RETURN_REQUIRED':
    case 'RETURNED':
      colorClass = 'text-amber-900';
      Icon = RotateCcw;
      break;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${colorClass}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{getDeliveryStatusLabel(status)}</span>
    </span>
  );
};

export const PaymentStatusText: React.FC<{ status: PaymentStatus }> = ({ status }) => {
  let colorClass = 'text-[#77827B]';
  let Icon = Clock;

  if (status === 'PAID') {
    colorClass = 'text-emerald-800';
    Icon = CheckCircle2;
  } else if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMEOUT') {
    colorClass = 'text-red-700';
    Icon = XCircle;
  } else if (status === 'AWAITING_CONFIG') {
    colorClass = 'text-amber-800';
    Icon = AlertTriangle;
  } else if (status === 'PENDING_STK') {
    colorClass = 'text-[#123C32]';
    Icon = Clock;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${colorClass}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{getPaymentStatusLabel(status)}</span>
    </span>
  );
};
