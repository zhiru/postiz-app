import { resolveIgRoute } from './instagram-route.resolver';

describe('Instagram route token boundary', () => {
  const integration = {
    token: 'page-token___user-token',
    providerIdentifier: 'instagram',
    organizationId: 'org-1',
    profileId: 'profile-1',
    internalId: 'ig-1',
  };

  it('passes only the page token to Facebook Graph mutations and follow checks', async () => {
    const messaging = { resolveIgUserToken: jest.fn().mockResolvedValue(null) };

    await expect(resolveIgRoute(integration, messaging as any)).resolves.toEqual({
      token: 'page-token', host: 'graph.facebook.com', useIgGraph: false,
      source: 'page-access-token',
    });
    expect(messaging.resolveIgUserToken).toHaveBeenCalledWith('org-1', 'profile-1', 'ig-1');
  });

  it('keeps a plain page token unchanged', async () => {
    const messaging = { resolveIgUserToken: jest.fn().mockResolvedValue(null) };
    const route = await resolveIgRoute({ ...integration, token: 'page-only' }, messaging as any);
    expect(route.token).toBe('page-only');
  });

  it('preserves a configured Instagram user token and host', async () => {
    const messaging = { resolveIgUserToken: jest.fn().mockResolvedValue('configured-ig-token') };
    const route = await resolveIgRoute(integration, messaging as any);
    expect(route).toMatchObject({ token: 'configured-ig-token', host: 'graph.instagram.com' });
  });
});
