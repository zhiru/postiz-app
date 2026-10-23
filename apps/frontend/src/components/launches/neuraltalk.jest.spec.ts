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
const {
  render,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  act,
} = require('@testing-library/react');
const { SWRConfig } = require('swr');
const { useForm, FormProvider } = require('react-hook-form');
const mockFetch = jest.fn();
let mockDefaultConnection: any = { configured: false, connections: [] };
const mockApi = (url: string, options?: any) =>
  url.endsWith('/default-connection') && !options
    ? Promise.resolve({ ok: true, json: async () => mockDefaultConnection })
    : mockFetch(url, options);
const mockDestinations = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockApi,
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, params: any = {}) =>
      fallback.replace(
        /{{(\w+)}}/g,
        (_: string, key: string) => params[key] ?? ''
      ),
}));
jest.mock('@gitroom/react/translation/translated-label', () => ({
  TranslatedLabel: ({ label }: any) => label,
}));
jest.mock('@gitroom/frontend/hooks/use-current-profile.hook', () => ({
  useCurrentProfile: () => ({ profile: { id: 'profile-1' } }),
}));
jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration',
  () => ({ useIntegration: () => ({ integration: { id: 'integration-1' } }) })
);
jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.custom.provider.function',
  () => ({ useCustomProviderFunction: () => ({ get: mockDestinations }) })
);
jest.mock('@gitroom/frontend/components/launches/helpers/use.values', () => ({
  useSettings: () => require('react-hook-form').useFormContext(),
}));
jest.mock('use-debounce', () => ({ useDebounce: (value: string) => [value] }));
const { NeuralTalkAccountModal } = require('./neuraltalk-account-modal');
const {
  NeuralTalkDestinations,
} = require('../new-launch/providers/neuraltalk/neuraltalk.destinations');
const click = async (element: HTMLElement) => {
  await waitFor(() =>
    expect((element as HTMLButtonElement).disabled).not.toBe(true)
  );
  await act(async () => {
    fireEvent.click(element);
  });
};
const success = (data: any) => ({ ok: true, json: async () => data });
const withCache = (component: any) => {
  const cache = new Map();
  render(
    React.createElement(
      SWRConfig,
      {
        value: {
          provider: () => cache,
          dedupingInterval: 0,
          loadingTimeout: 0,
        },
      },
      component
    )
  );
  return cache;
};
afterAll(() => dom.window.close());
afterEach(() => {
  cleanup();
  mockDefaultConnection = { configured: false, connections: [] };
  jest.clearAllMocks();
});

it('discovers accounts and inboxes, supports back, and connects only the chosen inbox without caching credentials', async () => {
  const onComplete = jest.fn();
  mockFetch
    .mockResolvedValueOnce(
      success({
        accounts: [
          { id: 'b2b7ea10-d317-4ea6-a877-5007915ee123', name: 'Abrasel' },
        ],
      })
    )
    .mockResolvedValueOnce(
      success({
        inboxes: [
          {
            id: '8',
            name: 'WhatsApp grupos',
            supportsGroups: true,
            channelType: 'Channel::Whatsapp',
          },
        ],
      })
    )
    .mockResolvedValueOnce(success({ id: 'integration-1' }));
  const cache = withCache(
    React.createElement(NeuralTalkAccountModal, {
      onComplete,
      onCancel: jest.fn(),
    })
  );
  fireEvent.change(screen.getByLabelText('API access token'), {
    target: { value: 'test-secret-token' },
  });
  await click(screen.getByRole('button', { name: 'Continue' }));
  await click(await screen.findByRole('button', { name: 'Abrasel' }));
  await click(await screen.findByRole('button', { name: /WhatsApp grupos/ }));
  await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  expect(mockFetch.mock.calls.map((call: any) => call[0])).toEqual([
    '/integrations/neuraltalk/accounts',
    '/integrations/neuraltalk/inboxes',
    '/integrations/neuraltalk/connect',
  ]);
  expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({
    baseUrl: 'https://chat.neuraltalk.com.br',
    apiToken: 'test-secret-token',
    accountId: 'b2b7ea10-d317-4ea6-a877-5007915ee123',
    inboxId: '8',
  });
  expect(JSON.stringify(Array.from(cache.entries()))).not.toContain(
    'test-secret-token'
  );
});

it('searches accounts with accents, supports back/cancel and does not connect on discovery', async () => {
  const onCancel = jest.fn();
  mockFetch
    .mockResolvedValueOnce(
      success({
        accounts: [
          { id: 'b2b7ea10-d317-4ea6-a877-5007915ee123', name: 'São Paulo' },
          { id: 'account-4', name: 'Abrasel' },
        ],
      })
    )
    .mockResolvedValueOnce(success({ inboxes: [] }));
  withCache(
    React.createElement(NeuralTalkAccountModal, {
      onComplete: jest.fn(),
      onCancel,
    })
  );
  fireEvent.change(screen.getByLabelText('API access token'), {
    target: { value: 'token' },
  });
  await click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('button', { name: 'São Paulo' });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sao' } });
  expect(screen.queryByRole('button', { name: 'Abrasel' })).toBeNull();
  await click(screen.getByRole('button', { name: 'São Paulo' }));
  await screen.findByText(
    'No accessible results found. Check your account permissions or search.'
  );
  await click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('button', { name: 'Abrasel' })).toBeTruthy();
  await click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByLabelText('API access token').getAttribute('type')).toBe(
    'password'
  );
  await click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

it('shows a safe retryable error without reflecting a server token or connecting', async () => {
  mockFetch.mockResolvedValue({
    ok: false,
    json: async () => ({ message: 'secret-server-token' }),
  });
  const onComplete = jest.fn();
  withCache(
    React.createElement(NeuralTalkAccountModal, {
      onComplete,
      onCancel: jest.fn(),
    })
  );
  fireEvent.change(screen.getByLabelText('API access token'), {
    target: { value: 'token' },
  });
  await click(screen.getByRole('button', { name: 'Continue' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(
    /Could not connect/
  );
  expect(document.body.textContent).not.toContain('secret-server-token');
  expect(screen.getByRole('button', { name: 'Continue' }).disabled).toBe(false);
  expect(onComplete).not.toHaveBeenCalled();
});

const DestinationForm = ({ initial = [] }: { initial?: string[] }) => {
  const form = useForm({ defaultValues: { targets: initial } });
  return React.createElement(
    FormProvider,
    form,
    React.createElement(NeuralTalkDestinations),
    React.createElement(
      'output',
      { 'data-testid': 'targets' },
      JSON.stringify(form.watch('targets'))
    )
  );
};
it('keeps recipient selection across searches and pages, and removes an off-page recipient explicitly', async () => {
  mockDestinations.mockImplementation(async (_tool: string, args: any) =>
    args.query
      ? {
          items: [{ id: 'contact:3', name: 'Felipe', kind: 'contact' }],
          page: 1,
          hasMore: false,
        }
      : args.page === 1
      ? {
          items: [{ id: 'group:1', name: 'Abrasel grupo 1', kind: 'group' }],
          page: 1,
          hasMore: true,
        }
      : {
          items: [{ id: 'group:2', name: 'Abrasel grupo 2', kind: 'group' }],
          page: 2,
          hasMore: false,
        }
  );
  withCache(React.createElement(DestinationForm));
  await click(
    await screen.findByRole('checkbox', { name: 'Abrasel grupo 1 · Group' })
  );
  await click(screen.getByRole('button', { name: 'Load more' }));
  await click(
    await screen.findByRole('checkbox', { name: 'Abrasel grupo 2 · Group' })
  );
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'Felipe' },
  });
  await click(
    await screen.findByRole('checkbox', { name: 'Felipe · Contact' })
  );
  expect(JSON.parse(screen.getByTestId('targets').textContent)).toEqual([
    'group:1',
    'group:2',
    'contact:3',
  ]);
  await click(screen.getByRole('button', { name: 'Remove Abrasel grupo 1' }));
  expect(JSON.parse(screen.getByTestId('targets').textContent)).toEqual([
    'group:2',
    'contact:3',
  ]);
  expect(
    mockDestinations.mock.calls.some((call: any) => call[1].page === 2)
  ).toBe(true);
});

it('does not discard saved recipients when lookup fails and limits selection to 50', async () => {
  const initial = Array.from(
    { length: 50 },
    (_, index) => `group:${index + 1}`
  );
  mockDestinations.mockResolvedValue({
    items: [{ id: 'contact:99', name: 'Other contact', kind: 'contact' }],
    page: 1,
    hasMore: false,
  });
  withCache(React.createElement(DestinationForm, { initial }));
  await click(
    await screen.findByRole('checkbox', { name: 'Other contact · Contact' })
  );
  expect(JSON.parse(screen.getByTestId('targets').textContent)).toEqual(
    initial
  );
  expect(screen.getByText('Select up to 50 recipients per post.')).toBeTruthy();
  cleanup();
  mockDestinations.mockResolvedValue({ statusCode: 403 });
  withCache(React.createElement(DestinationForm, { initial: ['group:7'] }));
  expect((await screen.findByRole('alert')).textContent).toMatch(
    /Could not load recipients/
  );
  expect(JSON.parse(screen.getByTestId('targets').textContent)).toEqual([
    'group:7',
  ]);
});

it('resolves names of previously saved recipients outside the first page', async () => {
  mockDestinations.mockImplementation(async (_tool: string, args: any) =>
    args.ids
      ? {
          items: [{ id: 'group:22', name: 'Diretoria Abrasel', kind: 'group' }],
          page: 1,
          hasMore: false,
        }
      : { items: [], page: 1, hasMore: false }
  );
  withCache(React.createElement(DestinationForm, { initial: ['group:22'] }));
  expect(
    await screen.findByRole('button', { name: 'Remove Diretoria Abrasel' })
  ).toBeTruthy();
  expect(JSON.parse(screen.getByTestId('targets').textContent)).toEqual([
    'group:22',
  ]);
  expect(mockDestinations).toHaveBeenCalledWith('destinations', {
    ids: ['group:22'],
  });
});

it('shows unavailable inboxes without allowing connection', async () => {
  mockFetch
    .mockResolvedValueOnce(
      success({ accounts: [{ id: 'account-1', name: 'Abrasel' }] })
    )
    .mockResolvedValueOnce(
      success({
        inboxes: [
          {
            id: '8',
            name: 'Desconectada',
            supportsGroups: false,
            available: false,
            channelType: 'Channel::Whatsapp',
          },
        ],
      })
    );
  withCache(
    React.createElement(NeuralTalkAccountModal, {
      onComplete: jest.fn(),
      onCancel: jest.fn(),
    })
  );
  fireEvent.change(screen.getByLabelText('API access token'), {
    target: { value: 'token' },
  });
  await click(screen.getByRole('button', { name: 'Continue' }));
  await click(await screen.findByRole('button', { name: 'Abrasel' }));
  expect(
    (await screen.findByRole('button', { name: /Desconectada/ })).disabled
  ).toBe(true);
  expect(screen.getByText('Sending is unavailable in this inbox')).toBeTruthy();
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

const {
  RepeatComponent,
  isPostRecurrenceBlocked,
} = require('./repeat.component');
it.each([false, true])(
  'blocks recurring controls in desktop/mobile list=%s without silently clearing saved recurrence',
  async (list) => {
    const onChange = jest.fn();
    render(
      React.createElement(RepeatComponent, {
        repeat: 7,
        onChange,
        list,
        supportsRecurringPosts: false,
        unavailableMessage: 'Abrasel messages only supports one-time delivery.',
      })
    );
    expect(screen.getByRole('status').textContent).toMatch(/one-time delivery/);
    expect(screen.queryByText('Week')).toBeNull();
    expect(screen.queryByText('Repeat Post Every')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(isPostRecurrenceBlocked(7, false)).toBe(true);
    await click(screen.getByRole('button', { name: 'Do Not Repeat' }));
    expect(onChange).toHaveBeenCalledWith(0);
    expect(isPostRecurrenceBlocked(0, false)).toBe(false);
  }
);
it('keeps normal channel recurrence enabled and allows one-time NeuralTalk posts', () => {
  expect(isPostRecurrenceBlocked(undefined, false)).toBe(false);
  expect(isPostRecurrenceBlocked(null, false)).toBe(false);
  expect(isPostRecurrenceBlocked(30, true)).toBe(false);
  const onChange = jest.fn();
  render(
    React.createElement(RepeatComponent, { repeat: 7, onChange, list: true })
  );
  expect(screen.getByText('Week')).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
});

it('reopens with a saved default and connects without requesting or caching its token', async () => {
  mockDefaultConnection = {
    configured: true,
    baseUrl: 'https://chat.neuraltalk.com.br',
    connections: [],
  };
  mockFetch
    .mockResolvedValueOnce(
      success({ accounts: [{ id: 'tenant', name: 'Abrasel' }] })
    )
    .mockResolvedValueOnce(success({ inboxes: [{ id: '8', name: 'Groups' }] }))
    .mockResolvedValueOnce(success({ id: 'channel' }));
  const complete = jest.fn();
  withCache(
    React.createElement(NeuralTalkAccountModal, {
      onComplete: complete,
      onCancel: jest.fn(),
    })
  );
  await screen.findByText('Saved default connection');
  expect(screen.queryByLabelText('API access token')).toBeNull();
  await click(screen.getByRole('button', { name: 'Continue' }));
  await click(await screen.findByRole('button', { name: 'Abrasel' }));
  await click(await screen.findByRole('button', { name: 'Groups' }));
  expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({
    useSavedConnection: true,
    accountId: 'tenant',
    inboxId: '8',
  });
  expect(complete).toHaveBeenCalledTimes(1);
});

it('reuses an existing channel and saves its default without requiring the token again', async () => {
  mockDefaultConnection = { configured: false, connections: [{ id: 'existing', name: 'Existing inbox' }] };
  mockFetch.mockResolvedValueOnce(success({ accounts: [{ id: 'tenant', name: 'Abrasel' }] }));
  withCache(React.createElement(NeuralTalkAccountModal, { onComplete: jest.fn(), onCancel: jest.fn() }));
  await screen.findByText('Existing inbox');
  expect(screen.queryByLabelText('API access token')).toBeNull();
  await click(screen.getByRole('button', { name: 'Continue' }));
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ savedIntegrationId: 'existing', saveAsDefault: true });
});
it('removes only the saved default and offers a replacement token', async () => {
  mockDefaultConnection = { configured: true, connections: [] };
  mockFetch.mockResolvedValueOnce(success({ configured: false }));
  withCache(React.createElement(NeuralTalkAccountModal, { onComplete: jest.fn(), onCancel: jest.fn() }));
  await click(await screen.findByRole('button', { name: 'Remove saved default' }));
  expect(mockFetch.mock.calls[0]).toEqual(['/integrations/neuraltalk/default-connection', { method: 'DELETE' }]);
  expect(screen.getByLabelText('API access token')).toBeDefined();
});
