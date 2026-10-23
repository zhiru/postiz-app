import 'reflect-metadata';
import { InstagramProvider } from './instagram.provider';
import { InstagramStandaloneProvider } from './instagram.standalone.provider';
import { ssrfSafeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
jest.mock(
  '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher',
  () => ({ ssrfSafeFetch: jest.fn() })
);
const request = ssrfSafeFetch as jest.Mock;
const ok = (value: unknown) => ({ ok: true, json: async () => value });
beforeEach(() => request.mockReset());
it('requires Facebook user token, granted permission and matching owner', async () => {
  const p = new InstagramProvider();
  await expect(p.checkRemoteDeletion('owner', 'page', '123')).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(ok({ data: [] }));
  await expect(
    p.checkRemoteDeletion('owner', 'page___user', '123')
  ).rejects.toThrow();
  request
    .mockResolvedValueOnce(
      ok({
        data: [{ permission: 'instagram_manage_contents', status: 'granted' }],
      })
    )
    .mockResolvedValueOnce(ok({ id: '123', owner: { id: 'other' } }));
  await expect(
    p.checkRemoteDeletion('owner', 'page___user', '123')
  ).rejects.toThrow();
});
it('uses a header token and confirms the exact deleted ID with no retries', async () => {
  request.mockResolvedValueOnce(ok({ success: true, deleted_id: '123' }));
  expect(
    await new InstagramProvider().deletePublishedPost('page___user', '123')
  ).toEqual({ success: true, deletedId: '123' });
  expect(request).toHaveBeenCalledWith(
    expect.not.stringContaining('user'),
    expect.objectContaining({
      method: 'DELETE',
      headers: { Authorization: 'Bearer user' },
    })
  );
  expect(request).toHaveBeenCalledTimes(1);
});
it('does not claim success for a different deleted ID or an accepted-only response', async () => {
  for (const result of [
    { success: true, deleted_id: '456' },
    { success: true },
  ]) {
    request.mockResolvedValueOnce(ok(result));
    await expect(
      new InstagramProvider().deletePublishedPost('page___user', '123')
    ).rejects.toThrow();
  }
});
it('does not expose deletion on Instagram Login', () => {
  expect(
    (new InstagramStandaloneProvider() as any).deletePublishedPost
  ).toBeUndefined();
});
