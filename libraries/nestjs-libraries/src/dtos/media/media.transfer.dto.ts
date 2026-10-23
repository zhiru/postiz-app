import { z } from 'zod';

const manifest = {
  filename: z
    .string()
    .min(1)
    .max(200)
    .refine(
      (name) =>
        name.trim().length > 0 &&
        !/[\\/\u0000-\u001f\u007f]/.test(name) &&
        name !== '.' &&
        name !== '..',
      'Use a filename, not a filesystem path.'
    ),
  mimeType: z.enum([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/avif',
    'image/bmp',
    'image/tiff',
    'video/mp4',
    'video/quicktime',
  ]),
  adjust: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(200),
};
export const uploadMediaSchema = z
  .object({
    ...manifest,
    base64: z
      .string()
      .min(1)
      .max(6 * 1024 * 1024)
      .refine(
        (value) =>
          value.length <= 6 * 1024 * 1024 &&
          value.length % 4 === 0 &&
          /^[A-Za-z0-9+/]+={0,2}$/.test(value),
        'Use valid base64 file bytes.'
      ),
  })
  .strict();
export const prepareMediaUploadSchema = z
  .object({
    ...manifest,
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(1024 * 1024 * 1024),
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .transform((value) => value.toLowerCase()),
  })
  .strict()
  .refine(
    (value) =>
      !value.mimeType.startsWith('image/') ||
      value.sizeBytes <= 10 * 1024 * 1024,
    { message: 'Images must not exceed 10 MiB.', path: ['sizeBytes'] }
  );
export const completeMediaUploadSchema = z
  .object({
    uploadId: z.string().regex(/^mu_[a-f0-9]{64}$/),
  })
  .strict();
export type UploadMediaInput = z.infer<typeof uploadMediaSchema>;
export type PrepareMediaUploadInput = z.infer<typeof prepareMediaUploadSchema>;
export type MediaTransferManifest = Omit<
  PrepareMediaUploadInput,
  'idempotencyKey'
>;
export type MediaTransferStatus = {
  uploadId: string;
  status:
    | 'awaiting_upload'
    | 'uploading'
    | 'processing'
    | 'ready'
    | 'failed'
    | 'unknown';
  progress: number | null;
  id?: string;
  path?: string;
  originalPath?: string;
  error?: { code: string; message: string };
};
export type PreparedMediaTransfer = MediaTransferStatus & {
  uploadUrl?: string;
  method?: 'POST';
  uploadHeaders?: { 'X-Postiz-Upload-Ticket': string };
  expiresAt?: string;
};
