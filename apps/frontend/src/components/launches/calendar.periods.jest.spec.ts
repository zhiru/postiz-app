export {};
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
dom.window.matchMedia = () => ({ matches: false });
const React = require('react');
const {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} = require('@testing-library/react');
const { SWRConfig } = require('swr');
const mockFetch = jest.fn(async () => ({
  json: async () => ({ posts: [], total: 0 }),
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
let mockDisplay = 'list';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`display=${mockDisplay}`),
}));
const { CalendarWeekProvider, useCalendar } = require('./calendar.context');
const {
  setUserTimezone,
} = require('@gitroom/frontend/components/layout/set.timezone');
afterEach(() => {
  cleanup();
  mockDisplay = 'list';
  jest.useRealTimers();
  setUserTimezone(null);
});
afterAll(() => dom.window.close());
it('refreshes relative server date boundaries after local midnight without touching other filters', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-24T02:59:30Z'));
  setUserTimezone('America/Sao_Paulo');
  function Consumer() {
    const c = useCalendar();
    return React.createElement(
      'button',
      {
        onClick: () => {
          c.setListRange('today');
          c.setPostSearch('Summit');
          c.setSelectedChannels(['channel-1']);
        },
      },
      'Today'
    );
  }
  render(
    React.createElement(
      SWRConfig,
      { value: { provider: () => new Map() } },
      React.createElement(
        CalendarWeekProvider,
        { integrations: [] },
        React.createElement(Consumer)
      )
    )
  );
  await act(async () => {
    fireEvent.click(screen.getByText('Today'));
  });
  const urls = () =>
    mockFetch.mock.calls
      .map((call: any[]) => String(call[0]))
      .filter((url: string) => url.startsWith('/posts/list?'))
      .map((url: string) => new URL(url, 'http://localhost'));
  expect(
    urls().some(
      (url: URL) =>
        url.searchParams.get('startDate') === '2026-10-23T03:00:00.000Z'
    )
  ).toBe(true);
  await act(async () => {
    jest.advanceTimersByTime(31000);
  });
  const next = urls().find(
    (url: URL) =>
      url.searchParams.get('startDate') === '2026-10-24T03:00:00.000Z'
  );
  expect(next).toBeDefined();
  expect(next.searchParams.get('search')).toBe('Summit');
  expect(next.searchParams.get('integrations')).toBe('channel-1');
});

it('opens the optional list alongside the calendar only on demand and returns from a day list to its original month', async () => {
  mockDisplay = 'month';
  mockFetch.mockClear();
  function Consumer() {
    const c = useCalendar();
    return React.createElement(
      'div',
      {},
      React.createElement('output', {}, `${c.display}:${c.startDate}`),
      React.createElement(
        'button',
        {
          onClick: () =>
            c.setFilters({
              startDate: '2026-09-01',
              endDate: '2026-09-30',
              display: 'month',
              customer: null,
            }),
        },
        'Month'
      ),
      React.createElement(
        'button',
        { onClick: () => c.setPostsPanelOpen(true) },
        'Panel'
      ),
      React.createElement(
        'button',
        {
          onClick: () => {
            c.setListRange('day:2026-09-12');
            c.setFilters({
              startDate: '2026-09-12',
              endDate: '2026-09-12',
              display: 'list',
              customer: null,
            });
          },
        },
        'Day list'
      ),
      React.createElement('button', { onClick: c.returnToCalendar }, 'Back')
    );
  }
  render(
    React.createElement(
      SWRConfig,
      { value: { provider: () => new Map() } },
      React.createElement(
        CalendarWeekProvider,
        { integrations: [] },
        React.createElement(Consumer)
      )
    )
  );
  await act(async () => {
    fireEvent.click(screen.getByText('Month'));
  });
  mockFetch.mockClear();
  await act(async () => {
    fireEvent.click(screen.getByText('Panel'));
  });
  expect(
    mockFetch.mock.calls.some((c: any[]) =>
      String(c[0]).startsWith('/posts/list?')
    )
  ).toBe(true);
  await act(async () => {
    fireEvent.click(screen.getByText('Day list'));
  });
  expect(screen.getByText('list:2026-09-12')).toBeDefined();
  await act(async () => {
    fireEvent.click(screen.getByText('Back'));
  });
  expect(screen.getByText('month:2026-09-01')).toBeDefined();
});
