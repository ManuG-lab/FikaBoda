import { jsPDF } from 'jspdf';
import type { DeliveryJob, PaymentRecord, Shop } from '../types/fikaboda';
import { formatKes, formatTimestamp } from './crypto';

export function downloadMerchantStatementPdf(
  shop: Shop,
  jobs: DeliveryJob[],
  payments: PaymentRecord[],
  periodLabel: string
) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  // Brand header bar
  doc.setFillColor(18, 60, 50); // #123C32
  doc.rect(0, 0, 595, 86, 'F');

  doc.setTextColor(213, 255, 112); // #D5FF70
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('FIKABODA', 40, 42);

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Your Shop. Our Riders. Fika!  |  Merchant Delivery Statement', 40, 62);

  // Shop Metadata
  doc.setTextColor(23, 35, 31);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(shop.shopName, 40, 118);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(90, 102, 95);
  doc.text(`${shop.physicalAddress}  |  ${shop.phoneNumber}  |  ${shop.email}`, 40, 134);
  doc.text(`Statement Period: ${periodLabel}  |  Generated: ${new Date().toLocaleDateString('en-KE')}`, 40, 149);

  // Summary metrics
  const completedCount = jobs.filter((j) => j.deliveryStatus === 'DELIVERED').length;
  const totalFee = jobs.reduce((acc, j) => acc + (j.deliveryStatus !== 'CANCELLED' ? j.deliveryFee : 0), 0);
  const totalPaid = payments
    .filter((p) => p.paymentStatus === 'PAID')
    .reduce((acc, p) => acc + p.amount, 0);

  doc.setDrawColor(220, 225, 220);
  doc.setFillColor(247, 248, 245);
  doc.roundedRect(40, 170, 515, 58, 6, 6, 'FD');

  doc.setTextColor(23, 35, 31);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(`Total Deliveries: ${jobs.length}`, 56, 194);
  doc.text(`Completed: ${completedCount}`, 190, 194);
  doc.text(`Delivery Charges: ${formatKes(totalFee)}`, 300, 194);
  doc.text(`Confirmed Paid: ${formatKes(totalPaid)}`, 440, 194);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 110, 105);
  doc.text(
    'Note: Delivery fees are billed separately from merchant product sales.',
    56,
    214
  );

  // Table header
  let y = 256;
  doc.setFillColor(18, 60, 50);
  doc.rect(40, y - 14, 515, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('REF', 48, y);
  doc.text('DATE', 112, y);
  doc.text('CUSTOMER / ROUTE', 200, y);
  doc.text('DIST', 360, y);
  doc.text('STATUS', 410, y);
  doc.text('FEE', 505, y);

  y += 20;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(23, 35, 31);

  jobs.slice(0, 28).forEach((job, idx) => {
    if (y > 760) {
      doc.addPage();
      y = 50;
    }
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 247);
      doc.rect(40, y - 12, 515, 18, 'F');
    }
    doc.setFontSize(8);
    doc.text(job.referenceCode, 48, y);
    doc.text(formatTimestamp(job.createdAt).slice(0, 14), 112, y);
    const routeText = `${job.customerName} (${job.deliveryAddress.slice(0, 26)})`;
    doc.text(routeText, 200, y);
    doc.text(`${job.roadDistanceKm.toFixed(1)} km`, 360, y);
    doc.text(job.deliveryStatus, 410, y);
    doc.text(formatKes(job.deliveryFee), 505, y);
    y += 18;
  });

  doc.setFontSize(8);
  doc.setTextColor(120, 130, 125);
  doc.text('FikaBoda Logistics Infrastructure — Westlands, Nairobi, Kenya', 40, 810);

  doc.save(`FikaBoda-Statement-${shop.shopName.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`);
}
