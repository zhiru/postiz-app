const prepare = jest.fn(),
  fail = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn(() => ({
    prepareLocalMediaV1: prepare,
    failLocalMediaV1: fail,
  })),
}));
import { proxyActivities } from '@temporalio/workflow';
import { prepareLocalMediaWorkflowV1 } from './prepare.local.media.workflow.v1';
describe('local media preparation workflow', () => {
  beforeEach(() => {
    prepare.mockReset();
    fail.mockReset();
  });
  it('does not retry conversion with a possibly uploaded output, but retries the idempotent failure marker', async () => {
    expect(proxyActivities).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ retry: { maximumAttempts: 1 } })
    );
    expect(proxyActivities).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ retry: { maximumAttempts: 5 } })
    );
    await prepareLocalMediaWorkflowV1({ mediaId: 'media' });
    expect(prepare).toHaveBeenCalledWith('media');
    expect(fail).not.toHaveBeenCalled();
  });
  it('marks a failed conversion without changing or deleting its original', async () => {
    prepare.mockRejectedValueOnce(new Error('Conversion failed'));
    await prepareLocalMediaWorkflowV1({ mediaId: 'media' });
    expect(fail).toHaveBeenCalledWith('media');
  });
});
