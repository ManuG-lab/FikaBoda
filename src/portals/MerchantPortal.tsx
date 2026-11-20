import React, { useEffect, useMemo, useState } from 'react';
import { signOut } from 'firebase/auth';
import {
  CheckCircle2,
  ClipboardCopy,
  CreditCard,
  FileDown,
  HelpCircle,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  PackagePlus,
  Settings,
  Smartphone,
  Store,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import { auth } from '../firebase/config';
import type {
  DeliveryEvidence,
  DeliveryJob,
  JobEvent,
  LatLng,
  PackageSize,
  PaymentRecord,
  PricingRule,
  ServiceZone,
  Shop,
  SupportTicket,
  UserProfile,
} from '../types/fikaboda';
import {
  cancelJobTransaction,
  createDeliveryJobTransaction,
  createShopApplication,
  createSupportTicket,
  getJobPickupEvidence,
  subscribeToJobEvents,
  subscribeToMerchantJobs,
  subscribeToPaymentsByOwner,
  subscribeToPricingRules,
  subscribeToServiceZones,
  subscribeToShopByOwner,
  subscribeToSupportTickets,
  updatePaymentInitiationState,
  updateShopProfileByMerchant,
  type CreatedDeliveryResult,
} from '../services/firestoreService';
import {
  checkMpesaCallbackStatus,
  dispatchExternalNotification,
  initiateMpesaStkPush,
} from '../services/apiService';
import {
  calculateDeliveryQuote,
  isWithinServiceZones,
  WESTLANDS_CENTER,
} from '../utils/pricing';
import {
  formatKes,
  formatKenyanPhone,
  formatTimestamp,
  isValidKenyanPhone,
} from '../utils/crypto';
import { downloadMerchantStatementPdf } from '../utils/pdfStatement';
import { FikaBodaLogo } from '../components/FikaBodaLogo';
import { NotificationsBell } from '../components/NotificationsBell';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { PullToRefresh } from '../components/PullToRefresh';
import { DeliveryStatusText, PaymentStatusText } from '../components/StatusBadge';
import { PlacesAddressInput } from '../components/Maps/PlacesAddressInput';
import { DeliveryRouteMap } from '../components/Maps/DeliveryRouteMap';
import { useToast } from '../components/ToastProvider';

type MerchantTab =
  | 'overview'
  | 'new_delivery'
  | 'active'
  | 'history'
  | 'transactions'
  | 'statements'
  | 'profile'
  | 'support'
  | 'settings';

export const MerchantPortal: React.FC<{
  profile: UserProfile;
  hasMapsKey: boolean;
  onNavigateTrack: (token: string) => void;
}> = ({ profile, hasMapsKey, onNavigateTrack }) => {
  const [shop, setShop] = useState<Shop | null | undefined>(undefined);
  const [tab, setTab] = useState<MerchantTab>('overview');
  const [jobs, setJobs] = useState<DeliveryJob[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const { pushToast } = useToast();

  // Onboarding form state
  const [obName, setObName] = useState('');
  const [obCategory, setObCategory] = useState('Retail & Electronics');
  const [obContact, setObContact] = useState(profile.fullName);
  const [obPhone, setObPhone] = useState(profile.phoneNumber);
  const [obAddress, setObAddress] = useState('Sarit Centre, Westlands, Nairobi');
  const [obLocation, setObLocation] = useState<LatLng>(WESTLANDS_CENTER);
  const [obHours, setObHours] = useState('Mon–Sat, 8:00 AM – 8:00 PM');
  const [obBusy, setObBusy] = useState(false);
  const [obError, setObError] = useState<string | null>(null);

  // New Delivery form state
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupCoords, setPickupCoords] = useState<LatLng>(WESTLANDS_CENTER);
  const [pickupInstructions, setPickupInstructions] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [dropoffCoords, setDropoffCoords] = useState<LatLng | null>(null);
  const [dropoffInstructions, setDropoffInstructions] = useState('');
  const [packageCategory, setPackageCategory] = useState('Boutique / Retail');
  const [packageDescription, setPackageDescription] = useState('');
  const [packageSize, setPackageSize] = useState<PackageSize>('SMALL');
  const [specialHandling, setSpecialHandling] = useState('NONE');
  const [mpesaPhone, setMpesaPhone] = useState(profile.phoneNumber);
  const [routeDistanceKm, setRouteDistanceKm] = useState<number>(3.2);
  const [routeDurationMins, setRouteDurationMins] = useState<number>(14);
  const [routeSource, setRouteSource] = useState<string>('HAVERSINE_ESTIMATE');
  const [creatingJob, setCreatingJob] = useState(false);
  const [createdReceipt, setCreatedReceipt] = useState<CreatedDeliveryResult | null>(null);
  const [stkFeedback, setStkFeedback] = useState<string | null>(null);

  // Active inspection & events
  const [selectedJob, setSelectedJob] = useState<DeliveryJob | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<JobEvent[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<DeliveryEvidence | null>(null);
  const [historyFilter, setHistoryFilter] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  // Reusable modal replacing browser window.prompt
  const [merchantPrompt, setMerchantPrompt] = useState<{
    title: string;
    label: string;
    placeholder: string;
    defaultValue?: string;
    submitLabel: string;
    onSubmit: (val: string) => Promise<void>;
  } | null>(null);
  const [promptInput, setPromptInput] = useState('');
  const [promptBusy, setPromptBusy] = useState(false);

  // Support ticket form
  const [ticketType, setTicketType] = useState('Delivery Delay');
  const [ticketJobId, setTicketJobId] = useState('');
  const [ticketDesc, setTicketDesc] = useState('');

  // Shop profile edit
  const [editShopName, setEditShopName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editHours, setEditHours] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editLocation, setEditLocation] = useState<LatLng>(WESTLANDS_CENTER);

  useEffect(() => {
    const u1 = subscribeToShopByOwner(profile.uid, (s) => {
      setShop(s);
      if (s) {
        setPickupAddress((prev) => prev || s.physicalAddress);
        setPickupCoords(s.location);
        setMpesaPhone((prev) => prev || s.phoneNumber);
        setEditShopName(s.shopName);
        setEditPhone(s.phoneNumber);
        setEditHours(s.operatingHours);
        setEditAddress(s.physicalAddress);
        setEditLocation(s.location);
      }
    });
    const u2 = subscribeToMerchantJobs(profile.uid, setJobs);
    const u3 = subscribeToPaymentsByOwner(profile.uid, setPayments);
    const u4 = subscribeToPricingRules(setPricingRules, true);
    const u5 = subscribeToServiceZones(setZones, true);
    const u6 = subscribeToSupportTickets(profile.uid, false, setTickets);
    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
    };
  }, [profile.uid, refreshTick]);

  const handleRefresh = async () => {
    setRefreshTick((t) => t + 1);
    await auth.currentUser?.reload().catch(() => {});
  };

  useEffect(() => {
    if (!selectedJob) {
      setSelectedEvents([]);
      setSelectedEvidence(null);
      return;
    }
    const unsub = subscribeToJobEvents(selectedJob.jobId, setSelectedEvents, {
      shopOwnerUid: profile.uid,
    });
    if (selectedJob.pickupPhotoRef) {
      void getJobPickupEvidence(selectedJob.jobId).then(setSelectedEvidence);
    } else {
      setSelectedEvidence(null);
    }
    return () => unsub();
  }, [selectedJob?.jobId, selectedJob?.pickupPhotoRef, profile.uid]);

  const quote = useMemo(
    () =>
      calculateDeliveryQuote({
        roadDistanceKm: routeDistanceKm,
        packageSize,
        specialHandling,
        rules: pricingRules,
        zoneId: shop?.zoneId,
      }),
    [routeDistanceKm, packageSize, specialHandling, pricingRules, shop?.zoneId]
  );

  const zoneCheck = useMemo(() => {
    if (!dropoffCoords) return null;
    return isWithinServiceZones(dropoffCoords, zones);
  }, [dropoffCoords, zones]);

  const activeJobs = jobs.filter(
    (j) => !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(j.deliveryStatus)
  );
  const historyJobs = jobs.filter((j) =>
    ['DELIVERED', 'CANCELLED', 'FAILED', 'RETURN_REQUIRED', 'RETURNED'].includes(j.deliveryStatus)
  );

  const handleOnboardingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setObError(null);
    if (obName.trim().length < 2) {
      setObError('Shop name must be at least 2 characters.');
      return;
    }
    if (obContact.trim().length < 2) {
      setObError('Contact person name must be at least 2 characters.');
      return;
    }
    if (!isValidKenyanPhone(obPhone)) {
      const msg = 'Enter a valid Kenyan phone number (e.g. 0712 345 678 or 254712345678).';
      setObError(msg);
      pushToast({ kind: 'error', title: 'Invalid Kenyan phone number', description: msg });
      return;
    }
    if (obAddress.trim().length < 3) {
      setObError('Enter or select a physical pickup address (at least 3 characters).');
      return;
    }
    if (obHours.trim().length < 2) {
      setObError('Enter your shop operating hours.');
      return;
    }
    setObBusy(true);
    try {
      await createShopApplication({
        ownerUid: profile.uid,
        shopName: obName,
        businessCategory: obCategory,
        contactPerson: obContact,
        phoneNumber: formatKenyanPhone(obPhone),
        email: profile.email,
        physicalAddress: obAddress,
        location: obLocation,
        operatingHours: obHours,
      });
      pushToast({
        kind: 'success',
        title: 'Merchant application submitted',
        description: 'A FikaBoda administrator will verify and activate your shop shortly.',
      });
    } catch (err: any) {
      let msg = err?.message || 'Could not submit shop application.';
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.error) msg = parsed.error;
      } catch {
        // use raw message
      }
      setObError(msg);
      pushToast({ kind: 'error', title: 'Submission failed', description: msg });
    } finally {
      setObBusy(false);
    }
  };

  const handleCreateDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shop || shop.status !== 'ACTIVE') return;
    if (!dropoffCoords || !dropoffAddress.trim()) {
      pushToast({ kind: 'error', title: 'Select a dropoff location on the map or via search' });
      return;
    }
    if (zoneCheck && !zoneCheck.supported) {
      pushToast({
        kind: 'error',
        title: 'Dropoff outside active Westlands zone',
        description: `Destination is ${zoneCheck.distanceFromCenterKm} km from Westlands hub.`,
      });
      return;
    }
    if (!isValidKenyanPhone(customerPhone)) {
      pushToast({ kind: 'error', title: 'Enter a valid Kenyan customer phone number' });
      return;
    }
    if (mpesaPhone && !isValidKenyanPhone(mpesaPhone)) {
      pushToast({ kind: 'error', title: 'Enter a valid Kenyan M-Pesa phone number' });
      return;
    }

    setCreatingJob(true);
    setStkFeedback(null);
    try {
      const result = await createDeliveryJobTransaction({
        shop,
        customerName,
        customerPhone: formatKenyanPhone(customerPhone),
        pickupAddress: pickupAddress || shop.physicalAddress,
        pickupCoordinates: pickupCoords,
        pickupInstructions,
        deliveryAddress: dropoffAddress,
        deliveryCoordinates: dropoffCoords,
        deliveryInstructions: dropoffInstructions,
        packageCategory,
        packageDescription,
        packageSize,
        specialHandling,
        roadDistanceKm: quote.roadDistanceKm,
        estimatedDuration: routeDurationMins,
        deliveryFee: quote.deliveryFee,
        riderEarning: quote.riderEarning,
        platformRevenue: quote.platformRevenue,
        mpesaPhoneNumber: mpesaPhone ? formatKenyanPhone(mpesaPhone) : shop.phoneNumber,
      });
      setCreatedReceipt(result);

      // Initiate real M-Pesa STK Push if configured
      if (mpesaPhone) {
        const stk = await initiateMpesaStkPush({
          paymentId: result.paymentId,
          jobId: result.jobId,
          phoneNumber: formatKenyanPhone(mpesaPhone),
          amount: quote.deliveryFee,
          accountReference: result.referenceCode,
        });
        setStkFeedback(stk.message);
        await updatePaymentInitiationState(result.paymentId, result.jobId, {
          paymentStatus: stk.status,
          checkoutRequestId: stk.checkoutRequestId,
          merchantRequestId: stk.merchantRequestId,
          ...(stk.status !== 'PENDING_STK' ? { failureReason: stk.message } : {}),
        });
      }

      // Attempt optional WhatsApp notification (reports honestly if unconfigured)
      const trackUrl = `${window.location.origin}/track/${result.rawTrackingToken}`;
      await dispatchExternalNotification({
        channel: 'WHATSAPP',
        phoneNumber: formatKenyanPhone(customerPhone),
        message: `${shop.shopName} dispatched your parcel (${result.referenceCode}) via FikaBoda. Track live: ${trackUrl}. Delivery PIN: ${result.deliveryPin}`,
        jobId: result.jobId,
      }).catch(() => null);

      pushToast({
        kind: 'success',
        title: `Dispatch ${result.referenceCode} created`,
        description: 'Share the Delivery PIN and tracking link with your customer.',
      });
      setCustomerName('');
      setCustomerPhone('');
      setDropoffAddress('');
      setDropoffCoords(null);
      setPackageDescription('');
    } catch (err: any) {
      pushToast({ kind: 'error', title: 'Could not create delivery', description: err?.message });
    } finally {
      setCreatingJob(false);
    }
  };

  const handleRetryStk = (pay: PaymentRecord) => {
    const initial = shop?.phoneNumber || '';
    setPromptInput(initial);
    setMerchantPrompt({
      title: `Initiate M-Pesa STK Push (${formatKes(pay.amount)})`,
      label: 'Enter Safaricom / Airtel Kenya phone number',
      placeholder: '0712345678',
      defaultValue: initial,
      submitLabel: 'Send STK Push',
      onSubmit: async (phone) => {
        if (!isValidKenyanPhone(phone)) {
          throw new Error('Enter a valid Kenyan mobile number (e.g. 0712345678).');
        }
        const stk = await initiateMpesaStkPush({
          paymentId: pay.paymentId,
          jobId: pay.jobId,
          phoneNumber: formatKenyanPhone(phone),
          amount: pay.amount,
          accountReference: pay.jobId.slice(-10),
        });
        await updatePaymentInitiationState(pay.paymentId, pay.jobId, {
          paymentStatus: stk.status,
          checkoutRequestId: stk.checkoutRequestId,
          merchantRequestId: stk.merchantRequestId,
          ...(stk.status !== 'PENDING_STK' ? { failureReason: stk.message } : {}),
        });
        pushToast({
          kind: stk.configured ? 'info' : 'error',
          title: stk.status,
          description: stk.message,
        });
      },
    });
  };

  // Loading state
  if (shop === undefined) {
    return (
      <div className="min-h-screen bg-[#F7F8F5] flex items-center justify-center text-sm text-[#77827B]">
        Loading merchant workspace...
      </div>
    );
  }

  // Onboarding Form (no shop yet)
  if (shop === null) {
    return (
      <div className="min-h-screen bg-[#F7F8F5]">
        <header className="bg-white border-b border-[#E3E7E2] px-4 sm:px-6 h-16 flex items-center justify-between">
          <FikaBodaLogo />
          <button
            type="button"
            onClick={() => void signOut(auth)}
            className="text-xs font-semibold text-[#77827B] hover:text-[#17231F] inline-flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-8">
          <div className="bg-white border border-[#E3E7E2] rounded-2xl p-6 sm:p-8 space-y-6">
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-[#123C32] font-semibold">
                Merchant Onboarding · Westlands
              </p>
              <h1 className="font-display text-2xl font-bold text-[#17231F] mt-1">
                Register Your Shop on FikaBoda
              </h1>
              <p className="text-xs text-[#77827B] mt-1">
                Submit your shop details and pickup pin for administrator verification.
              </p>
            </div>

            <form onSubmit={handleOnboardingSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#17231F] mb-1">
                    Shop / Business Name
                  </label>
                  <input
                    type="text"
                    required
                    value={obName}
                    onChange={(e) => setObName(e.target.value)}
                    placeholder="Westlands Tech & Audio"
                    className="w-full px-3.5 py-2.5 text-sm border border-[#E3E7E2] rounded-lg focus:outline-none focus:border-[#123C32]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#17231F] mb-1">
                    Business Category
                  </label>
                  <select
                    value={obCategory}
                    onChange={(e) => setObCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-[#E3E7E2] rounded-lg bg-white focus:outline-none focus:border-[#123C32]"
                  >
                    <option>Retail & Electronics</option>
                    <option>Fashion & Apparel</option>
                    <option>Pharmacy & Wellness</option>
                    <option>Bakery & Specialty Food</option>
                    <option>Cosmetics & Beauty</option>
                    <option>Documents & Corporate</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#17231F] mb-1">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    required
                    value={obContact}
                    onChange={(e) => setObContact(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-[#E3E7E2] rounded-lg focus:outline-none focus:border-[#123C32]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#17231F] mb-1">
                    Shop Phone (Kenyan)
                  </label>
                  <input
                    type="tel"
                    required
                    value={obPhone}
                    onChange={(e) => setObPhone(e.target.value)}
                    placeholder="0712 345 678"
                    className="w-full px-3.5 py-2.5 text-sm border border-[#E3E7E2] rounded-lg font-mono focus:outline-none focus:border-[#123C32]"
                  />
                </div>
              </div>

              <PlacesAddressInput
                label="Physical Pickup Address"
                required
                value={obAddress}
                hasMapsKey={hasMapsKey}
                onChangeText={setObAddress}
                onSelectPlace={(res) => {
                  setObAddress(res.address);
                  setObLocation(res.location);
                }}
              />

              <div className="space-y-1.5">
                <p className="text-xs text-[#77827B]">
                  Tap the map to refine your exact pickup pin ({obLocation.lat.toFixed(4)},{' '}
                  {obLocation.lng.toFixed(4)})
                </p>
                <DeliveryRouteMap
                  hasMapsKey={hasMapsKey}
                  pickup={obLocation}
                  pickupLabel={obName || 'Shop Pickup Pin'}
                  heightClass="h-56"
                  onMapClick={setObLocation}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#17231F] mb-1">
                  Operating Hours
                </label>
                <input
                  type="text"
                  required
                  value={obHours}
                  onChange={(e) => setObHours(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-[#E3E7E2] rounded-lg focus:outline-none focus:border-[#123C32]"
                />
              </div>

              {obError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 leading-relaxed">
                  {obError}
                </div>
              )}

              <button
                type="submit"
                disabled={obBusy}
                className="w-full py-3 rounded-lg bg-[#123C32] text-white text-sm font-semibold hover:bg-[#0D2E26] disabled:opacity-50 cursor-pointer"
              >
                {obBusy ? 'Submitting application...' : 'Submit Shop for Verification'}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  // Pending Approval or Suspended Gate
  if (shop.status !== 'ACTIVE') {
    return (
      <PullToRefresh onRefresh={handleRefresh}>
        <div className="min-h-screen bg-[#F7F8F5] flex flex-col">
          <header className="bg-white border-b border-[#E3E7E2] px-4 sm:px-6 h-16 flex items-center justify-between gap-2">
            <FikaBodaLogo />
            <div className="flex items-center gap-2">
              <PWAInstallButton compact />
              <button
                type="button"
                onClick={() => void signOut(auth)}
                className="text-xs font-semibold text-[#77827B] hover:text-[#17231F] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </header>
          <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
            <div className="max-w-lg w-full bg-white border border-[#E3E7E2] rounded-2xl p-6 sm:p-8 space-y-4">
              <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex items-center justify-center">
                <Store className="w-5 h-5" />
              </div>
              <h1 className="font-display text-xl font-bold text-[#17231F]">
                {shop.status === 'PENDING_APPROVAL'
                  ? 'Shop Awaiting Admin Approval'
                  : 'Shop Account Suspended'}
              </h1>
              <p className="text-sm text-[#77827B] leading-relaxed">
                {shop.status === 'PENDING_APPROVAL'
                  ? `${shop.shopName} has been submitted and is currently in the verification queue. Pull down to refresh anytime — once approved, this workspace unlocks automatically.`
                  : `${shop.shopName} is currently suspended. Contact FikaBoda Dispatch Support for review.`}
              </p>
              <div className="bg-[#F7F8F5] border border-[#E3E7E2] rounded-xl p-4 text-xs space-y-1.5">
                <p>
                  <span className="text-[#77827B]">Address:</span> {shop.physicalAddress}
                </p>
                <p>
                  <span className="text-[#77827B]">Verification:</span> {shop.verificationStatus}
                </p>
                <p>
                  <span className="text-[#77827B]">Status:</span> {shop.status}
                </p>
              </div>
            </div>
          </main>
        </div>
      </PullToRefresh>
    );
  }

  const navItems: Array<{ id: MerchantTab; label: string; icon: any }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'new_delivery', label: 'New Delivery', icon: PackagePlus },
    { id: 'active', label: `Active (${activeJobs.length})`, icon: Truck },
    { id: 'history', label: 'History', icon: History },
    { id: 'transactions', label: 'Transactions', icon: CreditCard },
    { id: 'statements', label: 'Statements', icon: FileDown },
    { id: 'profile', label: 'Shop Profile', icon: Store },
    { id: 'support', label: 'Support', icon: HelpCircle },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const totalSpent = payments
    .filter((p) => p.paymentStatus === 'PAID')
    .reduce((acc, p) => acc + p.amount, 0);

  return (
    <div className="min-h-screen bg-[#F7F8F5] flex flex-col lg:flex-row">
      {/* Left Sidebar (Desktop) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 bg-[#123C32] text-white shrink-0">
        <div className="p-5 border-b border-white/10">
          <FikaBodaLogo variant="light" />
          <p className="text-xs text-[#D5FF70] mt-2 font-medium truncate">{shop.shopName}</p>
          <p className="text-[11px] text-white/65 truncate">{shop.physicalAddress}</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[#D5FF70] text-[#123C32]'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-4 border-t border-white/10">
          <button
            type="button"
            onClick={() => void signOut(auth)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-white/75 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="bg-white border-b border-[#E3E7E2] px-4 sm:px-6 h-16 flex items-center justify-between gap-3 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <div className="lg:hidden">
              <FikaBodaLogo size="sm" />
            </div>
            <div className="hidden sm:block min-w-0">
              <h1 className="font-display font-semibold text-sm text-[#17231F] truncate">
                {shop.shopName}
              </h1>
              <p className="text-[11px] text-[#77827B] truncate">
                Merchant Portal · Westlands Zone
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setTab('new_delivery')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#123C32] text-white text-xs font-semibold hover:bg-[#0D2E26] whitespace-nowrap cursor-pointer"
            >
              <PackagePlus className="w-3.5 h-3.5" />
              <span>New Delivery</span>
            </button>
            <PWAInstallButton compact />
            <NotificationsBell uid={profile.uid} />
            <button
              type="button"
              onClick={() => void signOut(auth)}
              className="lg:hidden p-2 rounded-lg border border-[#E3E7E2] text-[#77827B] hover:text-[#17231F] cursor-pointer"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Mobile Nav Strip */}
        <div className="lg:hidden bg-white border-b border-[#E3E7E2] px-4 py-2 overflow-x-auto flex items-center gap-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                tab === item.id
                  ? 'bg-[#123C32] text-white'
                  : 'bg-[#F7F8F5] text-[#17231F] border border-[#E3E7E2]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <PullToRefresh onRefresh={handleRefresh} className="flex-1 flex flex-col">
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto space-y-6">
          {/* OVERVIEW */}
          {tab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
                  <p className="text-xs text-[#77827B]">Active Deliveries</p>
                  <p className="font-display text-2xl font-bold text-[#123C32] font-mono-tabular mt-1">
                    {activeJobs.length}
                  </p>
                </div>
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
                  <p className="text-xs text-[#77827B]">Total Dispatched</p>
                  <p className="font-display text-2xl font-bold text-[#17231F] font-mono-tabular mt-1">
                    {jobs.length}
                  </p>
                </div>
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
                  <p className="text-xs text-[#77827B]">Completed</p>
                  <p className="font-display text-2xl font-bold text-emerald-800 font-mono-tabular mt-1">
                    {jobs.filter((j) => j.deliveryStatus === 'DELIVERED').length}
                  </p>
                </div>
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
                  <p className="text-xs text-[#77827B]">Confirmed M-Pesa Paid</p>
                  <p className="font-display text-2xl font-bold text-[#17231F] font-mono-tabular mt-1">
                    {formatKes(totalSpent)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-8 bg-white border border-[#E3E7E2] rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display font-semibold text-base text-[#17231F]">
                      Live Deliveries
                    </h2>
                    <button
                      type="button"
                      onClick={() => setTab('active')}
                      className="text-xs font-semibold text-[#123C32] hover:underline cursor-pointer"
                    >
                      View all active
                    </button>
                  </div>
                  {activeJobs.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[#77827B] space-y-3">
                      <p>No active deliveries right now.</p>
                      <button
                        type="button"
                        onClick={() => setTab('new_delivery')}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#123C32] text-white text-xs font-semibold cursor-pointer"
                      >
                        <PackagePlus className="w-4 h-4" />
                        <span>Dispatch a Rider</span>
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-[#E3E7E2]">
                      {activeJobs.slice(0, 5).map((j) => (
                        <div key={j.jobId} className="py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#17231F] truncate">
                              <span className="font-mono-tabular text-[#123C32]">{j.referenceCode}</span>{' '}
                              · {j.customerName}
                            </p>
                            <p className="text-xs text-[#77827B] truncate">{j.deliveryAddress}</p>
                          </div>
                          <div className="text-right shrink-0 space-y-0.5">
                            <DeliveryStatusText status={j.deliveryStatus} />
                            <p className="text-[11px] font-mono-tabular text-[#77827B]">
                              {formatKes(j.deliveryFee)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="lg:col-span-4 bg-white border border-[#E3E7E2] rounded-xl overflow-hidden flex flex-col">
                  <div className="h-40 bg-[#EFF2EC]">
                    <img
                      src="/src/assets/images/nairobi_merchant_parcel_1795092089071.jpg"
                      alt="Shop parcel preparation"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-5 space-y-2 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="font-display font-semibold text-sm text-[#17231F]">
                        Ready to Send a Parcel?
                      </h3>
                      <p className="text-xs text-[#77827B] mt-1 leading-relaxed">
                        Set the customer dropoff pin, verify Westlands coverage, and trigger M-Pesa STK Push in one workflow.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTab('new_delivery')}
                      className="mt-3 w-full py-2.5 rounded-lg bg-[#D5FF70] text-[#123C32] text-xs font-bold hover:bg-[#c8f75a] cursor-pointer"
                    >
                      Create New Delivery
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* NEW DELIVERY */}
          {tab === 'new_delivery' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <form
                onSubmit={handleCreateDelivery}
                className="lg:col-span-7 bg-white border border-[#E3E7E2] rounded-xl p-5 sm:p-6 space-y-5"
              >
                <div>
                  <h2 className="font-display text-lg font-bold text-[#17231F]">
                    Create Delivery Dispatch
                  </h2>
                  <p className="text-xs text-[#77827B]">
                    Pin customer dropoff to compute road distance, fee breakdown, and PINs.
                  </p>
                </div>

                {createdReceipt && (
                  <div className="bg-[#123C32] text-white rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-[#D5FF70]">
                        {createdReceipt.referenceCode} CREATED
                      </span>
                      <button
                        type="button"
                        onClick={() => setCreatedReceipt(null)}
                        className="text-xs text-white/70 hover:text-white cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="bg-white/10 rounded-lg p-2.5">
                        <p className="text-white/70">Merchant Pickup PIN</p>
                        <p className="font-mono-tabular text-lg font-bold text-[#D5FF70]">
                          {createdReceipt.pickupPin}
                        </p>
                        <p className="text-[10px] text-white/65">Give to rider at collection</p>
                      </div>
                      <div className="bg-white/10 rounded-lg p-2.5">
                        <p className="text-white/70">Customer Delivery PIN</p>
                        <p className="font-mono-tabular text-lg font-bold text-[#D5FF70]">
                          {createdReceipt.deliveryPin}
                        </p>
                        <p className="text-[10px] text-white/65">Share with recipient only</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          const url = `${window.location.origin}/track/${createdReceipt.rawTrackingToken}`;
                          void navigator.clipboard?.writeText(url);
                          pushToast({ kind: 'success', title: 'Tracking link copied' });
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D5FF70] text-[#123C32] text-xs font-bold cursor-pointer"
                      >
                        <ClipboardCopy className="w-3.5 h-3.5" />
                        <span>Copy Tracking Link</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigateTrack(createdReceipt.rawTrackingToken)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 text-white text-xs font-semibold hover:bg-white/25 cursor-pointer"
                      >
                        <span>Open Live Tracker</span>
                      </button>
                    </div>
                    {stkFeedback && (
                      <p className="text-[11px] text-[#D5FF70]/90 border-t border-white/15 pt-2">
                        M-Pesa STK Status: {stkFeedback}
                      </p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#17231F] mb-1">
                      Customer Name
                    </label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Grace Muthoni"
                      className="w-full px-3.5 py-2.5 text-sm border border-[#E3E7E2] rounded-lg focus:outline-none focus:border-[#123C32]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#17231F] mb-1">
                      Customer Phone (Kenyan)
                    </label>
                    <input
                      type="tel"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="0722 123 456"
                      className="w-full px-3.5 py-2.5 text-sm border border-[#E3E7E2] rounded-lg font-mono focus:outline-none focus:border-[#123C32]"
                    />
                  </div>
                </div>

                <PlacesAddressInput
                  label="Pickup Location"
                  value={pickupAddress}
                  hasMapsKey={hasMapsKey}
                  onChangeText={setPickupAddress}
                  onSelectPlace={(res) => {
                    setPickupAddress(res.address);
                    setPickupCoords(res.location);
                  }}
                />

                <PlacesAddressInput
                  label="Customer Dropoff Location"
                  value={dropoffAddress}
                  hasMapsKey={hasMapsKey}
                  onChangeText={setDropoffAddress}
                  onSelectPlace={(res) => {
                    setDropoffAddress(res.address);
                    setDropoffCoords(res.location);
                  }}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#17231F] mb-1">
                      Pickup Instructions
                    </label>
                    <input
                      type="text"
                      value={pickupInstructions}
                      onChange={(e) => setPickupInstructions(e.target.value)}
                      placeholder="Ground floor counter, ask for Mercy"
                      className="w-full px-3.5 py-2 text-sm border border-[#E3E7E2] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#17231F] mb-1">
                      Delivery Instructions
                    </label>
                    <input
                      type="text"
                      value={dropoffInstructions}
                      onChange={(e) => setDropoffInstructions(e.target.value)}
                      placeholder="Call at security gate"
                      className="w-full px-3.5 py-2 text-sm border border-[#E3E7E2] rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#17231F] mb-1">
                      Category
                    </label>
                    <select
                      value={packageCategory}
                      onChange={(e) => setPackageCategory(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#E3E7E2] rounded-lg bg-white"
                    >
                      <option>Boutique / Retail</option>
                      <option>Electronics</option>
                      <option>Pharmacy</option>
                      <option>Documents</option>
                      <option>Food & Bakery</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#17231F] mb-1">
                      Package Size
                    </label>
                    <select
                      value={packageSize}
                      onChange={(e) => setPackageSize(e.target.value as PackageSize)}
                      className="w-full px-3 py-2 text-sm border border-[#E3E7E2] rounded-lg bg-white"
                    >
                      <option value="SMALL">Small (Boda Box)</option>
                      <option value="MEDIUM">Medium (+KES 20)</option>
                      <option value="LARGE">Large (+KES 60)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#17231F] mb-1">
                      Handling
                    </label>
                    <select
                      value={specialHandling}
                      onChange={(e) => setSpecialHandling(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#E3E7E2] rounded-lg bg-white"
                    >
                      <option value="NONE">Standard</option>
                      <option value="FRAGILE">Fragile (+KES 50+)</option>
                      <option value="KEEP_UPRIGHT">Keep Upright (+KES 50+)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#17231F] mb-1">
                    Package Description
                  </label>
                  <input
                    type="text"
                    value={packageDescription}
                    onChange={(e) => setPackageDescription(e.target.value)}
                    placeholder="Sealed gift box, 1.5kg"
                    className="w-full px-3.5 py-2 text-sm border border-[#E3E7E2] rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#17231F] mb-1">
                    M-Pesa STK Push Number (Delivery Fee Only)
                  </label>
                  <div className="relative">
                    <Smartphone className="w-4 h-4 text-[#77827B] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      value={mpesaPhone}
                      onChange={(e) => setMpesaPhone(e.target.value)}
                      placeholder="254712345678"
                      className="w-full pl-9 pr-3 py-2 text-sm border border-[#E3E7E2] rounded-lg font-mono"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={creatingJob || Boolean(zoneCheck && !zoneCheck.supported)}
                  className="w-full py-3 rounded-lg bg-[#123C32] text-white text-sm font-semibold hover:bg-[#0D2E26] disabled:opacity-50 cursor-pointer"
                >
                  {creatingJob
                    ? 'Creating Delivery & Initiating STK...'
                    : `Dispatch Rider · ${formatKes(quote.deliveryFee)}`}
                </button>
              </form>

              {/* Right Column: Live Map + Fee Summary */}
              <div className="lg:col-span-5 space-y-4">
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#17231F]">
                      Route & Dropoff Pin (Click map to drop pin)
                    </span>
                    <span className="font-mono-tabular text-[#77827B]">
                      {routeSource === 'GOOGLE_ROUTES' ? 'Google Routes' : 'Est. Distance'}
                    </span>
                  </div>
                  <DeliveryRouteMap
                    hasMapsKey={hasMapsKey}
                    pickup={pickupCoords}
                    pickupLabel={shop.shopName}
                    dropoff={dropoffCoords}
                    dropoffLabel={dropoffAddress || 'Customer Dropoff'}
                    heightClass="h-72"
                    onMapClick={(coords) => {
                      setDropoffCoords(coords);
                      if (!dropoffAddress) {
                        setDropoffAddress(
                          `Pinned Location (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`
                        );
                      }
                    }}
                    onRouteComputed={(res) => {
                      setRouteDistanceKm(res.distanceKm);
                      setRouteDurationMins(res.durationMinutes);
                      setRouteSource(res.source);
                    }}
                  />
                </div>

                <div className="bg-white border border-[#E3E7E2] rounded-xl p-5 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display font-semibold text-sm text-[#17231F]">
                      Pricing & Zone Check
                    </h3>
                    {zoneCheck && (
                      <span
                        className={`font-semibold ${
                          zoneCheck.supported ? 'text-emerald-800' : 'text-red-700'
                        }`}
                      >
                        {zoneCheck.supported
                          ? `Supported (${zoneCheck.zone?.zoneName || 'Westlands'})`
                          : `Outside Zone (${zoneCheck.distanceFromCenterKm} km)`}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-[#E3E7E2]">
                    <div className="flex justify-between">
                      <span className="text-[#77827B]">Road Distance & ETA</span>
                      <span className="font-mono-tabular font-semibold text-[#17231F]">
                        {quote.roadDistanceKm.toFixed(1)} km · ~{routeDurationMins} mins
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#77827B]">Size / Handling Surcharge</span>
                      <span className="font-mono-tabular text-[#17231F]">
                        {formatKes(quote.surcharges)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#77827B]">Rider Share ({quote.riderPercentage}%)</span>
                      <span className="font-mono-tabular text-[#17231F]">
                        {formatKes(quote.riderEarning)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#77827B]">
                        Platform Share ({quote.platformPercentage}%)
                      </span>
                      <span className="font-mono-tabular text-[#17231F]">
                        {formatKes(quote.platformRevenue)}
                      </span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-[#E3E7E2] text-sm font-bold text-[#123C32]">
                      <span>Total Delivery Fee</span>
                      <span className="font-mono-tabular">{formatKes(quote.deliveryFee)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ACTIVE DELIVERIES */}
          {tab === 'active' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-6 bg-white border border-[#E3E7E2] rounded-xl divide-y divide-[#E3E7E2]">
                <div className="p-4 flex items-center justify-between">
                  <h2 className="font-display font-semibold text-sm text-[#17231F]">
                    Active Dispatches ({activeJobs.length})
                  </h2>
                </div>
                {activeJobs.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#77827B]">
                    No active jobs. Create a delivery to dispatch a rider.
                  </div>
                ) : (
                  activeJobs.map((j) => (
                    <button
                      key={j.jobId}
                      type="button"
                      onClick={() => setSelectedJob(j)}
                      className={`w-full text-left p-4 hover:bg-[#F7F8F5] transition-colors cursor-pointer ${
                        selectedJob?.jobId === j.jobId ? 'bg-[#F7F8F5]' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono-tabular text-xs font-bold text-[#123C32]">
                          {j.referenceCode}
                        </span>
                        <DeliveryStatusText status={j.deliveryStatus} />
                      </div>
                      <p className="text-sm font-medium text-[#17231F] mt-1">{j.customerName}</p>
                      <p className="text-xs text-[#77827B] truncate">{j.deliveryAddress}</p>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-[#77827B]">
                        <span>{j.riderName ? `Rider: ${j.riderName}` : 'Unassigned'}</span>
                        <PaymentStatusText status={j.paymentStatus} />
                      </div>
                    </button>
                  ))
                )}
              </div>

              <div className="lg:col-span-6">
                {selectedJob ? (
                  <div className="bg-white border border-[#E3E7E2] rounded-xl p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono-tabular text-xs font-bold text-[#123C32]">
                          {selectedJob.referenceCode}
                        </p>
                        <h3 className="font-display text-base font-bold text-[#17231F]">
                          {selectedJob.customerName} · {selectedJob.customerPhone}
                        </h3>
                      </div>
                      {['PENDING_DISPATCH', 'ASSIGNED', 'ACCEPTED'].includes(
                        selectedJob.deliveryStatus
                      ) && (
                        <button
                          type="button"
                          onClick={() => {
                            setPromptInput('');
                            setMerchantPrompt({
                              title: `Cancel Dispatch ${selectedJob.referenceCode}`,
                              label: 'Reason for cancelling this delivery',
                              placeholder: 'e.g. Customer rescheduled order',
                              submitLabel: 'Cancel Job',
                              onSubmit: async (reason) => {
                                await cancelJobTransaction(
                                  selectedJob,
                                  profile.uid,
                                  reason || 'Cancelled by merchant'
                                );
                                pushToast({ kind: 'info', title: 'Delivery cancelled' });
                                setSelectedJob(null);
                              },
                            });
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Cancel Job</span>
                        </button>
                      )}
                    </div>

                    <DeliveryRouteMap
                      hasMapsKey={hasMapsKey}
                      pickup={selectedJob.pickupCoordinates}
                      pickupLabel={selectedJob.shopName}
                      dropoff={selectedJob.deliveryCoordinates}
                      dropoffLabel={selectedJob.deliveryAddress}
                      heightClass="h-56"
                    />

                    {selectedEvidence && (
                      <div className="border border-[#E3E7E2] rounded-xl p-3 space-y-2 bg-[#F7F8F5]">
                        <p className="text-xs font-semibold text-[#17231F]">
                          Rider Pickup Parcel Photo
                        </p>
                        <img
                          src={selectedEvidence.dataUrl}
                          alt="Pickup parcel evidence"
                          className="w-full max-h-48 object-contain rounded-lg bg-white border border-[#E3E7E2]"
                        />
                      </div>
                    )}

                    <div className="border-t border-[#E3E7E2] pt-3">
                      <p className="text-xs font-semibold text-[#17231F] mb-2">Job Timeline</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {selectedEvents.map((ev) => (
                          <div key={ev.eventId} className="text-xs flex justify-between gap-2">
                            <span className="text-[#17231F]">{ev.notes || ev.eventType}</span>
                            <span className="font-mono-tabular text-[#77827B] shrink-0">
                              {formatTimestamp(ev.createdAt)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white border border-[#E3E7E2] rounded-xl p-10 text-center text-xs text-[#77827B]">
                    Select a delivery on the left to inspect its live map and timeline.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* HISTORY */}
          {tab === 'history' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl overflow-hidden">
              <div className="p-4 border-b border-[#E3E7E2] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="font-display font-semibold text-sm text-[#17231F]">
                  Delivery History ({historyJobs.length})
                </h2>
                <input
                  type="text"
                  value={historyFilter}
                  onChange={(e) => setHistoryFilter(e.target.value)}
                  placeholder="Filter by ref or customer..."
                  className="px-3 py-1.5 text-xs border border-[#E3E7E2] rounded-lg focus:outline-none focus:border-[#123C32]"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F7F8F5] border-b border-[#E3E7E2] text-[#77827B]">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Ref</th>
                      <th className="py-3 px-4 font-semibold">Customer</th>
                      <th className="py-3 px-4 font-semibold">Dropoff</th>
                      <th className="py-3 px-4 font-semibold">Distance</th>
                      <th className="py-3 px-4 font-semibold">Fee</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                      <th className="py-3 px-4 font-semibold">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3E7E2]">
                    {historyJobs
                      .filter(
                        (j) =>
                          !historyFilter ||
                          j.referenceCode.toLowerCase().includes(historyFilter.toLowerCase()) ||
                          j.customerName.toLowerCase().includes(historyFilter.toLowerCase())
                      )
                      .map((j) => (
                        <tr key={j.jobId} className="hover:bg-[#F7F8F5]/60">
                          <td className="py-3 px-4 font-mono-tabular font-semibold text-[#123C32]">
                            {j.referenceCode}
                          </td>
                          <td className="py-3 px-4">{j.customerName}</td>
                          <td className="py-3 px-4 max-w-[220px] truncate">{j.deliveryAddress}</td>
                          <td className="py-3 px-4 font-mono-tabular">
                            {j.roadDistanceKm.toFixed(1)} km
                          </td>
                          <td className="py-3 px-4 font-mono-tabular">{formatKes(j.deliveryFee)}</td>
                          <td className="py-3 px-4">
                            <DeliveryStatusText status={j.deliveryStatus} />
                          </td>
                          <td className="py-3 px-4 font-mono-tabular text-[#77827B]">
                            {formatTimestamp(j.createdAt)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TRANSACTIONS */}
          {tab === 'transactions' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl overflow-hidden">
              <div className="p-4 border-b border-[#E3E7E2]">
                <h2 className="font-display font-semibold text-sm text-[#17231F]">
                  M-Pesa Daraja Payment Records
                </h2>
                <p className="text-xs text-[#77827B]">
                  Payments are only marked PAID after verified Daraja callback confirmation or admin reconciliation.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F7F8F5] border-b border-[#E3E7E2] text-[#77827B]">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Payment ID</th>
                      <th className="py-3 px-4 font-semibold">Amount</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                      <th className="py-3 px-4 font-semibold">Receipt / Checkout ID</th>
                      <th className="py-3 px-4 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3E7E2]">
                    {payments.map((p) => (
                      <tr key={p.paymentId}>
                        <td className="py-3 px-4 font-mono-tabular">{p.paymentId}</td>
                        <td className="py-3 px-4 font-mono-tabular font-semibold">
                          {formatKes(p.amount)}
                        </td>
                        <td className="py-3 px-4">
                          <PaymentStatusText status={p.paymentStatus} />
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-[#77827B]">
                          {p.mpesaReceiptNumber || p.checkoutRequestId || p.failureReason || '—'}
                        </td>
                        <td className="py-3 px-4 space-x-2">
                          {p.paymentStatus !== 'PAID' && (
                            <button
                              type="button"
                              onClick={() => void handleRetryStk(p)}
                              className="text-xs font-semibold text-[#123C32] hover:underline cursor-pointer"
                            >
                              Trigger STK Push
                            </button>
                          )}
                          {p.checkoutRequestId && p.paymentStatus === 'PENDING_STK' && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const status = await checkMpesaCallbackStatus(
                                    p.checkoutRequestId!
                                  );
                                  pushToast({
                                    kind: 'info',
                                    title: `Daraja Status: ${status.status}`,
                                    description: status.mpesaReceiptNumber || status.resultDesc,
                                  });
                                } catch (err: any) {
                                  pushToast({
                                    kind: 'error',
                                    title: 'Status check',
                                    description: err?.message,
                                  });
                                }
                              }}
                              className="text-xs font-semibold text-[#77827B] hover:text-[#17231F] cursor-pointer"
                            >
                              Query Status
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* STATEMENTS */}
          {tab === 'statements' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl p-6 space-y-4 max-w-2xl">
              <h2 className="font-display text-base font-bold text-[#17231F]">
                Monthly Delivery & Fee Statements
              </h2>
              <p className="text-xs text-[#77827B] leading-relaxed">
                Generate a branded PDF statement summarizing completed dispatches, road distances, and confirmed M-Pesa delivery fee charges for {shop.shopName}.
              </p>
              <button
                type="button"
                onClick={() =>
                  downloadMerchantStatementPdf(
                    shop,
                    jobs,
                    payments,
                    new Date().toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })
                  )
                }
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#123C32] text-white text-xs font-semibold hover:bg-[#0D2E26] cursor-pointer"
              >
                <FileDown className="w-4 h-4" />
                <span>Download PDF Statement ({jobs.length} jobs)</span>
              </button>
            </div>
          )}

          {/* SHOP PROFILE */}
          {tab === 'profile' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl p-6 max-w-2xl space-y-4">
              <h2 className="font-display text-base font-bold text-[#17231F]">Shop Profile</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">Shop Name</label>
                  <input
                    type="text"
                    value={editShopName}
                    onChange={(e) => setEditShopName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E3E7E2] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E3E7E2] rounded-lg font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Operating Hours</label>
                <input
                  type="text"
                  value={editHours}
                  onChange={(e) => setEditHours(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E3E7E2] rounded-lg"
                />
              </div>
              <PlacesAddressInput
                label="Physical Address"
                value={editAddress}
                hasMapsKey={hasMapsKey}
                onChangeText={setEditAddress}
                onSelectPlace={(res) => {
                  setEditAddress(res.address);
                  setEditLocation(res.location);
                }}
              />
              <button
                type="button"
                onClick={async () => {
                  await updateShopProfileByMerchant(shop.shopId, {
                    shopName: editShopName,
                    phoneNumber: editPhone,
                    operatingHours: editHours,
                    physicalAddress: editAddress,
                    location: editLocation,
                  });
                  pushToast({ kind: 'success', title: 'Shop profile updated' });
                }}
                className="px-4 py-2.5 rounded-lg bg-[#123C32] text-white text-xs font-semibold hover:bg-[#0D2E26] cursor-pointer"
              >
                Save Changes
              </button>
            </div>
          )}

          {/* SUPPORT */}
          {tab === 'support' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (ticketDesc.trim().length < 5) return;
                  await createSupportTicket({
                    createdBy: profile.uid,
                    creatorRole: 'MERCHANT',
                    jobId: ticketJobId,
                    issueType: ticketType,
                    description: ticketDesc,
                  });
                  setTicketDesc('');
                  setTicketJobId('');
                  pushToast({ kind: 'success', title: 'Support ticket submitted' });
                }}
                className="lg:col-span-5 bg-white border border-[#E3E7E2] rounded-xl p-5 space-y-4"
              >
                <h2 className="font-display font-semibold text-sm text-[#17231F]">
                  Contact Dispatch Support
                </h2>
                <div>
                  <label className="block text-xs font-semibold mb-1">Issue Type</label>
                  <select
                    value={ticketType}
                    onChange={(e) => setTicketType(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E3E7E2] rounded-lg bg-white"
                  >
                    <option>Delivery Delay</option>
                    <option>M-Pesa Reconciliation</option>
                    <option>Rider Conduct / Pickup</option>
                    <option>Zone Coverage Request</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Job ID (Optional)</label>
                  <input
                    type="text"
                    value={ticketJobId}
                    onChange={(e) => setTicketJobId(e.target.value)}
                    placeholder="job_..."
                    className="w-full px-3 py-2 text-sm border border-[#E3E7E2] rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Details</label>
                  <textarea
                    rows={4}
                    required
                    value={ticketDesc}
                    onChange={(e) => setTicketDesc(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E3E7E2] rounded-lg"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-lg bg-[#123C32] text-white text-xs font-semibold cursor-pointer"
                >
                  Open Ticket
                </button>
              </form>

              <div className="lg:col-span-7 bg-white border border-[#E3E7E2] rounded-xl divide-y divide-[#E3E7E2]">
                <div className="p-4 font-display font-semibold text-sm text-[#17231F]">
                  Your Support Tickets ({tickets.length})
                </div>
                {tickets.length === 0 ? (
                  <div className="p-6 text-xs text-[#77827B]">No support tickets opened yet.</div>
                ) : (
                  tickets.map((t) => (
                    <div key={t.ticketId} className="p-4 space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[#17231F]">{t.issueType}</span>
                        <span className="font-mono-tabular font-semibold text-[#123C32]">
                          {t.status}
                        </span>
                      </div>
                      <p className="text-[#77827B]">{t.description}</p>
                      {t.resolutionNotes && (
                        <p className="text-emerald-800 pt-1">Resolution: {t.resolutionNotes}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* SETTINGS */}
          {tab === 'settings' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl p-6 max-w-xl space-y-4 text-xs">
              <h2 className="font-display text-base font-bold text-[#17231F]">
                Merchant Account Settings
              </h2>
              <p className="text-[#77827B]">
                Signed in as <span className="font-semibold text-[#17231F]">{profile.email}</span> · Role:{' '}
                <span className="font-mono-tabular text-[#123C32]">{profile.role}</span>
              </p>
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <PWAInstallButton showWhenInstalled />
                <button
                  type="button"
                  onClick={() => void signOut(auth)}
                  className="px-4 py-2 rounded-lg border border-[#E3E7E2] text-[#17231F] font-semibold hover:bg-[#F7F8F5] cursor-pointer"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </main>
        </PullToRefresh>
      </div>

      {merchantPrompt && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setPromptBusy(true);
              try {
                await merchantPrompt.onSubmit(promptInput.trim());
                setMerchantPrompt(null);
              } catch (err: any) {
                pushToast({
                  kind: 'error',
                  title: 'Action failed',
                  description: err?.message,
                });
              } finally {
                setPromptBusy(false);
              }
            }}
            className="bg-white border border-[#E3E7E2] rounded-2xl max-w-md w-full p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display font-bold text-base text-[#17231F]">
                {merchantPrompt.title}
              </h3>
              <button
                type="button"
                onClick={() => setMerchantPrompt(null)}
                className="p-1 text-[#77827B] hover:text-[#17231F] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#17231F] mb-1">
                {merchantPrompt.label}
              </label>
              <input
                type="text"
                required
                autoFocus
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                placeholder={merchantPrompt.placeholder}
                className="w-full px-3.5 py-2.5 text-sm border border-[#E3E7E2] rounded-lg focus:outline-none focus:border-[#123C32]"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setMerchantPrompt(null)}
                className="min-h-[40px] px-4 rounded-xl border border-[#E3E7E2] text-xs font-semibold text-[#17231F] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={promptBusy}
                className="min-h-[40px] px-4 rounded-xl bg-[#123C32] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {promptBusy ? 'Working...' : merchantPrompt.submitLabel}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
