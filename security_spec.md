# FikaBoda Security Specification (Phase 0 — Payload-First Security TDD)

## 1. Core Data Invariants
1. **No Self-Assigned Privileged Roles**: A user registering via `/users/{uid}` can only create a document with `role` in `['MERCHANT', 'RIDER']` and `accountStatus == 'PENDING'`. Only `SUPER_ADMIN` (bootstrapped via verified email `gmannu2055@gmail.com` or `/admins/{uid}`) may assign `ADMIN` or `DISPATCHER` roles.
2. **Shop Ownership & Approval Gate**: A `deliveryJob` cannot be created by a merchant unless `/shops/{shopId}` exists, `ownerUid == request.auth.uid`, and `status == 'ACTIVE'`.
3. **Atomic Tracking Projection**: Creating a `/deliveryJobs/{jobId}` document MUST atomically create `/trackingLinks/{customerTrackingTokenHash}` in the same transaction (`existsAfter`), preventing orphaned or un-trackable jobs.
4. **Atomic Single-Rider Claim**: A rider can only accept a job when `existing().riderId == null && existing().deliveryStatus in ['PENDING_DISPATCH', 'ASSIGNED']`, and their `/riders/{riderId}` document has `approvalStatus == 'APPROVED'` and `availabilityStatus == 'ONLINE'`. Two riders racing will result in one success and one `PERMISSION_DENIED` / transaction abort.
5. **PIN-Gated Lifecycle & Financial Math Integrity**:
   - A rider cannot transition `deliveryStatus` to `'PICKED_UP'` unless `incoming().pickupPinProofHash == existing().pickupPinHash`.
   - A rider cannot transition `deliveryStatus` to `'DELIVERED'` unless `incoming().deliveryPinProofHash == existing().deliveryPinHash`.
   - Clients can NEVER modify `deliveryFee`, `riderEarning`, `platformRevenue`, `paymentStatus` (to `'PAID'`), or `settlementStatus` (to `'SETTLED'`). Only authorized admins/server callbacks may confirm payments or settle payouts.
6. **Terminal State Locking**: Once `deliveryStatus` reaches `DELIVERED`, `CANCELLED`, or `RETURNED`, non-admin clients cannot mutate the job.
7. **PII Isolation & Non-Enumerable Tracking**:
   - `/users/{uid}`, `/shops/{shopId}`, `/riders/{riderId}`, and `/deliveryJobs/{jobId}` never allow blanket `list` to unrelated authenticated users.
   - `/trackingLinks/{tokenHash}` enforces `allow list: if false;` and `allow get: if resource.data.active == true && resource.data.expiresAt > request.time;` so raw tokens never appear in Firestore and no customer can enumerate other orders.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Privilege Escalation on Signup**: `create /users/{uid}` with `{ role: 'SUPER_ADMIN', accountStatus: 'ACTIVE' }`.
2. **Ghost Field Shadow Write**: `update /shops/{shopId}` by merchant adding `{ verificationStatus: 'VERIFIED', ghostFlag: true }`.
3. **Spoofed Unverified Email Admin**: Request with `email: 'gmannu2055@gmail.com'` and `email_verified: false` attempting to read `/activityLogs`.
4. **Cross-Merchant Job Scraping**: `list /deliveryJobs` by Merchant A without `where('shopOwnerUid', '==', merchantA.uid)`.
5. **Cross-Merchant Job Forgery**: `create /deliveryJobs/{jobId}` by Merchant A setting `shopId` to Merchant B's active shop.
6. **Negative / Tampered Financial Split**: `create /deliveryJobs/{jobId}` with `deliveryFee: 250, riderEarning: 500, platformRevenue: -250`.
7. **Rider Double-Accept Hijack**: Rider B attempting `update /deliveryJobs/{jobId}` when `existing().riderId` is already set to Rider A.
8. **Rider Completing Delivery Without PIN**: Rider updating `deliveryStatus: 'DELIVERED'` with `deliveryPinProofHash: '0000'` != `existing().deliveryPinHash`.
9. **Merchant Self-Confirming M-Pesa Payment**: Merchant updating `/payments/{paymentId}` with `{ paymentStatus: 'PAID', mpesaReceiptNumber: 'FAKE123' }`.
10. **Rider Self-Settling Payout**: Rider creating/updating `/riderSettlements/{id}` with `{ settlementStatus: 'SETTLED' }` or inflated `riderEarning`.
11. **Public Tracking Enumeration**: Anonymous client executing `list /trackingLinks`.
12. **Resource Poisoning via Oversized ID / Timestamp Tampering**: `create /supportTickets/{1500_char_id}` or `createdAt` set to past timestamp != `request.time`.
