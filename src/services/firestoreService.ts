import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type { User } from 'firebase/auth';
import { db, storage } from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errors';
import type {
  ActivityLog,
  AdminRoleRecord,
  AppNotification,
  DeliveryEvidence,
  DeliveryJob,
  DeliveryStatus,
  JobEvent,
  LatLng,
  PackageSize,
  PaymentRecord,
  PaymentStatus,
  PricingRule,
  Rider,
  RiderAvailabilityStatus,
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
import {
  generateFourDigitPin,
  generateJobReference,
  generateSecureToken,
  sha256Hex,
} from '../utils/crypto';
import { prepareVerificationDocPayload } from '../utils/fileDocs';
import { DEFAULT_PRICING_RULES, DEFAULT_WESTLANDS_ZONE } from '../utils/pricing';
import { canTransitionJobStatus } from '../utils/statusMachine';

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeLatLng(loc?: LatLng | null): LatLng | undefined {
  if (!loc || typeof loc !== 'object') return undefined;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return undefined;
  }
  return { lat, lng };
}

// ==================================================
// Auth Profile & Role Bootstrap
// ==================================================

interface PendingAuthSeed {
  role: 'MERCHANT' | 'RIDER';
  fullName?: string;
  phoneNumber?: string;
}

let pendingAuthSeed: PendingAuthSeed | null = null;
const inFlightUserProfilePromises = new Map<string, Promise<UserProfile>>();

export function setPendingAuthSeed(seed: PendingAuthSeed | null) {
  pendingAuthSeed = seed;
}

function sanitizeFullName(raw: string | null | undefined, email: string | null | undefined): string {
  const candidate = (raw || email?.split('@')[0] || 'FikaBoda User').trim();
  if (candidate.length >= 2) return candidate.slice(0, 120);
  return 'FikaBoda User';
}

export async function ensureUserProfile(
  user: User,
  preferredRole: 'MERCHANT' | 'RIDER' = 'MERCHANT',
  fullNameOverride?: string,
  phoneOverride?: string
): Promise<UserProfile> {
  const existingInFlight = inFlightUserProfilePromises.get(user.uid);
  if (existingInFlight) {
    return existingInFlight;
  }

  const run = (async (): Promise<UserProfile> => {
    const userRef = doc(db, 'users', user.uid);
    const isBootstrappedSuperAdmin =
      user.email === 'gmannu2055@gmail.com' && user.emailVerified;

    const effectiveRole = pendingAuthSeed?.role || preferredRole;
    const effectiveFullName = sanitizeFullName(
      fullNameOverride || pendingAuthSeed?.fullName || user.displayName,
      user.email
    );
    const effectivePhone = (
      phoneOverride ||
      pendingAuthSeed?.phoneNumber ||
      user.phoneNumber ||
      ''
    )
      .trim()
      .slice(0, 24);

    try {
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists()) {
          const profile: UserProfile = {
            uid: user.uid,
            fullName: effectiveFullName,
            email: (user.email || '').slice(0, 200),
            phoneNumber: effectivePhone,
            role: isBootstrappedSuperAdmin ? 'SUPER_ADMIN' : effectiveRole,
            accountStatus: isBootstrappedSuperAdmin ? 'ACTIVE' : 'PENDING',
            ...(user.photoURL ? { profilePhoto: user.photoURL.slice(0, 512) } : {}),
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp(),
          };
          tx.set(userRef, profile);
          return profile;
        }

        const existingData = snap.data() as UserProfile;
        const updates: Record<string, any> = {
          lastLogin: serverTimestamp(),
        };
        if (effectivePhone && !existingData.phoneNumber) {
          updates.phoneNumber = effectivePhone;
        }
        if (fullNameOverride && fullNameOverride.trim().length >= 2) {
          updates.fullName = fullNameOverride.trim().slice(0, 120);
        }
        tx.update(userRef, updates);
        return existingData;
      });

      pendingAuthSeed = null;

      if (isBootstrappedSuperAdmin) {
        const adminRef = doc(db, 'admins', user.uid);
        const adminSnap = await getDoc(adminRef);
        if (!adminSnap.exists()) {
          await setDoc(adminRef, {
            uid: user.uid,
            email: user.email || '',
            role: 'SUPER_ADMIN',
            assignedBy: user.uid,
            active: true,
            createdAt: serverTimestamp(),
          });
        }
      }

      const freshSnap = await getDoc(userRef);
      return freshSnap.exists() ? (freshSnap.data() as UserProfile) : result;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
    }
  })();

  inFlightUserProfilePromises.set(user.uid, run);
  try {
    return await run;
  } finally {
    inFlightUserProfilePromises.delete(user.uid);
  }
}

export async function updateUserFcmToken(uid: string, fcmToken: string) {
  try {
    await updateDoc(doc(db, 'users', uid), {
      fcmToken: fcmToken.slice(0, 512),
      lastLogin: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export function subscribeToUserProfile(
  uid: string,
  cb: (profile: UserProfile | null) => void
): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => cb(snap.exists() ? (snap.data() as UserProfile) : null),
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );
}

export function subscribeToAllUsers(cb: (users: UserProfile[]) => void): Unsubscribe {
  const path = 'users';
  const q = query(collection(db, path), orderBy('createdAt', 'desc'), limit(200));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as UserProfile)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeToAdmins(cb: (admins: AdminRoleRecord[]) => void): Unsubscribe {
  const path = 'admins';
  const q = query(collection(db, path), limit(50));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as AdminRoleRecord)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

// ==================================================
// Seeding Westlands Defaults (Admin Action)
// ==================================================

export async function seedWestlandsDefaults(): Promise<void> {
  try {
    const batch = writeBatch(db);
    const zoneRef = doc(db, 'serviceZones', DEFAULT_WESTLANDS_ZONE.zoneId);
    const zoneSnap = await getDoc(zoneRef);
    if (!zoneSnap.exists()) {
      batch.set(zoneRef, {
        ...DEFAULT_WESTLANDS_ZONE,
        createdAt: serverTimestamp(),
      });
    }

    for (const rule of DEFAULT_PRICING_RULES) {
      const ruleRef = doc(db, 'pricingRules', rule.ruleId);
      const ruleSnap = await getDoc(ruleRef);
      if (!ruleSnap.exists()) {
        batch.set(ruleRef, {
          ...rule,
          updatedAt: serverTimestamp(),
        });
      }
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'serviceZones/pricingRules');
  }
}

// ==================================================
// Shops (Merchant Onboarding & Management)
// ==================================================

export function subscribeToShopByOwner(
  ownerUid: string,
  cb: (shop: Shop | null) => void
): Unsubscribe {
  const path = 'shops';
  const q = query(collection(db, path), where('ownerUid', '==', ownerUid), limit(1));
  return onSnapshot(
    q,
    (snap) => cb(snap.empty ? null : (snap.docs[0].data() as Shop)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeToAllShops(cb: (shops: Shop[]) => void): Unsubscribe {
  const path = 'shops';
  const q = query(collection(db, path), orderBy('createdAt', 'desc'), limit(200));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as Shop)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function createShopApplication(params: {
  ownerUid: string;
  shopName: string;
  businessCategory: string;
  contactPerson: string;
  phoneNumber: string;
  email: string;
  physicalAddress: string;
  location: LatLng;
  operatingHours: string;
}): Promise<string> {
  const shopId = `shop_${params.ownerUid}`;
  const path = `shops/${shopId}`;
  try {
    await setDoc(doc(db, 'shops', shopId), {
      shopId,
      ownerUid: params.ownerUid,
      shopName: params.shopName.trim().slice(0, 120),
      businessCategory: params.businessCategory.trim().slice(0, 80),
      contactPerson: params.contactPerson.trim().slice(0, 120),
      phoneNumber: params.phoneNumber.trim().slice(0, 24),
      email: params.email.trim().slice(0, 200),
      physicalAddress: params.physicalAddress.trim().slice(0, 240),
      location: { lat: params.location.lat, lng: params.location.lng },
      operatingHours: params.operatingHours.trim().slice(0, 120),
      verificationStatus: 'PENDING',
      status: 'PENDING_APPROVAL',
      zoneId: DEFAULT_WESTLANDS_ZONE.zoneId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await createActivityLog(
      params.ownerUid,
      'MERCHANT_APPLICATION_SUBMITTED',
      'shop',
      shopId,
      `Submitted shop application for ${params.shopName}`
    );
    return shopId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateShopProfileByMerchant(
  shopId: string,
  updates: Partial<
    Pick<
      Shop,
      | 'shopName'
      | 'businessCategory'
      | 'contactPerson'
      | 'phoneNumber'
      | 'physicalAddress'
      | 'location'
      | 'operatingHours'
    >
  >
) {
  const path = `shops/${shopId}`;
  try {
    await updateDoc(doc(db, 'shops', shopId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminUpdateShopStatus(
  adminUid: string,
  shop: Shop,
  status: 'ACTIVE' | 'SUSPENDED',
  verificationStatus: 'VERIFIED' | 'REJECTED' | 'PENDING'
) {
  const path = `shops/${shop.shopId}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'shops', shop.shopId), {
      status,
      verificationStatus,
      updatedAt: serverTimestamp(),
    });
    const userRef = doc(db, 'users', shop.ownerUid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      batch.update(userRef, {
        accountStatus: status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED',
        lastLogin: serverTimestamp(),
      });
    }
    const notifId = newId('notif');
    batch.set(doc(db, 'notifications', notifId), {
      notificationId: notifId,
      recipientUid: shop.ownerUid,
      title: status === 'ACTIVE' ? 'Shop Approved on FikaBoda' : 'Shop Account Updated',
      message:
        status === 'ACTIVE'
          ? `${shop.shopName} is now verified and active for dispatch in Westlands.`
          : `${shop.shopName} status changed to ${status}. Contact support for details.`,
      type: 'SHOP_STATUS',
      read: false,
      createdAt: serverTimestamp(),
    });
    const logId = newId('log');
    batch.set(doc(db, 'activityLogs', logId), {
      logId,
      actorUid: adminUid,
      action: `SHOP_${status}`,
      targetType: 'shop',
      targetId: shop.shopId,
      details: `Set ${shop.shopName} status=${status}, verification=${verificationStatus}`,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ==================================================
// Riders (Onboarding, Docs, Availability, GPS)
// ==================================================

export function subscribeToRiderByUid(
  uid: string,
  cb: (rider: Rider | null) => void
): Unsubscribe {
  const path = `riders/${uid}`;
  return onSnapshot(
    doc(db, 'riders', uid),
    (snap) => cb(snap.exists() ? (snap.data() as Rider) : null),
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );
}

export function subscribeToAllRiders(cb: (riders: Rider[]) => void): Unsubscribe {
  const path = 'riders';
  const q = query(collection(db, path), orderBy('createdAt', 'desc'), limit(200));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as Rider)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function uploadRiderVerificationDoc(
  uid: string,
  docKey: VerificationDocKey,
  file: File
): Promise<string> {
  const prepared = await prepareVerificationDocPayload(docKey, file);
  let storagePath: string | undefined;

  // Best-effort Firebase Storage upload (fast 5s timeout); Firestore doc always persists
  try {
    const candidatePath = `rider-docs/${uid}/${docKey}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
    const storageRef = ref(storage, candidatePath);
    const uploadPromise = uploadBytes(storageRef, file, {
      contentType: file.type || prepared.mimeType,
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Storage upload timeout')), 5000);
    });
    await Promise.race([uploadPromise, timeoutPromise]);
    storagePath = candidatePath;
  } catch {
    // Storage bucket/rules optional; document payload persists in PII-isolated Firestore subcollection
  }

  const docRef = doc(db, 'riders', uid, 'verificationDocs', docKey);
  const path = `riders/${uid}/verificationDocs/${docKey}`;
  try {
    const existingSnap = await getDoc(docRef);
    const basePayload: Record<string, any> = {
      docKey,
      riderId: uid,
      uid,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      byteSize: prepared.byteSize,
      dataUrl: prepared.dataUrl,
      ...(storagePath ? { storagePath } : {}),
      verificationStatus: 'PENDING',
      uploadedAt: existingSnap.exists()
        ? (existingSnap.data() as RiderVerificationDoc).uploadedAt || serverTimestamp()
        : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(docRef, basePayload);
    return storagePath || `firestore:${path}`;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateRiderVerificationDocAndRef(
  uid: string,
  docKey: VerificationDocKey,
  file: File,
  currentRefs: Record<string, string> = {}
): Promise<string> {
  const refValue = await uploadRiderVerificationDoc(uid, docKey, file);
  const riderRef = doc(db, 'riders', uid);
  try {
    await updateDoc(riderRef, {
      verificationDocRefs: {
        ...currentRefs,
        [docKey]: refValue,
      },
      updatedAt: serverTimestamp(),
    });
    return refValue;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `riders/${uid}`);
  }
}

export function subscribeToRiderVerificationDocs(
  riderId: string,
  cb: (docs: RiderVerificationDoc[]) => void
): Unsubscribe {
  const path = `riders/${riderId}/verificationDocs`;
  return onSnapshot(
    collection(db, 'riders', riderId, 'verificationDocs'),
    (snap) => {
      cb(snap.docs.map((d) => d.data() as RiderVerificationDoc));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function resolveVerificationDocPreviewUrl(
  docItem: RiderVerificationDoc
): Promise<string | null> {
  if (docItem.dataUrl) return docItem.dataUrl;
  if (docItem.storagePath) {
    try {
      return await getDownloadURL(ref(storage, docItem.storagePath));
    } catch {
      return null;
    }
  }
  return null;
}

export async function resolveStoragePathUrl(storagePath: string): Promise<string | null> {
  if (!storagePath || storagePath.startsWith('firestore:')) return null;
  try {
    return await getDownloadURL(ref(storage, storagePath));
  } catch {
    return null;
  }
}

export async function adminReviewVerificationDoc(params: {
  adminUid: string;
  rider: Rider;
  docKey: VerificationDocKey;
  status: VerificationStatus;
  reviewNotes?: string;
}) {
  const { adminUid, rider, docKey, status, reviewNotes } = params;
  const docPath = `riders/${rider.riderId}/verificationDocs/${docKey}`;
  try {
    const batch = writeBatch(db);
    const docRef = doc(db, 'riders', rider.riderId, 'verificationDocs', docKey);
    batch.update(docRef, {
      verificationStatus: status,
      reviewedBy: adminUid,
      ...(reviewNotes ? { reviewNotes: reviewNotes.trim().slice(0, 300) } : {}),
      updatedAt: serverTimestamp(),
    });

    if (docKey === 'drivingLicence') {
      batch.update(doc(db, 'riders', rider.riderId), {
        licenceVerificationStatus: status,
        updatedAt: serverTimestamp(),
      });
    } else if (docKey === 'insurance') {
      batch.update(doc(db, 'riders', rider.riderId), {
        insuranceVerificationStatus: status,
        updatedAt: serverTimestamp(),
      });
    }

    const logId = newId('log');
    batch.set(doc(db, 'activityLogs', logId), {
      logId,
      actorUid: adminUid,
      action: `RIDER_DOC_${status}`,
      targetType: 'riderVerificationDoc',
      targetId: `${rider.riderId}:${docKey}`,
      details: `Marked ${docKey} for ${rider.fullName} as ${status}`,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }
}

export async function createRiderApplication(params: {
  uid: string;
  fullName: string;
  phoneNumber: string;
  email: string;
  nationalIdReference: string;
  drivingLicenceRef: string;
  motorcycleRegistration: string;
  insuranceDetails: string;
  emergencyContact: string;
  verificationDocRefs?: Record<string, string>;
}): Promise<string> {
  const riderId = params.uid;
  const path = `riders/${riderId}`;
  try {
    await setDoc(doc(db, 'riders', riderId), {
      riderId,
      uid: params.uid,
      fullName: params.fullName.trim().slice(0, 120),
      phoneNumber: params.phoneNumber.trim().slice(0, 24),
      email: params.email.trim().slice(0, 200),
      nationalIdReference: params.nationalIdReference.trim().slice(0, 64),
      drivingLicenceRef: params.drivingLicenceRef.trim().slice(0, 80),
      motorcycleRegistration: params.motorcycleRegistration.trim().toUpperCase().slice(0, 32),
      insuranceDetails: params.insuranceDetails.trim().slice(0, 120),
      emergencyContact: params.emergencyContact.trim().slice(0, 120),
      verificationDocRefs: params.verificationDocRefs || {},
      licenceVerificationStatus: 'PENDING',
      insuranceVerificationStatus: 'PENDING',
      approvalStatus: 'PENDING',
      availabilityStatus: 'OFFLINE',
      rating: 5.0,
      totalDeliveries: 0,
      totalEarnings: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await createActivityLog(
      params.uid,
      'RIDER_APPLICATION_SUBMITTED',
      'rider',
      riderId,
      `Rider ${params.fullName} submitted onboarding (${params.motorcycleRegistration})`
    );
    return riderId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateRiderAvailabilityAndLocation(params: {
  riderId: string;
  availabilityStatus: RiderAvailabilityStatus;
  location?: LatLng;
  activeTrackingTokenHash?: string | null;
}) {
  const path = `riders/${params.riderId}`;
  try {
    const batch = writeBatch(db);
    const payload: Record<string, any> = {
      availabilityStatus: params.availabilityStatus,
      updatedAt: serverTimestamp(),
    };
    const cleanLoc = sanitizeLatLng(params.location);
    if (cleanLoc) {
      payload.currentLocation = cleanLoc;
      payload.lastLocationUpdate = serverTimestamp();
    }
    batch.update(doc(db, 'riders', params.riderId), payload);

    if (cleanLoc && params.activeTrackingTokenHash) {
      batch.update(doc(db, 'trackingLinks', params.activeTrackingTokenHash), {
        riderLocation: cleanLoc,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminUpdateRiderApproval(
  adminUid: string,
  rider: Rider,
  approvalStatus: 'APPROVED' | 'SUSPENDED' | 'REJECTED',
  licenceVerificationStatus: 'VERIFIED' | 'REJECTED' | 'PENDING',
  insuranceVerificationStatus: 'VERIFIED' | 'REJECTED' | 'PENDING'
) {
  const path = `riders/${rider.riderId}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'riders', rider.riderId), {
      approvalStatus,
      licenceVerificationStatus,
      insuranceVerificationStatus,
      ...(approvalStatus !== 'APPROVED' ? { availabilityStatus: 'OFFLINE' } : {}),
      updatedAt: serverTimestamp(),
    });
    const userRef = doc(db, 'users', rider.uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      batch.update(userRef, {
        accountStatus:
          approvalStatus === 'APPROVED'
            ? 'ACTIVE'
            : approvalStatus === 'REJECTED'
              ? 'REJECTED'
              : 'SUSPENDED',
        lastLogin: serverTimestamp(),
      });
    }
    const docsSnap = await getDocs(collection(db, 'riders', rider.riderId, 'verificationDocs'));
    docsSnap.forEach((docSnap) => {
      const d = docSnap.data() as RiderVerificationDoc;
      let targetStatus = d.verificationStatus;
      if (d.docKey === 'drivingLicence') targetStatus = licenceVerificationStatus;
      else if (d.docKey === 'insurance') targetStatus = insuranceVerificationStatus;
      else if (approvalStatus === 'APPROVED') targetStatus = 'VERIFIED';
      else if (approvalStatus === 'REJECTED') targetStatus = 'REJECTED';

      batch.update(docSnap.ref, {
        verificationStatus: targetStatus,
        reviewedBy: adminUid,
        updatedAt: serverTimestamp(),
      });
    });

    const notifId = newId('notif');
    batch.set(doc(db, 'notifications', notifId), {
      notificationId: notifId,
      recipientUid: rider.uid,
      title:
        approvalStatus === 'APPROVED'
          ? 'Rider Account Approved'
          : `Rider Status: ${approvalStatus}`,
      message:
        approvalStatus === 'APPROVED'
          ? 'Your licence and insurance are verified. You can now go Online to accept Westlands jobs.'
          : `Your rider verification status is ${approvalStatus}.`,
      type: 'RIDER_STATUS',
      read: false,
      createdAt: serverTimestamp(),
    });
    const logId = newId('log');
    batch.set(doc(db, 'activityLogs', logId), {
      logId,
      actorUid: adminUid,
      action: `RIDER_${approvalStatus}`,
      targetType: 'rider',
      targetId: rider.riderId,
      details: `Updated rider ${rider.fullName}: approval=${approvalStatus}`,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function getJobPickupEvidence(jobId: string): Promise<DeliveryEvidence | null> {
  try {
    const snap = await getDoc(doc(db, 'deliveryJobs', jobId, 'evidence', 'pickup'));
    return snap.exists() ? (snap.data() as DeliveryEvidence) : null;
  } catch {
    return null;
  }
}

// ==================================================
// Delivery Jobs, Transactions, Tracking & PINs
// ==================================================

export function subscribeToMerchantJobs(
  shopOwnerUid: string,
  cb: (jobs: DeliveryJob[]) => void
): Unsubscribe {
  const path = 'deliveryJobs';
  const q = query(
    collection(db, path),
    where('shopOwnerUid', '==', shopOwnerUid),
    orderBy('createdAt', 'desc'),
    limit(150)
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as DeliveryJob)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeToRiderJobs(
  riderUid: string,
  cb: (jobs: DeliveryJob[]) => void
): Unsubscribe {
  const path = 'deliveryJobs';
  const q = query(
    collection(db, path),
    where('riderUid', '==', riderUid),
    orderBy('createdAt', 'desc'),
    limit(100)
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as DeliveryJob)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeToAvailableJobs(cb: (jobs: DeliveryJob[]) => void): Unsubscribe {
  const path = 'deliveryJobs';
  const q = query(
    collection(db, path),
    where('deliveryStatus', '==', 'PENDING_DISPATCH'),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as DeliveryJob)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeToAllJobs(cb: (jobs: DeliveryJob[]) => void): Unsubscribe {
  const path = 'deliveryJobs';
  const q = query(collection(db, path), orderBy('createdAt', 'desc'), limit(250));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as DeliveryJob)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeToTrackingLink(
  tokenHash: string,
  cb: (link: TrackingLink | null) => void,
  onErr?: (err: unknown) => void
): Unsubscribe {
  const path = `trackingLinks/${tokenHash}`;
  return onSnapshot(
    doc(db, 'trackingLinks', tokenHash),
    (snap) => cb(snap.exists() ? (snap.data() as TrackingLink) : null),
    (err) => {
      if (onErr) onErr(err);
      else handleFirestoreError(err, OperationType.GET, path);
    }
  );
}

export function subscribeToJobEvents(
  jobId: string,
  cb: (events: JobEvent[]) => void,
  scope?: { shopOwnerUid?: string; riderUid?: string }
): Unsubscribe {
  const path = 'jobEvents';
  const constraints: any[] = [where('jobId', '==', jobId)];
  if (scope?.shopOwnerUid) {
    constraints.push(where('shopOwnerUid', '==', scope.shopOwnerUid));
  } else if (scope?.riderUid) {
    constraints.push(where('riderUid', '==', scope.riderUid));
  } else {
    constraints.push(orderBy('createdAt', 'asc'));
  }
  constraints.push(limit(100));

  const q = query(collection(db, path), ...constraints);
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as JobEvent);
      if (scope?.shopOwnerUid || scope?.riderUid) {
        items.sort((a, b) => {
          const ta = (a.createdAt as any)?.toMillis?.() ?? 0;
          const tb = (b.createdAt as any)?.toMillis?.() ?? 0;
          return ta - tb;
        });
      }
      cb(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export interface CreatedDeliveryResult {
  jobId: string;
  paymentId: string;
  referenceCode: string;
  rawTrackingToken: string;
  tokenHash: string;
  pickupPin: string;
  deliveryPin: string;
}

export async function createDeliveryJobTransaction(params: {
  shop: Shop;
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
  mpesaPhoneNumber?: string;
}): Promise<CreatedDeliveryResult> {
  const jobId = newId('job');
  const paymentId = newId('pay');
  const eventId = newId('evt');
  const logId = newId('log');
  const referenceCode = generateJobReference();
  const rawTrackingToken = generateSecureToken(24);
  const tokenHash = await sha256Hex(rawTrackingToken);
  const pickupPin = generateFourDigitPin();
  const deliveryPin = generateFourDigitPin();
  const pickupPinHash = await sha256Hex(pickupPin);
  const deliveryPinHash = await sha256Hex(deliveryPin);

  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 72 * 60 * 60 * 1000));

  try {
    await runTransaction(db, async (tx) => {
      const jobRef = doc(db, 'deliveryJobs', jobId);
      const trackRef = doc(db, 'trackingLinks', tokenHash);
      const eventRef = doc(db, 'jobEvents', eventId);
      const payRef = doc(db, 'payments', paymentId);
      const logRef = doc(db, 'activityLogs', logId);

      tx.set(jobRef, {
        jobId,
        referenceCode,
        shopId: params.shop.shopId,
        shopOwnerUid: params.shop.ownerUid,
        shopName: params.shop.shopName,
        customerName: params.customerName.trim().slice(0, 120),
        customerPhone: params.customerPhone.trim().slice(0, 24),
        pickupAddress: params.pickupAddress.trim().slice(0, 240),
        pickupCoordinates: {
          lat: params.pickupCoordinates.lat,
          lng: params.pickupCoordinates.lng,
        },
        pickupInstructions: (params.pickupInstructions || '').trim().slice(0, 300),
        deliveryAddress: params.deliveryAddress.trim().slice(0, 240),
        deliveryCoordinates: {
          lat: params.deliveryCoordinates.lat,
          lng: params.deliveryCoordinates.lng,
        },
        deliveryInstructions: (params.deliveryInstructions || '').trim().slice(0, 300),
        packageCategory: params.packageCategory.trim().slice(0, 64),
        packageDescription: (params.packageDescription || '').trim().slice(0, 240),
        packageSize: params.packageSize,
        specialHandling: (params.specialHandling || 'NONE').trim().slice(0, 160),
        roadDistanceKm: Number(params.roadDistanceKm.toFixed(2)),
        estimatedDuration: Math.max(1, Math.round(params.estimatedDuration)),
        deliveryFee: params.deliveryFee,
        riderEarning: params.riderEarning,
        platformRevenue: params.platformRevenue,
        paymentStatus: 'UNPAID',
        deliveryStatus: 'PENDING_DISPATCH',
        customerTrackingTokenHash: tokenHash,
        pickupPinHash,
        deliveryPinHash,
        zoneId: params.shop.zoneId || DEFAULT_WESTLANDS_ZONE.zoneId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.set(trackRef, {
        tokenHash,
        jobId,
        shopOwnerUid: params.shop.ownerUid,
        shopName: params.shop.shopName,
        referenceCode,
        deliveryStatus: 'PENDING_DISPATCH',
        pickupAddress: params.pickupAddress.trim().slice(0, 240),
        pickupCoordinates: {
          lat: params.pickupCoordinates.lat,
          lng: params.pickupCoordinates.lng,
        },
        deliveryAddress: params.deliveryAddress.trim().slice(0, 240),
        deliveryCoordinates: {
          lat: params.deliveryCoordinates.lat,
          lng: params.deliveryCoordinates.lng,
        },
        roadDistanceKm: Number(params.roadDistanceKm.toFixed(2)),
        estimatedDuration: Math.max(1, Math.round(params.estimatedDuration)),
        active: true,
        expiresAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.set(eventRef, {
        eventId,
        jobId,
        shopOwnerUid: params.shop.ownerUid,
        eventType: 'JOB_CREATED',
        actorUid: params.shop.ownerUid,
        location: {
          lat: params.pickupCoordinates.lat,
          lng: params.pickupCoordinates.lng,
        },
        notes: `Delivery ${referenceCode} created (${params.roadDistanceKm.toFixed(1)} km)`,
        createdAt: serverTimestamp(),
      });

      tx.set(payRef, {
        paymentId,
        jobId,
        shopId: params.shop.shopId,
        shopOwnerUid: params.shop.ownerUid,
        amount: params.deliveryFee,
        provider: 'MPESA_DARAJA_SANDBOX',
        phoneNumber: (params.mpesaPhoneNumber || params.shop.phoneNumber).slice(0, 24),
        paymentStatus: 'INITIATED',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.set(logRef, {
        logId,
        actorUid: params.shop.ownerUid,
        action: 'DELIVERY_CREATED',
        targetType: 'deliveryJob',
        targetId: jobId,
        details: `${referenceCode} created for ${params.customerName}`,
        createdAt: serverTimestamp(),
      });
    });

    return {
      jobId,
      paymentId,
      referenceCode,
      rawTrackingToken,
      tokenHash,
      pickupPin,
      deliveryPin,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `deliveryJobs/${jobId}`);
  }
}

export async function acceptJobTransaction(jobId: string, rider: Rider): Promise<void> {
  const jobRef = doc(db, 'deliveryJobs', jobId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(jobRef);
      if (!snap.exists()) {
        throw new Error('Delivery job no longer exists.');
      }
      const job = snap.data() as DeliveryJob;
      if (job.riderUid && job.riderUid !== rider.uid) {
        throw new Error('Another rider has already accepted this job.');
      }
      if (!['PENDING_DISPATCH', 'ASSIGNED'].includes(job.deliveryStatus)) {
        throw new Error(`Job is no longer available (current status: ${job.deliveryStatus}).`);
      }

      const trackRef = doc(db, 'trackingLinks', job.customerTrackingTokenHash);
      const trackSnap = await tx.get(trackRef);
      const isAlreadyAssignedToMe = job.deliveryStatus === 'ASSIGNED' && job.riderUid === rider.uid;

      if (isAlreadyAssignedToMe) {
        tx.update(jobRef, {
          deliveryStatus: 'ACCEPTED',
          updatedAt: serverTimestamp(),
        });
        if (trackSnap.exists()) {
          tx.update(trackRef, {
            deliveryStatus: 'ACCEPTED',
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        tx.update(jobRef, {
          riderId: rider.riderId,
          riderUid: rider.uid,
          riderName: rider.fullName.slice(0, 120),
          riderPhone: rider.phoneNumber.slice(0, 24),
          deliveryStatus: 'ACCEPTED',
          assignedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        if (trackSnap.exists()) {
          tx.update(trackRef, {
            riderUid: rider.uid,
            riderName: rider.fullName.slice(0, 120),
            riderPhone: rider.phoneNumber.slice(0, 24),
            deliveryStatus: 'ACCEPTED',
            updatedAt: serverTimestamp(),
          });
        }
      }

      const cleanLoc = sanitizeLatLng(rider.currentLocation);
      const eventId = newId('evt');
      tx.set(doc(db, 'jobEvents', eventId), {
        eventId,
        jobId,
        shopOwnerUid: job.shopOwnerUid,
        riderUid: rider.uid,
        eventType: 'RIDER_ACCEPTED',
        actorUid: rider.uid,
        ...(cleanLoc ? { location: cleanLoc } : {}),
        notes: `${rider.fullName} (${rider.motorcycleRegistration}) accepted job ${job.referenceCode}`.slice(0, 400),
        createdAt: serverTimestamp(),
      });

      const notifId = newId('notif');
      tx.set(doc(db, 'notifications', notifId), {
        notificationId: notifId,
        recipientUid: job.shopOwnerUid,
        title: `Rider Assigned · ${job.referenceCode}`.slice(0, 140),
        message: `${rider.fullName} (${rider.motorcycleRegistration}) is heading to pickup.`.slice(0, 500),
        type: 'RIDER_ASSIGNED',
        jobId,
        read: false,
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('already accepted') || error.message.includes('no longer'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `deliveryJobs/${jobId}`);
  }
}

export async function advanceJobStatusTransaction(params: {
  job: DeliveryJob;
  actorUid: string;
  nextStatus: DeliveryStatus;
  pinInput?: string;
  pickupPhotoFile?: File | null;
  location?: LatLng;
  notes?: string;
}): Promise<void> {
  const { job, actorUid, nextStatus, pinInput, pickupPhotoFile, location, notes } = params;

  if (!canTransitionJobStatus(job.deliveryStatus, nextStatus)) {
    throw new Error(`Invalid status transition from ${job.deliveryStatus} to ${nextStatus}.`);
  }

  let pickupPinProofHash: string | undefined;
  let deliveryPinProofHash: string | undefined;
  let pickupPhotoRef: string | undefined;

  let pickupEvidencePayload: {
    fileName: string;
    mimeType: string;
    byteSize: number;
    dataUrl: string;
  } | null = null;

  if (nextStatus === 'PICKED_UP') {
    if (!pinInput || pinInput.trim().length < 4) {
      throw new Error('Pickup PIN from merchant is required to confirm collection.');
    }
    pickupPinProofHash = await sha256Hex(pinInput.trim());
    if (pickupPinProofHash !== job.pickupPinHash) {
      throw new Error('Incorrect Pickup PIN. Verify the 4-digit PIN with the shop.');
    }
    if (pickupPhotoFile) {
      try {
        const prepared = await prepareVerificationDocPayload('nationalId', pickupPhotoFile);
        if (prepared.mimeType !== 'application/pdf') {
          pickupEvidencePayload = {
            fileName: prepared.fileName,
            mimeType: prepared.mimeType,
            byteSize: prepared.byteSize,
            dataUrl: prepared.dataUrl,
          };
          pickupPhotoRef = `firestore:deliveryJobs/${job.jobId}/evidence/pickup`;
        }
      } catch (err) {
        console.warn('Optional pickup photo preparation skipped:', err);
      }
      try {
        const storagePath = `delivery-evidence/${job.jobId}/pickup_${Date.now()}.jpg`;
        const uploadPromise = uploadBytes(ref(storage, storagePath), pickupPhotoFile, {
          contentType: pickupPhotoFile.type || 'image/jpeg',
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Storage upload timeout')), 4000)
        );
        await Promise.race([uploadPromise, timeoutPromise]);
        pickupPhotoRef = storagePath;
      } catch {
        // Firestore evidence doc holds the compressed photo if Storage isn't active
      }
    }
  }

  if (nextStatus === 'DELIVERED') {
    if (!pinInput || pinInput.trim().length < 4) {
      throw new Error('Customer Delivery PIN is required to complete delivery.');
    }
    deliveryPinProofHash = await sha256Hex(pinInput.trim());
    if (deliveryPinProofHash !== job.deliveryPinHash) {
      throw new Error('Incorrect Customer Delivery PIN. Ask the recipient for their 4-digit PIN.');
    }
  }

  const cleanLoc = sanitizeLatLng(location);

  try {
    await runTransaction(db, async (tx) => {
      const jobRef = doc(db, 'deliveryJobs', job.jobId);
      const jobSnap = await tx.get(jobRef);
      if (!jobSnap.exists()) {
        throw new Error('Delivery job no longer exists.');
      }
      const freshJob = jobSnap.data() as DeliveryJob;
      if (!canTransitionJobStatus(freshJob.deliveryStatus, nextStatus)) {
        throw new Error(
          `Job state changed (${freshJob.deliveryStatus}). Refresh and retry if needed.`
        );
      }

      const trackRef = doc(db, 'trackingLinks', freshJob.customerTrackingTokenHash);
      const trackSnap = await tx.get(trackRef);
      const settlementRef = doc(db, 'riderSettlements', freshJob.jobId);
      const settlementSnap = nextStatus === 'DELIVERED' ? await tx.get(settlementRef) : null;

      const jobUpdates: Record<string, any> = {
        deliveryStatus: nextStatus,
        updatedAt: serverTimestamp(),
      };

      if (nextStatus === 'PICKED_UP') {
        jobUpdates.pickupPinProofHash = pickupPinProofHash;
        jobUpdates.pickedUpAt = serverTimestamp();
        if (pickupPhotoRef) jobUpdates.pickupPhotoRef = pickupPhotoRef;
        if (pickupEvidencePayload) {
          const evId = 'pickup';
          const evData: DeliveryEvidence = {
            evidenceId: evId,
            jobId: freshJob.jobId,
            shopOwnerUid: freshJob.shopOwnerUid,
            riderUid: actorUid,
            evidenceType: 'PICKUP_PHOTO',
            fileName: pickupEvidencePayload.fileName,
            mimeType: pickupEvidencePayload.mimeType,
            byteSize: pickupEvidencePayload.byteSize,
            dataUrl: pickupEvidencePayload.dataUrl,
            createdAt: serverTimestamp(),
          };
          tx.set(doc(db, 'deliveryJobs', freshJob.jobId, 'evidence', evId), evData);
        }
      }
      if (nextStatus === 'DELIVERED') {
        jobUpdates.deliveryPinProofHash = deliveryPinProofHash;
        jobUpdates.completedAt = serverTimestamp();
      }
      if (['FAILED', 'RETURN_REQUIRED'].includes(nextStatus) && notes) {
        jobUpdates.cancellationReason = notes.slice(0, 240);
      }

      tx.update(jobRef, jobUpdates);

      if (trackSnap.exists()) {
        const trackUpdates: Record<string, any> = {
          deliveryStatus: nextStatus,
          ...(nextStatus === 'DELIVERED' || nextStatus === 'RETURNED' ? { active: false } : {}),
          updatedAt: serverTimestamp(),
        };
        if (cleanLoc) trackUpdates.riderLocation = cleanLoc;
        tx.update(trackRef, trackUpdates);
      }

      if (
        nextStatus === 'DELIVERED' &&
        freshJob.riderId &&
        freshJob.riderUid &&
        settlementSnap &&
        !settlementSnap.exists()
      ) {
        tx.set(settlementRef, {
          settlementId: freshJob.jobId,
          riderId: freshJob.riderId,
          riderUid: freshJob.riderUid,
          jobId: freshJob.jobId,
          grossDeliveryFee: freshJob.deliveryFee,
          riderEarning: freshJob.riderEarning,
          settlementStatus: 'PENDING',
          createdAt: serverTimestamp(),
        });
      }

      const eventId = newId('evt');
      tx.set(doc(db, 'jobEvents', eventId), {
        eventId,
        jobId: freshJob.jobId,
        shopOwnerUid: freshJob.shopOwnerUid,
        riderUid: freshJob.riderUid || null,
        eventType: nextStatus,
        actorUid,
        ...(cleanLoc ? { location: cleanLoc } : {}),
        notes: (notes || `Status updated to ${nextStatus}`).slice(0, 400),
        createdAt: serverTimestamp(),
      });

      const notifId = newId('notif');
      tx.set(doc(db, 'notifications', notifId), {
        notificationId: notifId,
        recipientUid: freshJob.shopOwnerUid,
        title: `${freshJob.referenceCode} · ${nextStatus.replace(/_/g, ' ')}`.slice(0, 140),
        message: `Delivery for ${freshJob.customerName} is now ${nextStatus.replace(/_/g, ' ').toLowerCase()}.`.slice(0, 500),
        type: 'JOB_STATUS',
        jobId: freshJob.jobId,
        read: false,
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('PIN') ||
        error.message.includes('state changed') ||
        error.message.includes('no longer'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `deliveryJobs/${job.jobId}`);
  }
}

export async function cancelJobTransaction(
  job: DeliveryJob,
  actorUid: string,
  reason: string
): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const jobRef = doc(db, 'deliveryJobs', job.jobId);
      const jobSnap = await tx.get(jobRef);
      if (!jobSnap.exists()) {
        throw new Error('Delivery job no longer exists.');
      }
      const freshJob = jobSnap.data() as DeliveryJob;
      const trackRef = doc(db, 'trackingLinks', freshJob.customerTrackingTokenHash);
      const trackSnap = await tx.get(trackRef);

      tx.update(jobRef, {
        deliveryStatus: 'CANCELLED',
        cancellationReason: reason.trim().slice(0, 240) || 'Cancelled by authorized user',
        updatedAt: serverTimestamp(),
      });
      if (trackSnap.exists()) {
        tx.update(trackRef, {
          deliveryStatus: 'CANCELLED',
          active: false,
          updatedAt: serverTimestamp(),
        });
      }
      const eventId = newId('evt');
      tx.set(doc(db, 'jobEvents', eventId), {
        eventId,
        jobId: freshJob.jobId,
        shopOwnerUid: freshJob.shopOwnerUid,
        riderUid: freshJob.riderUid || null,
        eventType: 'CANCELLED',
        actorUid,
        notes: (reason.trim() || 'Cancelled').slice(0, 400),
        createdAt: serverTimestamp(),
      });
      if (freshJob.riderUid) {
        const notifId = newId('notif');
        tx.set(doc(db, 'notifications', notifId), {
          notificationId: notifId,
          recipientUid: freshJob.riderUid,
          title: `Job Cancelled · ${freshJob.referenceCode}`.slice(0, 140),
          message: (reason.trim() || 'Delivery was cancelled.').slice(0, 500),
          type: 'JOB_CANCELLED',
          jobId: freshJob.jobId,
          read: false,
          createdAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `deliveryJobs/${job.jobId}`);
  }
}

export async function adminAssignRiderTransaction(
  adminUid: string,
  job: DeliveryJob,
  rider: Rider
): Promise<void> {
  try {
    const cleanLoc = sanitizeLatLng(rider.currentLocation);
    await runTransaction(db, async (tx) => {
      const jobRef = doc(db, 'deliveryJobs', job.jobId);
      const jobSnap = await tx.get(jobRef);
      if (!jobSnap.exists()) {
        throw new Error('Delivery job no longer exists.');
      }
      const freshJob = jobSnap.data() as DeliveryJob;
      const trackRef = doc(db, 'trackingLinks', freshJob.customerTrackingTokenHash);
      const trackSnap = await tx.get(trackRef);

      tx.update(jobRef, {
        riderId: rider.riderId,
        riderUid: rider.uid,
        riderName: rider.fullName.slice(0, 120),
        riderPhone: rider.phoneNumber.slice(0, 24),
        deliveryStatus: 'ASSIGNED',
        assignedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (trackSnap.exists()) {
        tx.update(trackRef, {
          riderUid: rider.uid,
          riderName: rider.fullName.slice(0, 120),
          riderPhone: rider.phoneNumber.slice(0, 24),
          deliveryStatus: 'ASSIGNED',
          ...(cleanLoc ? { riderLocation: cleanLoc } : {}),
          updatedAt: serverTimestamp(),
        });
      }
      const eventId = newId('evt');
      tx.set(doc(db, 'jobEvents', eventId), {
        eventId,
        jobId: freshJob.jobId,
        shopOwnerUid: freshJob.shopOwnerUid,
        riderUid: rider.uid,
        eventType: 'DISPATCHER_ASSIGNED',
        actorUid: adminUid,
        notes: `Dispatcher assigned ${rider.fullName} (${rider.motorcycleRegistration})`.slice(0, 400),
        createdAt: serverTimestamp(),
      });
      const notifId = newId('notif');
      tx.set(doc(db, 'notifications', notifId), {
        notificationId: notifId,
        recipientUid: rider.uid,
        title: `New Job Assigned · ${freshJob.referenceCode}`.slice(0, 140),
        message: `Pickup at ${freshJob.shopName} -> ${freshJob.deliveryAddress}`.slice(0, 500),
        type: 'JOB_ASSIGNED',
        jobId: freshJob.jobId,
        read: false,
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `deliveryJobs/${job.jobId}`);
  }
}

// ==================================================
// Payments, Settlements, Pricing & Zones
// ==================================================

export function subscribeToPaymentsByOwner(
  shopOwnerUid: string,
  cb: (payments: PaymentRecord[]) => void
): Unsubscribe {
  const path = 'payments';
  const q = query(
    collection(db, path),
    where('shopOwnerUid', '==', shopOwnerUid),
    orderBy('createdAt', 'desc'),
    limit(150)
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as PaymentRecord)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeToAllPayments(cb: (payments: PaymentRecord[]) => void): Unsubscribe {
  const path = 'payments';
  const q = query(collection(db, path), orderBy('createdAt', 'desc'), limit(200));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as PaymentRecord)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function updatePaymentInitiationState(
  paymentId: string,
  jobId: string,
  updates: {
    paymentStatus: Exclude<PaymentStatus, 'PAID' | 'REFUNDED'>;
    checkoutRequestId?: string;
    merchantRequestId?: string;
    failureReason?: string;
  }
) {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'payments', paymentId), {
      paymentStatus: updates.paymentStatus,
      ...(updates.checkoutRequestId ? { checkoutRequestId: updates.checkoutRequestId } : {}),
      ...(updates.merchantRequestId ? { merchantRequestId: updates.merchantRequestId } : {}),
      ...(updates.failureReason ? { failureReason: updates.failureReason.slice(0, 240) } : {}),
      updatedAt: serverTimestamp(),
    });
    if (updates.paymentStatus === 'PENDING_STK') {
      batch.update(doc(db, 'deliveryJobs', jobId), {
        paymentStatus: 'PENDING_STK',
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `payments/${paymentId}`);
  }
}

export async function adminConfirmPaymentCallback(
  adminUid: string,
  payment: PaymentRecord,
  mpesaReceiptNumber: string
) {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'payments', payment.paymentId), {
      paymentStatus: 'PAID',
      mpesaReceiptNumber: mpesaReceiptNumber.trim().slice(0, 64),
      paidAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'deliveryJobs', payment.jobId), {
      paymentStatus: 'PAID',
      updatedAt: serverTimestamp(),
    });
    const logId = newId('log');
    batch.set(doc(db, 'activityLogs', logId), {
      logId,
      actorUid: adminUid,
      action: 'PAYMENT_RECONCILED',
      targetType: 'payment',
      targetId: payment.paymentId,
      details: `Confirmed M-Pesa receipt ${mpesaReceiptNumber}`,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `payments/${payment.paymentId}`);
  }
}

export function subscribeToSettlementsByRider(
  riderUid: string,
  cb: (items: RiderSettlement[]) => void
): Unsubscribe {
  const path = 'riderSettlements';
  const q = query(
    collection(db, path),
    where('riderUid', '==', riderUid),
    orderBy('createdAt', 'desc'),
    limit(150)
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as RiderSettlement)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeToAllSettlements(cb: (items: RiderSettlement[]) => void): Unsubscribe {
  const path = 'riderSettlements';
  const q = query(collection(db, path), orderBy('createdAt', 'desc'), limit(200));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as RiderSettlement)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function adminSettleRiderPayout(
  adminUid: string,
  settlement: RiderSettlement,
  payoutReference: string
) {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'riderSettlements', settlement.settlementId), {
      settlementStatus: 'SETTLED',
      payoutReference: payoutReference.trim().slice(0, 128),
      settledAt: serverTimestamp(),
    });
    const notifId = newId('notif');
    batch.set(doc(db, 'notifications', notifId), {
      notificationId: notifId,
      recipientUid: settlement.riderUid,
      title: 'Settlement Processed',
      message: `KES ${settlement.riderEarning} payout settled (Ref: ${payoutReference}).`,
      type: 'SETTLEMENT_PAID',
      jobId: settlement.jobId,
      read: false,
      createdAt: serverTimestamp(),
    });
    const logId = newId('log');
    batch.set(doc(db, 'activityLogs', logId), {
      logId,
      actorUid: adminUid,
      action: 'SETTLEMENT_PAID',
      targetType: 'riderSettlement',
      targetId: settlement.settlementId,
      details: `Settled KES ${settlement.riderEarning} to ${settlement.riderUid} (${payoutReference})`,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `riderSettlements/${settlement.settlementId}`);
  }
}

export function subscribeToPricingRules(
  cb: (rules: PricingRule[]) => void,
  activeOnly = true
): Unsubscribe {
  const path = 'pricingRules';
  const q = activeOnly
    ? query(collection(db, path), where('active', '==', true), limit(50))
    : query(collection(db, path), limit(50));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as PricingRule)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function savePricingRule(adminUid: string, rule: Omit<PricingRule, 'updatedAt'>) {
  if (rule.riderPercentage + rule.platformPercentage !== 100) {
    throw new Error('Rider percentage + Platform percentage must equal 100%.');
  }
  const path = `pricingRules/${rule.ruleId}`;
  try {
    await setDoc(doc(db, 'pricingRules', rule.ruleId), {
      ...rule,
      updatedAt: serverTimestamp(),
    });
    await createActivityLog(
      adminUid,
      'PRICING_RULE_UPDATED',
      'pricingRule',
      rule.ruleId,
      `${rule.minimumDistance}-${rule.maximumDistance}km fee KES ${rule.deliveryFee} (${rule.riderPercentage}/${rule.platformPercentage}%)`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeToServiceZones(
  cb: (zones: ServiceZone[]) => void,
  activeOnly = true
): Unsubscribe {
  const path = 'serviceZones';
  const q = activeOnly
    ? query(collection(db, path), where('active', '==', true), limit(50))
    : query(collection(db, path), limit(50));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as ServiceZone)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function saveServiceZone(adminUid: string, zone: Omit<ServiceZone, 'createdAt'>) {
  const path = `serviceZones/${zone.zoneId}`;
  try {
    await setDoc(doc(db, 'serviceZones', zone.zoneId), {
      ...zone,
      createdAt: serverTimestamp(),
    });
    await createActivityLog(
      adminUid,
      'SERVICE_ZONE_SAVED',
      'serviceZone',
      zone.zoneId,
      `Zone ${zone.zoneName} active=${zone.active}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ==================================================
// Notifications, Support Tickets, Audit Logs, Roles
// ==================================================

export function subscribeToNotifications(
  recipientUid: string,
  cb: (items: AppNotification[]) => void
): Unsubscribe {
  const path = 'notifications';
  const q = query(
    collection(db, path),
    where('recipientUid', '==', recipientUid),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as AppNotification)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function markNotificationRead(notificationId: string) {
  try {
    await updateDoc(doc(db, 'notifications', notificationId), { read: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notificationId}`);
  }
}

export function subscribeToSupportTickets(
  uid: string,
  isAdminView: boolean,
  cb: (tickets: SupportTicket[]) => void
): Unsubscribe {
  const path = 'supportTickets';
  const q = isAdminView
    ? query(collection(db, path), orderBy('createdAt', 'desc'), limit(100))
    : query(
        collection(db, path),
        where('createdBy', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as SupportTicket)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function createSupportTicket(params: {
  createdBy: string;
  creatorRole: UserRole;
  jobId?: string;
  issueType: string;
  description: string;
}) {
  const ticketId = newId('tkt');
  try {
    await setDoc(doc(db, 'supportTickets', ticketId), {
      ticketId,
      createdBy: params.createdBy,
      creatorRole: params.creatorRole,
      jobId: (params.jobId || '').trim().slice(0, 128),
      issueType: params.issueType.trim().slice(0, 80),
      description: params.description.trim().slice(0, 1000),
      status: 'OPEN',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `supportTickets/${ticketId}`);
  }
}

export async function resolveSupportTicket(
  adminUid: string,
  ticketId: string,
  status: 'IN_REVIEW' | 'RESOLVED' | 'CLOSED',
  resolutionNotes: string
) {
  try {
    await updateDoc(doc(db, 'supportTickets', ticketId), {
      status,
      resolutionNotes: resolutionNotes.trim().slice(0, 500),
      ...(status === 'RESOLVED' || status === 'CLOSED'
        ? { resolvedAt: serverTimestamp() }
        : {}),
    });
    await createActivityLog(
      adminUid,
      `TICKET_${status}`,
      'supportTicket',
      ticketId,
      resolutionNotes
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `supportTickets/${ticketId}`);
  }
}

export function subscribeToActivityLogs(cb: (logs: ActivityLog[]) => void): Unsubscribe {
  const path = 'activityLogs';
  const q = query(collection(db, path), orderBy('createdAt', 'desc'), limit(150));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as ActivityLog)),
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function createActivityLog(
  actorUid: string,
  action: string,
  targetType: string,
  targetId: string,
  details?: string
) {
  const logId = newId('log');
  try {
    await setDoc(doc(db, 'activityLogs', logId), {
      logId,
      actorUid,
      action: action.slice(0, 120),
      targetType: targetType.slice(0, 64),
      targetId: targetId.slice(0, 128),
      ...(details ? { details: details.slice(0, 500) } : {}),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    // Non-fatal if caller is unverified during onboarding
    console.warn('Activity log write skipped:', error);
  }
}

export async function assignUserAdminRole(
  superAdminUid: string,
  targetUser: UserProfile,
  newRole: 'ADMIN' | 'DISPATCHER' | 'MERCHANT' | 'RIDER'
) {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', targetUser.uid), {
      role: newRole,
      accountStatus: 'ACTIVE',
      lastLogin: serverTimestamp(),
    });
    if (newRole === 'ADMIN' || newRole === 'DISPATCHER') {
      batch.set(doc(db, 'admins', targetUser.uid), {
        uid: targetUser.uid,
        email: targetUser.email,
        role: newRole,
        assignedBy: superAdminUid,
        active: true,
        createdAt: serverTimestamp(),
      });
    } else {
      const adminSnap = await getDoc(doc(db, 'admins', targetUser.uid));
      if (adminSnap.exists()) {
        batch.update(doc(db, 'admins', targetUser.uid), { active: false });
      }
    }
    const logId = newId('log');
    batch.set(doc(db, 'activityLogs', logId), {
      logId,
      actorUid: superAdminUid,
      action: 'USER_ROLE_UPDATED',
      targetType: 'user',
      targetId: targetUser.uid,
      details: `Assigned role ${newRole} to ${targetUser.email}`,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${targetUser.uid}`);
  }
}
