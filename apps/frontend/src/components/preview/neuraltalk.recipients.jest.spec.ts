export {};
jest.mock('canvas', () => null);
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<html><body></body></html>', {
  url: 'http://localhost',
});
Object.assign(global, {
  window: dom.window,
  document: dom.window.document,
  MutationObserver: dom.window.MutationObserver,
});
Object.defineProperty(global, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
});
(global as any).IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { render, screen, waitFor, cleanup } = require('@testing-library/react');
const { SWRConfig } = require('swr');
const mockFetch = jest.fn();
let mockUser: any;
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => mockUser,
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_: string, fallback: string, values: any = {}) =>
      fallback.replace(
        /{{(\w+)}}/g,
        (_: string, key: string) => values[key] || ''
      ),
}));
const { NeuralTalkRecipients } = require('./neuraltalk.recipients');
const mount = (providerIdentifier = 'neuraltalk') =>
  render(
    React.createElement(
      SWRConfig,
      {
        value: {
          provider: () => new Map(),
          dedupingInterval: 0,
          shouldRetryOnError: false,
        },
      },
      React.createElement(NeuralTalkRecipients, {
        postId: 'post',
        providerIdentifier,
      })
    )
  );
beforeEach(() => {
  mockUser = { id: 'user', orgId: 'org', profileId: 'profile' };
  mockFetch.mockReset();
});
afterEach(cleanup);
it('does not fetch or render recipients for unauthenticated visitors or other providers', () => {
  mockUser = {};
  const guest = mount();
  expect(guest.container.textContent).toBe('');
  guest.unmount();
  mockUser = { id: 'user' };
  const other = mount('instagram');
  expect(other.container.textContent).toBe('');
  expect(mockFetch).not.toHaveBeenCalled();
});
it('renders configured, registered and provider-confirmed recipients distinctly', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      recipients: [
        { target: 'contact:1', status: 'configured' },
        { target: 'group:2', status: 'confirmed' },
        { target: 'contact:3', status: 'accepted' },
      ],
    }),
  });
  mount();
  await screen.findByText('Group #2');
  expect(
    screen.getByText('Configured destination — delivery not confirmed', {
      exact: false,
    })
  ).toBeTruthy();
  expect(
    screen.getByText(
      'Message registered in NeuralTalk — device delivery not confirmed',
      { exact: false }
    )
  ).toBeTruthy();
  expect(
    screen.getByText(
      'Send confirmed by provider — device delivery not confirmed',
      { exact: false }
    )
  ).toBeTruthy();
  expect(mockFetch).toHaveBeenCalledWith('/posts/post/neuraltalk-recipients');
});
it('shows an empty state for historical posts without saved targets', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ recipients: [] }),
  });
  mount();
  await screen.findByText('No saved destinations for this post.');
});
it('shows loading and a safe error when the private request fails', async () => {
  let finish: (value: any) => void;
  mockFetch.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  mount();
  expect(screen.getByText('Loading recipients…')).toBeTruthy();
  finish!({ ok: false });
  await waitFor(() =>
    expect(screen.getByText('Recipients could not be loaded.')).toBeTruthy()
  );
  expect(screen.queryByText('Delivery confirmed')).toBeNull();
});

it('resolves contact and group names through the existing authorized selector with an ID fallback', async () => {
  mockFetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url === '/integrations/function'
        ? {
            items: [
              { id: 'contact:1', name: 'Ana' },
              { id: 'group:2', name: 'Equipe' },
              { id: 'contact:3', name: '  ' },
            ],
          }
        : {
            integrationId: 'channel',
            recipients: [
              { target: 'contact:1', status: 'configured' },
              { target: 'group:2', status: 'confirmed' },
              { target: 'contact:3', status: 'unknown' },
            ],
          },
  }));
  mount();
  await screen.findByText('Ana');
  expect(screen.getByText('Equipe')).toBeTruthy();
  expect(screen.getByText('Contact #3')).toBeTruthy();
  expect(mockFetch).toHaveBeenCalledWith('/integrations/function', {
    method: 'POST',
    body: JSON.stringify({
      id: 'channel',
      name: 'destinations',
      data: { ids: ['contact:1', 'group:2', 'contact:3'] },
    }),
  });
});
it.each([false, true])(
  'keeps saved IDs and receipt status when name lookup fails (HTTP ok: %s)',
  async (ok) => {
    mockFetch.mockImplementation(async (url: string) =>
      url === '/integrations/function'
        ? { ok, json: async () => false }
        : {
            ok: true,
            json: async () => ({
              integrationId: 'channel',
              recipients: [{ target: 'group:2', status: 'accepted' }],
            }),
          }
    );
    mount();
    await screen.findByText('Group #2');
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(
      screen.getByText(
        'Message registered in NeuralTalk — device delivery not confirmed',
        { exact: false }
      )
    ).toBeTruthy();
    expect(screen.queryByText('Recipients could not be loaded.')).toBeNull();
  }
);
