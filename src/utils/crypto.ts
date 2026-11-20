export async function sha256Hex(input: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const { createHash } = await import('crypto');
  return createHash('sha256').update(input).digest('hex');
}

export function generateSecureToken(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateFourDigitPin(): string {
  const arr = new Uint32Array(1);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(arr);
  } else {
    arr[0] = Math.floor(Math.random() * 10000);
  }
  return String(1000 + (arr[0] % 9000));
}

export function generateJobReference(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(6);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < 6; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[arr[i] % chars.length];
  }
  return `FB-${code}`;
}

export function formatKenyanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) return `254${digits}`;
  return digits;
}

export function isValidKenyanPhone(phone: string): boolean {
  const formatted = formatKenyanPhone(phone);
  return /^254(7|1)\d{8}$/.test(formatted);
}

export function formatKes(amount: number): string {
  return `KES ${Math.round(amount).toLocaleString('en-KE')}`;
}

export function formatTimestamp(ts: any): string {
  if (!ts) return '—';
  const date = typeof ts?.toDate === 'function' ? ts.toDate() : ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function toDateSafe(ts: any): Date | null {
  if (!ts) return null;
  const d = typeof ts?.toDate === 'function' ? ts.toDate() : ts instanceof Date ? ts : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}
