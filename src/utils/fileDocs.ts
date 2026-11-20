import type { VerificationDocKey } from '../types/fikaboda';

export const ALLOWED_DOC_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const MAX_RAW_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB browser file input limit
export const MAX_STORED_DOC_BYTES = 680 * 1024; // Keeps Firestore doc well under 1 MiB limit

export interface PreparedVerificationDoc {
  docKey: VerificationDocKey;
  fileName: string;
  mimeType: string;
  byteSize: number;
  dataUrl: string;
}

export function validateVerificationDocFile(file: {
  name: string;
  type: string;
  size: number;
}): { valid: boolean; error?: string } {
  if (!file || !file.name) {
    return { valid: false, error: 'No file selected.' };
  }
  const normalizedType = (file.type || '').toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const inferredType =
    normalizedType ||
    (ext === 'pdf'
      ? 'application/pdf'
      : ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'jpg' || ext === 'jpeg'
            ? 'image/jpeg'
            : '');

  if (!ALLOWED_DOC_MIME_TYPES.includes(inferredType as any)) {
    return {
      valid: false,
      error: `${file.name}: Unsupported file type. Upload JPG, PNG, WebP, or PDF.`,
    };
  }
  if (file.size <= 0) {
    return { valid: false, error: `${file.name}: File appears empty.` };
  }
  if (file.size > MAX_RAW_UPLOAD_BYTES) {
    return {
      valid: false,
      error: `${file.name}: File exceeds 10 MB limit.`,
    };
  }
  if (inferredType === 'application/pdf' && file.size > MAX_STORED_DOC_BYTES) {
    return {
      valid: false,
      error: `${file.name}: PDF must be under 680 KB (or upload a photo/screenshot instead).`,
    };
  }
  return { valid: true };
}

export function estimateDataUrlByteSize(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return dataUrl.length;
  const base64 = dataUrl.slice(commaIdx + 1);
  return Math.floor((base64.length * 3) / 4);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function compressImageFile(file: File, maxDimension = 1280, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Canvas context unavailable'));
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        let result = canvas.toDataURL('image/jpeg', quality);
        if (estimateDataUrlByteSize(result) > MAX_STORED_DOC_BYTES) {
          result = canvas.toDataURL('image/jpeg', 0.56);
        }
        URL.revokeObjectURL(objectUrl);
        resolve(result);
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not decode image ${file.name}`));
    };
    img.src = objectUrl;
  });
}

export async function prepareVerificationDocPayload(
  docKey: VerificationDocKey,
  file: File
): Promise<PreparedVerificationDoc> {
  const check = validateVerificationDocFile(file);
  if (!check.valid) {
    throw new Error(check.error || 'Invalid document file.');
  }

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  let dataUrl: string;
  let mimeType: string;

  if (isPdf) {
    dataUrl = await readFileAsDataUrl(file);
    mimeType = 'application/pdf';
  } else {
    try {
      dataUrl = await compressImageFile(file);
      mimeType = 'image/jpeg';
    } catch {
      dataUrl = await readFileAsDataUrl(file);
      mimeType = file.type || 'image/jpeg';
    }
  }

  const byteSize = estimateDataUrlByteSize(dataUrl);
  if (byteSize > MAX_STORED_DOC_BYTES) {
    throw new Error(
      `${file.name} is still too large after compression (${Math.round(byteSize / 1024)} KB). Choose a smaller image or PDF.`
    );
  }

  return {
    docKey,
    fileName: file.name.slice(0, 120),
    mimeType,
    byteSize,
    dataUrl,
  };
}
