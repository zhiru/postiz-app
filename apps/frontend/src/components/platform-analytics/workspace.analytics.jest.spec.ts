export {};
jest.mock('canvas', () => null);
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<html><body></body></html>', {
  url: 'http://localhost',
});
Object.assign(global, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
});
Object.defineProperty(global, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
});
(global as any).IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} = require('@testing-library/react');
const { SWRConfig } = require('swr');
const mockModal = jest.fn();
jest.mock('../layout/new-modal', () => ({
  useModals: () => ({ openModal: mockModal }),
}));
jest.mock('../launches/calendar', () => ({ PostPreviewFrame: () => null }));
jest.mock('../layout/user.context', () => ({
  useUser: () => ({ orgId: 'org', profileId: 'profile' }),
}));
jest.mock('../../hooks/use-profile-permissions', () => ({
  useProfilePermissions: () => ({ canWrite: false }),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_: string, fallback: string) => fallback,
}));
jest.mock('@gitroom/react/helpers/safe.image', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../launches/helpers/platform-icon.helper', () => ({
  PlatformIconBadge: () => null,
}));
jest.mock('@gitroom/react/form/button', () => ({
  Button: ({ children, loading, secondary, ...props }: any) =>
    require('react').createElement('button', props, children),
}));
const rows = [
  {
    id: 'p',
    content: 'Alpha',
    publishDate: '2026-10-23T12:00:00Z',
    format: 'story',
    thumbnail: null,
    channelPicture: null,
    channelName: 'Account',
    integrationId: 'i',
    platform: 'instagram',
    metrics: {
      reactions: 0,
      comments: null,
      views: 12,
      reach: null,
      impressions: null,
    },
    engagementRate: { value: null, formula: null, denominator: 'views' },
    updatedAt: null,
    status: 'not_collected',
    source: null,
  },
];
const mockFetch = jest.fn(async (path: string, options: any) => ({
  ok: true,
  json: async () =>
    path.includes('/integrations/list')
      ? { integrations: [{ id: 'i', name: 'Account' }] }
      : {
          total: 1,
          posts: rows,
          topReactions: rows,
          topComments: [],
          summary: {
            metrics: rows[0].metrics,
            coverage: Object.fromEntries(
              Object.entries(rows[0].metrics).map(([k, v]) => [
                k,
                { known: v == null ? 0 : 1, total: 1 },
              ])
            ),
          },
          channels: [{ id: 'i', name: 'Account', posts: 1 }],
          weekdays: [1, 0, 0, 0, 0, 0, 0],
        },
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
const { WorkspaceAnalytics } = require('./workspace.analytics');
afterEach(() => {
  cleanup();
  mockFetch.mockClear();
  mockModal.mockClear();
});
afterAll(() => dom.window.close());
it('shows unknown versus zero, filters before page requests, and never publishes while reading', async () => {
  await act(async () => {
    render(
      React.createElement(
        SWRConfig,
        { value: { provider: () => new Map() } },
        React.createElement(WorkspaceAnalytics)
      )
    );
  });
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  await act(async () => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Format' }), {
      target: { value: 'story' },
    });
  });
  expect(
    mockFetch.mock.calls.some(
      (call: any[]) =>
        String(call[0]).includes('format=story') &&
        String(call[0]).includes('page=0')
    )
  ).toBe(true);
  expect(
    mockFetch.mock.calls.every(
      (call: any[]) => !call[1]?.method || call[1]?.method === 'GET'
    )
  ).toBe(true);
  fireEvent.click(screen.getAllByText('Alpha')[0].closest('button'));
  expect(mockModal).toHaveBeenCalledWith(
    expect.objectContaining({ size: '80vw', height: '80vh', fullScreen: true })
  );
});
