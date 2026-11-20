import React from 'react';
import type { DeliveryJob, Rider } from '../../types/fikaboda';
import { formatKes, toDateSafe } from '../../utils/crypto';

export const OperationsCharts: React.FC<{
  jobs: DeliveryJob[];
  riders: Rider[];
}> = ({ jobs, riders }) => {
  // Build last 7 days series from real Firestore deliveryJobs
  const days: Array<{ label: string; key: string; count: number; revenue: number; failed: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-KE', { weekday: 'short' });
    days.push({ label, key, count: 0, revenue: 0, failed: 0 });
  }

  jobs.forEach((job) => {
    const dt = toDateSafe(job.createdAt);
    if (!dt) return;
    const key = dt.toISOString().slice(0, 10);
    const bucket = days.find((d) => d.key === key);
    if (!bucket) return;
    bucket.count += 1;
    if (job.deliveryStatus === 'DELIVERED') {
      bucket.revenue += job.deliveryFee;
    }
    if (job.deliveryStatus === 'FAILED' || job.deliveryStatus === 'CANCELLED') {
      bucket.failed += 1;
    }
  });

  const maxCount = Math.max(1, ...days.map((d) => d.count));
  const maxRevenue = Math.max(1, ...days.map((d) => d.revenue));

  const riderStats = riders
    .map((r) => {
      const completed = jobs.filter(
        (j) => j.riderUid === r.uid && j.deliveryStatus === 'DELIVERED'
      ).length;
      return { name: r.fullName, completed, plate: r.motorcycleRegistration };
    })
    .sort((a, b) => b.completed - a.completed)
    .slice(0, 5);
  const maxRiderCount = Math.max(1, ...riderStats.map((r) => r.completed));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white border border-[#E3E7E2] rounded-xl p-5">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="font-display font-semibold text-sm text-[#17231F]">
              Daily Delivery Volume (7 Days)
            </h3>
            <p className="text-xs text-[#77827B]">Total dispatches vs failed/cancelled</p>
          </div>
          <span className="text-xs font-mono-tabular text-[#123C32] font-semibold">
            {jobs.length} total
          </span>
        </div>

        <div className="h-44 flex items-end gap-3 pt-4 border-b border-[#E3E7E2] pb-2">
          {days.map((d) => {
            const heightPct = Math.round((d.count / maxCount) * 100);
            const failedPct = d.count > 0 ? Math.round((d.failed / maxCount) * 100) : 0;
            return (
              <div key={d.key} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
                <span className="text-[11px] font-mono-tabular text-[#77827B]">{d.count}</span>
                <div className="w-full max-w-[34px] h-28 bg-[#F7F8F5] rounded-t-md flex flex-col justify-end overflow-hidden border border-[#E3E7E2]">
                  {failedPct > 0 && (
                    <div
                      style={{ height: `${failedPct}%` }}
                      className="w-full bg-red-400"
                      title={`Failed/Cancelled: ${d.failed}`}
                    />
                  )}
                  <div
                    style={{ height: `${Math.max(heightPct - failedPct, d.count > 0 ? 6 : 0)}%` }}
                    className="w-full bg-[#123C32] transition-all duration-300"
                    title={`Deliveries: ${d.count}`}
                  />
                </div>
                <span className="text-[11px] text-[#77827B]">{d.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white border border-[#E3E7E2] rounded-xl p-5">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="font-display font-semibold text-sm text-[#17231F]">
              Completed Revenue & Top Riders
            </h3>
            <p className="text-xs text-[#77827B]">Gross delivered fees (KES) & rider output</p>
          </div>
          <span className="text-xs font-mono-tabular text-[#123C32] font-semibold">
            {formatKes(days.reduce((a, b) => a + b.revenue, 0))}
          </span>
        </div>

        <div className="space-y-3">
          {days.slice(-4).map((d) => (
            <div key={d.key} className="flex items-center gap-3 text-xs">
              <span className="w-10 text-[#77827B] font-medium">{d.label}</span>
              <div className="flex-1 h-2.5 bg-[#F7F8F5] rounded-full overflow-hidden border border-[#E3E7E2]">
                <div
                  style={{ width: `${Math.round((d.revenue / maxRevenue) * 100)}%` }}
                  className="h-full bg-[#A6E65B]"
                />
              </div>
              <span className="w-24 text-right font-mono-tabular text-[#17231F]">
                {formatKes(d.revenue)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-5 pt-4 border-t border-[#E3E7E2]">
          <p className="text-xs font-semibold text-[#17231F] mb-2.5">Top Active Riders</p>
          {riderStats.length === 0 ? (
            <p className="text-xs text-[#77827B]">No rider completions recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {riderStats.map((r) => (
                <div key={r.plate + r.name} className="flex items-center gap-2 text-xs">
                  <span className="truncate flex-1 text-[#17231F]">
                    {r.name} <span className="text-[#77827B] font-mono-tabular">· {r.plate}</span>
                  </span>
                  <div className="w-24 h-2 bg-[#F7F8F5] rounded-full overflow-hidden">
                    <div
                      style={{ width: `${Math.round((r.completed / maxRiderCount) * 100)}%` }}
                      className="h-full bg-[#123C32]"
                    />
                  </div>
                  <span className="w-8 text-right font-mono-tabular font-semibold text-[#123C32]">
                    {r.completed}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
