import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import * as crypto from 'crypto';

const FIRESTORE_DATABASE_ID = 'ai-studio-d9b327f4-3a53-402a-a6d3-8e8eab87448d';

admin.initializeApp();
const db = getFirestore(FIRESTORE_DATABASE_ID);

const darajaConsumerKey = defineSecret('DARAJA_CONSUMER_KEY');
const darajaConsumerSecret = defineSecret('DARAJA_CONSUMER_SECRET');
const darajaShortcode = defineSecret('DARAJA_SHORTCODE');
const darajaPasskey = defineSecret('DARAJA_PASSKEY');

function sha256(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex');
}

/**
 * Authoritative Custom Claims assignment (SUPER_ADMIN only).
 * Syncs custom claims alongside Firestore /admins/{uid} and /users/{uid}.
 */
export const setUserRoleClaim = onCall(async (request) => {
  if (!request.auth || !request.auth.token.email_verified) {
    throw new HttpsError('unauthenticated', 'Verified authentication required.');
  }
  const callerEmail = request.auth.token.email;
  const callerAdminSnap = await db.doc(`admins/${request.auth.uid}`).get();
  const isSuperAdmin =
    callerEmail === 'gmannu2055@gmail.com' ||
    (callerAdminSnap.exists && callerAdminSnap.data()?.role === 'SUPER_ADMIN');

  if (!isSuperAdmin) {
    throw new HttpsError('permission-denied', 'Only SUPER_ADMIN can assign privileged claims.');
  }

  const { targetUid, role } = request.data as { targetUid: string; role: string };
  if (!targetUid || !['SUPER_ADMIN', 'ADMIN', 'DISPATCHER', 'MERCHANT', 'RIDER'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Invalid targetUid or role.');
  }

  await admin.auth().setCustomUserClaims(targetUid, { role });
  await db.doc(`users/${targetUid}`).update({ role, accountStatus: 'ACTIVE' });

  if (['SUPER_ADMIN', 'ADMIN', 'DISPATCHER'].includes(role)) {
    await db.doc(`admins/${targetUid}`).set(
      {
        uid: targetUid,
        role,
        assignedBy: request.auth.uid,
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  return { ok: true, targetUid, role };
});

/**
 * Server-side atomic rider job acceptance preventing double-claims.
 */
export const acceptDeliveryJob = onCall(async (request) => {
  if (!request.auth || !request.auth.token.email_verified) {
    throw new HttpsError('unauthenticated', 'Verified rider authentication required.');
  }
  const uid = request.auth.uid;
  const { jobId } = request.data as { jobId: string };
  if (!jobId) throw new HttpsError('invalid-argument', 'jobId is required.');

  const riderSnap = await db.doc(`riders/${uid}`).get();
  if (!riderSnap.exists || riderSnap.data()?.approvalStatus !== 'APPROVED') {
    throw new HttpsError('permission-denied', 'Only approved riders can accept jobs.');
  }
  const rider = riderSnap.data()!;

  await db.runTransaction(async (tx) => {
    const jobRef = db.doc(`deliveryJobs/${jobId}`);
    const jobSnap = await tx.get(jobRef);
    if (!jobSnap.exists) throw new HttpsError('not-found', 'Job not found.');
    const job = jobSnap.data()!;
    if (job.riderUid && job.riderUid !== uid) {
      throw new HttpsError('failed-precondition', 'Job already claimed by another rider.');
    }
    if (!['PENDING_DISPATCH', 'ASSIGNED'].includes(job.deliveryStatus)) {
      throw new HttpsError('failed-precondition', 'Job is no longer open for acceptance.');
    }

    tx.update(jobRef, {
      riderId: uid,
      riderUid: uid,
      riderName: rider.fullName,
      riderPhone: rider.phoneNumber,
      deliveryStatus: 'ACCEPTED',
      assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.update(db.doc(`trackingLinks/${job.customerTrackingTokenHash}`), {
      riderUid: uid,
      riderName: rider.fullName,
      riderPhone: rider.phoneNumber,
      deliveryStatus: 'ACCEPTED',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, jobId };
});

/**
 * Server-side PIN verification and status progression.
 */
export const verifyPinAndAdvanceJob = onCall(async (request) => {
  if (!request.auth || !request.auth.token.email_verified) {
    throw new HttpsError('unauthenticated', 'Verified authentication required.');
  }
  const uid = request.auth.uid;
  const { jobId, nextStatus, pin } = request.data as {
    jobId: string;
    nextStatus: 'PICKED_UP' | 'DELIVERED';
    pin: string;
  };
  if (!jobId || !pin) throw new HttpsError('invalid-argument', 'jobId and pin are required.');

  const pinHash = sha256(pin.trim());
  await db.runTransaction(async (tx) => {
    const jobRef = db.doc(`deliveryJobs/${jobId}`);
    const jobSnap = await tx.get(jobRef);
    if (!jobSnap.exists) throw new HttpsError('not-found', 'Job not found.');
    const job = jobSnap.data()!;
    if (job.riderUid !== uid) {
      throw new HttpsError('permission-denied', 'Only the assigned rider can advance this job.');
    }

    if (nextStatus === 'PICKED_UP') {
      if (job.deliveryStatus !== 'ARRIVED_AT_PICKUP') {
        throw new HttpsError('failed-precondition', 'Rider must arrive at pickup first.');
      }
      if (pinHash !== job.pickupPinHash) {
        throw new HttpsError('permission-denied', 'Invalid pickup PIN.');
      }
      tx.update(jobRef, {
        deliveryStatus: 'PICKED_UP',
        pickupPinProofHash: pinHash,
        pickedUpAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else if (nextStatus === 'DELIVERED') {
      if (job.deliveryStatus !== 'ARRIVED_AT_DESTINATION') {
        throw new HttpsError('failed-precondition', 'Rider must arrive at destination first.');
      }
      if (pinHash !== job.deliveryPinHash) {
        throw new HttpsError('permission-denied', 'Invalid customer delivery PIN.');
      }
      tx.update(jobRef, {
        deliveryStatus: 'DELIVERED',
        deliveryPinProofHash: pinHash,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(db.doc(`riderSettlements/${jobId}`), {
        settlementId: jobId,
        riderId: uid,
        riderUid: uid,
        jobId,
        grossDeliveryFee: job.deliveryFee,
        riderEarning: job.riderEarning,
        settlementStatus: 'PENDING',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });
  return { ok: true };
});

/**
 * Daraja M-Pesa STK Push Cloud Function (Uses Firebase Secrets).
 */
export const initiateMpesaStkPush = onCall(
  { secrets: [darajaConsumerKey, darajaConsumerSecret, darajaShortcode, darajaPasskey] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
    const { paymentId, jobId, phoneNumber, amount } = request.data as {
      paymentId: string;
      jobId: string;
      phoneNumber: string;
      amount: number;
    };
    const key = darajaConsumerKey.value();
    const secret = darajaConsumerSecret.value();
    const shortcode = darajaShortcode.value();
    const passkey = darajaPasskey.value();

    if (!key || !secret || !shortcode || !passkey) {
      return {
        status: 'AWAITING_CONFIG',
        configured: false,
        message: 'Configure Firebase Functions secrets for Safaricom Daraja before initiating live STK Push.',
      };
    }

    const authStr = Buffer.from(`${key}:${secret}`).toString('base64');
    const oauthRes = await fetch(
      'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
      { headers: { Authorization: `Basic ${authStr}` } }
    );
    const oauthJson = (await oauthRes.json()) as { access_token?: string };
    if (!oauthJson.access_token) {
      throw new HttpsError('internal', 'Failed to obtain Daraja OAuth token.');
    }

    const now = new Date();
    const ts = now.toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString('base64');

    const stkRes = await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${oauthJson.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: ts,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: phoneNumber,
        PartyB: shortcode,
        PhoneNumber: phoneNumber,
        CallBackURL: process.env.DARAJA_CALLBACK_URL || '',
        AccountReference: jobId.slice(0, 12),
        TransactionDesc: 'FikaBoda Delivery',
      }),
    });
    const stkJson = (await stkRes.json()) as {
      CheckoutRequestID?: string;
      MerchantRequestID?: string;
      ResponseCode?: string;
    };
    if (stkJson.ResponseCode !== '0' || !stkJson.CheckoutRequestID) {
      throw new HttpsError('aborted', 'Daraja STK Push request rejected.');
    }

    await db.doc(`payments/${paymentId}`).update({
      paymentStatus: 'PENDING_STK',
      checkoutRequestId: stkJson.CheckoutRequestID,
      merchantRequestId: stkJson.MerchantRequestID || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { status: 'PENDING_STK', checkoutRequestId: stkJson.CheckoutRequestID };
  }
);

/**
 * Daraja M-Pesa Callback Webhook with Idempotency Protection.
 */
export const mpesaCallback = onRequest(async (req, res) => {
  const stkCallback = req.body?.Body?.stkCallback;
  if (!stkCallback?.CheckoutRequestID) {
    res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid payload' });
    return;
  }

  const checkoutRequestId = String(stkCallback.CheckoutRequestID);
  const paySnap = await db
    .collection('payments')
    .where('checkoutRequestId', '==', checkoutRequestId)
    .limit(1)
    .get();

  if (paySnap.empty) {
    res.json({ ResultCode: 0, ResultDesc: 'Accepted (unmatched CheckoutRequestID)' });
    return;
  }

  const payDoc = paySnap.docs[0];
  const payData = payDoc.data();
  if (payData.paymentStatus === 'PAID') {
    res.json({ ResultCode: 0, ResultDesc: 'Already reconciled' });
    return;
  }

  const resultCode = Number(stkCallback.ResultCode);
  const items: Array<{ Name: string; Value?: unknown }> = stkCallback.CallbackMetadata?.Item || [];
  const receipt = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value;

  const batch = db.batch();
  if (resultCode === 0) {
    batch.update(payDoc.ref, {
      paymentStatus: 'PAID',
      mpesaReceiptNumber: receipt ? String(receipt) : '',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.update(db.doc(`deliveryJobs/${payData.jobId}`), {
      paymentStatus: 'PAID',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else {
    batch.update(payDoc.ref, {
      paymentStatus: resultCode === 1037 ? 'TIMEOUT' : 'FAILED',
      failureReason: String(stkCallback.ResultDesc || 'Payment failed'),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

/**
 * Trigger: Notify admins when a new delivery job is created & update rider stats on completion.
 */
export const onDeliveryJobCreated = onDocumentCreated(
  { document: 'deliveryJobs/{jobId}', database: FIRESTORE_DATABASE_ID },
  async (event) => {
  const job = event.data?.data();
  if (!job) return;
  const adminsSnap = await db.collection('admins').where('active', '==', true).limit(10).get();
  const batch = db.batch();
  adminsSnap.docs.forEach((adm) => {
    const notifRef = db.collection('notifications').doc();
    batch.set(notifRef, {
      notificationId: notifRef.id,
      recipientUid: adm.id,
      title: `New Delivery · ${job.referenceCode}`,
      message: `${job.shopName} requested delivery (${job.roadDistanceKm} km)`,
      type: 'NEW_DELIVERY',
      jobId: job.jobId,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
});

export const onDeliveryJobUpdated = onDocumentUpdated(
  { document: 'deliveryJobs/{jobId}', database: FIRESTORE_DATABASE_ID },
  async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;

  if (before.deliveryStatus !== 'DELIVERED' && after.deliveryStatus === 'DELIVERED' && after.riderId) {
    await db.doc(`riders/${after.riderId}`).update({
      totalDeliveries: admin.firestore.FieldValue.increment(1),
      totalEarnings: admin.firestore.FieldValue.increment(after.riderEarning || 0),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
});
