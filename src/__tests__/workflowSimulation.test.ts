import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  calculateDeliveryQuote,
  DEFAULT_PRICING_RULES,
  DEFAULT_WESTLANDS_ZONE,
  isWithinServiceZones,
} from '../utils/pricing';
import {
  canTransitionJobStatus,
  TERMINAL_DELIVERY_STATUSES,
} from '../utils/statusMachine';
import {
  formatKenyanPhone,
  generateFourDigitPin,
  generateJobReference,
  generateSecureToken,
  isValidKenyanPhone,
  sha256Hex,
} from '../utils/crypto';
import {
  estimateDataUrlByteSize,
  MAX_RAW_UPLOAD_BYTES,
  MAX_STORED_DOC_BYTES,
  validateVerificationDocFile,
} from '../utils/fileDocs';
import type {
  ActivityLog,
  AppNotification,
  DeliveryEvidence,
  DeliveryJob,
  DeliveryStatus,
  LatLng,
  PackageSize,
  PaymentRecord,
  PricingRule,
  Rider,
  RiderSettlement,
  RiderVerificationDoc,
  ServiceZone,
  Shop,
  SupportTicket,
  TrackingLink,
  UserProfile,
  UserRole,
  VerificationDocKey,
  VerificationStatus,
} from '../types/fikaboda';

/**
 * In-memory FikaBoda State Machine & Security-Invariant Simulator.
 * Mirrors the exact Firestore data contracts, state transitions, PIN cryptography,
 * document storage constraints, Daraja webhook parsing, and settlement atomicity.
 */
class FikaBodaWorkflowSimulator {
  users = new Map<string, UserProfile>();
  admins = new Map<string, { uid: string; email: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'DISPATCHER'; active: boolean }>();
  shops = new Map<string, Shop>();
  riders = new Map<string, Rider>();
  verificationDocs = new Map<string, RiderVerificationDoc>(); // key: `${riderId}:${docKey}`
  jobs = new Map<string, DeliveryJob>();
  evidence = new Map<string, DeliveryEvidence>(); // key: `${jobId}:pickup`
  trackingLinks = new Map<string, TrackingLink>();
  payments = new Map<string, PaymentRecord>();
  settlements = new Map<string, RiderSettlement>();
  notifications: AppNotification[] = [];
  tickets = new Map<string, SupportTicket>();
  activityLogs: ActivityLog[] = [];
  processedCallbacks = new Set<string>();

  private zones: ServiceZone[] = [{ ...DEFAULT_WESTLANDS_ZONE, createdAt: new Date() } as ServiceZone];
  private rules: PricingRule[] = DEFAULT_PRICING_RULES.map((r) => ({ ...r, updatedAt: new Date() }));

  bootstrapSuperAdmin(uid: string, email: string, fullName: string) {
    this.users.set(uid, {
      uid,
      fullName,
      email,
      phoneNumber: '254700000000',
      role: 'SUPER_ADMIN',
      accountStatus: 'ACTIVE',
      createdAt: new Date(),
      lastLogin: new Date(),
    });
    this.admins.set(uid, { uid, email, role: 'SUPER_ADMIN', active: true });
  }

  private assertAdmin(uid: string) {
    const admin = this.admins.get(uid);
    if (!admin || !admin.active || !['SUPER_ADMIN', 'ADMIN'].includes(admin.role)) {
      throw new Error('PERMISSION_DENIED: Admin privileges required.');
    }
  }

  private assertDispatcherOrAdmin(uid: string) {
    const admin = this.admins.get(uid);
    if (!admin || !admin.active || !['SUPER_ADMIN', 'ADMIN', 'DISPATCHER'].includes(admin.role)) {
      throw new Error('PERMISSION_DENIED: Dispatcher or Admin privileges required.');
    }
  }

  registerUser(params: {
    uid: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    requestedRole: UserRole;
  }): UserProfile {
    if (!['MERCHANT', 'RIDER'].includes(params.requestedRole)) {
      throw new Error('PERMISSION_DENIED: Client signup cannot self-assign ADMIN or SUPER_ADMIN.');
    }
    if (!isValidKenyanPhone(params.phoneNumber)) {
      throw new Error('VALIDATION_ERROR: Invalid Kenyan phone number.');
    }
    const profile: UserProfile = {
      uid: params.uid,
      fullName: params.fullName.trim(),
      email: params.email.trim(),
      phoneNumber: formatKenyanPhone(params.phoneNumber),
      role: params.requestedRole,
      accountStatus: 'PENDING',
      createdAt: new Date(),
      lastLogin: new Date(),
    };
    this.users.set(params.uid, profile);
    return profile;
  }

  submitShopApplication(params: {
    ownerUid: string;
    shopName: string;
    businessCategory: string;
    contactPerson: string;
    phoneNumber: string;
    email: string;
    physicalAddress: string;
    location: LatLng;
    operatingHours: string;
  }): Shop {
    const user = this.users.get(params.ownerUid);
    if (!user || user.role !== 'MERCHANT') {
      throw new Error('PERMISSION_DENIED: Only MERCHANT users can register a shop.');
    }
    const zoneCheck = isWithinServiceZones(params.location, this.zones);
    if (!zoneCheck.supported) {
      throw new Error('ZONE_ERROR: Shop coordinates are outside active Nairobi Westlands service zone.');
    }
    const shopId = `shop_${params.ownerUid}`;
    const shop: Shop = {
      shopId,
      ownerUid: params.ownerUid,
      shopName: params.shopName,
      businessCategory: params.businessCategory,
      contactPerson: params.contactPerson,
      phoneNumber: formatKenyanPhone(params.phoneNumber),
      email: params.email,
      physicalAddress: params.physicalAddress,
      location: params.location,
      operatingHours: params.operatingHours,
      verificationStatus: 'PENDING',
      status: 'PENDING_APPROVAL',
      zoneId: DEFAULT_WESTLANDS_ZONE.zoneId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.shops.set(shopId, shop);
    return shop;
  }

  uploadVerificationDoc(params: {
    actorUid: string;
    riderId: string;
    docKey: VerificationDocKey;
    fileName: string;
    mimeType: string;
    dataUrl: string;
    rawSizeBytes: number;
  }): RiderVerificationDoc {
    if (params.actorUid !== params.riderId) {
      throw new Error('PERMISSION_DENIED: Riders may only upload their own verification documents.');
    }
    const check = validateVerificationDocFile({
      name: params.fileName,
      type: params.mimeType,
      size: params.rawSizeBytes,
    });
    if (!check.valid) {
      throw new Error(`DOC_VALIDATION_ERROR: ${check.error}`);
    }
    const byteSize = estimateDataUrlByteSize(params.dataUrl);
    if (byteSize <= 0 || byteSize > MAX_STORED_DOC_BYTES) {
      throw new Error('DOC_VALIDATION_ERROR: Stored payload exceeds Firestore safe threshold.');
    }

    const storageKey = `${params.riderId}:${params.docKey}`;
    const prev = this.verificationDocs.get(storageKey);
    const record: RiderVerificationDoc = {
      docKey: params.docKey,
      riderId: params.riderId,
      uid: params.riderId,
      fileName: params.fileName,
      mimeType: params.mimeType,
      byteSize,
      dataUrl: params.dataUrl,
      verificationStatus: 'PENDING', // Always reset on upload/re-upload
      uploadedAt: prev?.uploadedAt || new Date(),
      updatedAt: new Date(),
    };
    this.verificationDocs.set(storageKey, record);

    const rider = this.riders.get(params.riderId);
    if (rider) {
      rider.verificationDocRefs = {
        ...(rider.verificationDocRefs || {}),
        [params.docKey]: `firestore:riders/${params.riderId}/verificationDocs/${params.docKey}`,
      };
      rider.updatedAt = new Date();
    }
    return record;
  }

  submitRiderApplication(params: {
    uid: string;
    fullName: string;
    phoneNumber: string;
    email: string;
    nationalIdReference: string;
    drivingLicenceRef: string;
    motorcycleRegistration: string;
    insuranceDetails: string;
    emergencyContact: string;
  }): Rider {
    const user = this.users.get(params.uid);
    if (!user || user.role !== 'RIDER') {
      throw new Error('PERMISSION_DENIED: Only RIDER users can register a rider profile.');
    }
    const requiredDocs: VerificationDocKey[] = ['nationalId', 'drivingLicence', 'insurance'];
    const refs: Record<string, string> = {};
    for (const k of requiredDocs) {
      const uploaded = this.verificationDocs.get(`${params.uid}:${k}`);
      if (!uploaded) {
        throw new Error(`VALIDATION_ERROR: Missing uploaded verification document (${k}).`);
      }
      refs[k] = `firestore:riders/${params.uid}/verificationDocs/${k}`;
    }

    const rider: Rider = {
      riderId: params.uid,
      uid: params.uid,
      fullName: params.fullName,
      phoneNumber: formatKenyanPhone(params.phoneNumber),
      email: params.email,
      nationalIdReference: params.nationalIdReference,
      drivingLicenceRef: params.drivingLicenceRef,
      motorcycleRegistration: params.motorcycleRegistration.toUpperCase(),
      insuranceDetails: params.insuranceDetails,
      emergencyContact: params.emergencyContact,
      verificationDocRefs: refs,
      licenceVerificationStatus: 'PENDING',
      insuranceVerificationStatus: 'PENDING',
      approvalStatus: 'PENDING',
      availabilityStatus: 'OFFLINE',
      rating: 5.0,
      totalDeliveries: 0,
      totalEarnings: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.riders.set(params.uid, rider);
    return rider;
  }

  getRiderDocsForAdmin(adminUid: string, riderId: string): RiderVerificationDoc[] {
    this.assertAdmin(adminUid);
    return (['nationalId', 'drivingLicence', 'insurance'] as VerificationDocKey[])
      .map((k) => this.verificationDocs.get(`${riderId}:${k}`))
      .filter((d): d is RiderVerificationDoc => Boolean(d));
  }

  adminReviewRiderDoc(params: {
    adminUid: string;
    riderId: string;
    docKey: VerificationDocKey;
    status: VerificationStatus;
    reviewNotes?: string;
  }): RiderVerificationDoc {
    this.assertAdmin(params.adminUid);
    const key = `${params.riderId}:${params.docKey}`;
    const doc = this.verificationDocs.get(key);
    if (!doc) throw new Error('NOT_FOUND: Verification document missing.');
    doc.verificationStatus = params.status;
    doc.reviewedBy = params.adminUid;
    if (params.reviewNotes) doc.reviewNotes = params.reviewNotes;
    doc.updatedAt = new Date();

    const rider = this.riders.get(params.riderId);
    if (rider) {
      if (params.docKey === 'drivingLicence') rider.licenceVerificationStatus = params.status;
      if (params.docKey === 'insurance') rider.insuranceVerificationStatus = params.status;
      rider.updatedAt = new Date();
    }
    return doc;
  }

  adminUpdateRiderApproval(params: {
    adminUid: string;
    riderId: string;
    approvalStatus: 'APPROVED' | 'SUSPENDED' | 'REJECTED';
    licenceVerificationStatus: VerificationStatus;
    insuranceVerificationStatus: VerificationStatus;
  }): Rider {
    this.assertAdmin(params.adminUid);
    const rider = this.riders.get(params.riderId);
    if (!rider) throw new Error('NOT_FOUND: Rider does not exist.');
    rider.approvalStatus = params.approvalStatus;
    rider.licenceVerificationStatus = params.licenceVerificationStatus;
    rider.insuranceVerificationStatus = params.insuranceVerificationStatus;
    if (params.approvalStatus !== 'APPROVED') {
      rider.availabilityStatus = 'OFFLINE';
    }
    rider.updatedAt = new Date();

    const user = this.users.get(rider.uid);
    if (user) {
      user.accountStatus =
        params.approvalStatus === 'APPROVED'
          ? 'ACTIVE'
          : params.approvalStatus === 'REJECTED'
            ? 'REJECTED'
            : 'SUSPENDED';
    }

    for (const k of ['nationalId', 'drivingLicence', 'insurance'] as VerificationDocKey[]) {
      const d = this.verificationDocs.get(`${rider.riderId}:${k}`);
      if (!d) continue;
      if (k === 'drivingLicence') d.verificationStatus = params.licenceVerificationStatus;
      else if (k === 'insurance') d.verificationStatus = params.insuranceVerificationStatus;
      else if (params.approvalStatus === 'APPROVED') d.verificationStatus = 'VERIFIED';
      else if (params.approvalStatus === 'REJECTED') d.verificationStatus = 'REJECTED';
      d.reviewedBy = params.adminUid;
      d.updatedAt = new Date();
    }
    return rider;
  }

  adminUpdateShopStatus(params: {
    adminUid: string;
    shopId: string;
    status: 'ACTIVE' | 'SUSPENDED';
    verificationStatus: VerificationStatus;
  }): Shop {
    this.assertAdmin(params.adminUid);
    const shop = this.shops.get(params.shopId);
    if (!shop) throw new Error('NOT_FOUND: Shop does not exist.');
    shop.status = params.status;
    shop.verificationStatus = params.verificationStatus;
    shop.updatedAt = new Date();

    const user = this.users.get(shop.ownerUid);
    if (user) {
      user.accountStatus = params.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED';
    }
    return shop;
  }

  async createDeliveryOrder(params: {
    merchantUid: string;
    shopId: string;
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    deliveryCoordinates: LatLng;
    packageCategory: string;
    packageSize: PackageSize;
    specialHandling?: string;
    roadDistanceKm: number;
  }): Promise<{
    job: DeliveryJob;
    trackingToken: string;
    pickupPin: string;
    deliveryPin: string;
  }> {
    const shop = this.shops.get(params.shopId);
    if (!shop || shop.ownerUid !== params.merchantUid) {
      throw new Error('PERMISSION_DENIED: Only owning merchant can dispatch orders.');
    }
    if (shop.status !== 'ACTIVE') {
      throw new Error('GATING_ERROR: Shop must be ACTIVE before dispatching orders.');
    }
    const zoneCheck = isWithinServiceZones(params.deliveryCoordinates, this.zones);
    if (!zoneCheck.supported) {
      throw new Error('ZONE_ERROR: Delivery dropoff is outside supported Westlands zone.');
    }

    const quote = calculateDeliveryQuote({
      roadDistanceKm: params.roadDistanceKm,
      packageSize: params.packageSize,
      specialHandling: params.specialHandling,
      rules: this.rules,
      zoneId: DEFAULT_WESTLANDS_ZONE.zoneId,
    });

    const jobId = `job_${this.jobs.size + 1}_${Date.now()}`;
    const trackingToken = generateSecureToken(24);
    const trackingTokenHash = await sha256Hex(trackingToken);
    const pickupPin = generateFourDigitPin();
    const deliveryPin = generateFourDigitPin();
    const pickupPinHash = await sha256Hex(pickupPin);
    const deliveryPinHash = await sha256Hex(deliveryPin);

    const job: DeliveryJob = {
      jobId,
      referenceCode: generateJobReference(),
      shopId: shop.shopId,
      shopOwnerUid: shop.ownerUid,
      shopName: shop.shopName,
      customerName: params.customerName,
      customerPhone: formatKenyanPhone(params.customerPhone),
      pickupAddress: shop.physicalAddress,
      pickupCoordinates: shop.location,
      deliveryAddress: params.deliveryAddress,
      deliveryCoordinates: params.deliveryCoordinates,
      packageCategory: params.packageCategory,
      packageSize: params.packageSize,
      specialHandling: params.specialHandling || 'NONE',
      roadDistanceKm: quote.roadDistanceKm,
      estimatedDuration: Math.max(8, Math.round(quote.roadDistanceKm * 3.5)),
      deliveryFee: quote.deliveryFee,
      riderEarning: quote.riderEarning,
      platformRevenue: quote.platformRevenue,
      paymentStatus: 'UNPAID',
      deliveryStatus: 'PENDING_DISPATCH',
      customerTrackingTokenHash: trackingTokenHash,
      pickupPinHash,
      deliveryPinHash,
      zoneId: DEFAULT_WESTLANDS_ZONE.zoneId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const trackingLink: TrackingLink = {
      tokenHash: trackingTokenHash,
      jobId,
      shopOwnerUid: shop.ownerUid,
      shopName: shop.shopName,
      referenceCode: job.referenceCode,
      deliveryStatus: 'PENDING_DISPATCH',
      pickupAddress: job.pickupAddress,
      pickupCoordinates: job.pickupCoordinates,
      deliveryAddress: job.deliveryAddress,
      deliveryCoordinates: job.deliveryCoordinates,
      roadDistanceKm: job.roadDistanceKm,
      estimatedDuration: job.estimatedDuration,
      active: true,
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.jobs.set(jobId, job);
    this.trackingLinks.set(trackingTokenHash, trackingLink);
    return { job, trackingToken, pickupPin, deliveryPin };
  }

  claimJobAsRider(riderUid: string, jobId: string): DeliveryJob {
    const rider = this.riders.get(riderUid);
    if (!rider || rider.approvalStatus !== 'APPROVED') {
      throw new Error('GATING_ERROR: Rider must be APPROVED to claim jobs.');
    }
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('NOT_FOUND: Delivery job does not exist.');
    if (job.riderUid) {
      throw new Error('CONFLICT: Job has already been claimed by another rider.');
    }
    if (!['PENDING_DISPATCH', 'ASSIGNED'].includes(job.deliveryStatus)) {
      throw new Error('INVALID_STATE: Job is not open for claiming.');
    }

    job.riderId = rider.riderId;
    job.riderUid = rider.uid;
    job.riderName = rider.fullName;
    job.riderPhone = rider.phoneNumber;
    job.deliveryStatus = 'ACCEPTED';
    job.assignedAt = new Date();
    job.updatedAt = new Date();

    const link = this.trackingLinks.get(job.customerTrackingTokenHash);
    if (link) {
      link.riderUid = rider.uid;
      link.riderName = rider.fullName;
      link.riderPhone = rider.phoneNumber;
      link.deliveryStatus = 'ACCEPTED';
      link.updatedAt = new Date();
    }
    return job;
  }

  dispatcherAssignRider(dispatcherUid: string, jobId: string, riderUid: string): DeliveryJob {
    this.assertDispatcherOrAdmin(dispatcherUid);
    const rider = this.riders.get(riderUid);
    if (!rider || rider.approvalStatus !== 'APPROVED') {
      throw new Error('GATING_ERROR: Cannot assign unapproved rider.');
    }
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('NOT_FOUND: Job missing.');
    if (!['PENDING_DISPATCH', 'FAILED'].includes(job.deliveryStatus)) {
      throw new Error('INVALID_STATE: Job cannot be reassigned from current status.');
    }

    job.riderId = rider.riderId;
    job.riderUid = rider.uid;
    job.riderName = rider.fullName;
    job.riderPhone = rider.phoneNumber;
    job.deliveryStatus = 'ASSIGNED';
    job.assignedAt = new Date();
    job.updatedAt = new Date();

    const link = this.trackingLinks.get(job.customerTrackingTokenHash);
    if (link) {
      link.riderUid = rider.uid;
      link.riderName = rider.fullName;
      link.riderPhone = rider.phoneNumber;
      link.deliveryStatus = 'ASSIGNED';
      link.updatedAt = new Date();
    }
    return job;
  }

  updateRiderGps(riderUid: string, location: LatLng, activeTrackingTokenHash?: string) {
    const rider = this.riders.get(riderUid);
    if (!rider || rider.approvalStatus !== 'APPROVED') {
      throw new Error('PERMISSION_DENIED: Approved rider required.');
    }
    rider.currentLocation = location;
    rider.lastLocationUpdate = new Date();
    if (activeTrackingTokenHash) {
      const link = this.trackingLinks.get(activeTrackingTokenHash);
      if (link && link.riderUid === riderUid) {
        link.riderLocation = location;
        link.updatedAt = new Date();
      }
    }
  }

  async advanceJobStatus(params: {
    actorUid: string;
    jobId: string;
    nextStatus: DeliveryStatus;
    pinInput?: string;
    pickupPhoto?: { fileName: string; mimeType: string; dataUrl: string; rawSizeBytes: number };
    reason?: string;
  }): Promise<DeliveryJob> {
    const job = this.jobs.get(params.jobId);
    if (!job) throw new Error('NOT_FOUND: Job missing.');
    if (!canTransitionJobStatus(job.deliveryStatus, params.nextStatus)) {
      throw new Error(`INVALID_TRANSITION: ${job.deliveryStatus} -> ${params.nextStatus} is forbidden.`);
    }

    const isAdmin = this.admins.has(params.actorUid);
    const isOwningRider = job.riderUid === params.actorUid;
    const isOwningMerchant = job.shopOwnerUid === params.actorUid;

    if (params.nextStatus === 'CANCELLED') {
      if (!isAdmin && !isOwningMerchant) {
        throw new Error('PERMISSION_DENIED: Only merchant or admin may cancel this job.');
      }
      if (!isAdmin && !['PENDING_DISPATCH', 'ASSIGNED', 'ACCEPTED'].includes(job.deliveryStatus)) {
        throw new Error('INVALID_STATE: Merchant cannot cancel parcel already in transit.');
      }
    } else if (!isAdmin && !isOwningRider) {
      throw new Error('PERMISSION_DENIED: Only assigned rider or admin can advance delivery.');
    }

    if (params.nextStatus === 'PICKED_UP') {
      if (!params.pinInput) throw new Error('PIN_REQUIRED: Pickup PIN required.');
      const proofHash = await sha256Hex(params.pinInput.trim());
      if (proofHash !== job.pickupPinHash) {
        throw new Error('PIN_MISMATCH: Incorrect Pickup PIN.');
      }
      job.pickupPinProofHash = proofHash;
      job.pickedUpAt = new Date();

      if (params.pickupPhoto) {
        const check = validateVerificationDocFile({
          name: params.pickupPhoto.fileName,
          type: params.pickupPhoto.mimeType,
          size: params.pickupPhoto.rawSizeBytes,
        });
        if (!check.valid) throw new Error(check.error);
        const ev: DeliveryEvidence = {
          evidenceId: 'pickup',
          jobId: job.jobId,
          shopOwnerUid: job.shopOwnerUid,
          riderUid: job.riderUid || params.actorUid,
          evidenceType: 'PICKUP_PHOTO',
          fileName: params.pickupPhoto.fileName,
          mimeType: params.pickupPhoto.mimeType,
          byteSize: estimateDataUrlByteSize(params.pickupPhoto.dataUrl),
          dataUrl: params.pickupPhoto.dataUrl,
          createdAt: new Date(),
        };
        this.evidence.set(`${job.jobId}:pickup`, ev);
        job.pickupPhotoRef = `firestore:deliveryJobs/${job.jobId}/evidence/pickup`;
      }
    }

    if (params.nextStatus === 'DELIVERED') {
      if (!params.pinInput) throw new Error('PIN_REQUIRED: Delivery PIN required.');
      const proofHash = await sha256Hex(params.pinInput.trim());
      if (proofHash !== job.deliveryPinHash) {
        throw new Error('PIN_MISMATCH: Incorrect Delivery PIN.');
      }
      job.deliveryPinProofHash = proofHash;
      job.completedAt = new Date();

      if (job.riderUid) {
        const rider = this.riders.get(job.riderUid);
        if (rider) {
          rider.totalDeliveries += 1;
          rider.totalEarnings += job.riderEarning;
        }
        // Atomic 1-to-1 settlement record keyed by jobId
        if (!this.settlements.has(job.jobId)) {
          this.settlements.set(job.jobId, {
            settlementId: job.jobId,
            riderId: job.riderId || job.riderUid,
            riderUid: job.riderUid,
            jobId: job.jobId,
            grossDeliveryFee: job.deliveryFee,
            riderEarning: job.riderEarning,
            settlementStatus: 'PENDING',
            createdAt: new Date(),
          });
        }
      }
    }

    if (params.reason) {
      job.cancellationReason = params.reason;
    }
    job.deliveryStatus = params.nextStatus;
    job.updatedAt = new Date();

    const link = this.trackingLinks.get(job.customerTrackingTokenHash);
    if (link) {
      link.deliveryStatus = params.nextStatus;
      if (TERMINAL_DELIVERY_STATUSES.includes(params.nextStatus)) {
        link.active = false;
      }
      link.updatedAt = new Date();
    }

    return job;
  }

  initiateMpesaPayment(params: {
    merchantUid: string;
    jobId: string;
    phoneNumber: string;
    darajaConfigured: boolean;
  }): PaymentRecord {
    const job = this.jobs.get(params.jobId);
    if (!job || job.shopOwnerUid !== params.merchantUid) {
      throw new Error('PERMISSION_DENIED: Only owning shop can initiate payment.');
    }
    if (!isValidKenyanPhone(params.phoneNumber)) {
      throw new Error('VALIDATION_ERROR: Invalid M-Pesa phone number.');
    }

    const paymentId = `pay_${this.payments.size + 1}_${job.jobId}`;
    const checkoutRequestId = params.darajaConfigured ? `ws_CO_${Date.now()}_${this.payments.size + 1}` : undefined;
    const status = params.darajaConfigured ? 'PENDING_STK' : 'AWAITING_CONFIG';

    const payment: PaymentRecord = {
      paymentId,
      jobId: job.jobId,
      shopId: job.shopId,
      shopOwnerUid: job.shopOwnerUid,
      amount: job.deliveryFee,
      provider: 'MPESA_DARAJA_SANDBOX',
      phoneNumber: formatKenyanPhone(params.phoneNumber),
      checkoutRequestId,
      paymentStatus: status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.payments.set(paymentId, payment);
    if (params.darajaConfigured) {
      job.paymentStatus = 'PENDING_STK';
    }
    return payment;
  }

  processDarajaCallback(payload: {
    CheckoutRequestID: string;
    ResultCode: number;
    ResultDesc: string;
    MpesaReceiptNumber?: string;
  }): { idempotentDuplicate: boolean; paymentStatus: PaymentRecord['paymentStatus'] } {
    if (this.processedCallbacks.has(payload.CheckoutRequestID)) {
      const existing = Array.from(this.payments.values()).find(
        (p) => p.checkoutRequestId === payload.CheckoutRequestID
      );
      return { idempotentDuplicate: true, paymentStatus: existing?.paymentStatus || 'PAID' };
    }

    const payment = Array.from(this.payments.values()).find(
      (p) => p.checkoutRequestId === payload.CheckoutRequestID
    );
    if (!payment) throw new Error('NOT_FOUND: Unknown CheckoutRequestID.');

    this.processedCallbacks.add(payload.CheckoutRequestID);
    const nextStatus =
      payload.ResultCode === 0 ? 'PAID' : payload.ResultCode === 1037 ? 'TIMEOUT' : 'FAILED';

    payment.paymentStatus = nextStatus;
    payment.updatedAt = new Date();
    if (nextStatus === 'PAID') {
      payment.mpesaReceiptNumber = payload.MpesaReceiptNumber;
      payment.paidAt = new Date();
    } else {
      payment.failureReason = payload.ResultDesc;
    }

    const job = this.jobs.get(payment.jobId);
    if (job) {
      job.paymentStatus = nextStatus === 'PAID' ? 'PAID' : 'FAILED';
      job.updatedAt = new Date();
    }
    return { idempotentDuplicate: false, paymentStatus: nextStatus };
  }

  adminSettlePayout(adminUid: string, settlementId: string, payoutReference: string): RiderSettlement {
    this.assertAdmin(adminUid);
    const settlement = this.settlements.get(settlementId);
    if (!settlement) throw new Error('NOT_FOUND: Settlement record missing.');
    if (settlement.settlementStatus === 'SETTLED') {
      throw new Error('IDEMPOTENCY_GUARD: Settlement already marked SETTLED.');
    }
    settlement.settlementStatus = 'SETTLED';
    settlement.payoutReference = payoutReference;
    settlement.settledAt = new Date();
    return settlement;
  }

  createSupportTicket(params: {
    actorUid: string;
    issueType: string;
    description: string;
    jobId?: string;
  }): SupportTicket {
    const user = this.users.get(params.actorUid);
    if (!user) throw new Error('AUTH_ERROR: Unknown user.');
    const ticketId = `ticket_${this.tickets.size + 1}`;
    const ticket: SupportTicket = {
      ticketId,
      createdBy: params.actorUid,
      creatorRole: user.role,
      jobId: params.jobId,
      issueType: params.issueType,
      description: params.description,
      status: 'OPEN',
      createdAt: new Date(),
    };
    this.tickets.set(ticketId, ticket);
    return ticket;
  }

  resolveSupportTicket(adminUid: string, ticketId: string, resolutionNotes: string): SupportTicket {
    this.assertDispatcherOrAdmin(adminUid);
    const ticket = this.tickets.get(ticketId);
    if (!ticket) throw new Error('NOT_FOUND: Ticket missing.');
    ticket.status = 'RESOLVED';
    ticket.resolutionNotes = resolutionNotes;
    ticket.resolvedAt = new Date();
    return ticket;
  }
}

const SAMPLE_IMAGE_DATA_URL =
  'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes-for-test-verification-doc').toString('base64');

describe('FikaBoda End-to-End Lifecycle Simulation', () => {
  it('runs complete lifecycle: registration -> doc storage & admin review -> order -> PIN delivery -> Daraja -> settlement', async () => {
    const sim = new FikaBodaWorkflowSimulator();
    sim.bootstrapSuperAdmin('admin_1', 'gmannu2055@gmail.com', 'Emmanuel SuperAdmin');

    // 1. Security guard: block privilege self-escalation
    expect(() =>
      sim.registerUser({
        uid: 'attacker_1',
        fullName: 'Malicious User',
        email: 'evil@test.ke',
        phoneNumber: '0711000111',
        requestedRole: 'ADMIN',
      })
    ).toThrow(/PERMISSION_DENIED/);

    // 2. Register Merchant & Rider
    const merchantUser = sim.registerUser({
      uid: 'merchant_1',
      fullName: 'Amina Wanjiku',
      email: 'amina@westlandsbakes.co.ke',
      phoneNumber: '0712345678',
      requestedRole: 'MERCHANT',
    });
    expect(merchantUser.accountStatus).toBe('PENDING');
    expect(merchantUser.phoneNumber).toBe('254712345678');

    const riderUser = sim.registerUser({
      uid: 'rider_1',
      fullName: 'Brian Kiprop',
      email: 'brian@riders.co.ke',
      phoneNumber: '+254 722 334 455',
      requestedRole: 'RIDER',
    });
    expect(riderUser.accountStatus).toBe('PENDING');
    expect(riderUser.phoneNumber).toBe('254722334455');

    // 3. Submit Shop Application (outside zone rejected, Westlands accepted)
    expect(() =>
      sim.submitShopApplication({
        ownerUid: 'merchant_1',
        shopName: 'Mombasa Coastal Bakery',
        businessCategory: 'Bakery & Cakes',
        contactPerson: 'Amina Wanjiku',
        phoneNumber: '0712345678',
        email: 'amina@westlandsbakes.co.ke',
        physicalAddress: 'Nyali Bridge',
        location: { lat: -4.0435, lng: 39.6682 },
        operatingHours: '08:00 - 18:00',
      })
    ).toThrow(/ZONE_ERROR/);

    const shop = sim.submitShopApplication({
      ownerUid: 'merchant_1',
      shopName: 'Westlands Artisan Bakery',
      businessCategory: 'Bakery & Cakes',
      contactPerson: 'Amina Wanjiku',
      phoneNumber: '0712345678',
      email: 'amina@westlandsbakes.co.ke',
      physicalAddress: 'Sarit Centre Ground Floor, Westlands',
      location: { lat: -1.2611, lng: 36.8019 },
      operatingHours: '07:30 - 20:00',
    });
    expect(shop.status).toBe('PENDING_APPROVAL');

    // 4. Rider uploads National ID, Driving Licence & PSV Insurance Docs
    expect(() =>
      sim.submitRiderApplication({
        uid: 'rider_1',
        fullName: 'Brian Kiprop',
        phoneNumber: '0722334455',
        email: 'brian@riders.co.ke',
        nationalIdReference: '34129876',
        drivingLicenceRef: 'DL-NTSA-88921',
        motorcycleRegistration: 'KMFE 412A',
        insuranceDetails: 'Jubilee PSV #99210',
        emergencyContact: '0733111222',
      })
    ).toThrow(/Missing uploaded verification document/);

    // Reject oversized PDF & unsupported EXE
    expect(() =>
      sim.uploadVerificationDoc({
        actorUid: 'rider_1',
        riderId: 'rider_1',
        docKey: 'nationalId',
        fileName: 'huge.pdf',
        mimeType: 'application/pdf',
        dataUrl: SAMPLE_IMAGE_DATA_URL,
        rawSizeBytes: MAX_STORED_DOC_BYTES + 10_000,
      })
    ).toThrow(/DOC_VALIDATION_ERROR/);

    for (const [docKey, fileName] of [
      ['nationalId', 'national_id.jpg'],
      ['drivingLicence', 'ntsa_licence.png'],
      ['insurance', 'psv_cover.pdf'],
    ] as Array<[VerificationDocKey, string]>) {
      const mimeType = fileName.endsWith('.pdf')
        ? 'application/pdf'
        : fileName.endsWith('.png')
          ? 'image/png'
          : 'image/jpeg';
      const uploaded = sim.uploadVerificationDoc({
        actorUid: 'rider_1',
        riderId: 'rider_1',
        docKey,
        fileName,
        mimeType,
        dataUrl: SAMPLE_IMAGE_DATA_URL,
        rawSizeBytes: 180_000,
      });
      expect(uploaded.verificationStatus).toBe('PENDING');
      expect(uploaded.byteSize).toBeLessThanOrEqual(MAX_STORED_DOC_BYTES);
    }

    const rider = sim.submitRiderApplication({
      uid: 'rider_1',
      fullName: 'Brian Kiprop',
      phoneNumber: '0722334455',
      email: 'brian@riders.co.ke',
      nationalIdReference: '34129876',
      drivingLicenceRef: 'DL-NTSA-88921',
      motorcycleRegistration: 'kmfe 412a',
      insuranceDetails: 'Jubilee PSV #99210',
      emergencyContact: '0733111222',
    });
    expect(rider.motorcycleRegistration).toBe('KMFE 412A');
    expect(rider.approvalStatus).toBe('PENDING');

    // 5. Gating check: unapproved shop cannot dispatch
    await expect(
      sim.createDeliveryOrder({
        merchantUid: 'merchant_1',
        shopId: shop.shopId,
        customerName: 'Grace Njeri',
        customerPhone: '0711222333',
        deliveryAddress: 'Kilimani, Yaya Centre',
        deliveryCoordinates: { lat: -1.2921, lng: 36.7886 },
        packageCategory: 'Bakery',
        packageSize: 'MEDIUM',
        roadDistanceKm: 4.8,
      })
    ).rejects.toThrow(/GATING_ERROR/);

    // 6. Admin inspects docs, rejects blurry insurance -> rider re-uploads -> admin approves all
    expect(() => sim.getRiderDocsForAdmin('merchant_1', 'rider_1')).toThrow(/PERMISSION_DENIED/);
    const adminDocs = sim.getRiderDocsForAdmin('admin_1', 'rider_1');
    expect(adminDocs).toHaveLength(3);
    expect(adminDocs.every((d) => Boolean(d.dataUrl))).toBe(true);

    const rejectedInsurance = sim.adminReviewRiderDoc({
      adminUid: 'admin_1',
      riderId: 'rider_1',
      docKey: 'insurance',
      status: 'REJECTED',
      reviewNotes: 'Sticker expiry date cropped',
    });
    expect(rejectedInsurance.verificationStatus).toBe('REJECTED');
    expect(sim.riders.get('rider_1')?.insuranceVerificationStatus).toBe('REJECTED');

    // Rider re-uploads clearer insurance doc -> resets status to PENDING & removes reviewNotes
    const reuploadedInsurance = sim.uploadVerificationDoc({
      actorUid: 'rider_1',
      riderId: 'rider_1',
      docKey: 'insurance',
      fileName: 'psv_cover_clear.jpg',
      mimeType: 'image/jpeg',
      dataUrl: SAMPLE_IMAGE_DATA_URL,
      rawSizeBytes: 220_000,
    });
    expect(reuploadedInsurance.verificationStatus).toBe('PENDING');
    expect(reuploadedInsurance.reviewNotes).toBeUndefined();

    // Admin verifies docs and approves both Rider & Shop
    sim.adminUpdateRiderApproval({
      adminUid: 'admin_1',
      riderId: 'rider_1',
      approvalStatus: 'APPROVED',
      licenceVerificationStatus: 'VERIFIED',
      insuranceVerificationStatus: 'VERIFIED',
    });
    sim.adminUpdateShopStatus({
      adminUid: 'admin_1',
      shopId: shop.shopId,
      status: 'ACTIVE',
      verificationStatus: 'VERIFIED',
    });
    expect(sim.users.get('rider_1')?.accountStatus).toBe('ACTIVE');
    expect(sim.users.get('merchant_1')?.accountStatus).toBe('ACTIVE');
    expect(
      sim.getRiderDocsForAdmin('admin_1', 'rider_1').every((d) => d.verificationStatus === 'VERIFIED')
    ).toBe(true);

    // 7. Merchant creates a live delivery order + TrackingLink + PINs
    const { job, trackingToken, pickupPin, deliveryPin } = await sim.createDeliveryOrder({
      merchantUid: 'merchant_1',
      shopId: shop.shopId,
      customerName: 'Grace Njeri',
      customerPhone: '0711222333',
      deliveryAddress: 'Yaya Centre, Kilimani',
      deliveryCoordinates: { lat: -1.2921, lng: 36.7886 },
      packageCategory: 'Fragile Cake Box',
      packageSize: 'MEDIUM',
      specialHandling: 'FRAGILE',
      roadDistanceKm: 4.8,
    });
    expect(job.referenceCode).toMatch(/^FB-[A-Z0-9]{6}$/);
    expect(job.riderEarning + job.platformRevenue).toBe(job.deliveryFee);

    const trackingLink = sim.trackingLinks.get(job.customerTrackingTokenHash)!;
    expect(trackingLink).toBeDefined();
    expect(trackingLink.active).toBe(true);
    expect(trackingToken).toHaveLength(48);
    // Ensure customer PII is isolated from public TrackingLink projection
    expect((trackingLink as unknown as Record<string, unknown>).customerName).toBeUndefined();
    expect((trackingLink as unknown as Record<string, unknown>).customerPhone).toBeUndefined();

    // 8. Rider claims job + second rider concurrent claim blocked
    sim.registerUser({
      uid: 'rider_2',
      fullName: 'Dennis Mwangi',
      email: 'dennis@riders.co.ke',
      phoneNumber: '0744555666',
      requestedRole: 'RIDER',
    });
    for (const k of ['nationalId', 'drivingLicence', 'insurance'] as VerificationDocKey[]) {
      sim.uploadVerificationDoc({
        actorUid: 'rider_2',
        riderId: 'rider_2',
        docKey: k,
        fileName: `${k}.jpg`,
        mimeType: 'image/jpeg',
        dataUrl: SAMPLE_IMAGE_DATA_URL,
        rawSizeBytes: 100_000,
      });
    }
    sim.submitRiderApplication({
      uid: 'rider_2',
      fullName: 'Dennis Mwangi',
      phoneNumber: '0744555666',
      email: 'dennis@riders.co.ke',
      nationalIdReference: '99123456',
      drivingLicenceRef: 'DL-2',
      motorcycleRegistration: 'KMFZ 999Z',
      insuranceDetails: 'APA PSV #123',
      emergencyContact: '0700111222',
    });
    sim.adminUpdateRiderApproval({
      adminUid: 'admin_1',
      riderId: 'rider_2',
      approvalStatus: 'APPROVED',
      licenceVerificationStatus: 'VERIFIED',
      insuranceVerificationStatus: 'VERIFIED',
    });

    sim.claimJobAsRider('rider_1', job.jobId);
    expect(() => sim.claimJobAsRider('rider_2', job.jobId)).toThrow(/CONFLICT/);

    // 9. Delivery progression with PIN checks, Pickup Photo Evidence & GPS updates
    await sim.advanceJobStatus({
      actorUid: 'rider_1',
      jobId: job.jobId,
      nextStatus: 'ARRIVED_AT_PICKUP',
    });

    // Wrong Pickup PIN rejected
    await expect(
      sim.advanceJobStatus({
        actorUid: 'rider_1',
        jobId: job.jobId,
        nextStatus: 'PICKED_UP',
        pinInput: '0000',
      })
    ).rejects.toThrow(/PIN_MISMATCH/);

    // Valid Pickup PIN + photo evidence accepted
    await sim.advanceJobStatus({
      actorUid: 'rider_1',
      jobId: job.jobId,
      nextStatus: 'PICKED_UP',
      pinInput: pickupPin,
      pickupPhoto: {
        fileName: 'parcel_sealed.jpg',
        mimeType: 'image/jpeg',
        dataUrl: SAMPLE_IMAGE_DATA_URL,
        rawSizeBytes: 95_000,
      },
    });
    expect(sim.evidence.get(`${job.jobId}:pickup`)?.evidenceType).toBe('PICKUP_PHOTO');

    await sim.advanceJobStatus({
      actorUid: 'rider_1',
      jobId: job.jobId,
      nextStatus: 'IN_TRANSIT',
    });
    sim.updateRiderGps('rider_1', { lat: -1.278, lng: 36.798 }, job.customerTrackingTokenHash);
    expect(sim.trackingLinks.get(job.customerTrackingTokenHash)?.riderLocation).toEqual({
      lat: -1.278,
      lng: 36.798,
    });

    await sim.advanceJobStatus({
      actorUid: 'rider_1',
      jobId: job.jobId,
      nextStatus: 'ARRIVED_AT_DESTINATION',
    });

    // Wrong Delivery PIN rejected
    await expect(
      sim.advanceJobStatus({
        actorUid: 'rider_1',
        jobId: job.jobId,
        nextStatus: 'DELIVERED',
        pinInput: '0000',
      })
    ).rejects.toThrow(/PIN_MISMATCH/);

    // Valid Delivery PIN completes job, deactivates tracking link & creates 1-to-1 settlement
    await sim.advanceJobStatus({
      actorUid: 'rider_1',
      jobId: job.jobId,
      nextStatus: 'DELIVERED',
      pinInput: deliveryPin,
    });
    expect(job.deliveryStatus).toBe('DELIVERED');
    expect(sim.trackingLinks.get(job.customerTrackingTokenHash)?.active).toBe(false);
    expect(sim.riders.get('rider_1')?.totalDeliveries).toBe(1);
    expect(sim.riders.get('rider_1')?.totalEarnings).toBe(job.riderEarning);

    const settlement = sim.settlements.get(job.jobId)!;
    expect(settlement).toBeDefined();
    expect(settlement.settlementStatus).toBe('PENDING');
    expect(settlement.riderEarning).toBe(job.riderEarning);

    // 10. M-Pesa Daraja payment: honest unconfigured vs configured STK + callback idempotency
    const unconfiguredPay = sim.initiateMpesaPayment({
      merchantUid: 'merchant_1',
      jobId: job.jobId,
      phoneNumber: '0712345678',
      darajaConfigured: false,
    });
    expect(unconfiguredPay.paymentStatus).toBe('AWAITING_CONFIG');

    const stkPay = sim.initiateMpesaPayment({
      merchantUid: 'merchant_1',
      jobId: job.jobId,
      phoneNumber: '0712345678',
      darajaConfigured: true,
    });
    expect(stkPay.paymentStatus).toBe('PENDING_STK');
    expect(job.paymentStatus).toBe('PENDING_STK');

    const firstCb = sim.processDarajaCallback({
      CheckoutRequestID: stkPay.checkoutRequestId!,
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      MpesaReceiptNumber: 'UAB9X71KLP',
    });
    expect(firstCb.idempotentDuplicate).toBe(false);
    expect(firstCb.paymentStatus).toBe('PAID');
    expect(stkPay.mpesaReceiptNumber).toBe('UAB9X71KLP');
    expect(job.paymentStatus).toBe('PAID');

    const dupCb = sim.processDarajaCallback({
      CheckoutRequestID: stkPay.checkoutRequestId!,
      ResultCode: 0,
      ResultDesc: 'Duplicate retry',
      MpesaReceiptNumber: 'SHOULD_NOT_OVERWRITE',
    });
    expect(dupCb.idempotentDuplicate).toBe(true);
    expect(stkPay.mpesaReceiptNumber).toBe('UAB9X71KLP');

    // 11. Admin settles rider payout & prevents double settlement
    const settled = sim.adminSettlePayout('admin_1', settlement.settlementId, 'B2C-MPESA-88412');
    expect(settled.settlementStatus).toBe('SETTLED');
    expect(settled.payoutReference).toBe('B2C-MPESA-88412');
    expect(() => sim.adminSettlePayout('admin_1', settlement.settlementId, 'DUP')).toThrow(
      /IDEMPOTENCY_GUARD/
    );

    // 12. Support ticket lifecycle
    const ticket = sim.createSupportTicket({
      actorUid: 'rider_1',
      jobId: job.jobId,
      issueType: 'Recipient Wait Time',
      description: 'Customer requested 10 min wait at Kilimani gate.',
    });
    expect(ticket.status).toBe('OPEN');
    const resolved = sim.resolveSupportTicket('admin_1', ticket.ticketId, 'Logged and approved.');
    expect(resolved.status).toBe('RESOLVED');
  });

  it('handles dispatcher assignment, cancellation, return-to-shop, and STK timeout paths', async () => {
    const sim = new FikaBodaWorkflowSimulator();
    sim.bootstrapSuperAdmin('admin_1', 'gmannu2055@gmail.com', 'Admin');

    sim.registerUser({
      uid: 'm2',
      fullName: 'Kipchoge Coffee',
      email: 'coffee@westlands.ke',
      phoneNumber: '0711111111',
      requestedRole: 'MERCHANT',
    });
    const shop = sim.submitShopApplication({
      ownerUid: 'm2',
      shopName: 'Kipchoge Coffee Roasters',
      businessCategory: 'Food & Coffee',
      contactPerson: 'Kipchoge',
      phoneNumber: '0711111111',
      email: 'coffee@westlands.ke',
      physicalAddress: 'Westgate Mall',
      location: { lat: -1.2572, lng: 36.8035 },
      operatingHours: '07:00 - 19:00',
    });
    sim.adminUpdateShopStatus({
      adminUid: 'admin_1',
      shopId: shop.shopId,
      status: 'ACTIVE',
      verificationStatus: 'VERIFIED',
    });

    sim.registerUser({
      uid: 'r2',
      fullName: 'Wycliffe Otieno',
      email: 'wycliffe@riders.ke',
      phoneNumber: '0722222222',
      requestedRole: 'RIDER',
    });
    for (const k of ['nationalId', 'drivingLicence', 'insurance'] as VerificationDocKey[]) {
      sim.uploadVerificationDoc({
        actorUid: 'r2',
        riderId: 'r2',
        docKey: k,
        fileName: `${k}.jpg`,
        mimeType: 'image/jpeg',
        dataUrl: SAMPLE_IMAGE_DATA_URL,
        rawSizeBytes: 50_000,
      });
    }
    sim.submitRiderApplication({
      uid: 'r2',
      fullName: 'Wycliffe Otieno',
      phoneNumber: '0722222222',
      email: 'wycliffe@riders.ke',
      nationalIdReference: '12345678',
      drivingLicenceRef: 'DL-99',
      motorcycleRegistration: 'KMEA 001B',
      insuranceDetails: 'PSV #11',
      emergencyContact: '0700999888',
    });
    sim.adminUpdateRiderApproval({
      adminUid: 'admin_1',
      riderId: 'r2',
      approvalStatus: 'APPROVED',
      licenceVerificationStatus: 'VERIFIED',
      insuranceVerificationStatus: 'VERIFIED',
    });

    // Dispatcher assign + Return-to-shop flow
    const order1 = await sim.createDeliveryOrder({
      merchantUid: 'm2',
      shopId: shop.shopId,
      customerName: 'Mercy Achieng',
      customerPhone: '0799888777',
      deliveryAddress: 'Lavington Green',
      deliveryCoordinates: { lat: -1.2804, lng: 36.7745 },
      packageCategory: 'Hot Coffee',
      packageSize: 'SMALL',
      roadDistanceKm: 4.2,
    });
    sim.dispatcherAssignRider('admin_1', order1.job.jobId, 'r2');
    expect(order1.job.deliveryStatus).toBe('ASSIGNED');

    await sim.advanceJobStatus({ actorUid: 'r2', jobId: order1.job.jobId, nextStatus: 'ACCEPTED' });
    await sim.advanceJobStatus({
      actorUid: 'r2',
      jobId: order1.job.jobId,
      nextStatus: 'ARRIVED_AT_PICKUP',
    });
    await sim.advanceJobStatus({
      actorUid: 'r2',
      jobId: order1.job.jobId,
      nextStatus: 'PICKED_UP',
      pinInput: order1.pickupPin,
    });
    await sim.advanceJobStatus({
      actorUid: 'r2',
      jobId: order1.job.jobId,
      nextStatus: 'RETURN_REQUIRED',
      reason: 'Customer unreachable after 3 calls',
    });
    await sim.advanceJobStatus({ actorUid: 'r2', jobId: order1.job.jobId, nextStatus: 'RETURNED' });
    expect(order1.job.deliveryStatus).toBe('RETURNED');
    expect(sim.trackingLinks.get(order1.job.customerTrackingTokenHash)?.active).toBe(false);

    // Merchant cancel + STK Timeout flow
    const order2 = await sim.createDeliveryOrder({
      merchantUid: 'm2',
      shopId: shop.shopId,
      customerName: 'Sam Ouma',
      customerPhone: '0733444555',
      deliveryAddress: 'Riverside Drive',
      deliveryCoordinates: { lat: -1.271, lng: 36.801 },
      packageCategory: 'Merchandise',
      packageSize: 'LARGE',
      roadDistanceKm: 2.5,
    });
    const payTimeout = sim.initiateMpesaPayment({
      merchantUid: 'm2',
      jobId: order2.job.jobId,
      phoneNumber: '0733444555',
      darajaConfigured: true,
    });
    const cbTimeout = sim.processDarajaCallback({
      CheckoutRequestID: payTimeout.checkoutRequestId!,
      ResultCode: 1037,
      ResultDesc: 'DS timeout user cannot be reached',
    });
    expect(cbTimeout.paymentStatus).toBe('TIMEOUT');

    await sim.advanceJobStatus({
      actorUid: 'm2',
      jobId: order2.job.jobId,
      nextStatus: 'CANCELLED',
      reason: 'Customer cancelled order',
    });
    expect(order2.job.deliveryStatus).toBe('CANCELLED');
    expect(sim.trackingLinks.get(order2.job.customerTrackingTokenHash)?.active).toBe(false);
  });
});

describe('Document Validation, Firestore Rules & PWA Readiness Checks', () => {
  it('validates allowed/disallowed file types and size caps', () => {
    expect(
      validateVerificationDocFile({ name: 'id.jpg', type: 'image/jpeg', size: 120_000 }).valid
    ).toBe(true);
    expect(
      validateVerificationDocFile({ name: 'licence.pdf', type: 'application/pdf', size: 500_000 }).valid
    ).toBe(true);
    expect(
      validateVerificationDocFile({
        name: 'too_big.jpg',
        type: 'image/jpeg',
        size: MAX_RAW_UPLOAD_BYTES + 1,
      }).valid
    ).toBe(false);
    expect(
      validateVerificationDocFile({ name: 'malware.exe', type: 'application/x-msdownload', size: 1024 }).valid
    ).toBe(false);
  });

  it('includes hardened rules for rider verificationDocs, delivery evidence, and transactional null reads', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rules).toContain('match /verificationDocs/{docKey}');
    expect(rules).toContain("docKey in ['nationalId', 'drivingLicence', 'insurance']");
    expect(rules).toContain('data.byteSize > 0 && data.byteSize <= 700000');
    expect(rules).toContain('!incoming().keys().hasAny([\'reviewedBy\', \'reviewNotes\'])');
    expect(rules).toContain('match /evidence/{evidenceId}');
    expect(rules).toContain('match /riderSettlements/{settlementId}');
    expect(rules).toContain('get(/databases/$(database)/documents/deliveryJobs/$(settlementId)).data.riderUid == request.auth.uid');
    expect(rules).toContain('(isSignedIn() && resource == null)');
  });

  it('configures PWA autoUpdate, Service Worker registration, and PullToRefresh', () => {
    const viteCfg = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    const mainTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/main.tsx'), 'utf8');
    const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');

    expect(viteCfg).toContain('VitePWA(');
    expect(viteCfg).toContain("registerType: 'autoUpdate'");
    expect(viteCfg).toContain('skipWaiting: true');
    expect(viteCfg).toContain('clientsClaim: true');
    expect(mainTsx).toContain("from 'virtual:pwa-register'");
    expect(mainTsx).toContain('fikaboda-sw-need-refresh');
    expect(indexHtml).toContain('apple-touch-icon.png');
    expect(indexHtml).toContain('viewport-fit=cover');
  });
});
