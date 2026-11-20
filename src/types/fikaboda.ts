export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'DISPATCHER' | 'MERCHANT' | 'RIDER';

export type AccountStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export type ShopStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED';

export type RiderApprovalStatus = 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REJECTED';

export type RiderAvailabilityStatus = 'ONLINE' | 'OFFLINE' | 'ON_DELIVERY';

export type PackageSize = 'SMALL' | 'MEDIUM' | 'LARGE';

export type DeliveryStatus =
  | 'PENDING_DISPATCH'
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'ARRIVED_AT_PICKUP'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'ARRIVED_AT_DESTINATION'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'
  | 'RETURN_REQUIRED'
  | 'RETURNED';

export type PaymentStatus =
  | 'INITIATED'
  | 'UNPAID'
  | 'PENDING_STK'
  | 'AWAITING_CONFIG'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'REFUNDED';

export type SettlementStatus = 'PENDING' | 'PROCESSING' | 'SETTLED';

export type TicketStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface UserProfile {
  uid: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  role: UserRole;
  accountStatus: AccountStatus;
  profilePhoto?: string;
  fcmToken?: string;
  createdAt: any;
  lastLogin: any;
}

export interface AdminRoleRecord {
  uid: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'DISPATCHER';
  assignedBy: string;
  active: boolean;
  createdAt: any;
}

export interface Shop {
  shopId: string;
  ownerUid: string;
  shopName: string;
  businessCategory: string;
  contactPerson: string;
  phoneNumber: string;
  email: string;
  physicalAddress: string;
  location: LatLng;
  operatingHours: string;
  verificationStatus: VerificationStatus;
  status: ShopStatus;
  zoneId?: string;
  createdAt: any;
  updatedAt: any;
}

export type VerificationDocKey = 'nationalId' | 'drivingLicence' | 'insurance';

export interface RiderVerificationDoc {
  docKey: VerificationDocKey;
  riderId: string;
  uid: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  dataUrl?: string;
  storagePath?: string;
  verificationStatus: VerificationStatus;
  reviewedBy?: string;
  reviewNotes?: string;
  uploadedAt: any;
  updatedAt: any;
}

export interface DeliveryEvidence {
  evidenceId: string;
  jobId: string;
  shopOwnerUid: string;
  riderUid: string;
  evidenceType: 'PICKUP_PHOTO';
  fileName: string;
  mimeType: string;
  byteSize: number;
  dataUrl: string;
  createdAt: any;
}

export interface Rider {
  riderId: string;
  uid: string;
  fullName: string;
  phoneNumber: string;
  email: string;
  nationalIdReference: string;
  drivingLicenceRef?: string;
  motorcycleRegistration: string;
  insuranceDetails?: string;
  emergencyContact?: string;
  verificationDocRefs?: Record<string, string>;
  licenceVerificationStatus: VerificationStatus;
  insuranceVerificationStatus: VerificationStatus;
  approvalStatus: RiderApprovalStatus;
  availabilityStatus: RiderAvailabilityStatus;
  currentLocation?: LatLng;
  lastLocationUpdate?: any;
  rating: number;
  totalDeliveries: number;
  totalEarnings: number;
  createdAt: any;
  updatedAt: any;
}

export interface DeliveryJob {
  jobId: string;
  referenceCode: string;
  shopId: string;
  shopOwnerUid: string;
  shopName: string;
  riderId?: string | null;
  riderUid?: string | null;
  riderName?: string | null;
  riderPhone?: string | null;
  customerName: string;
  customerPhone: string;
  pickupAddress: string;
  pickupCoordinates: LatLng;
  pickupInstructions?: string;
  deliveryAddress: string;
  deliveryCoordinates: LatLng;
  deliveryInstructions?: string;
  packageCategory: string;
  packageDescription?: string;
  packageSize: PackageSize;
  specialHandling?: string;
  roadDistanceKm: number;
  estimatedDuration: number;
  deliveryFee: number;
  riderEarning: number;
  platformRevenue: number;
  paymentStatus: PaymentStatus;
  deliveryStatus: DeliveryStatus;
  customerTrackingTokenHash: string;
  pickupPinHash: string;
  deliveryPinHash: string;
  pickupPinProofHash?: string;
  deliveryPinProofHash?: string;
  pickupPhotoRef?: string;
  cancellationReason?: string;
  zoneId?: string;
  createdAt: any;
  assignedAt?: any;
  pickedUpAt?: any;
  completedAt?: any;
  updatedAt: any;
}

export interface TrackingLink {
  tokenHash: string;
  jobId: string;
  shopOwnerUid: string;
  riderUid?: string | null;
  shopName: string;
  referenceCode: string;
  deliveryStatus: DeliveryStatus;
  pickupAddress: string;
  pickupCoordinates: LatLng;
  deliveryAddress: string;
  deliveryCoordinates: LatLng;
  riderName?: string | null;
  riderPhone?: string | null;
  riderLocation?: LatLng | null;
  roadDistanceKm: number;
  estimatedDuration: number;
  active: boolean;
  expiresAt: any;
  createdAt: any;
  updatedAt: any;
}

export interface JobEvent {
  eventId: string;
  jobId: string;
  shopOwnerUid: string;
  riderUid?: string | null;
  eventType: string;
  actorUid: string;
  location?: LatLng | null;
  notes?: string;
  createdAt: any;
}

export interface PaymentRecord {
  paymentId: string;
  jobId: string;
  shopId: string;
  shopOwnerUid: string;
  amount: number;
  provider: 'MPESA_DARAJA_SANDBOX' | 'MPESA_DARAJA_PROD';
  phoneNumber?: string;
  checkoutRequestId?: string;
  merchantRequestId?: string;
  mpesaReceiptNumber?: string;
  paymentStatus: PaymentStatus;
  failureReason?: string;
  paidAt?: any;
  createdAt: any;
  updatedAt: any;
}

export interface RiderSettlement {
  settlementId: string;
  riderId: string;
  riderUid: string;
  jobId: string;
  grossDeliveryFee: number;
  riderEarning: number;
  settlementStatus: SettlementStatus;
  payoutReference?: string;
  createdAt: any;
  settledAt?: any;
}

export interface PricingRule {
  ruleId: string;
  zoneId: string;
  zoneName?: string;
  minimumDistance: number;
  maximumDistance: number;
  baseFee?: number;
  perKmFee?: number;
  deliveryFee: number;
  riderPercentage: number;
  platformPercentage: number;
  fragileSurcharge?: number;
  active: boolean;
  updatedAt: any;
}

export interface ServiceZone {
  zoneId: string;
  zoneName: string;
  center?: LatLng;
  radiusKm?: number;
  coverageBoundary: {
    type: 'circle' | 'polygon';
    center?: LatLng;
    radiusKm?: number;
    description?: string;
  };
  active: boolean;
  createdAt: any;
}

export interface AppNotification {
  notificationId: string;
  recipientUid: string;
  title: string;
  message: string;
  type: string;
  jobId?: string;
  read: boolean;
  createdAt: any;
}

export interface SupportTicket {
  ticketId: string;
  createdBy: string;
  creatorRole?: UserRole;
  jobId?: string;
  issueType: string;
  description: string;
  status: TicketStatus;
  resolutionNotes?: string;
  createdAt: any;
  resolvedAt?: any;
}

export interface ActivityLog {
  logId: string;
  actorUid: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: string;
  createdAt: any;
}

export interface IntegrationReadiness {
  firebase: { configured: boolean; projectId: string };
  googleMaps: { configured: boolean };
  daraja: { configured: boolean; env: string; callbackUrlConfigured: boolean };
  whatsapp: { configured: boolean };
  sms: { configured: boolean };
  fcm: { configured: boolean };
  appCheck: { configured: boolean };
}
