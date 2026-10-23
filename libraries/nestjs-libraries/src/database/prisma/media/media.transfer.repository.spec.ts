import {
  MediaTransferRepository,
  TransferState,
} from './media.transfer.repository';
const scope = { id: 'upload', organizationId: 'o1', profileId: 'p1' };
const state: TransferState = {
  version: 1,
  status: 'uploading',
  manifest: {
    filename: 'photo.png',
    mimeType: 'image/png',
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
    adjust: false,
  },
};
const record = { ...scope, requestHash: 'hash', result: JSON.stringify(state) };
const setup = () => {
  const tx = {
    postOperation: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    media: { create: jest.fn() },
  };
  const transaction: any = {
    model: { $transaction: jest.fn(async (callback) => callback(tx)) },
  };
  return {
    tx,
    transaction,
    repository: new MediaTransferRepository(transaction),
  };
};
it('scopes every read to the exact authenticated organization and profile', async () => {
  const { tx, repository } = setup();
  await repository.find(scope);
  expect(tx.postOperation.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: scope })
  );
});
it('commits the media id and replay receipt inside one transaction', async () => {
  const { tx, transaction, repository } = setup();
  await repository.save(record, state, {
    id: 'media',
    name: 'stored.png',
    path: 'https://uploads.test/stored.png',
    sizeBytes: 10,
    mimeType: 'image/png',
  });
  expect(transaction.model.$transaction).toHaveBeenCalledTimes(1);
  expect(tx.postOperation.updateMany).toHaveBeenCalledWith({
    where: { ...scope, result: record.result },
    data: {
      result: JSON.stringify({ ...state, status: 'stored', mediaId: 'media' }),
    },
  });
  expect(tx.media.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        originalName: 'photo.png',
        originalPath: 'https://uploads.test/stored.png',
        status: 'ready',
        organizationId: 'o1',
        profileId: 'p1',
      }),
    })
  );
});
it('never creates a second media row after another worker completed the claim', async () => {
  const { tx, repository } = setup();
  tx.postOperation.updateMany.mockResolvedValue({ count: 0 });
  await expect(
    repository.save(record, state, {
      id: 'media',
      name: 'stored.png',
      path: 'https://uploads.test/stored.png',
      sizeBytes: 10,
      mimeType: 'image/png',
    })
  ).rejects.toThrow();
  expect(tx.media.create).not.toHaveBeenCalled();
});
