import React, { useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import {
  AlertTriangle,
  Bike,
  Camera,
  CheckCircle2,
  ClipboardList,
  History,
  Home,
  LogOut,
  MapPin,
  Navigation,
  Phone,
  ShieldCheck,
  User,
  Wallet,
} from 'lucide-react';
import { auth } from '../firebase/config';
import type {
  DeliveryJob,
  DeliveryStatus,
  LatLng,
  Rider,
  RiderSettlement,
  RiderVerificationDoc,
  UserProfile,
  VerificationDocKey,
} from '../types/fikaboda';
import {
  acceptJobTransaction,
  advanceJobStatusTransaction,
  createRiderApplication,
  subscribeToAvailableJobs,
  subscribeToRiderByUid,
  subscribeToRiderJobs,
  subscribeToRiderVerificationDocs,
  subscribeToSettlementsByRider,
  updateRiderAvailabilityAndLocation,
  updateRiderVerificationDocAndRef,
  uploadRiderVerificationDoc,
} from '../services/firestoreService';
import { formatKenyanPhone, formatKes, formatTimestamp, isValidKenyanPhone } from '../utils/crypto';
import { validateVerificationDocFile } from '../utils/fileDocs';
import { getDeliveryStatusLabel, RIDER_NEXT_STATUS } from '../utils/statusMachine';
import { FikaBodaLogo } from '../components/FikaBodaLogo';
import { NotificationsBell } from '../components/NotificationsBell';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { PullToRefresh } from '../components/PullToRefresh';
import { DeliveryStatusText } from '../components/StatusBadge';
import { DeliveryRouteMap } from '../components/Maps/DeliveryRouteMap';
import { useToast } from '../components/ToastProvider';

type RiderTab = 'home' | 'available' | 'active' | 'earnings' | 'history' | 'profile';

export const RiderPortal: React.FC<{
  profile: UserProfile;
  hasMapsKey: boolean;
}> = ({ profile, hasMapsKey }) => {
  const [rider, setRider] = useState<Rider | null | undefined>(undefined);
  const [riderDocs, setRiderDocs] = useState<RiderVerificationDoc[]>([]);
  const [tab, setTab] = useState<RiderTab>('home');
  const [availableJobs, setAvailableJobs] = useState<DeliveryJob[]>([]);
  const [myJobs, setMyJobs] = useState<DeliveryJob[]>([]);
  const [settlements, setSettlements] = useState<RiderSettlement[]>([]);
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [liveCoords, setLiveCoords] = useState<LatLng | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const watchIdRef = useRef<number | null>(null);
  const lastSyncRef = useRef<number>(0);
  const { pushToast } = useToast();

  // Onboarding state
  const [obName, setObName] = useState(profile.fullName);
  const [obPhone, setObPhone] = useState(profile.phoneNumber);
  const [obNationalId, setObNationalId] = useState('');
  const [obLicence, setObLicence] = useState('');
  const [obPlate, setObPlate] = useState('');
  const [obInsurance, setObInsurance] = useState('');
  const [obEmergency, setObEmergency] = useState('');
  const [idFile, setIdFile] = useState<File | null>(null);
  const [licenceFile, setLicenceFile] = useState<File | null>(null);
  const [insuranceFile, setInsuranceFile] = useState<File | null>(null);
  const [obBusy, setObBusy] = useState(false);
  const [obError, setObError] = useState<string | null>(null);
  const [reuploadKey, setReuploadKey] = useState<VerificationDocKey | null>(null);

  // Active delivery step PIN, photo & issue reporting state
  const [pinInput, setPinInput] = useState('');
  const [pickupPhoto, setPickupPhoto] = useState<File | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [acceptingJobId, setAcceptingJobId] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueReason, setIssueReason] = useState('');

  useEffect(() => {
    const u1 = subscribeToRiderByUid(profile.uid, setRider);
    const u2 = subscribeToAvailableJobs(setAvailableJobs);
    const u3 = subscribeToRiderJobs(profile.uid, setMyJobs);
    const u4 = subscribeToSettlementsByRider(profile.uid, setSettlements);
    const u5 = subscribeToRiderVerificationDocs(profile.uid, setRiderDocs);
    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
    };
  }, [profile.uid, refreshTick]);

  const handleRefresh = async () => {
    setRefreshTick((t) => t + 1);
    await auth.currentUser?.reload().catch(() => {});
  };

  const assignedJobs = myJobs.filter((j) => j.deliveryStatus === 'ASSIGNED');
  const inProgressJob =
    myJobs.find(
      (j) =>
        ![
          'PENDING_DISPATCH',
          'ASSIGNED',
          'DELIVERED',
          'CANCELLED',
          'RETURNED',
          'FAILED',
        ].includes(j.deliveryStatus)
    ) || null;
  const activeJob = inProgressJob || assignedJobs[0] || null;

  // Controlled GPS watchPosition when enabled & rider approved
  useEffect(() => {
    if (!gpsEnabled || !rider || rider.approvalStatus !== 'APPROVED') {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!('geolocation' in navigator)) {
      setGpsError('Geolocation is not supported in this browser.');
      return;
    }

    setGpsError(null);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const coords: LatLng = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        setLiveCoords(coords);
        const now = Date.now();
        if (now - lastSyncRef.current > 9000) {
          lastSyncRef.current = now;
          const nextStatus = activeJob ? 'ON_DELIVERY' : rider.availabilityStatus;
          void updateRiderAvailabilityAndLocation({
            riderId: rider.riderId,
            availabilityStatus: nextStatus === 'OFFLINE' ? 'ONLINE' : nextStatus,
            location: coords,
            activeTrackingTokenHash: activeJob?.customerTrackingTokenHash || null,
          }).catch(() => {});
        }
      },
      (err) => {
        setGpsError(`GPS error: ${err.message}`);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [gpsEnabled, rider?.riderId, rider?.approvalStatus, activeJob?.jobId]);

  const handleOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    setObError(null);
    if (obName.trim().length < 2) {
      setObError('Full legal name must be at least 2 characters.');
      return;
    }
    if (!isValidKenyanPhone(obPhone)) {
      const msg = 'Enter a valid Kenyan mobile number (e.g. 0712 345 678 or 254712345678).';
      setObError(msg);
      pushToast({ kind: 'error', title: 'Invalid Kenyan mobile number', description: msg });
      return;
    }
    if (obNationalId.trim().length < 4) {
      setObError('National ID number must be at least 4 characters.');
      return;
    }
    if (obPlate.trim().length < 4) {
      setObError('Motorcycle registration plate must be at least 4 characters.');
      return;
    }

    setObBusy(true);
    try {
      const verificationDocRefs: Record<string, string> = {};
      const uploadErrors: string[] = [];

      const tryUpload = async (key: VerificationDocKey, file: File | null) => {
        if (!file) return;
        const check = validateVerificationDocFile(file);
        if (!check.valid) {
          uploadErrors.push(check.error || file.name);
          return;
        }
        try {
          verificationDocRefs[key] = await uploadRiderVerificationDoc(profile.uid, key, file);
        } catch (err: any) {
          uploadErrors.push(`${file.name}: ${err?.message || 'upload failed'}`);
        }
      };

      await Promise.all([
        tryUpload('nationalId', idFile),
        tryUpload('drivingLicence', licenceFile),
        tryUpload('insurance', insuranceFile),
      ]);

      if (uploadErrors.length > 0) {
        setObError(uploadErrors.join(' '));
        pushToast({
          kind: 'error',
          title: 'Document check failed',
          description: uploadErrors[0],
        });
        setObBusy(false);
        return;
      }

      await createRiderApplication({
        uid: profile.uid,
        fullName: obName,
        phoneNumber: formatKenyanPhone(obPhone),
        email: profile.email,
        nationalIdReference: obNationalId,
        drivingLicenceRef: obLicence,
        motorcycleRegistration: obPlate,
        insuranceDetails: obInsurance,
        emergencyContact: obEmergency,
        verificationDocRefs,
      });

      pushToast({
        kind: 'success',
        title: 'Rider application & documents submitted',
        description: 'Your verification details and documents are ready for admin inspection.',
      });
    } catch (err: any) {
      let msg = err?.message || 'Could not submit rider application.';
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.error) msg = parsed.error;
      } catch {
        // use raw message
      }
      setObError(msg);
      pushToast({ kind: 'error', title: 'Onboarding failed', description: msg });
    } finally {
      setObBusy(false);
    }
  };

  if (rider === undefined) {
    return (
      <div className="min-h-screen bg-[#F7F8F5] flex items-center justify-center text-sm text-[#77827B]">
        Loading FikaBoda Rider Console...
      </div>
    );
  }

  // Onboarding Form
  if (rider === null) {
    return (
      <div className="min-h-screen bg-[#F7F8F5]">
        <header className="bg-white border-b border-[#E3E7E2] px-4 h-14 flex items-center justify-between">
          <FikaBodaLogo size="sm" />
          <button
            type="button"
            onClick={() => void signOut(auth)}
            className="text-xs font-semibold text-[#77827B] hover:text-[#17231F] inline-flex items-center gap-1 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-6">
          <div className="bg-white border border-[#E3E7E2] rounded-2xl p-6 space-y-5">
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-[#123C32] font-semibold">
                Rider Verification · Nairobi
              </p>
              <h1 className="font-display text-xl font-bold text-[#17231F] mt-1">
                Complete Rider Onboarding
              </h1>
              <p className="text-xs text-[#77827B] mt-1">
                Verification documents are stored securely for administrator inspection and compliance approval.
              </p>
            </div>

            <form onSubmit={handleOnboarding} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold mb-1">Full Legal Name</label>
                  <input
                    type="text"
                    required
                    value={obName}
                    onChange={(e) => setObName(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-[#E3E7E2] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">M-Pesa Phone Number</label>
                  <input
                    type="tel"
                    required
                    value={obPhone}
                    onChange={(e) => setObPhone(e.target.value)}
                    placeholder="0712 345 678"
                    className="w-full px-3 py-2.5 text-sm border border-[#E3E7E2] rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold mb-1">National ID Number</label>
                  <input
                    type="text"
                    required
                    value={obNationalId}
                    onChange={(e) => setObNationalId(e.target.value)}
                    placeholder="34567890"
                    className="w-full px-3 py-2.5 text-sm border border-[#E3E7E2] rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    Motorcycle Registration
                  </label>
                  <input
                    type="text"
                    required
                    value={obPlate}
                    onChange={(e) => setObPlate(e.target.value.toUpperCase())}
                    placeholder="KMDZ 412B"
                    className="w-full px-3 py-2.5 text-sm border border-[#E3E7E2] rounded-lg font-mono uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    NTSA Driving Licence Ref
                  </label>
                  <input
                    type="text"
                    required
                    value={obLicence}
                    onChange={(e) => setObLicence(e.target.value)}
                    placeholder="DL-FG-992104"
                    className="w-full px-3 py-2.5 text-sm border border-[#E3E7E2] rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Insurance Policy / Insurer</label>
                  <input
                    type="text"
                    required
                    value={obInsurance}
                    onChange={(e) => setObInsurance(e.target.value)}
                    placeholder="APA PSV/Boda Comprehensive"
                    className="w-full px-3 py-2.5 text-sm border border-[#E3E7E2] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Emergency Contact</label>
                <input
                  type="text"
                  required
                  value={obEmergency}
                  onChange={(e) => setObEmergency(e.target.value)}
                  placeholder="Mary Kiprop · 0722 000 111"
                  className="w-full px-3 py-2.5 text-sm border border-[#E3E7E2] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <label className="border border-dashed border-[#E3E7E2] rounded-xl p-3 text-xs cursor-pointer hover:border-[#123C32]">
                  <span className="font-semibold block text-[#17231F]">National ID Photo</span>
                  <span className="text-[11px] text-[#77827B] truncate block mt-1">
                    {idFile ? idFile.name : 'Upload JPG/PNG/PDF'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => setIdFile(e.target.files?.[0] || null)}
                  />
                </label>
                <label className="border border-dashed border-[#E3E7E2] rounded-xl p-3 text-xs cursor-pointer hover:border-[#123C32]">
                  <span className="font-semibold block text-[#17231F]">Driving Licence</span>
                  <span className="text-[11px] text-[#77827B] truncate block mt-1">
                    {licenceFile ? licenceFile.name : 'Upload JPG/PNG/PDF'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => setLicenceFile(e.target.files?.[0] || null)}
                  />
                </label>
                <label className="border border-dashed border-[#E3E7E2] rounded-xl p-3 text-xs cursor-pointer hover:border-[#123C32]">
                  <span className="font-semibold block text-[#17231F]">Insurance Cert</span>
                  <span className="text-[11px] text-[#77827B] truncate block mt-1">
                    {insuranceFile ? insuranceFile.name : 'Upload JPG/PNG/PDF'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => setInsuranceFile(e.target.files?.[0] || null)}
                  />
                </label>
              </div>

              {obError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 leading-relaxed">
                  {obError}
                </div>
              )}

              <button
                type="submit"
                disabled={obBusy}
                className="w-full min-h-[44px] py-3 rounded-xl bg-[#123C32] text-white text-sm font-semibold hover:bg-[#0D2E26] disabled:opacity-50 cursor-pointer"
              >
                {obBusy ? 'Uploading & Submitting...' : 'Submit Rider Application'}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  // Pending / Suspended / Rejected Gate
  if (rider.approvalStatus !== 'APPROVED') {
    const docItems: Array<{ key: VerificationDocKey; label: string }> = [
      { key: 'nationalId', label: 'National ID Photo' },
      { key: 'drivingLicence', label: 'NTSA Driving Licence' },
      { key: 'insurance', label: 'Insurance Certificate' },
    ];

    return (
      <PullToRefresh onRefresh={handleRefresh}>
        <div className="min-h-screen bg-[#F7F8F5] flex flex-col">
          <header className="bg-white border-b border-[#E3E7E2] px-4 h-14 flex items-center justify-between gap-2">
            <FikaBodaLogo size="sm" />
            <div className="flex items-center gap-2">
              <PWAInstallButton compact />
              <button
                type="button"
                onClick={() => void signOut(auth)}
                className="text-xs font-semibold text-[#77827B] hover:text-[#17231F] inline-flex items-center gap-1 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </header>
          <main className="flex-1 flex items-center justify-center p-4 sm:p-5">
            <div className="max-w-lg w-full bg-white border border-[#E3E7E2] rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h1 className="font-display text-lg font-bold text-[#17231F]">
                Rider Status: {rider.approvalStatus}
              </h1>
              <p className="text-xs text-[#77827B] leading-relaxed">
                {rider.approvalStatus === 'PENDING'
                  ? 'Your National ID, NTSA licence, and motorcycle insurance are queued for admin review. Pull down anytime to refresh your approval status.'
                  : 'Your rider profile is currently restricted from dispatch. Contact FikaBoda Operations for assistance.'}
              </p>
              <div className="bg-[#F7F8F5] border border-[#E3E7E2] rounded-xl p-4 text-xs space-y-1.5">
                <p>
                  <span className="text-[#77827B]">Plate:</span>{' '}
                  <span className="font-mono font-semibold">{rider.motorcycleRegistration}</span>
                </p>
                <p>
                  <span className="text-[#77827B]">Licence Check:</span>{' '}
                  {rider.licenceVerificationStatus}
                </p>
                <p>
                  <span className="text-[#77827B]">Insurance Check:</span>{' '}
                  {rider.insuranceVerificationStatus}
                </p>
              </div>

              <div className="space-y-2 pt-1">
                <p className="text-xs font-semibold text-[#17231F]">
                  Verification Documents ({riderDocs.length}/3 uploaded)
                </p>
                <div className="space-y-2">
                  {docItems.map((item) => {
                    const uploaded = riderDocs.find((d) => d.docKey === item.key);
                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-2 border border-[#E3E7E2] rounded-xl px-3 py-2.5 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-[#17231F]">{item.label}</p>
                          <p className="text-[11px] text-[#77827B] truncate">
                            {uploaded
                              ? `${uploaded.fileName} · ${uploaded.verificationStatus}`
                              : 'Not uploaded yet'}
                          </p>
                        </div>
                        <label className="shrink-0 px-3 py-1.5 rounded-lg bg-[#F7F8F5] border border-[#E3E7E2] hover:border-[#123C32] font-semibold text-[#123C32] cursor-pointer">
                          <span>
                            {reuploadKey === item.key
                              ? 'Saving...'
                              : uploaded
                                ? 'Replace'
                                : 'Upload'}
                          </span>
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            className="hidden"
                            disabled={reuploadKey !== null}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              setReuploadKey(item.key);
                              try {
                                await updateRiderVerificationDocAndRef(
                                  profile.uid,
                                  item.key,
                                  file,
                                  rider.verificationDocRefs || {}
                                );
                                pushToast({
                                  kind: 'success',
                                  title: `${item.label} uploaded`,
                                  description: 'Visible to FikaBoda Admin for verification.',
                                });
                              } catch (err: any) {
                                pushToast({
                                  kind: 'error',
                                  title: 'Upload failed',
                                  description: err?.message,
                                });
                              } finally {
                                setReuploadKey(null);
                              }
                            }}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </main>
        </div>
      </PullToRefresh>
    );
  }

  const nextStatus: DeliveryStatus | undefined = activeJob
    ? RIDER_NEXT_STATUS[activeJob.deliveryStatus]
    : undefined;

  const handleToggleOnline = async () => {
    const target = rider.availabilityStatus === 'ONLINE' ? 'OFFLINE' : 'ONLINE';
    try {
      await updateRiderAvailabilityAndLocation({
        riderId: rider.riderId,
        availabilityStatus: activeJob ? 'ON_DELIVERY' : target,
        location: liveCoords || undefined,
        activeTrackingTokenHash: activeJob?.customerTrackingTokenHash || null,
      });
      if (target === 'ONLINE') {
        setGpsEnabled(true);
      } else {
        setGpsEnabled(false);
      }
      pushToast({ kind: 'info', title: `Rider availability: ${target}` });
    } catch (err: any) {
      pushToast({
        kind: 'error',
        title: 'Availability update failed',
        description: err?.message,
      });
    }
  };

  const handleAdvanceStep = async () => {
    if (!activeJob || !nextStatus) return;
    setActionBusy(true);
    try {
      await advanceJobStatusTransaction({
        job: activeJob,
        actorUid: profile.uid,
        nextStatus,
        pinInput: nextStatus === 'PICKED_UP' || nextStatus === 'DELIVERED' ? pinInput : undefined,
        pickupPhotoFile: nextStatus === 'PICKED_UP' ? pickupPhoto : null,
        location: liveCoords || rider.currentLocation,
      });
      setPinInput('');
      setPickupPhoto(null);
      pushToast({
        kind: 'success',
        title: `Status updated: ${getDeliveryStatusLabel(nextStatus)}`,
      });
    } catch (err: any) {
      pushToast({ kind: 'error', title: 'Action failed', description: err?.message });
    } finally {
      setActionBusy(false);
    }
  };

  const handleAcceptJob = async (job: DeliveryJob) => {
    setAcceptingJobId(job.jobId);
    try {
      await acceptJobTransaction(job.jobId, rider);
      pushToast({
        kind: 'success',
        title: `Accepted ${job.referenceCode}`,
        description: 'Head to pickup shop and collect Parcel PIN.',
      });
      setTab('active');
    } catch (err: any) {
      let msg = err?.message || 'Unable to accept delivery job.';
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.error) msg = parsed.error;
      } catch {
        // keep plain error message
      }
      pushToast({
        kind: 'error',
        title: 'Could not claim job',
        description: msg,
      });
    } finally {
      setAcceptingJobId(null);
    }
  };

  const totalPendingKes = settlements
    .filter((s) => s.settlementStatus !== 'SETTLED')
    .reduce((acc, s) => acc + s.riderEarning, 0);
  const totalSettledKes = settlements
    .filter((s) => s.settlementStatus === 'SETTLED')
    .reduce((acc, s) => acc + s.riderEarning, 0);

  const navItems: Array<{ id: RiderTab; label: string; icon: any }> = [
    { id: 'home', label: 'Home', icon: Home },
    {
      id: 'available',
      label: `Jobs (${availableJobs.length + assignedJobs.length})`,
      icon: ClipboardList,
    },
    { id: 'active', label: 'Active', icon: Navigation },
    { id: 'earnings', label: 'Earnings', icon: Wallet },
    { id: 'history', label: 'History', icon: History },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  return (
    <div className="min-h-screen bg-[#F7F8F5] flex flex-col lg:flex-row pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 bg-[#123C32] text-white shrink-0">
        <div className="p-5 border-b border-white/10">
          <FikaBodaLogo variant="light" />
          <p className="text-xs text-[#D5FF70] mt-2 font-semibold truncate">{rider.fullName}</p>
          <p className="text-[11px] font-mono text-white/70">{rider.motorcycleRegistration}</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  tab === item.id
                    ? 'bg-[#D5FF70] text-[#123C32]'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-4 border-t border-white/10">
          <button
            type="button"
            onClick={() => void signOut(auth)}
            className="w-full flex items-center gap-2 text-xs text-white/75 hover:text-white cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Compact Top Bar */}
        <header className="bg-white border-b border-[#E3E7E2] px-4 h-14 flex items-center justify-between gap-2 sticky top-0 z-30">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="lg:hidden">
              <FikaBodaLogo size="sm" />
            </div>
            <span className="hidden sm:inline text-xs font-semibold text-[#17231F] truncate">
              {rider.fullName} · {rider.motorcycleRegistration}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={() => void handleToggleOnline()}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                rider.availabilityStatus === 'ONLINE' || rider.availabilityStatus === 'ON_DELIVERY'
                  ? 'bg-[#D5FF70] text-[#123C32]'
                  : 'bg-[#F7F8F5] text-[#77827B] border border-[#E3E7E2]'
              }`}
            >
              {rider.availabilityStatus}
            </button>
            <NotificationsBell uid={profile.uid} />
          </div>
        </header>

        <PullToRefresh onRefresh={handleRefresh} className="flex-1 flex flex-col">

        <main className="flex-1 p-4 sm:p-6 max-w-5xl w-full mx-auto space-y-5">
          {/* HOME */}
          {tab === 'home' && (
            <div className="space-y-4">
              <div className="bg-[#123C32] text-white rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-mono text-[#D5FF70]">WESTLANDS COURIER CONSOLE</p>
                  <h1 className="font-display text-xl font-bold mt-1">
                    {rider.availabilityStatus === 'OFFLINE'
                      ? 'You are currently Offline'
                      : activeJob
                        ? `On Delivery · ${activeJob.referenceCode}`
                        : 'Online & Ready for Dispatch'}
                  </h1>
                  <p className="text-xs text-white/75 mt-1">
                    {gpsEnabled
                      ? liveCoords
                        ? `Live GPS: ${liveCoords.lat.toFixed(4)}, ${liveCoords.lng.toFixed(4)}`
                        : 'Acquiring browser GPS signal...'
                      : 'Enable GPS while your screen is open to share live location with dispatch & customers.'}
                  </p>
                  {gpsError && <p className="text-xs text-amber-300 mt-1">{gpsError}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleToggleOnline()}
                    className="min-h-[44px] px-4 rounded-xl bg-[#D5FF70] text-[#123C32] text-xs font-bold cursor-pointer"
                  >
                    {rider.availabilityStatus === 'OFFLINE' ? 'Go Online' : 'Go Offline'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setGpsEnabled((v) => !v)}
                    className="min-h-[44px] px-3.5 rounded-xl bg-white/10 text-white text-xs font-semibold hover:bg-white/20 cursor-pointer"
                  >
                    {gpsEnabled ? 'Pause GPS' : 'Start GPS'}
                  </button>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
                Web PWA GPS Note: Browser geolocation updates continuously while this tab remains open. Locking your phone screen pauses web GPS until reopened.
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
                  <p className="text-xs text-[#77827B]">Open Westlands Jobs</p>
                  <p className="font-display text-2xl font-bold text-[#123C32] font-mono-tabular mt-1">
                    {availableJobs.length}
                  </p>
                </div>
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
                  <p className="text-xs text-[#77827B]">Pending Payout</p>
                  <p className="font-display text-xl font-bold text-[#17231F] font-mono-tabular mt-1">
                    {formatKes(totalPendingKes)}
                  </p>
                </div>
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
                  <p className="text-xs text-[#77827B]">Settled Total</p>
                  <p className="font-display text-xl font-bold text-emerald-800 font-mono-tabular mt-1">
                    {formatKes(totalSettledKes)}
                  </p>
                </div>
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
                  <p className="text-xs text-[#77827B]">Completed Trips</p>
                  <p className="font-display text-2xl font-bold text-[#17231F] font-mono-tabular mt-1">
                    {myJobs.filter((j) => j.deliveryStatus === 'DELIVERED').length}
                  </p>
                </div>
              </div>

              {assignedJobs.length > 0 && (
                <div className="space-y-2.5">
                  {assignedJobs.map((job) => (
                    <div
                      key={job.jobId}
                      className="bg-[#D5FF70]/25 border-2 border-[#123C32] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-[11px] font-mono-tabular font-bold uppercase tracking-wider text-[#123C32]">
                          DISPATCHER ASSIGNED · {job.referenceCode}
                        </p>
                        <p className="text-sm font-bold text-[#17231F] mt-0.5">
                          {job.shopName} → {job.deliveryAddress}
                        </p>
                        <p className="text-xs text-[#77827B] mt-0.5">
                          {formatKes(job.riderEarning)} · {job.roadDistanceKm.toFixed(1)} km · ~{job.estimatedDuration}m
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(inProgressJob) || acceptingJobId !== null}
                        onClick={() => void handleAcceptJob(job)}
                        className="min-h-[44px] px-4 rounded-xl bg-[#123C32] text-[#D5FF70] text-xs font-bold shrink-0 hover:bg-[#0D2E26] disabled:opacity-50 cursor-pointer"
                      >
                        {inProgressJob
                          ? 'Complete Active Job First'
                          : acceptingJobId === job.jobId
                            ? 'Accepting...'
                            : 'Accept Delivery Job'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {inProgressJob ? (
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-mono-tabular font-bold text-[#123C32]">
                      ACTIVE · {inProgressJob.referenceCode}
                    </p>
                    <p className="text-sm font-semibold text-[#17231F]">
                      {inProgressJob.shopName} → {inProgressJob.deliveryAddress}
                    </p>
                    <DeliveryStatusText status={inProgressJob.deliveryStatus} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab('active')}
                    className="min-h-[44px] px-4 rounded-xl bg-[#123C32] text-white text-xs font-semibold shrink-0 cursor-pointer"
                  >
                    Open Active Job
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {availableJobs.slice(0, 3).map((job) => (
                    <div
                      key={job.jobId}
                      className="bg-white border border-[#E3E7E2] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-mono-tabular font-bold text-[#123C32]">
                          OPEN DISPATCH · {job.referenceCode} · {job.packageSize}
                        </p>
                        <p className="text-sm font-bold text-[#17231F] mt-0.5">
                          {job.shopName} → {job.deliveryAddress}
                        </p>
                        <p className="text-xs text-[#77827B] mt-0.5">
                          Earning {formatKes(job.riderEarning)} · {job.roadDistanceKm.toFixed(1)} km · ~{job.estimatedDuration}m
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={acceptingJobId !== null}
                        onClick={() => void handleAcceptJob(job)}
                        className="min-h-[44px] px-4 rounded-xl bg-[#123C32] text-white text-xs font-bold shrink-0 hover:bg-[#0D2E26] disabled:opacity-50 cursor-pointer"
                      >
                        {acceptingJobId === job.jobId ? 'Accepting...' : 'Accept Delivery Job'}
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setTab('available')}
                    className="w-full min-h-[48px] rounded-xl bg-white border border-[#E3E7E2] hover:border-[#123C32] text-sm font-semibold text-[#123C32] flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ClipboardList className="w-4 h-4" />
                    <span>Browse All Available Westlands Jobs ({availableJobs.length})</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* AVAILABLE JOBS */}
          {tab === 'available' && (
            <div className="space-y-4">
              {assignedJobs.length > 0 && (
                <div className="space-y-3">
                  <h2 className="font-display text-base font-bold text-[#123C32]">
                    Assigned to You ({assignedJobs.length})
                  </h2>
                  {assignedJobs.map((job) => (
                    <div
                      key={job.jobId}
                      className="bg-[#D5FF70]/20 border-2 border-[#123C32] rounded-xl p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-mono-tabular font-bold text-[#123C32]">
                            ASSIGNED · {job.referenceCode} · {job.packageSize}
                          </p>
                          <h3 className="text-sm font-bold text-[#17231F] mt-0.5">{job.shopName}</h3>
                        </div>
                        <div className="text-right">
                          <p className="font-mono-tabular text-base font-bold text-[#123C32]">
                            {formatKes(job.riderEarning)}
                          </p>
                          <p className="text-[11px] font-mono-tabular text-[#77827B]">
                            {job.roadDistanceKm.toFixed(1)} km · ~{job.estimatedDuration}m
                          </p>
                        </div>
                      </div>
                      <div className="text-xs space-y-1 text-[#77827B]">
                        <p>
                          <span className="font-semibold text-[#17231F]">Pickup:</span>{' '}
                          {job.pickupAddress}
                        </p>
                        <p>
                          <span className="font-semibold text-[#17231F]">Dropoff:</span>{' '}
                          {job.deliveryAddress}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(inProgressJob) || acceptingJobId !== null}
                        onClick={() => void handleAcceptJob(job)}
                        className="w-full min-h-[44px] rounded-xl bg-[#123C32] text-[#D5FF70] text-xs font-bold hover:bg-[#0D2E26] disabled:opacity-50 cursor-pointer"
                      >
                        {inProgressJob
                          ? 'Complete Active Job First'
                          : acceptingJobId === job.jobId
                            ? 'Accepting...'
                            : 'Accept Delivery Job'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-bold text-[#17231F]">
                  Available Westlands Jobs ({availableJobs.length})
                </h2>
              </div>
              {availableJobs.length === 0 ? (
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-8 text-center text-xs text-[#77827B]">
                  No open jobs waiting right now. Pull down to refresh or keep your status Online for new shop dispatches.
                </div>
              ) : (
                availableJobs.map((job) => (
                  <div
                    key={job.jobId}
                    className="bg-white border border-[#E3E7E2] rounded-xl p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-mono-tabular font-bold text-[#123C32]">
                          {job.referenceCode} · {job.packageSize}
                        </p>
                        <h3 className="text-sm font-bold text-[#17231F] mt-0.5">{job.shopName}</h3>
                      </div>
                      <div className="text-right">
                        <p className="font-mono-tabular text-base font-bold text-[#123C32]">
                          {formatKes(job.riderEarning)}
                        </p>
                        <p className="text-[11px] font-mono-tabular text-[#77827B]">
                          {job.roadDistanceKm.toFixed(1)} km · ~{job.estimatedDuration}m
                        </p>
                      </div>
                    </div>
                    <div className="text-xs space-y-1 text-[#77827B]">
                      <p>
                        <span className="font-semibold text-[#17231F]">Pickup:</span>{' '}
                        {job.pickupAddress}
                      </p>
                      <p>
                        <span className="font-semibold text-[#17231F]">Dropoff:</span>{' '}
                        {job.deliveryAddress}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(inProgressJob) || acceptingJobId !== null}
                      onClick={() => void handleAcceptJob(job)}
                      className="w-full min-h-[44px] rounded-xl bg-[#123C32] text-white text-xs font-bold hover:bg-[#0D2E26] disabled:opacity-50 cursor-pointer"
                    >
                      {inProgressJob
                        ? 'Complete Active Job First'
                        : acceptingJobId === job.jobId
                          ? 'Accepting...'
                          : 'Accept Delivery Job'}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ACTIVE DELIVERY */}
          {tab === 'active' && (
            <div className="space-y-4">
              {!activeJob ? (
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-8 text-center text-xs text-[#77827B]">
                  You do not have an active delivery. Check Available Jobs to accept a dispatch.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  <div className="lg:col-span-6 bg-white border border-[#E3E7E2] rounded-xl p-5 space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono-tabular text-xs font-bold text-[#123C32]">
                          {activeJob.referenceCode}
                        </p>
                        <h2 className="font-display text-lg font-bold text-[#17231F]">
                          {activeJob.shopName}
                        </h2>
                      </div>
                      <DeliveryStatusText status={activeJob.deliveryStatus} />
                    </div>

                    <div className="text-xs space-y-2 border-t border-b border-[#E3E7E2] py-3">
                      <p>
                        <span className="font-semibold text-[#17231F]">Pickup:</span>{' '}
                        {activeJob.pickupAddress}
                        {activeJob.pickupInstructions ? ` (${activeJob.pickupInstructions})` : ''}
                      </p>
                      <p>
                        <span className="font-semibold text-[#17231F]">Customer:</span>{' '}
                        {activeJob.customerName} · {activeJob.deliveryAddress}
                        {activeJob.deliveryInstructions
                          ? ` (${activeJob.deliveryInstructions})`
                          : ''}
                      </p>
                      <div className="pt-1 flex items-center gap-3">
                        <a
                          href={`tel:${activeJob.customerPhone}`}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E3E7E2] text-xs font-semibold text-[#123C32]"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          <span>Call Customer</span>
                        </a>
                        <span className="font-mono-tabular font-bold text-[#123C32]">
                          Earning: {formatKes(activeJob.riderEarning)}
                        </span>
                      </div>
                    </div>

                    {nextStatus && (
                      <div className="space-y-3">
                        {(nextStatus === 'PICKED_UP' || nextStatus === 'DELIVERED') && (
                          <div>
                            <label className="block text-xs font-semibold text-[#17231F] mb-1">
                              {nextStatus === 'PICKED_UP'
                                ? 'Enter 4-Digit Merchant Pickup PIN'
                                : 'Enter 4-Digit Customer Delivery PIN'}
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={pinInput}
                              onChange={(e) => setPinInput(e.target.value)}
                              placeholder="1234"
                              className="w-full px-3.5 py-2.5 text-base font-mono tracking-widest border border-[#E3E7E2] rounded-xl focus:outline-none focus:border-[#123C32]"
                            />
                          </div>
                        )}

                        {nextStatus === 'PICKED_UP' && (
                          <label className="flex items-center gap-2.5 border border-dashed border-[#E3E7E2] rounded-xl p-3 text-xs cursor-pointer">
                            <Camera className="w-4 h-4 text-[#123C32]" />
                            <span className="text-[#17231F]">
                              {pickupPhoto
                                ? `Photo attached: ${pickupPhoto.name}`
                                : 'Attach Pickup Parcel Photo (Optional)'}
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              onChange={(e) => setPickupPhoto(e.target.files?.[0] || null)}
                            />
                          </label>
                        )}

                        {activeJob.deliveryStatus === 'ASSIGNED' ? (
                          <button
                            type="button"
                            disabled={acceptingJobId !== null}
                            onClick={() => void handleAcceptJob(activeJob)}
                            className="w-full min-h-[48px] rounded-xl bg-[#123C32] text-[#D5FF70] text-sm font-bold hover:bg-[#0D2E26] disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>
                              {acceptingJobId === activeJob.jobId
                                ? 'Accepting...'
                                : 'Accept Assigned Delivery Job'}
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => void handleAdvanceStep()}
                            className="w-full min-h-[48px] rounded-xl bg-[#123C32] text-[#D5FF70] text-sm font-bold hover:bg-[#0D2E26] disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>
                              {actionBusy
                                ? 'Updating...'
                                : `Mark ${getDeliveryStatusLabel(nextStatus)}`}
                            </span>
                          </button>
                        )}
                      </div>
                    )}

                    {['PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION'].includes(
                      activeJob.deliveryStatus
                    ) && (
                      <div className="space-y-2">
                        {!issueOpen ? (
                          <button
                            type="button"
                            onClick={() => setIssueOpen(true)}
                            className="w-full min-h-[44px] rounded-xl border border-red-200 text-red-700 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>Report Delivery Issue / Return to Shop</span>
                          </button>
                        ) : (
                          <div className="p-3 rounded-xl bg-red-50 border border-red-200 space-y-2.5">
                            <label className="block text-xs font-semibold text-red-900">
                              Describe delivery issue (e.g. customer unreachable):
                            </label>
                            <input
                              type="text"
                              value={issueReason}
                              onChange={(e) => setIssueReason(e.target.value)}
                              placeholder="Customer phone off after 3 calls"
                              className="w-full px-3 py-2 text-xs bg-white border border-red-200 rounded-lg"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={async () => {
                                  if (issueReason.trim().length < 3) return;
                                  setActionBusy(true);
                                  try {
                                    await advanceJobStatusTransaction({
                                      job: activeJob,
                                      actorUid: profile.uid,
                                      nextStatus: 'RETURN_REQUIRED',
                                      notes: issueReason.trim(),
                                      location: liveCoords || rider.currentLocation,
                                    });
                                    setIssueOpen(false);
                                    setIssueReason('');
                                    pushToast({ kind: 'info', title: 'Marked Return Required' });
                                  } catch (err: any) {
                                    pushToast({
                                      kind: 'error',
                                      title: 'Could not mark return',
                                      description: err?.message,
                                    });
                                  } finally {
                                    setActionBusy(false);
                                  }
                                }}
                                className="flex-1 min-h-[40px] rounded-lg bg-red-700 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                              >
                                {actionBusy ? 'Saving...' : 'Confirm Return'}
                              </button>
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => {
                                  setIssueOpen(false);
                                  setIssueReason('');
                                }}
                                className="px-3 min-h-[40px] rounded-lg border border-red-200 bg-white text-xs font-semibold text-red-800 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {activeJob.deliveryStatus === 'RETURN_REQUIRED' && (
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={async () => {
                          setActionBusy(true);
                          try {
                            await advanceJobStatusTransaction({
                              job: activeJob,
                              actorUid: profile.uid,
                              nextStatus: 'RETURNED',
                              notes: 'Parcel returned to merchant shop',
                              location: liveCoords || rider.currentLocation,
                            });
                            pushToast({ kind: 'success', title: 'Parcel marked returned to shop' });
                          } catch (err: any) {
                            pushToast({
                              kind: 'error',
                              title: 'Could not complete return',
                              description: err?.message,
                            });
                          } finally {
                            setActionBusy(false);
                          }
                        }}
                        className="w-full min-h-[44px] rounded-xl bg-amber-900 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        {actionBusy ? 'Updating...' : 'Confirm Parcel Returned to Merchant'}
                      </button>
                    )}
                  </div>

                  <div className="lg:col-span-6 bg-white border border-[#E3E7E2] rounded-xl p-4">
                    <DeliveryRouteMap
                      hasMapsKey={hasMapsKey}
                      pickup={activeJob.pickupCoordinates}
                      pickupLabel={activeJob.shopName}
                      dropoff={activeJob.deliveryCoordinates}
                      dropoffLabel={activeJob.deliveryAddress}
                      riderLocation={liveCoords || rider.currentLocation || null}
                      riderLabel={rider.fullName}
                      heightClass="h-[360px]"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* EARNINGS */}
          {tab === 'earnings' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl overflow-hidden">
              <div className="p-4 border-b border-[#E3E7E2] flex items-center justify-between">
                <div>
                  <h2 className="font-display font-semibold text-sm text-[#17231F]">
                    Rider Settlements ({settlements.length})
                  </h2>
                  <p className="text-xs text-[#77827B]">
                    Pending: {formatKes(totalPendingKes)} · Settled: {formatKes(totalSettledKes)}
                  </p>
                </div>
              </div>
              <div className="divide-y divide-[#E3E7E2]">
                {settlements.length === 0 ? (
                  <div className="p-6 text-xs text-[#77827B] text-center">
                    Completed deliveries generate atomic settlement records here.
                  </div>
                ) : (
                  settlements.map((s) => (
                    <div key={s.settlementId} className="p-4 flex items-center justify-between text-xs">
                      <div>
                        <p className="font-mono-tabular font-semibold text-[#17231F]">{s.jobId}</p>
                        <p className="text-[#77827B]">{formatTimestamp(s.createdAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono-tabular font-bold text-[#123C32]">
                          {formatKes(s.riderEarning)}
                        </p>
                        <p className="text-[11px] font-semibold text-[#77827B]">
                          {s.settlementStatus}
                          {s.payoutReference ? ` · ${s.payoutReference}` : ''}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* HISTORY */}
          {tab === 'history' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl divide-y divide-[#E3E7E2]">
              <div className="p-4 font-display font-semibold text-sm text-[#17231F]">
                Past Trips ({myJobs.length})
              </div>
              {myJobs.map((j) => (
                <div key={j.jobId} className="p-4 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-mono-tabular font-bold text-[#123C32]">
                      {j.referenceCode} · {j.shopName}
                    </p>
                    <p className="text-[#77827B] truncate">{j.deliveryAddress}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <DeliveryStatusText status={j.deliveryStatus} />
                    <p className="font-mono-tabular text-[#77827B] mt-0.5">
                      {formatKes(j.riderEarning)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* PROFILE */}
          {tab === 'profile' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl p-5 space-y-4 text-xs max-w-lg">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-[#123C32] text-[#D5FF70] flex items-center justify-center">
                  <Bike className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-display text-base font-bold text-[#17231F]">
                    {rider.fullName}
                  </h2>
                  <p className="font-mono text-[#77827B]">{rider.motorcycleRegistration}</p>
                </div>
              </div>
              <div className="space-y-1.5 border-t border-[#E3E7E2] pt-3">
                <p>
                  <span className="text-[#77827B]">Phone:</span> {rider.phoneNumber}
                </p>
                <p>
                  <span className="text-[#77827B]">Licence Verification:</span>{' '}
                  {rider.licenceVerificationStatus}
                </p>
                <p>
                  <span className="text-[#77827B]">Insurance Verification:</span>{' '}
                  {rider.insuranceVerificationStatus}
                </p>
                <p>
                  <span className="text-[#77827B]">Submitted Verification Docs:</span>{' '}
                  {riderDocs.length || Object.keys(rider.verificationDocRefs || {}).length} file(s)
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <PWAInstallButton showWhenInstalled />
                <button
                  type="button"
                  onClick={() => void signOut(auth)}
                  className="min-h-[44px] px-4 rounded-xl border border-[#E3E7E2] font-semibold text-[#17231F] cursor-pointer"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </main>
        </PullToRefresh>
      </div>

      {/* Mobile Sticky Bottom Tab Bar with safe-area */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 min-h-[56px] pb-[env(safe-area-inset-bottom)] bg-white border-t border-[#E3E7E2] grid grid-cols-6 z-40">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-semibold cursor-pointer ${
                active ? 'text-[#123C32]' : 'text-[#77827B]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="truncate max-w-full px-0.5">{item.label.split(' ')[0]}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
