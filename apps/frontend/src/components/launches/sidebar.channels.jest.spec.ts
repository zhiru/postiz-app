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
afterAll(() => dom.window.close());
const React = require('react');
const {
  render,
  screen,
  fireEvent,
  cleanup,
} = require('@testing-library/react');
const mockSetChannels = jest.fn();
let mockSelected: string[] | null = null;
const mockRefresh = jest.fn();
const mockContinue = jest.fn();
jest.doMock(
  '@gitroom/frontend/components/launches/calendar.context',
  () => ({})
);
jest.doMock(
  '@gitroom/frontend/components/launches/add.provider.component',
  () => ({})
);
jest.doMock('@gitroom/react/helpers/safe.image', () => ({}));
jest.doMock('@gitroom/frontend/components/launches/filters', () => ({}));
jest.doMock('@gitroom/helpers/utils/custom.fetch', () => ({}));
jest.doMock('@gitroom/frontend/components/layout/loading', () => ({}));
jest.doMock('../layout/user.context', () => ({}));
jest.doMock('@gitroom/frontend/hooks/use-profile-permissions', () => ({}));
jest.doMock('@gitroom/frontend/components/launches/menu/menu', () => ({}));
jest.doMock('next/navigation', () => ({}));
jest.doMock('@prisma/client', () => ({}));
jest.doMock('@gitroom/react/helpers/image.with.fallback', () => ({}));
jest.doMock('@gitroom/react/toaster/toaster', () => ({}));
jest.doMock('@gitroom/helpers/utils/use.fire.events', () => ({}));
jest.doMock('./calendar', () => ({}));
jest.doMock('react-dnd', () => ({}));
jest.doMock(
  '@gitroom/frontend/components/launches/helpers/dnd.provider',
  () => ({})
);
jest.doMock('./generator/generator', () => ({}));
jest.doMock('@gitroom/react/helpers/variable.context', () => ({}));
jest.doMock('@gitroom/frontend/components/launches/new.post', () => ({}));
jest.doMock(
  '@gitroom/react/translation/get.transation.service.client',
  () => ({})
);
jest.doMock(
  '@gitroom/frontend/components/launches/helpers/use.integration.list',
  () => ({})
);
jest.doMock(
  '@gitroom/frontend/components/launches/helpers/platform-icon.helper',
  () => ({})
);
jest.doMock('react-use-cookie', () => ({}));
jest.doMock('@gitroom/frontend/components/onboarding/onboarding', () => ({}));
jest.doMock('@gitroom/frontend/components/layout/check.payment', () => ({}));
jest.doMock(
  '@gitroom/frontend/components/launches/hubspot.installed',
  () => ({})
);
jest.doMock('@gitroom/frontend/components/layout/new-modal', () => ({}));
jest.doMock('@gitroom/react/form/input', () => ({}));
jest.doMock('@gitroom/react/form/button', () => ({}));

// Render the actual controls; isolate unrelated composer/provider boundaries.
jest.doMock('@gitroom/frontend/components/launches/calendar.context', () => ({
  useCalendar: () => ({
    selectedChannels: mockSelected,
    setSelectedChannels: mockSetChannels,
  }),
}));
jest.doMock('react-dnd', () => ({ useDrag: () => [{}, () => {}, () => {}] }));
jest.doMock('../layout/user.context', () => ({
  useUser: () => ({ totalChannels: 5 }),
}));
jest.doMock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars: any = {}) =>
      fallback.replace('{{name}}', vars.name),
}));
jest.doMock('@gitroom/react/helpers/image.with.fallback', () => ({
  __esModule: true,
  default: ({ fallbackSrc, ...props }: any) =>
    React.createElement('img', props),
}));
jest.doMock(
  '@gitroom/frontend/components/launches/helpers/platform-icon.helper',
  () => ({ PlatformIconBadge: () => null })
);
jest.doMock('@gitroom/frontend/components/launches/menu/menu', () => ({
  Menu: () => React.createElement('button', { type: 'button' }, 'Channel menu'),
}));
const { MenuComponent, AllChannelsFilter } = require('./launches.component');
const props = (refreshNeeded = false) => ({
  integration: {
    id: 'one',
    identifier: 'instagram',
    name: 'Account',
    refreshNeeded,
    picture: '/account.png',
  },
  totalNonDisabledChannels: 1,
  refreshChannel: () => mockRefresh,
  continueIntegration: () => mockContinue,
  mutate: jest.fn(),
  update: jest.fn(),
  collapsed: false,
});
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockSelected = null;
});
it('selects one channel and toggles additional channels with Shift', () => {
  const { rerender } = render(React.createElement(MenuComponent, props()));
  fireEvent.click(screen.getByRole('button', { name: 'Filter by Account' }));
  expect(mockSetChannels).toHaveBeenLastCalledWith(['one']);
  mockSelected = ['two'];
  rerender(React.createElement(MenuComponent, props()));
  fireEvent.click(screen.getByRole('button', { name: 'Filter by Account' }), {
    shiftKey: true,
  });
  expect(mockSetChannels).toHaveBeenLastCalledWith(['two', 'one']);
  mockSelected = ['one'];
  rerender(React.createElement(MenuComponent, props()));
  const button = screen.getByRole('button', { name: 'Filter by Account' });
  expect(button.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(button, { shiftKey: true });
  expect(mockSetChannels).toHaveBeenLastCalledWith(null);
});
it('keeps reconnect and channel menu separate from filtering', () => {
  render(React.createElement(MenuComponent, props(true)));
  fireEvent.click(screen.getByRole('button', { name: 'Channel menu' }));
  expect(mockSetChannels).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect channel' }));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(mockSetChannels).not.toHaveBeenCalled();
  const filter = screen.getByRole('button', { name: 'Filter by Account' });
  expect(filter.querySelector('button')).toBeNull();
  fireEvent.click(filter);
  expect(mockSetChannels).toHaveBeenCalledWith(['one']);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});
it('clears selection with All channels even in the collapsed sidebar', () => {
  mockSelected = ['one'];
  render(React.createElement(AllChannelsFilter, { collapsed: true }));
  const button = screen.getByRole('button', { name: 'All channels' });
  expect(button.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(button);
  expect(mockSetChannels).toHaveBeenCalledWith(null);
});
