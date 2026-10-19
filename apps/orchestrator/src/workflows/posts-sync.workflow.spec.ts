jest.mock('@temporalio/workflow', () => {
  const activities = {
    prepareExternalPostsSync: jest.fn(),
    syncExternalPostsPage: jest.fn(),
    finishExternalPostsSync: jest.fn(),
    failExternalPostsSync: jest.fn(),
  };
  return {
    proxyActivities: () => activities,
    continueAsNew: jest.fn(),
    sleep: jest.fn(),
    activities,
  };
});
import { syncExternalPostsWorkflowV1 } from './sync.external.posts.workflow.v1';
const { activities, continueAsNew } = jest.requireMock('@temporalio/workflow');

describe('external history workflow', () => {
  beforeEach(() => jest.resetAllMocks());
  const input = { organizationId: 'org', id: 'channel' };

  it('resumes the stored cursor and finishes only at the end of history', async () => {
    activities.prepareExternalPostsSync.mockResolvedValue({
      full: true,
      cursor: 'resume',
    });
    activities.syncExternalPostsPage
      .mockResolvedValueOnce({ nextCursor: 'next' })
      .mockResolvedValueOnce({});
    await syncExternalPostsWorkflowV1(input);
    expect(activities.syncExternalPostsPage.mock.calls).toEqual([
      ['org', 'channel', true, 'resume'],
      ['org', 'channel', true, 'next'],
    ]);
    expect(activities.finishExternalPostsSync).toHaveBeenCalledWith(
      'org',
      'channel',
      true
    );
  });

  it('rolls large histories into a new workflow execution without marking failure', async () => {
    activities.prepareExternalPostsSync.mockResolvedValue({ full: true });
    activities.syncExternalPostsPage.mockResolvedValue({ nextCursor: 'more' });
    await syncExternalPostsWorkflowV1(input);
    expect(activities.syncExternalPostsPage).toHaveBeenCalledTimes(50);
    expect(continueAsNew).toHaveBeenCalledWith({
      ...input,
      full: true,
      cursor: 'more',
    });
    expect(activities.finishExternalPostsSync).not.toHaveBeenCalled();
    expect(activities.failExternalPostsSync).not.toHaveBeenCalled();
  });

  it('bounds recent refreshes and does not mark a full reconciliation', async () => {
    activities.prepareExternalPostsSync.mockResolvedValue({ full: false });
    activities.syncExternalPostsPage.mockResolvedValue({ nextCursor: 'more' });
    await syncExternalPostsWorkflowV1(input);
    expect(activities.syncExternalPostsPage).toHaveBeenCalledTimes(3);
    expect(activities.finishExternalPostsSync).toHaveBeenCalledWith(
      'org',
      'channel',
      false
    );
  });

  it('reports a failed page without declaring the history imported', async () => {
    activities.prepareExternalPostsSync.mockResolvedValue({ full: true });
    activities.syncExternalPostsPage.mockRejectedValue(
      new Error('Temporary error')
    );
    await expect(syncExternalPostsWorkflowV1(input)).rejects.toThrow(
      'Temporary error'
    );
    expect(activities.failExternalPostsSync).toHaveBeenCalledWith(
      'org',
      'channel'
    );
    expect(activities.finishExternalPostsSync).not.toHaveBeenCalled();
  });
});
