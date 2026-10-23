jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.transfer.service',
  () => ({ MediaTransferService: class {} })
);
import { PassThrough } from 'stream';
import { lastValueFrom, of } from 'rxjs';
import {
  MediaTransferExceptionFilter,
  MediaTransferInterceptor,
} from './media.transfer.interceptor';
const make = (parts = 1) => {
  const request: any = new PassThrough();
  request.headers = {
    'content-type': 'multipart/form-data; boundary=test-boundary',
    'transfer-encoding': 'chunked',
  };
  request.method = 'POST';
  request.params = { uploadId: 'upload' };
  request.header = () => 'ticket';
  const response = {};
  const claimed = {
    record: { id: 'upload' },
    state: { manifest: { sizeBytes: 5 } },
  };
  const result = {
    uploadId: 'upload',
    status: 'ready',
    progress: 100,
    id: 'media',
  };
  const stored = {
    filename: 'stored.png',
    originalname: 'stored.png',
    path: 'https://uploads.test/stored.png',
    mimetype: 'image/png',
  };
  const service: any = {
    authorizeAndClaim: jest.fn().mockResolvedValue(claimed),
    receive: jest.fn(async (_c, stream) => {
      for await (const chunk of stream) {
        void chunk;
      }
      return stored;
    }),
    finalize: jest.fn().mockResolvedValue(result),
    fail: jest.fn().mockResolvedValue({ ...result, status: 'failed' }),
    discard: jest.fn(),
  };
  const context: any = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  };
  const next: any = { handle: () => of(request.mediaTransferResult) };
  const body =
    Array.from(
      { length: parts },
      () =>
        '--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\nbytes\r\n'
    ).join('') + '--test-boundary--\r\n';
  process.nextTick(() => request.end(body));
  return { request, service, context, next, result };
};
it('accepts exactly one real multipart file and finalizes only after parsing finishes', async () => {
  const { service, context, next, result } = make();
  expect(
    await lastValueFrom(
      await new MediaTransferInterceptor(service).intercept(context, next)
    )
  ).toEqual(result);
  expect(service.finalize).toHaveBeenCalledTimes(1);
  expect(service.fail).not.toHaveBeenCalled();
});
it('rejects an extra multipart file and removes uncommitted stored bytes', async () => {
  const { service, context, next } = make(2);
  const result = await lastValueFrom(
    await new MediaTransferInterceptor(service).intercept(context, next)
  );
  expect(result).toMatchObject({ status: 'failed' });
  expect(service.finalize).not.toHaveBeenCalled();
});
it('checks the ticket before starting multipart parsing', async () => {
  const { service, context, next } = make();
  service.authorizeAndClaim.mockRejectedValue(new Error('invalid ticket'));
  await expect(
    new MediaTransferInterceptor(service).intercept(context, next)
  ).rejects.toThrow('invalid ticket');
  expect(service.receive).not.toHaveBeenCalled();
});
it('replays a completed transfer without accepting another file', async () => {
  const { service, context, next, result } = make();
  service.authorizeAndClaim.mockResolvedValue(result);
  expect(
    await lastValueFrom(
      await new MediaTransferInterceptor(service).intercept(context, next)
    )
  ).toEqual(result);
  expect(service.receive).not.toHaveBeenCalled();
});
it('redacts the upload credential before an infrastructure failure reaches any error hook', async () => {
  const { request, service, context, next } = make();
  request.headers['x-postiz-upload-ticket'] = 'secret';
  request.rawHeaders = ['X-Postiz-Upload-Ticket', 'secret'];
  service.authorizeAndClaim.mockRejectedValue(new Error('redis://secret'));
  await expect(
    new MediaTransferInterceptor(service).intercept(context, next)
  ).rejects.toThrow();
  expect(request.headers['x-postiz-upload-ticket']).toBeUndefined();
  expect(request.rawHeaders).toEqual(['X-Postiz-Upload-Ticket', '[redacted]']);
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  new MediaTransferExceptionFilter().catch(new Error('redis://secret'), {
    switchToHttp: () => ({ getResponse: () => response }),
  } as any);
  expect(response.status).toHaveBeenCalledWith(503);
  expect(JSON.stringify(response.json.mock.calls)).not.toContain('secret');
});
