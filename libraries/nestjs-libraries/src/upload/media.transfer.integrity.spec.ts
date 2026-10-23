jest.mock('file-type', () => ({
  fileTypeStream: jest.fn(async (stream) => {
    stream.fileType = { mime: 'image/png', ext: 'png' };
    return stream;
  }),
}));
import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { uploadStreamToStorage } from './custom.upload.validation';
import { uploadMediaSchema } from '@gitroom/nestjs-libraries/dtos/media/media.transfer.dto';
const bytes = Buffer.from('the file');
const expected = {
  mimeType: 'image/png',
  sizeBytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
const storage: any = {
  uploadStream: jest.fn(async (stream) => {
    for await (const chunk of stream) {
      void chunk;
    }
    return {
      filename: 'file.png',
      originalname: 'file.png',
      mimetype: 'image/png',
      path: 'https://uploads.test/file.png',
    };
  }),
};
beforeEach(() => jest.clearAllMocks());
it('accepts bytes only when MIME, exact size and checksum match', async () => {
  await expect(
    uploadStreamToStorage(
      storage,
      new Response(bytes).body,
      bytes.length,
      expected
    )
  ).resolves.toMatchObject({ path: 'https://uploads.test/file.png' });
});
it.each([
  { mimeType: 'video/mp4' },
  { sizeBytes: bytes.length - 1 },
  { sizeBytes: bytes.length + 1 },
  { sha256: '0'.repeat(64) },
])('rejects mismatching manifest %p', async (patch) => {
  await expect(
    uploadStreamToStorage(storage, new Response(bytes).body, bytes.length, {
      ...expected,
      ...patch,
    })
  ).rejects.toBeInstanceOf(BadRequestException);
  if (patch.mimeType) expect(storage.uploadStream).not.toHaveBeenCalled();
});
it('validates maximum base64 input in linear space without a regex stack overflow', () => {
  const input = {
    filename: 'file.png',
    mimeType: 'image/png',
    adjust: false,
    idempotencyKey: 'upload-001',
    base64: 'a'.repeat(6 * 1024 * 1024),
  };
  expect(uploadMediaSchema.safeParse(input).success).toBe(true);
  expect(
    uploadMediaSchema.safeParse({ ...input, base64: input.base64 + 'a' })
      .success
  ).toBe(false);
});
it('preserves the exact basename including edge spaces while rejecting blank names', () => {
  const input = {
    filename: ' vídeo-á.png ',
    mimeType: 'image/png',
    adjust: false,
    idempotencyKey: 'upload-001',
    base64: 'YQ==',
  };
  expect(uploadMediaSchema.parse(input).filename).toBe(input.filename);
  expect(
    uploadMediaSchema.safeParse({ ...input, filename: '   ' }).success
  ).toBe(false);
});
