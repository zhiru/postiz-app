export {};
jest.mock('canvas', () => null);
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/integrations/social/instagram?code=test&state=test' });
Object.assign(global, { window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver });
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
(global as any).IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { render, cleanup, fireEvent, screen, act } = require('@testing-library/react');
const mockFetch = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => React.createElement('a', props, children) }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({ useT: () => (_key: string, fallback: string) => fallback }), { virtual: true });
jest.mock('@gitroom/react/helpers/variable.context', () => ({ useVariables: () => ({}) }), { virtual: true });
jest.mock('@gitroom/react/form/button', () => ({ Button: ({ children, loading, secondary, ...props }: any) => React.createElement('button', props, children) }), { virtual: true });
jest.mock('@gitroom/frontend/components/launches/helpers/use.custom.provider.function', () => ({ useCustomProviderFunction: () => ({ get: jest.fn() }) }));
jest.mock('@gitroom/frontend/components/layout/set.timezone', () => ({ newDayjs: () => ({ utcOffset: () => 0 }) }));
jest.mock('@gitroom/frontend/components/launches/helpers/use.integration', () => ({ IntegrationContext: React.createContext({}) }));
jest.mock('@gitroom/frontend/components/new-launch/providers/continue-provider/list', () => ({ continueProviderList: { instagram: require('../new-launch/providers/continue-provider/instagram/instagram.continue').InstagramContinue } }));
const { InstagramContinue } = require('../new-launch/providers/continue-provider/instagram/instagram.continue');
const { ContinueIntegration } = require('./continue.integration');
const accounts = [
  { id: 'ig-1', pageId: 'page-1', name: 'Grupo Mali', username: 'grupomalioficial', picture: { data: { url: 'a.jpg' } } },
  { id: 'ig-2', pageId: 'page-2', name: 'Revolução para sua pele', username: 'revitalize', picture: { data: { url: 'b.jpg' } } },
];
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
afterEach(() => { cleanup(); jest.clearAllMocks(); mockFetch.mockReset(); });
it('searches names, accents and @usernames, keeps selection and saves the original identity', async () => {
  const onSave = jest.fn(); const onCancel = jest.fn();
  render(React.createElement(InstagramContinue, { initialData: accounts, existingId: [], onSave, onCancel }));
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: '@grupomalioficial' } });
  expect(screen.queryByText('Revolução para sua pele')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Grupo Mali/ }));
  fireEvent.change(search, { target: { value: 'revolucao' } });
  expect(screen.getByText('Revolução para sua pele')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await flush();
  expect(onSave).toHaveBeenCalledWith({ id: 'ig-1', pageId: 'page-1' });
  fireEvent.change(search, { target: { value: 'missing-account' } });
  expect(screen.getByRole('status').textContent).toMatch(/No accounts found/);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
it('excludes existing accounts and prevents changing or saving during a save', () => {
  render(React.createElement(InstagramContinue, { initialData: accounts, existingId: ['ig-2'], onSave: jest.fn(), isSaving: true }));
  expect(screen.queryByText('Revolução para sua pele')).toBeNull();
  expect(screen.getByRole('button', { name: /Grupo Mali/ }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
});
it('does not replay OAuth under StrictMode and catches a failed request', async () => {
  mockFetch.mockRejectedValue(new Error('network'));
  render(React.createElement(React.StrictMode, null, React.createElement(ContinueIntegration, { provider: 'instagram', searchParams: { code: 'test', state: 'test' }, logged: true })));
  await flush();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Could not add provider')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Back to calendar' }).getAttribute('href')).toBe('/launches');
});
it('shows a restart path when step 2 was reloaded without replaying the consumed code', async () => {
  render(React.createElement(ContinueIntegration, { provider: 'instagram', searchParams: { step: '2' }, logged: true }));
  await flush();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(screen.getByText(/This connection expired/)).toBeTruthy();
});
it('keeps selection save failures visible and allows leaving the connection', async () => {
  mockFetch.mockResolvedValueOnce({ status: 200, json: async () => ({ inBetweenSteps: true, id: 'pending', pages: accounts }) });
  render(React.createElement(ContinueIntegration, { provider: 'instagram', searchParams: { code: 'test', state: 'test' }, logged: true }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: /Grupo Mali/ }));
  mockFetch.mockRejectedValueOnce(new Error('network'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await flush();
  expect(screen.getByText(/We could not confirm/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Back to calendar' })).toBeTruthy();
});

it('does not navigate when an OAuth response completes after leaving the screen', async () => {
  let resolve: (value: any) => void;
  mockFetch.mockReturnValue(new Promise((res) => { resolve = res; }));
  const view = render(React.createElement(ContinueIntegration, { provider: 'instagram', searchParams: { code: 'test', state: 'test' }, logged: true }));
  view.unmount();
  await act(async () => { resolve!({ status: 200, json: async () => ({ id: 'done' }) }); });
  expect(mockPush).not.toHaveBeenCalled();
});
it('returns public visitors to their known return destination on cancel', async () => {
  mockFetch.mockResolvedValueOnce({ status: 200, json: async () => ({ inBetweenSteps: true, id: 'pending', pages: accounts, returnURL: 'https://example.com/return' }) });
  render(React.createElement(ContinueIntegration, { provider: 'instagram', searchParams: { code: 'test', state: 'test' }, logged: false }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockPush).toHaveBeenCalledWith('https://example.com/return');
});

it('replaces an endless loading screen with an exit after a timeout, without retrying OAuth', async () => {
  jest.useFakeTimers();
  try {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(React.createElement(ContinueIntegration, { provider: 'instagram', searchParams: { code: 'test', state: 'test' }, logged: true }));
    await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByText('Could not add provider')).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});
