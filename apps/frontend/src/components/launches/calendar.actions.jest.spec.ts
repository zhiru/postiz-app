export {};
jest.mock('canvas', () => null);
jest.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: jest.fn(),
}));
jest.mock('i18next', () => ({
  __esModule: true,
  default: {
    on: jest.fn(),
    resolvedLanguage: 'en',
    language: 'en',
    t: (_: string, opts: any) => opts?.defaultValue || _,
  },
}));
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<html><body></body></html>', {
  url: 'http://localhost',
});
Object.assign(global, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
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
  screen,
  fireEvent,
  act,
  cleanup,
} = require('@testing-library/react');
const dayjs = require('dayjs');
const mockModal = jest.fn();
const mockClipboard = jest.fn().mockResolvedValue(undefined);
let mockCanWrite = true;
Object.defineProperty(global.navigator, 'clipboard', {
  value: { writeText: mockClipboard },
  configurable: true,
});
jest.mock('react-dnd', () => ({
  useDrag: () => [{ opacity: 1 }, () => {}],
  useDrop: () => [{}, () => {}],
}));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: mockModal }),
}));
jest.mock('@gitroom/frontend/hooks/use-profile-permissions', () => ({
  useProfilePermissions: () => ({ canWrite: mockCanWrite }),
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => ({}),
}));
jest.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({}),
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => jest.fn(),
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: jest.fn() }),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_: string, fallback: string) => fallback,
}));
jest.mock(
  '@gitroom/frontend/components/launches/add.provider.component',
  () => ({ useAddProvider: () => ({}) })
);
jest.mock('@gitroom/frontend/components/launches/statistics', () => ({
  StatisticsModal: () => null,
}));
jest.mock(
  '@gitroom/frontend/components/launches/missing-release.modal',
  () => ({ MissingReleaseModal: () => null })
);
jest.mock('@gitroom/frontend/components/new-launch/add.edit.modal', () => ({
  AddEditModal: () => null,
}));
jest.mock('@gitroom/frontend/components/launches/review-links.modal', () => ({
  ReviewLinksModal: () => null,
}));
jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.existing.data',
  () => ({ ExistingDataContextProvider: ({ children }: any) => children })
);
jest.mock('@gitroom/helpers/utils/sanitize.post.content', () => ({
  postContentPlainText: (v: string) => v,
}));
const { CalendarItem, PostPreviewFrame } = require('./calendar');
const props = () => ({
  date: dayjs(),
  isBeforeNow: false,
  editPost: jest.fn(),
  duplicatePost: jest.fn(),
  deletePost: jest.fn(),
  statistics: jest.fn(),
  openPost: jest.fn(),
  integrations: [],
  state: 'DRAFT',
  display: 'month',
  post: {
    id: 'post',
    publishDate: '2030-01-01T12:00:00Z',
    state: 'DRAFT',
    content: 'Draft caption',
    tags: [],
    integration: { name: 'Test account', providerIdentifier: 'instagram' },
  },
});
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockCanWrite = true;
});
afterAll(() => dom.window.close());
it('opens drafts for editing through click and keyboard, with one actions button', () => {
  const value = props();
  render(React.createElement(CalendarItem, value));
  const body = screen.getByRole('button', { name: 'Edit post' });
  fireEvent.click(body);
  fireEvent.keyDown(body, { key: 'Enter' });
  expect(value.editPost).toHaveBeenCalledTimes(2);
  expect(mockModal).not.toHaveBeenCalled();
  expect(screen.getAllByRole('button', { name: 'Post actions' })).toHaveLength(
    1
  );
});
it('opens an anchored portal menu, executes the chosen action and closes without a modal', () => {
  const value = props();
  render(React.createElement(CalendarItem, value));
  fireEvent.click(screen.getByRole('button', { name: 'Post actions' }));
  expect(screen.getByRole('menu').parentElement).toBe(document.body);
  expect(mockModal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate post' }));
  expect(value.duplicatePost).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).toBeNull();
});
it('supports menu keyboard navigation, Escape and outside clicks', () => {
  render(React.createElement(CalendarItem, props()));
  const button = screen.getByRole('button', { name: 'Post actions' });
  fireEvent.click(button);
  const edit = screen.getByRole('menuitem', { name: 'Edit post' });
  expect(document.activeElement).toBe(edit);
  fireEvent.keyDown(edit, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(
    screen.getByRole('menuitem', { name: 'Change date and time' })
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Edit post' }), {
    key: 'Tab',
  });
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(button);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
});
it('opens published posts in a centered 80vw by 80vh preview', () => {
  const value: any = props();
  value.state = 'PUBLISHED';
  value.post.releaseId = '123';
  render(React.createElement(CalendarItem, value));
  fireEvent.click(screen.getByRole('button', { name: 'Preview post' }));
  expect(value.editPost).not.toHaveBeenCalled();
  expect(mockModal.mock.calls[0][0].fullScreen).toBe(true);
  expect(mockModal.mock.calls[0][0]).toMatchObject({
    size: '80vw',
    height: '80vh',
  });
  expect(mockModal.mock.calls[0][0].children.type).toBe(PostPreviewFrame);
});

it('shows loading, timeout and retry instead of an empty preview', () => {
  jest.useFakeTimers();
  render(
    React.createElement(PostPreviewFrame, { postId: 'post', share: false })
  );
  expect(screen.getByRole('status').textContent).toContain('Loading');
  act(() => jest.advanceTimersByTime(20000));
  expect(screen.getByRole('alert').textContent).toContain('preview');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTitle('Preview post').getAttribute('src')).toBe('/p/post');
  jest.useRealTimers();
});
it('uses media previews and compact month cards without losing the actions menu', () => {
  const value: any = props();
  value.post.mediaPreview = { src: '/cover.png', video: true };
  render(React.createElement(CalendarItem, value));
  expect(
    document
      .querySelector('[data-calendar-media="month"] img')
      ?.getAttribute('src')
  ).toBe('/cover.png');
  expect(document.querySelector('[data-calendar-card="month"]')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Post actions' })).not.toBeNull();
});

it('reads PostQueen media previews from JSON and arrays, safely ignoring malformed data', () => {
  const {
    firstCalendarMedia,
  } = require('@gitroom/helpers/utils/posts.list.minify');
  expect(firstCalendarMedia('invalid')).toBeNull();
  expect(firstCalendarMedia('null')).toBeNull();
  expect(firstCalendarMedia([])).toBeNull();
  expect(
    firstCalendarMedia('[{"path":"/first.png"},{"path":"/second.png"}]')
  ).toEqual({ src: '/first.png', video: false });
  expect(
    firstCalendarMedia([{ path: '/clip.MOV?x=1', thumbnail: '/cover.png' }])
  ).toEqual({ src: '/cover.png', video: true });
});

it('converts list presets using the selected timezone and calendar boundaries', () => {
  const { listRangeDates } = require('./calendar.context');
  const {
    newDayjs,
    setUserTimezone,
  } = require('@gitroom/frontend/components/layout/set.timezone');
  setUserTimezone('America/Sao_Paulo');
  const today = newDayjs('2026-10-23T12:00:00');
  expect(listRangeDates('all', today)).toEqual({});
  expect(listRangeDates('today', today)).toEqual({
    startDate: '2026-10-23T03:00:00.000Z',
    endDate: '2026-10-24T02:59:59.999Z',
  });
  expect(listRangeDates('next7', today).endDate).toBe(
    '2026-10-30T02:59:59.999Z'
  );
  expect(listRangeDates('day:2026-10-25', today)).toEqual({
    startDate: '2026-10-25T03:00:00.000Z',
    endDate: '2026-10-26T02:59:59.999Z',
  });
  expect(listRangeDates('week', today).startDate).toBe(
    '2026-10-19T03:00:00.000Z'
  );
  expect(listRangeDates('month', today).endDate).toBe(
    '2026-11-01T02:59:59.999Z'
  );
  expect(listRangeDates('today', today.add(1, 'day')).startDate).toBe(
    '2026-10-24T03:00:00.000Z'
  );
  setUserTimezone('America/New_York');
  expect(listRangeDates('day:2026-11-01', newDayjs('2026-11-01'))).toEqual({
    startDate: '2026-11-01T04:00:00.000Z',
    endDate: '2026-11-02T04:59:59.999Z',
  });
  setUserTimezone(null);
});
it('requires real preview content and supports recovery after an iframe error', () => {
  render(
    React.createElement(PostPreviewFrame, { postId: 'post', share: true })
  );
  const frame = screen.getByTitle('Preview post');
  Object.defineProperty(frame, 'contentWindow', {
    value: { location: { href: 'http://localhost/p/post' } },
  });
  fireEvent.load(frame);
  expect(screen.getByRole('alert')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  const retryFrame = screen.getByTitle('Preview post');
  Object.defineProperty(retryFrame, 'contentWindow', {
    value: { location: { href: 'http://localhost/p/post' } },
  });
  Object.defineProperty(retryFrame, 'contentDocument', {
    value: { querySelector: () => ({}) },
  });
  fireEvent.load(retryFrame);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('never paints an overdue queued post as published', () => {
  const value: any = props();
  value.state = value.post.state = 'QUEUE';
  value.post.publishDate = '2020-01-01T12:00:00Z';
  value.isBeforeNow = true;
  render(React.createElement(CalendarItem, value));
  expect(screen.queryByText('✓')).toBeNull();
  expect(screen.getByRole('button', { name: 'Edit post' })).not.toBeNull();
});

it('opens the selected month day in the server-filtered list without creating a post', () => {
  const { CalendarColumn } = require('./calendar');
  const { CalendarContext, useCalendar } = require('./calendar.context');
  const {
    newDayjs,
  } = require('@gitroom/frontend/components/layout/set.timezone');
  const setFilters = jest.fn();
  const setListRange = jest.fn();
  function Wrapper() {
    const base = useCalendar();
    return React.createElement(
      CalendarContext.Provider,
      {
        value: {
          ...base,
          display: 'month',
          loading: false,
          customer: 'customer-1',
          setFilters,
          setListRange,
        },
      },
      React.createElement(CalendarColumn, { getDate: newDayjs('2026-10-23') })
    );
  }
  render(React.createElement(Wrapper));
  fireEvent.click(screen.getByRole('button', { name: /View posts for day/ }));
  expect(setListRange).toHaveBeenCalledWith('day:2026-10-23');
  expect(setFilters).toHaveBeenCalledWith({
    startDate: '2026-10-23',
    endDate: '2026-10-23',
    display: 'list',
    customer: 'customer-1',
  });
  expect(mockModal).not.toHaveBeenCalled();
});

it('copies captions and post links without changing the publication', async () => {
  const value = props();
  value.post.content = 'Paragraph one\n\n📅 Date\n📍 Place';
  render(React.createElement(CalendarItem, value));
  fireEvent.click(screen.getByRole('button', { name: 'Post actions' }));
  await act(async () =>
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy caption' }))
  );
  expect(mockClipboard).toHaveBeenLastCalledWith(value.post.content);
  fireEvent.click(screen.getByRole('button', { name: 'Post actions' }));
  await act(async () =>
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy post link' }))
  );
  expect(mockClipboard).toHaveBeenLastCalledWith('http://localhost/p/post');
  expect(value.editPost).not.toHaveBeenCalled();
  expect(value.deletePost).not.toHaveBeenCalled();
});
it('opens the existing editor to change the date without scheduling automatically', () => {
  const value = props();
  render(React.createElement(CalendarItem, value));
  fireEvent.click(screen.getByRole('button', { name: 'Post actions' }));
  fireEvent.click(
    screen.getByRole('menuitem', { name: 'Change date and time' })
  );
  expect(value.editPost).toHaveBeenCalledTimes(1);
  expect(value.deletePost).not.toHaveBeenCalled();
});
it.each(['post', 'carousel', 'video', 'story'])(
  'shows separate local/remote removal for supported published %s, without editing or deleting',
  (format: string) => {
    const value: any = props();
    value.state = value.post.state = 'PUBLISHED';
    Object.assign(value.post, {
      releaseId: '123',
      releaseURL: 'https://www.instagram.com/p/example/',
      remoteDeletionSupported: true,
      format,
    });
    render(React.createElement(CalendarItem, value));
    fireEvent.click(screen.getByRole('button', { name: 'Post actions' }));
    expect(
      screen.getByRole('menuitem', { name: 'Delete from network' })
    ).not.toBeNull();
    expect(
      screen.getByRole('menuitem', { name: 'Remove from Mali Posts' })
    ).not.toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Edit post' })).toBeNull();
    expect(
      screen.queryByRole('menuitem', { name: 'Change date and time' })
    ).toBeNull();
    expect(
      screen.getByRole('menuitem', { name: 'Copy network link' })
    ).not.toBeNull();
    expect(value.deletePost).not.toHaveBeenCalled();
  }
);
it.each(['unsupported', 'already_deleted', 'viewer'])(
  'does not offer remote deletion for %s',
  (kind: string) => {
    const value: any = props();
    value.state = value.post.state = 'PUBLISHED';
    Object.assign(value.post, {
      releaseId: '123',
      remoteDeletionSupported: kind !== 'unsupported',
      remoteDeleted: kind === 'already_deleted',
    });
    mockCanWrite = kind !== 'viewer';
    render(React.createElement(CalendarItem, value));
    fireEvent.click(screen.getByRole('button', { name: 'Post actions' }));
    expect(
      screen.queryByRole('menuitem', { name: 'Delete from network' })
    ).toBeNull();
  }
);
