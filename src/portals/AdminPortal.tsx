import React, { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import {
  Activity,
  BarChart3,
  Bike,
  CheckCircle2,
  CreditCard,
  DollarSign,
  Download,
  Eye,
  FileText,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  MapPin,
  Package,
  Radio,
  Settings,
  Shield,
  Store,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { auth } from '../firebase/config';
import type {
  ActivityLog,
  AdminRoleRecord,
  DeliveryJob,
  IntegrationReadiness,
  JobEvent,
  PaymentRecord,
  PricingRule,
  Rider,
  RiderSettlement,
  RiderVerificationDoc,
  ServiceZone,
  Shop,
  SupportTicket,
  UserProfile,
  VerificationDocKey,
} from '../types/fikaboda';
import {
  adminAssignRiderTransaction,
  adminConfirmPaymentCallback,
  adminReviewVerificationDoc,
  adminSettleRiderPayout,
  adminUpdateRiderApproval,
  adminUpdateShopStatus,
  assignUserAdminRole,
  cancelJobTransaction,
  resolveSupportTicket,
  resolveStoragePathUrl,
  resolveVerificationDocPreviewUrl,
  savePricingRule,
  saveServiceZone,
  seedWestlandsDefaults,
  subscribeToActivityLogs,
  subscribeToAdmins,
  subscribeToAllJobs,
  subscribeToAllPayments,
  subscribeToAllRiders,
  subscribeToAllSettlements,
  subscribeToAllShops,
  subscribeToAllUsers,
  subscribeToJobEvents,
  subscribeToPricingRules,
  subscribeToRiderVerificationDocs,
  subscribeToServiceZones,
  subscribeToSupportTickets,
} from '../services/firestoreService';
import { fetchIntegrationStatus } from '../services/apiService';
import { formatKes, formatTimestamp } from '../utils/crypto';
import { WESTLANDS_CENTER } from '../utils/pricing';
import { FikaBodaLogo } from '../components/FikaBodaLogo';
import { NotificationsBell } from '../components/NotificationsBell';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { PullToRefresh } from '../components/PullToRefresh';
import { DeliveryStatusText, PaymentStatusText } from '../components/StatusBadge';
import { DispatchFleetMap } from '../components/Maps/DispatchFleetMap';
import { OperationsCharts } from '../components/Charts/OperationsCharts';
import { useToast } from '../components/ToastProvider';

type AdminTab =
  | 'overview'
  | 'dispatch'
  | 'deliveries'
  | 'shops'
  | 'riders'
  | 'payments'
  | 'settlements'
  | 'pricing'
  | 'zones'
  | 'reports'
  | 'support'
  | 'audit'
  | 'settings';

export const AdminPortal: React.FC<{
  profile: UserProfile;
  hasMapsKey: boolean;
}> = ({ profile, hasMapsKey }) => {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [jobs, setJobs] = useState<DeliveryJob[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [settlements, setSettlements] = useState<RiderSettlement[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [admins, setAdmins] = useState<AdminRoleRecord[]>([]);
  const [readiness, setReadiness] = useState<IntegrationReadiness | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [selectedJob, setSelectedJob] = useState<DeliveryJob | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<JobEvent[]>([]);
  const [assignRiderId, setAssignRiderId] = useState('');
  const [jobSearch, setJobSearch] = useState('');

  // Rider Verification Document Inspection Modal state
  const [inspectingRider, setInspectingRider] = useState<Rider | null>(null);
  const [inspectedDocs, setInspectedDocs] = useState<RiderVerificationDoc[]>([]);
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});
  const [zoomedDoc, setZoomedDoc] = useState<{ title: string; url: string; mimeType: string } | null>(null);

  // Shop inspection modal state
  const [inspectingShop, setInspectingShop] = useState<Shop | null>(null);

  // Reusable input modal state (replaces browser window.prompt for PWA & iframe UX)
  const [promptModal, setPromptModal] = useState<{
    title: string;
    label: string;
    placeholder: string;
    submitLabel: string;
    onSubmit: (value: string) => Promise<void>;
  } | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [promptBusy, setPromptBusy] = useState(false);

  // New pricing rule form
  const [newMinKm, setNewMinKm] = useState('0');
  const [newMaxKm, setNewMaxKm] = useState('5');
  const [newFee, setNewFee] = useState('220');
  const [newRiderPct, setNewRiderPct] = useState('80');

  // New zone form
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneRadius, setNewZoneRadius] = useState('12');

  const { pushToast } = useToast();
  const isSuperAdmin = profile.role === 'SUPER_ADMIN';
  const isAdminLevel = profile.role === 'SUPER_ADMIN' || profile.role === 'ADMIN';

  useEffect(() => {
    const u1 = subscribeToAllJobs(setJobs);
    const u2 = subscribeToAllShops(setShops);
    const u3 = subscribeToAllRiders(setRiders);
    const u4 = isAdminLevel ? subscribeToAllPayments(setPayments) : () => {};
    const u5 = isAdminLevel ? subscribeToAllSettlements(setSettlements) : () => {};
    const u6 = subscribeToPricingRules(setPricingRules, !isAdminLevel);
    const u7 = subscribeToServiceZones(setZones, !isAdminLevel);
    const u8 = subscribeToSupportTickets(profile.uid, true, setTickets);
    const u9 = isAdminLevel ? subscribeToActivityLogs(setLogs) : () => {};
    const u10 = subscribeToAllUsers(setUsers);
    const u11 = isAdminLevel ? subscribeToAdmins(setAdmins) : () => {};

    fetchIntegrationStatus().then(setReadiness).catch(() => {});
    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
      u7();
      u8();
      u9();
      u10();
      u11();
    };
  }, [profile.uid, isAdminLevel, refreshTick]);

  const handleRefresh = async () => {
    setRefreshTick((t) => t + 1);
    const status = await fetchIntegrationStatus().catch(() => null);
    if (status) setReadiness(status);
  };

  useEffect(() => {
    if (!selectedJob) {
      setSelectedEvents([]);
      return;
    }
    const unsub = subscribeToJobEvents(selectedJob.jobId, setSelectedEvents);
    return () => unsub();
  }, [selectedJob?.jobId]);

  // Subscribe to rider verification docs when admin opens doc inspection modal
  useEffect(() => {
    if (!inspectingRider) {
      setInspectedDocs([]);
      setResolvedUrls({});
      return;
    }
    const unsub = subscribeToRiderVerificationDocs(inspectingRider.riderId, async (docs) => {
      setInspectedDocs(docs);
      const urls: Record<string, string> = {};
      for (const d of docs) {
        const u = await resolveVerificationDocPreviewUrl(d);
        if (u) urls[d.docKey] = u;
      }
      // Also resolve legacy verificationDocRefs pointing to Storage paths
      for (const [k, refVal] of Object.entries(inspectingRider.verificationDocRefs || {})) {
        if (!urls[k] && refVal && !refVal.startsWith('firestore:')) {
          const u = await resolveStoragePathUrl(refVal);
          if (u) urls[k] = u;
        }
      }
      setResolvedUrls(urls);
    });
    return () => unsub();
  }, [inspectingRider?.riderId]);

  const activeJobs = jobs.filter(
    (j) => !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(j.deliveryStatus)
  );
  const pendingShops = shops.filter((s) => s.status === 'PENDING_APPROVAL');
  const pendingRiders = riders.filter((r) => r.approvalStatus === 'PENDING');
  const approvedRiders = riders.filter((r) => r.approvalStatus === 'APPROVED');
  const onlineRiders = approvedRiders.filter((r) => r.availabilityStatus === 'ONLINE');
  const confirmedRevenue = payments
    .filter((p) => p.paymentStatus === 'PAID')
    .reduce((acc, p) => acc + p.amount, 0);

  const exportJobsCsv = () => {
    const rows = [
      ['Ref', 'Shop', 'Customer', 'Rider', 'DistanceKm', 'FeeKES', 'Status', 'Payment'],
      ...jobs.map((j) => [
        j.referenceCode,
        j.shopName,
        j.customerName,
        j.riderName || 'Unassigned',
        String(j.roadDistanceKm),
        String(j.deliveryFee),
        j.deliveryStatus,
        j.paymentStatus,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fikaboda-deliveries-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const navItems: Array<{ id: AdminTab; label: string; icon: any }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'dispatch', label: `Live Dispatch (${activeJobs.length})`, icon: Radio },
    { id: 'deliveries', label: 'Deliveries', icon: Package },
    { id: 'shops', label: `Shops (${pendingShops.length})`, icon: Store },
    { id: 'riders', label: `Riders (${pendingRiders.length})`, icon: Bike },
    { id: 'payments', label: 'Payments', icon: CreditCard },
    { id: 'settlements', label: 'Settlements', icon: Wallet },
    { id: 'pricing', label: 'Pricing', icon: DollarSign },
    { id: 'zones', label: 'Service Zones', icon: MapPin },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'support', label: 'Support', icon: HelpCircle },
    { id: 'audit', label: 'Audit Logs', icon: Activity },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-[#F7F8F5] flex flex-col lg:flex-row">
      <aside className="hidden lg:flex lg:flex-col lg:w-64 bg-[#123C32] text-white shrink-0">
        <div className="p-5 border-b border-white/10">
          <FikaBodaLogo variant="light" />
          <p className="text-[11px] font-mono text-[#D5FF70] mt-2">
            {profile.role} · OPS CONSOLE
          </p>
        </div>
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  tab === item.id
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
            className="w-full flex items-center gap-2 text-xs text-white/75 hover:text-white cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-[#E3E7E2] px-4 sm:px-6 h-16 flex items-center justify-between gap-3 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <div className="lg:hidden">
              <FikaBodaLogo size="sm" />
            </div>
            <div className="hidden sm:block">
              <h1 className="font-display font-semibold text-sm text-[#17231F]">
                FikaBoda Operations & Dispatch
              </h1>
              <p className="text-[11px] text-[#77827B]">
                Westlands Launch Network · {onlineRiders.length} riders online
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton compact />
            <NotificationsBell uid={profile.uid} />
            <button
              type="button"
              onClick={() => void signOut(auth)}
              className="lg:hidden p-2 rounded-lg border border-[#E3E7E2] text-[#77827B] cursor-pointer"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

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
              {(zones.length === 0 || pricingRules.length === 0) && isAdminLevel && (
                <div className="bg-[#123C32] text-white rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      Initialize Westlands Zone & Default KES Pricing Tiers
                    </p>
                    <p className="text-xs text-white/75">
                      Seed Westlands (18 km radius) and the 4 distance bands into Firestore so merchants can quote deliveries immediately.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await seedWestlandsDefaults();
                      pushToast({ kind: 'success', title: 'Westlands zones & pricing seeded' });
                    }}
                    className="px-4 py-2 rounded-lg bg-[#D5FF70] text-[#123C32] text-xs font-bold whitespace-nowrap cursor-pointer"
                  >
                    Seed Westlands Defaults
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
                  <p className="text-xs text-[#77827B]">Active Jobs</p>
                  <p className="font-display text-2xl font-bold text-[#123C32] font-mono-tabular mt-1">
                    {activeJobs.length}
                  </p>
                </div>
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
                  <p className="text-xs text-[#77827B]">Online Riders</p>
                  <p className="font-display text-2xl font-bold text-emerald-800 font-mono-tabular mt-1">
                    {onlineRiders.length}
                  </p>
                </div>
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
                  <p className="text-xs text-[#77827B]">Pending Shops</p>
                  <p className="font-display text-2xl font-bold text-amber-800 font-mono-tabular mt-1">
                    {pendingShops.length}
                  </p>
                </div>
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
                  <p className="text-xs text-[#77827B]">Pending Riders</p>
                  <p className="font-display text-2xl font-bold text-amber-800 font-mono-tabular mt-1">
                    {pendingRiders.length}
                  </p>
                </div>
                <div className="bg-white border border-[#E3E7E2] rounded-xl p-4">
                  <p className="text-xs text-[#77827B]">Confirmed M-Pesa</p>
                  <p className="font-display text-xl font-bold text-[#17231F] font-mono-tabular mt-1">
                    {formatKes(confirmedRevenue)}
                  </p>
                </div>
              </div>

              <OperationsCharts jobs={jobs} riders={riders} />
            </div>
          )}

          {/* LIVE DISPATCH */}
          {tab === 'dispatch' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <div className="lg:col-span-8">
                <DispatchFleetMap
                  hasMapsKey={hasMapsKey}
                  riders={riders}
                  jobs={jobs}
                  selectedJob={selectedJob}
                  onSelectJob={(job) => setSelectedJob(job)}
                />
              </div>

              <div className="lg:col-span-4 space-y-4">
                <div className="bg-white border border-[#E3E7E2] rounded-xl divide-y divide-[#E3E7E2] max-h-64 overflow-y-auto">
                  <div className="p-3.5 font-display font-semibold text-xs text-[#17231F]">
                    Active Dispatch Queue ({activeJobs.length})
                  </div>
                  {activeJobs.length === 0 ? (
                    <div className="p-4 text-xs text-[#77827B]">No active jobs in queue.</div>
                  ) : (
                    activeJobs.map((j) => (
                      <button
                        key={j.jobId}
                        type="button"
                        onClick={() => setSelectedJob(j)}
                        className={`w-full text-left p-3 hover:bg-[#F7F8F5] cursor-pointer ${
                          selectedJob?.jobId === j.jobId ? 'bg-[#F7F8F5]' : ''
                        }`}
                      >
                        <div className="flex justify-between text-xs">
                          <span className="font-mono-tabular font-bold text-[#123C32]">
                            {j.referenceCode}
                          </span>
                          <DeliveryStatusText status={j.deliveryStatus} />
                        </div>
                        <p className="text-xs font-medium text-[#17231F] truncate mt-0.5">
                          {j.shopName} → {j.customerName}
                        </p>
                      </button>
                    ))
                  )}
                </div>

                {selectedJob && (
                  <div className="bg-white border border-[#E3E7E2] rounded-xl p-4 space-y-3 text-xs">
                    <div>
                      <p className="font-mono-tabular font-bold text-[#123C32]">
                        {selectedJob.referenceCode}
                      </p>
                      <p className="font-semibold text-[#17231F]">{selectedJob.shopName}</p>
                      <p className="text-[#77827B] mt-0.5">{selectedJob.deliveryAddress}</p>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-[#E3E7E2]">
                      <label className="block font-semibold text-[#17231F]">
                        Assign / Reassign Approved Rider
                      </label>
                      <select
                        value={assignRiderId}
                        onChange={(e) => setAssignRiderId(e.target.value)}
                        className="w-full px-3 py-2 border border-[#E3E7E2] rounded-lg bg-white"
                      >
                        <option value="">Select approved rider...</option>
                        {approvedRiders.map((r) => (
                          <option key={r.riderId} value={r.riderId}>
                            {r.fullName} ({r.motorcycleRegistration}) · {r.availabilityStatus}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={!assignRiderId}
                          onClick={async () => {
                            const r = approvedRiders.find((x) => x.riderId === assignRiderId);
                            if (!r) return;
                            await adminAssignRiderTransaction(profile.uid, selectedJob, r);
                            pushToast({
                              kind: 'success',
                              title: `Assigned ${r.fullName} to ${selectedJob.referenceCode}`,
                            });
                          }}
                          className="flex-1 py-2 rounded-lg bg-[#123C32] text-white font-semibold disabled:opacity-50 cursor-pointer"
                        >
                          Assign Rider
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPromptValue('');
                            setPromptModal({
                              title: `Cancel ${selectedJob.referenceCode}`,
                              label: 'Admin cancellation reason',
                              placeholder: 'e.g. Duplicate order requested by merchant',
                              submitLabel: 'Confirm Cancel',
                              onSubmit: async (reason) => {
                                await cancelJobTransaction(selectedJob, profile.uid, reason);
                                pushToast({ kind: 'info', title: 'Job cancelled by dispatcher' });
                                setSelectedJob(null);
                              },
                            });
                          }}
                          className="px-3 py-2 rounded-lg border border-red-200 text-red-700 font-semibold cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[#E3E7E2] max-h-36 overflow-y-auto space-y-1.5">
                      <p className="font-semibold text-[#17231F]">Events</p>
                      {selectedEvents.map((ev) => (
                        <div key={ev.eventId} className="text-[11px] text-[#77827B]">
                          {ev.eventType}: {ev.notes}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* DELIVERIES TABLE */}
          {tab === 'deliveries' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl overflow-hidden">
              <div className="p-4 border-b border-[#E3E7E2] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="font-display font-semibold text-sm text-[#17231F]">
                  All Platform Deliveries ({jobs.length})
                </h2>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={jobSearch}
                    onChange={(e) => setJobSearch(e.target.value)}
                    placeholder="Search ref, shop, customer..."
                    className="px-3 py-1.5 text-xs border border-[#E3E7E2] rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={exportJobsCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E3E7E2] text-xs font-semibold hover:bg-[#F7F8F5] cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>CSV</span>
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F7F8F5] border-b border-[#E3E7E2] text-[#77827B]">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Ref</th>
                      <th className="py-3 px-4 font-semibold">Shop</th>
                      <th className="py-3 px-4 font-semibold">Customer</th>
                      <th className="py-3 px-4 font-semibold">Rider</th>
                      <th className="py-3 px-4 font-semibold">Fee</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                      <th className="py-3 px-4 font-semibold">Payment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3E7E2]">
                    {jobs
                      .filter(
                        (j) =>
                          !jobSearch ||
                          j.referenceCode.toLowerCase().includes(jobSearch.toLowerCase()) ||
                          j.shopName.toLowerCase().includes(jobSearch.toLowerCase()) ||
                          j.customerName.toLowerCase().includes(jobSearch.toLowerCase())
                      )
                      .map((j) => (
                        <tr key={j.jobId}>
                          <td className="py-3 px-4 font-mono-tabular font-bold text-[#123C32]">
                            {j.referenceCode}
                          </td>
                          <td className="py-3 px-4">{j.shopName}</td>
                          <td className="py-3 px-4">{j.customerName}</td>
                          <td className="py-3 px-4">{j.riderName || 'Unassigned'}</td>
                          <td className="py-3 px-4 font-mono-tabular">{formatKes(j.deliveryFee)}</td>
                          <td className="py-3 px-4">
                            <DeliveryStatusText status={j.deliveryStatus} />
                          </td>
                          <td className="py-3 px-4">
                            <PaymentStatusText status={j.paymentStatus} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SHOPS APPROVAL */}
          {tab === 'shops' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl divide-y divide-[#E3E7E2]">
              <div className="p-4 font-display font-semibold text-sm text-[#17231F]">
                Merchant Shops ({shops.length})
              </div>
              {shops.map((s) => (
                <div
                  key={s.shopId}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-[#17231F]">
                      {s.shopName}{' '}
                      <span className="font-mono text-xs text-[#77827B]">· {s.status}</span>
                    </p>
                    <p className="text-[#77827B] truncate">
                      {s.businessCategory} · {s.physicalAddress} · {s.phoneNumber}
                    </p>
                    <p className="text-[11px] text-[#77827B] mt-0.5">
                      Contact: {s.contactPerson} ({s.email}) · Hours: {s.operatingHours}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setInspectingShop(s)}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-[#E3E7E2] text-[#17231F] font-semibold hover:bg-[#F7F8F5] cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Inspect</span>
                    </button>
                    {isAdminLevel && s.status !== 'ACTIVE' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await adminUpdateShopStatus(profile.uid, s, 'ACTIVE', 'VERIFIED');
                          pushToast({ kind: 'success', title: `Approved ${s.shopName}` });
                        }}
                        className="px-3 py-2 rounded-lg bg-[#123C32] text-white font-semibold cursor-pointer"
                      >
                        Approve & Verify
                      </button>
                    )}
                    {isAdminLevel && s.status !== 'SUSPENDED' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await adminUpdateShopStatus(profile.uid, s, 'SUSPENDED', 'REJECTED');
                          pushToast({ kind: 'info', title: `Suspended ${s.shopName}` });
                        }}
                        className="px-3 py-2 rounded-lg border border-red-200 text-red-700 font-semibold cursor-pointer"
                      >
                        Suspend
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* RIDERS APPROVAL & DOCUMENT VERIFICATION */}
          {tab === 'riders' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl divide-y divide-[#E3E7E2]">
              <div className="p-4 flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-display font-semibold text-sm text-[#17231F]">
                    Boda Boda Riders ({riders.length})
                  </h2>
                  <p className="text-xs text-[#77827B]">
                    Inspect submitted National ID, NTSA Driving Licence, and Insurance documents before approving dispatch access.
                  </p>
                </div>
              </div>
              {riders.map((r) => (
                <div
                  key={r.riderId}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-[#17231F]">
                      {r.fullName}{' '}
                      <span className="font-mono text-xs text-[#123C32]">
                        · {r.motorcycleRegistration}
                      </span>{' '}
                      <span className="text-[#77827B]">· {r.approvalStatus}</span>
                    </p>
                    <p className="text-[#77827B] mt-0.5">
                      ID: <span className="font-mono">{r.nationalIdReference}</span> · Licence:{' '}
                      <span className="font-mono">{r.drivingLicenceRef || '—'}</span> · Docs:{' '}
                      <span className="font-semibold text-[#123C32]">
                        {Object.keys(r.verificationDocRefs || {}).length} attached
                      </span>
                    </p>
                    <p className="text-[11px] text-[#77827B] mt-0.5">
                      Licence: {r.licenceVerificationStatus} · Insurance: {r.insuranceVerificationStatus} · Phone: {r.phoneNumber}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setInspectingRider(r)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#123C32] text-[#123C32] font-semibold hover:bg-[#123C32]/5 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Review Docs</span>
                    </button>
                    {isAdminLevel && r.approvalStatus !== 'APPROVED' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await adminUpdateRiderApproval(
                            profile.uid,
                            r,
                            'APPROVED',
                            'VERIFIED',
                            'VERIFIED'
                          );
                          pushToast({ kind: 'success', title: `Approved rider ${r.fullName}` });
                        }}
                        className="px-3 py-2 rounded-lg bg-[#123C32] text-white font-semibold cursor-pointer"
                      >
                        Approve & Verify
                      </button>
                    )}
                    {isAdminLevel && r.approvalStatus !== 'SUSPENDED' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await adminUpdateRiderApproval(
                            profile.uid,
                            r,
                            'SUSPENDED',
                            r.licenceVerificationStatus,
                            r.insuranceVerificationStatus
                          );
                          pushToast({ kind: 'info', title: `Suspended ${r.fullName}` });
                        }}
                        className="px-3 py-2 rounded-lg border border-red-200 text-red-700 font-semibold cursor-pointer"
                      >
                        Suspend
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* PAYMENTS */}
          {tab === 'payments' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl overflow-hidden">
              <div className="p-4 border-b border-[#E3E7E2]">
                <h2 className="font-display font-semibold text-sm text-[#17231F]">
                  Payment Transactions & Daraja Reconciliation ({payments.length})
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F7F8F5] border-b border-[#E3E7E2] text-[#77827B]">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Payment ID</th>
                      <th className="py-3 px-4 font-semibold">Job ID</th>
                      <th className="py-3 px-4 font-semibold">Amount</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                      <th className="py-3 px-4 font-semibold">Receipt / Reason</th>
                      <th className="py-3 px-4 font-semibold">Reconcile</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3E7E2]">
                    {payments.map((p) => (
                      <tr key={p.paymentId}>
                        <td className="py-3 px-4 font-mono-tabular">{p.paymentId}</td>
                        <td className="py-3 px-4 font-mono-tabular">{p.jobId}</td>
                        <td className="py-3 px-4 font-mono-tabular font-semibold">
                          {formatKes(p.amount)}
                        </td>
                        <td className="py-3 px-4">
                          <PaymentStatusText status={p.paymentStatus} />
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-[#77827B]">
                          {p.mpesaReceiptNumber || p.failureReason || '—'}
                        </td>
                        <td className="py-3 px-4">
                          {isAdminLevel && p.paymentStatus !== 'PAID' && (
                            <button
                              type="button"
                              onClick={() => {
                                setPromptValue('');
                                setPromptModal({
                                  title: `Reconcile ${p.paymentId}`,
                                  label: 'Verified M-Pesa receipt code from Safaricom portal',
                                  placeholder: 'e.g. SLK82910PQ',
                                  submitLabel: 'Confirm Paid',
                                  onSubmit: async (receipt) => {
                                    if (receipt.trim().length < 5) {
                                      throw new Error('Enter a valid M-Pesa receipt code (min 5 chars).');
                                    }
                                    await adminConfirmPaymentCallback(profile.uid, p, receipt.trim());
                                    pushToast({
                                      kind: 'success',
                                      title: `Reconciled ${p.paymentId}`,
                                    });
                                  },
                                });
                              }}
                              className="text-xs font-semibold text-[#123C32] hover:underline cursor-pointer"
                            >
                              Verify Receipt
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

          {/* SETTLEMENTS */}
          {tab === 'settlements' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl divide-y divide-[#E3E7E2]">
              <div className="p-4 font-display font-semibold text-sm text-[#17231F]">
                Rider Payout Settlements ({settlements.length})
              </div>
              {settlements.map((s) => (
                <div
                  key={s.settlementId}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <p className="font-mono-tabular font-semibold text-[#17231F]">
                      Job {s.jobId} · Rider {s.riderUid}
                    </p>
                    <p className="text-[#77827B]">
                      Gross: {formatKes(s.grossDeliveryFee)} · Rider Payout:{' '}
                      <span className="font-semibold text-[#123C32]">
                        {formatKes(s.riderEarning)}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono-tabular font-semibold">{s.settlementStatus}</span>
                    {isAdminLevel && s.settlementStatus !== 'SETTLED' && (
                      <button
                        type="button"
                        onClick={() => {
                          setPromptValue('');
                          setPromptModal({
                            title: `Settle Rider Payout (${formatKes(s.riderEarning)})`,
                            label: 'M-Pesa B2C / Payout Transaction Reference',
                            placeholder: 'e.g. B2C_TXN_991827',
                            submitLabel: 'Mark Settled',
                            onSubmit: async (ref) => {
                              await adminSettleRiderPayout(profile.uid, s, ref);
                              pushToast({ kind: 'success', title: 'Rider settlement marked SETTLED' });
                            },
                          });
                        }}
                        className="px-3 py-2 rounded-lg bg-[#123C32] text-white font-semibold cursor-pointer"
                      >
                        Mark Settled
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* PRICING */}
          {tab === 'pricing' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 bg-white border border-[#E3E7E2] rounded-xl divide-y divide-[#E3E7E2]">
                <div className="p-4 font-display font-semibold text-sm text-[#17231F]">
                  Active Distance Pricing Rules ({pricingRules.length})
                </div>
                {pricingRules.map((r) => (
                  <div key={r.ruleId} className="p-4 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-semibold text-[#17231F]">
                        {r.minimumDistance}–{r.maximumDistance} km · {r.zoneName || r.zoneId}
                      </p>
                      <p className="text-[#77827B]">
                        Split: {r.riderPercentage}% rider / {r.platformPercentage}% platform
                      </p>
                    </div>
                    <span className="font-mono-tabular font-bold text-[#123C32] text-sm">
                      {formatKes(r.deliveryFee)}
                    </span>
                  </div>
                ))}
              </div>

              {isAdminLevel && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const riderPct = Number(newRiderPct);
                    await savePricingRule(profile.uid, {
                      ruleId: `rule_${Date.now()}`,
                      zoneId: zones[0]?.zoneId || 'westlands-nairobi',
                      zoneName: zones[0]?.zoneName || 'Westlands & Environs',
                      minimumDistance: Number(newMinKm),
                      maximumDistance: Number(newMaxKm),
                      deliveryFee: Number(newFee),
                      riderPercentage: riderPct,
                      platformPercentage: 100 - riderPct,
                      active: true,
                    });
                    pushToast({ kind: 'success', title: 'Pricing rule saved' });
                  }}
                  className="lg:col-span-5 bg-white border border-[#E3E7E2] rounded-xl p-5 space-y-3 text-xs"
                >
                  <h3 className="font-display font-semibold text-sm text-[#17231F]">
                    Add Pricing Tier
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Min Distance (km)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={newMinKm}
                        onChange={(e) => setNewMinKm(e.target.value)}
                        className="w-full px-3 py-2 border border-[#E3E7E2] rounded-lg font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Max Distance (km)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={newMaxKm}
                        onChange={(e) => setNewMaxKm(e.target.value)}
                        className="w-full px-3 py-2 border border-[#E3E7E2] rounded-lg font-mono"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Base Delivery Fee (KES)</label>
                      <input
                        type="number"
                        value={newFee}
                        onChange={(e) => setNewFee(e.target.value)}
                        className="w-full px-3 py-2 border border-[#E3E7E2] rounded-lg font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Rider Share (%)</label>
                      <input
                        type="number"
                        min={50}
                        max={95}
                        value={newRiderPct}
                        onChange={(e) => setNewRiderPct(e.target.value)}
                        className="w-full px-3 py-2 border border-[#E3E7E2] rounded-lg font-mono"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-lg bg-[#123C32] text-white font-semibold cursor-pointer"
                  >
                    Save Pricing Tier
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ZONES */}
          {tab === 'zones' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 bg-white border border-[#E3E7E2] rounded-xl divide-y divide-[#E3E7E2]">
                <div className="p-4 font-display font-semibold text-sm text-[#17231F]">
                  Nairobi Service Zones ({zones.length})
                </div>
                {zones.map((z) => (
                  <div key={z.zoneId} className="p-4 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-semibold text-[#17231F]">{z.zoneName}</p>
                      <p className="text-[#77827B]">
                        Radius: {z.radiusKm || z.coverageBoundary?.radiusKm || 18} km ·{' '}
                        {z.active ? 'Active' : 'Inactive'}
                      </p>
                    </div>
                    {isAdminLevel && (
                      <button
                        type="button"
                        onClick={async () => {
                          await saveServiceZone(profile.uid, { ...z, active: !z.active });
                          pushToast({ kind: 'info', title: `Toggled ${z.zoneName}` });
                        }}
                        className="px-3 py-1.5 rounded-lg border border-[#E3E7E2] font-semibold cursor-pointer"
                      >
                        {z.active ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {isAdminLevel && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!newZoneName.trim()) return;
                    const id = newZoneName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    await saveServiceZone(profile.uid, {
                      zoneId: id,
                      zoneName: newZoneName.trim(),
                      center: WESTLANDS_CENTER,
                      radiusKm: Number(newZoneRadius),
                      coverageBoundary: {
                        type: 'circle',
                        center: WESTLANDS_CENTER,
                        radiusKm: Number(newZoneRadius),
                      },
                      active: true,
                    });
                    setNewZoneName('');
                    pushToast({ kind: 'success', title: 'Service zone added' });
                  }}
                  className="lg:col-span-5 bg-white border border-[#E3E7E2] rounded-xl p-5 space-y-3 text-xs"
                >
                  <h3 className="font-display font-semibold text-sm text-[#17231F]">
                    Add Nairobi Zone
                  </h3>
                  <input
                    type="text"
                    required
                    value={newZoneName}
                    onChange={(e) => setNewZoneName(e.target.value)}
                    placeholder="Kilimani & Kileleshwa"
                    className="w-full px-3 py-2 border border-[#E3E7E2] rounded-lg"
                  />
                  <input
                    type="number"
                    min={2}
                    max={50}
                    value={newZoneRadius}
                    onChange={(e) => setNewZoneRadius(e.target.value)}
                    placeholder="Radius (km)"
                    className="w-full px-3 py-2 border border-[#E3E7E2] rounded-lg font-mono"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-lg bg-[#123C32] text-white font-semibold cursor-pointer"
                  >
                    Create Zone
                  </button>
                </form>
              )}
            </div>
          )}

          {/* REPORTS */}
          {tab === 'reports' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="font-display font-bold text-base text-[#17231F]">
                  Operations Analytics & Reports
                </h2>
                <button
                  type="button"
                  onClick={exportJobsCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#123C32] text-white text-xs font-semibold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV Report</span>
                </button>
              </div>
              <OperationsCharts jobs={jobs} riders={riders} />
            </div>
          )}

          {/* SUPPORT */}
          {tab === 'support' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl divide-y divide-[#E3E7E2]">
              <div className="p-4 font-display font-semibold text-sm text-[#17231F]">
                Support Tickets ({tickets.length})
              </div>
              {tickets.map((t) => (
                <div
                  key={t.ticketId}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <p className="font-semibold text-[#17231F]">
                      {t.issueType} · <span className="font-mono text-[#123C32]">{t.status}</span>
                    </p>
                    <p className="text-[#77827B] mt-0.5">{t.description}</p>
                  </div>
                  {t.status !== 'RESOLVED' && (
                    <button
                      type="button"
                      onClick={() => {
                        setPromptValue('');
                        setPromptModal({
                          title: `Resolve Ticket (${t.issueType})`,
                          label: 'Resolution notes for merchant / rider',
                          placeholder: 'Issue reviewed and resolved with dispatch.',
                          submitLabel: 'Mark Resolved',
                          onSubmit: async (notes) => {
                            await resolveSupportTicket(profile.uid, t.ticketId, 'RESOLVED', notes);
                            pushToast({ kind: 'success', title: 'Ticket marked RESOLVED' });
                          },
                        });
                      }}
                      className="px-3 py-2 rounded-lg bg-[#123C32] text-white font-semibold shrink-0 cursor-pointer"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* AUDIT LOGS */}
          {tab === 'audit' && (
            <div className="bg-white border border-[#E3E7E2] rounded-xl divide-y divide-[#E3E7E2]">
              <div className="p-4 font-display font-semibold text-sm text-[#17231F]">
                System Activity & Security Logs ({logs.length})
              </div>
              {logs.map((l) => (
                <div key={l.logId} className="p-3.5 flex justify-between gap-3 text-xs">
                  <div>
                    <span className="font-mono font-bold text-[#123C32]">{l.action}</span>{' '}
                    <span className="text-[#17231F]">{l.details}</span>
                  </div>
                  <span className="font-mono-tabular text-[#77827B] shrink-0">
                    {formatTimestamp(l.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* SETTINGS + ROLE ASSIGNMENT + INTEGRATION READINESS */}
          {tab === 'settings' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-6 bg-white border border-[#E3E7E2] rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#123C32]" />
                  <h3 className="font-display font-semibold text-sm text-[#17231F]">
                    Integration Configuration Readiness
                  </h3>
                </div>
                <p className="text-xs text-[#77827B]">
                  Live server status from <code className="font-mono">/api/config/status</code>. Unconfigured providers remain honestly paused without simulated transactions.
                </p>
                {readiness ? (
                  <div className="divide-y divide-[#E3E7E2] text-xs">
                    {[
                      {
                        label: `Firebase Project (${readiness.firebase.projectId})`,
                        ok: readiness.firebase.configured,
                      },
                      { label: 'Google Maps Platform Browser SDK', ok: hasMapsKey || readiness.googleMaps.configured },
                      {
                        label: `Safaricom Daraja M-Pesa (${readiness.daraja.env})`,
                        ok: readiness.daraja.configured,
                      },
                      { label: 'WhatsApp Business Cloud API', ok: readiness.whatsapp.configured },
                      { label: "Africa's Talking SMS Gateway", ok: readiness.sms.configured },
                      { label: 'Firebase Cloud Messaging (VAPID)', ok: readiness.fcm.configured },
                      { label: 'Firebase App Check (reCAPTCHA v3)', ok: readiness.appCheck.configured },
                    ].map((row) => (
                      <div key={row.label} className="py-2.5 flex items-center justify-between">
                        <span className="text-[#17231F] font-medium">{row.label}</span>
                        <span
                          className={`font-semibold ${
                            row.ok ? 'text-emerald-800' : 'text-amber-800'
                          }`}
                        >
                          {row.ok ? 'Configured' : 'Awaiting Credentials'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#77827B]">Checking server configuration...</p>
                )}
              </div>

              <div className="lg:col-span-6 bg-white border border-[#E3E7E2] rounded-xl p-5 space-y-4">
                <h3 className="font-display font-semibold text-sm text-[#17231F]">
                  Role Management {isSuperAdmin ? '(Super Admin)' : '(View Only)'}
                </h3>
                <div className="divide-y divide-[#E3E7E2] max-h-80 overflow-y-auto text-xs">
                  {users.map((u) => (
                    <div key={u.uid} className="py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-[#17231F] truncate">{u.fullName}</p>
                        <p className="text-[#77827B] truncate">
                          {u.email} · {u.role}
                        </p>
                      </div>
                      {isSuperAdmin && u.uid !== profile.uid && (
                        <select
                          value={u.role}
                          onChange={async (e) => {
                            const nextRole = e.target.value as any;
                            await assignUserAdminRole(profile.uid, u, nextRole);
                            pushToast({
                              kind: 'success',
                              title: `Updated ${u.email} to ${nextRole}`,
                            });
                          }}
                          className="px-2 py-1 border border-[#E3E7E2] rounded bg-white text-xs"
                        >
                          <option value="MERCHANT">MERCHANT</option>
                          <option value="RIDER">RIDER</option>
                          <option value="DISPATCHER">DISPATCHER</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      )}
                    </div>
                  ))}
                </div>
                {admins.length > 0 && (
                  <p className="text-[11px] text-[#77827B]">
                    Active admin registry entries: {admins.filter((a) => a.active).length}
                  </p>
                )}
                <div className="pt-2 border-t border-[#E3E7E2] flex items-center gap-3">
                  <PWAInstallButton showWhenInstalled />
                </div>
              </div>
            </div>
          )}
        </main>
        </PullToRefresh>
      </div>

      {/* RIDER VERIFICATION DOCUMENT INSPECTION MODAL */}
      {inspectingRider && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-end sm:items-center justify-center p-3 sm:p-5">
          <div className="bg-white border border-[#E3E7E2] rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-[#E3E7E2] flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-mono uppercase tracking-wider text-[#123C32] font-semibold">
                  Rider Compliance & Document Inspection
                </p>
                <h3 className="font-display text-lg font-bold text-[#17231F]">
                  {inspectingRider.fullName} · {inspectingRider.motorcycleRegistration}
                </h3>
                <p className="text-xs text-[#77827B]">
                  {inspectingRider.email} · {inspectingRider.phoneNumber} · Emergency:{' '}
                  {inspectingRider.emergencyContact || '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingRider(null)}
                className="p-2 rounded-lg text-[#77827B] hover:text-[#17231F] hover:bg-[#F7F8F5] cursor-pointer"
                aria-label="Close document review"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-[#F7F8F5] border border-[#E3E7E2] rounded-xl p-3.5">
                <div>
                  <span className="text-[#77827B] block">National ID Reference</span>
                  <span className="font-mono font-semibold text-[#17231F]">
                    {inspectingRider.nationalIdReference}
                  </span>
                </div>
                <div>
                  <span className="text-[#77827B] block">NTSA Driving Licence Ref</span>
                  <span className="font-mono font-semibold text-[#17231F]">
                    {inspectingRider.drivingLicenceRef || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[#77827B] block">Insurance Policy / Insurer</span>
                  <span className="font-semibold text-[#17231F]">
                    {inspectingRider.insuranceDetails || '—'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(
                  [
                    { key: 'nationalId', title: 'National ID Photo' },
                    { key: 'drivingLicence', title: 'NTSA Driving Licence' },
                    { key: 'insurance', title: 'Insurance Certificate' },
                  ] as Array<{ key: VerificationDocKey; title: string }>
                ).map((item) => {
                  const docRecord = inspectedDocs.find((d) => d.docKey === item.key);
                  const previewUrl = resolvedUrls[item.key] || docRecord?.dataUrl || null;
                  const refString = inspectingRider.verificationDocRefs?.[item.key];
                  const isPdf = docRecord?.mimeType === 'application/pdf';

                  return (
                    <div
                      key={item.key}
                      className="border border-[#E3E7E2] rounded-xl overflow-hidden flex flex-col bg-white"
                    >
                      <div className="px-3.5 py-2.5 bg-[#F7F8F5] border-b border-[#E3E7E2] flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[#17231F]">{item.title}</span>
                        <span
                          className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded ${
                            docRecord?.verificationStatus === 'VERIFIED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : docRecord?.verificationStatus === 'REJECTED'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {docRecord?.verificationStatus || (refString ? 'ATTACHED' : 'MISSING')}
                        </span>
                      </div>

                      <div className="h-44 bg-[#EFF2EC] flex items-center justify-center p-2 relative">
                        {previewUrl ? (
                          isPdf ? (
                            <div className="text-center space-y-2 p-3">
                              <FileText className="w-9 h-9 text-[#123C32] mx-auto" />
                              <p className="text-xs font-semibold text-[#17231F] truncate max-w-[180px]">
                                {docRecord?.fileName || 'document.pdf'}
                              </p>
                              <button
                                type="button"
                                onClick={() =>
                                  setZoomedDoc({
                                    title: item.title,
                                    url: previewUrl,
                                    mimeType: 'application/pdf',
                                  })
                                }
                                className="px-3 py-1.5 rounded-lg bg-[#123C32] text-white text-xs font-semibold cursor-pointer"
                              >
                                View PDF
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setZoomedDoc({
                                  title: item.title,
                                  url: previewUrl,
                                  mimeType: docRecord?.mimeType || 'image/jpeg',
                                })
                              }
                              className="w-full h-full cursor-pointer group relative"
                            >
                              <img
                                src={previewUrl}
                                alt={item.title}
                                className="w-full h-full object-contain rounded"
                              />
                              <span className="absolute bottom-2 right-2 px-2 py-1 rounded bg-black/70 text-white text-[10px] font-semibold">
                                Tap to zoom
                              </span>
                            </button>
                          )
                        ) : (
                          <div className="text-center text-xs text-[#77827B] px-3">
                            {refString
                              ? `File reference (${refString.slice(0, 28)}...) awaiting preview`
                              : 'Rider has not uploaded this file yet'}
                          </div>
                        )}
                      </div>

                      {docRecord && (
                        <div className="px-3 py-2 text-[11px] text-[#77827B] border-t border-[#E3E7E2] flex items-center justify-between gap-2">
                          <span className="truncate">{docRecord.fileName}</span>
                          <span className="font-mono shrink-0">
                            {Math.round(docRecord.byteSize / 1024)} KB
                          </span>
                        </div>
                      )}

                      {isAdminLevel && docRecord && (
                        <div className="p-2.5 border-t border-[#E3E7E2] grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              await adminReviewVerificationDoc({
                                adminUid: profile.uid,
                                rider: inspectingRider,
                                docKey: item.key,
                                status: 'VERIFIED',
                              });
                              pushToast({
                                kind: 'success',
                                title: `${item.title} verified`,
                              });
                            }}
                            className="py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Verify</span>
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await adminReviewVerificationDoc({
                                adminUid: profile.uid,
                                rider: inspectingRider,
                                docKey: item.key,
                                status: 'REJECTED',
                                reviewNotes: 'Please re-upload a clearer document photo.',
                              });
                              pushToast({
                                kind: 'info',
                                title: `${item.title} rejected`,
                              });
                            }}
                            className="py-1.5 rounded-lg border border-red-200 text-red-700 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Reject</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {isAdminLevel && (
              <div className="px-5 py-3.5 border-t border-[#E3E7E2] bg-[#F7F8F5] flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await adminUpdateRiderApproval(
                      profile.uid,
                      inspectingRider,
                      'REJECTED',
                      'REJECTED',
                      'REJECTED'
                    );
                    pushToast({ kind: 'info', title: `Rejected ${inspectingRider.fullName}` });
                    setInspectingRider(null);
                  }}
                  className="min-h-[40px] px-4 rounded-xl border border-red-200 bg-white text-red-700 text-xs font-semibold cursor-pointer"
                >
                  Reject Rider
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await adminUpdateRiderApproval(
                      profile.uid,
                      inspectingRider,
                      'APPROVED',
                      'VERIFIED',
                      'VERIFIED'
                    );
                    pushToast({
                      kind: 'success',
                      title: `Approved & verified ${inspectingRider.fullName}`,
                    });
                    setInspectingRider(null);
                  }}
                  className="min-h-[40px] px-4 rounded-xl bg-[#123C32] text-[#D5FF70] text-xs font-bold cursor-pointer"
                >
                  Approve Rider & Verify All Docs
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* DOCUMENT ZOOM LIGHTBOX */}
      {zoomedDoc && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E3E7E2] flex items-center justify-between gap-3">
              <h4 className="font-display font-semibold text-sm text-[#17231F]">
                {zoomedDoc.title}
              </h4>
              <div className="flex items-center gap-2">
                <a
                  href={zoomedDoc.url}
                  download={`${zoomedDoc.title.toLowerCase().replace(/\s+/g, '_')}`}
                  className="px-3 py-1.5 rounded-lg bg-[#123C32] text-white text-xs font-semibold"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setZoomedDoc(null)}
                  className="p-1.5 rounded-lg text-[#77827B] hover:text-[#17231F] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-[#17231F] flex items-center justify-center overflow-auto p-3">
              {zoomedDoc.mimeType === 'application/pdf' ? (
                <iframe
                  src={zoomedDoc.url}
                  title={zoomedDoc.title}
                  className="w-full h-[75vh] bg-white rounded"
                />
              ) : (
                <img
                  src={zoomedDoc.url}
                  alt={zoomedDoc.title}
                  className="max-w-full max-h-[78vh] object-contain"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* SHOP INSPECTION MODAL */}
      {inspectingShop && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white border border-[#E3E7E2] rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-mono uppercase text-[#123C32] font-semibold">
                  Merchant Shop Inspection
                </p>
                <h3 className="font-display text-lg font-bold text-[#17231F]">
                  {inspectingShop.shopName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectingShop(null)}
                className="p-1.5 rounded-lg text-[#77827B] hover:text-[#17231F] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-[#F7F8F5] border border-[#E3E7E2] rounded-xl p-4 text-xs space-y-2">
              <p>
                <span className="text-[#77827B]">Category:</span> {inspectingShop.businessCategory}
              </p>
              <p>
                <span className="text-[#77827B]">Contact Person:</span>{' '}
                {inspectingShop.contactPerson}
              </p>
              <p>
                <span className="text-[#77827B]">Phone / Email:</span> {inspectingShop.phoneNumber}{' '}
                · {inspectingShop.email}
              </p>
              <p>
                <span className="text-[#77827B]">Pickup Address:</span>{' '}
                {inspectingShop.physicalAddress}
              </p>
              <p>
                <span className="text-[#77827B]">Coordinates:</span>{' '}
                <span className="font-mono">
                  {inspectingShop.location.lat.toFixed(5)}, {inspectingShop.location.lng.toFixed(5)}
                </span>
              </p>
              <p>
                <span className="text-[#77827B]">Operating Hours:</span>{' '}
                {inspectingShop.operatingHours}
              </p>
              <p>
                <span className="text-[#77827B]">Status:</span> {inspectingShop.status} (
                {inspectingShop.verificationStatus})
              </p>
            </div>
            {isAdminLevel && (
              <div className="flex items-center justify-end gap-2">
                {inspectingShop.status !== 'SUSPENDED' && (
                  <button
                    type="button"
                    onClick={async () => {
                      await adminUpdateShopStatus(
                        profile.uid,
                        inspectingShop,
                        'SUSPENDED',
                        'REJECTED'
                      );
                      pushToast({ kind: 'info', title: `Suspended ${inspectingShop.shopName}` });
                      setInspectingShop(null);
                    }}
                    className="min-h-[40px] px-4 rounded-xl border border-red-200 text-red-700 text-xs font-semibold cursor-pointer"
                  >
                    Suspend
                  </button>
                )}
                {inspectingShop.status !== 'ACTIVE' && (
                  <button
                    type="button"
                    onClick={async () => {
                      await adminUpdateShopStatus(
                        profile.uid,
                        inspectingShop,
                        'ACTIVE',
                        'VERIFIED'
                      );
                      pushToast({ kind: 'success', title: `Approved ${inspectingShop.shopName}` });
                      setInspectingShop(null);
                    }}
                    className="min-h-[40px] px-4 rounded-xl bg-[#123C32] text-[#D5FF70] text-xs font-bold cursor-pointer"
                  >
                    Approve & Verify Shop
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* REUSABLE ACTION INPUT MODAL */}
      {promptModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!promptValue.trim()) return;
              setPromptBusy(true);
              try {
                await promptModal.onSubmit(promptValue.trim());
                setPromptModal(null);
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
                {promptModal.title}
              </h3>
              <button
                type="button"
                onClick={() => setPromptModal(null)}
                className="p-1 text-[#77827B] hover:text-[#17231F] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#17231F] mb-1">
                {promptModal.label}
              </label>
              <input
                type="text"
                required
                autoFocus
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                placeholder={promptModal.placeholder}
                className="w-full px-3.5 py-2.5 text-sm border border-[#E3E7E2] rounded-lg focus:outline-none focus:border-[#123C32]"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPromptModal(null)}
                className="min-h-[40px] px-4 rounded-xl border border-[#E3E7E2] text-xs font-semibold text-[#17231F] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={promptBusy}
                className="min-h-[40px] px-4 rounded-xl bg-[#123C32] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {promptBusy ? 'Saving...' : promptModal.submitLabel}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
