export {};
jest.mock('canvas', () => null);
// Keyboard events are covered separately; keep the real modal/store in integration tests.
jest.mock('react-hotkeys-hook', () => ({ useHotkeys: jest.fn() }));
jest.mock(
  '@gitroom/nestjs-libraries/services/make.is',
  () => ({ makeId: () => 'modal-id' }),
  { virtual: true }
);
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
  renderHook,
  screen,
  fireEvent,
  act,
  cleanup,
} = require('@testing-library/react');
const dayjs = require('dayjs');
const mockModal = jest.fn();
const mockCloseById = jest.fn();
const mockClipboard = jest.fn().mockResolvedValue(undefined);
let mockCanWrite = true;
let mockRealModals = false;
const mockFetch = jest.fn();
const mockReload = jest.fn();
const mockToast = jest.fn();
const mockIntegrations = [
  { id: 'source', name: 'Source' },
  { id: 'target', name: 'Target' },
];
Object.defineProperty(global.navigator, 'clipboard', {
  value: { writeText: mockClipboard },
  configurable: true,
});
jest.mock('react-dnd', () => ({
  useDrag: () => [{ opacity: 1 }, () => {}],
  useDrop: () => [{}, () => {}],
}));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => {
    const actual = jest
      .requireActual('@gitroom/frontend/components/layout/new-modal')
      .useModals();
    return mockRealModals
      ? actual
      : { openModal: mockModal, closeById: mockCloseById };
  },
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
  useFetch: () => mockFetch,
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToast }),
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
const {
  CalendarItem,
  PostPreviewFrame,
  usePostActions,
} = require('./calendar');
const props = () => ({
  date: dayjs(),
  isBeforeNow: false,
  editPost: jest.fn(),
  duplicatePost: jest.fn(),
  copyToChannel: jest.fn(),
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
  mockRealModals = false;
});
afterAll(() => dom.window.close());
it.each(['day', 'week', 'month'])(
  'shows the explicit trial badge in the %s card, including imported posts',
  (display: string) => {
    const value: any = props();
    value.display = display;
    Object.assign(value.post, {
      isTrialReel: true,
      format: 'video',
      importedFromPlatform: true,
    });
    render(React.createElement(CalendarItem, value));
    const badge = screen.getByText('Trial Reel');
    expect(badge.closest('.sr-only')).toBeNull();
  }
);
it.each([false, undefined, 'false', 'true'])(
  'does not show a trial badge without a boolean projection: %s',
  (isTrialReel: unknown) => {
    const value: any = props();
    Object.assign(value.post, {
      isTrialReel,
      format: 'video',
      importedFromPlatform: true,
      releaseURL: 'https://www.instagram.com/reel/example/',
    });
    render(React.createElement(CalendarItem, value));
    expect(screen.queryByText('Trial Reel')).toBeNull();
  }
);
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
it.each(['day', 'week', 'month'])(
  'keeps imported video actions open in %s when moving focus would scroll the page',
  async (display: string) => {
    const value: any = props();
    value.display = display;
    value.state = value.post.state = 'PUBLISHED';
    Object.assign(value.post, {
      importedFromPlatform: true,
      releaseId: 'imported-video',
      releaseURL: 'https://www.instagram.com/reel/example/',
      format: 'video',
      content: 'Video Abrasel',
      mediaPreview: { src: '/abrasel.mp4', video: true },
    });
    // JSDOM does not scroll on focus. Model the browser's queued scroll event
    // when focus moves from a scrolled list into a portal on document.body.
    const originalFocus = dom.window.HTMLElement.prototype.focus;
    const focus = jest
      .spyOn(dom.window.HTMLElement.prototype, 'focus')
      .mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
        originalFocus.call(this, options);
        if (!options?.preventScroll) {
          queueMicrotask(() => fireEvent.scroll(document));
        }
      });
    try {
      render(React.createElement(CalendarItem, value));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Post actions' }));
      });
      expect(screen.getByRole('menu').parentElement).toBe(document.body);
      const items = screen.getAllByRole('menuitem');
      expect(items[0]).toBe(
        screen.getByRole('menuitem', { name: 'Edit on original platform' })
      );
      expect(document.activeElement).toBe(items[0]);
      for (const name of [
        'Duplicate post',
        'Copy to another network',
        'Preview post',
        'Copy caption',
      ]) {
        await act(async () => {
          fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
        });
        expect(document.activeElement).toBe(
          screen.getByRole('menuitem', { name })
        );
      }
      await act(async () => {
        fireEvent.keyDown(document.activeElement!, { key: 'Home' });
      });
      expect(document.activeElement).toBe(items[0]);
      await act(async () => {
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
      });
      expect(document.activeElement).toBe(items[items.length - 1]);
      expect(screen.queryByRole('menuitem', { name: 'Edit post' })).toBeNull();
      expect(
        screen.queryByRole('menuitem', { name: 'Change date and time' })
      ).toBeNull();
      expect(
        screen.getByRole('menuitem', { name: 'Remove from Mali Posts' })
      ).not.toBeNull();
      expect(mockModal).not.toHaveBeenCalled();
      expect(value.editPost).not.toHaveBeenCalled();
      expect(value.deletePost).not.toHaveBeenCalled();
      // Manual scrolling of the list still dismisses the anchored menu.
      fireEvent.scroll(document);
      expect(screen.queryByRole('menu')).toBeNull();
    } finally {
      focus.mockRestore();
    }
  }
);
it('keeps imported video viewer actions read-only and copies the original link', async () => {
  mockCanWrite = false;
  const value: any = props();
  value.display = 'day';
  value.state = value.post.state = 'PUBLISHED';
  Object.assign(value.post, {
    importedFromPlatform: true,
    releaseId: 'imported-video',
    releaseURL: 'https://www.instagram.com/reel/example/',
    remoteDeletionSupported: true,
  });
  render(React.createElement(CalendarItem, value));
  fireEvent.click(screen.getByRole('button', { name: 'Post actions' }));
  for (const name of [
    'Edit post',
    'Change date and time',
    'Duplicate post',
    'Client review links',
    'Delete from network',
    'Remove from Mali Posts',
  ]) {
    expect(screen.queryByRole('menuitem', { name })).toBeNull();
  }
  expect(
    screen.getByRole('menuitem', { name: 'View original publication' })
  ).not.toBeNull();
  await act(async () => {
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Copy network link' })
    );
  });
  expect(mockClipboard).toHaveBeenCalledWith(value.post.releaseURL);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(mockModal).not.toHaveBeenCalled();
  expect(value.deletePost).not.toHaveBeenCalled();
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
  const preview = mockModal.mock.calls[0][0].children;
  cleanup();
  const { Component: ModalComponent } = jest.requireActual(
    '@gitroom/frontend/components/layout/new-modal'
  );
  render(
    React.createElement(ModalComponent, {
      modal: mockModal.mock.calls[0][0],
      isLast: true,
      zIndex: 100,
      closeModal: mockCloseById,
    })
  );
  expect(screen.getByTitle('Preview post').getAttribute('src')).toBe(
    '/p/post?private=true&share=true'
  );
  expect(screen.getByRole('group', { name: 'Post actions' })).not.toBeNull();
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
  expect(screen.getByTitle('Preview post').getAttribute('src')).toBe(
    '/p/post?private=true'
  );
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

it.each(['month', 'week', 'day'])(
  'opens the same actions on right click in %s without activating the card',
  (display: string) => {
    const value = { ...props(), display };
    render(React.createElement(CalendarItem, value));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Edit post' }), {
      clientX: 100,
      clientY: 120,
    });
    const contextItems = screen
      .getAllByRole('menuitem')
      .map((item: HTMLElement) => item.textContent);
    expect(value.editPost).not.toHaveBeenCalled();
    expect(mockModal).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Post actions' }));
    expect(
      screen
        .getAllByRole('menuitem')
        .map((item: HTMLElement) => item.textContent)
    ).toEqual(contextItems);
  }
);

it.each([{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }])(
  'opens card actions with the keyboard context menu shortcut %o',
  (shortcut: any) => {
    const value = props();
    render(React.createElement(CalendarItem, value));
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Edit post' }),
      shortcut
    );
    expect(screen.getByRole('menu')).not.toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: 'Edit post' })
    );
    expect(value.editPost).not.toHaveBeenCalled();
  }
);

it.each([false, true])(
  'reuses composer actions in the private preview (imported=%s)',
  (imported: boolean) => {
    const value: any = props();
    value.state = value.post.state = 'PUBLISHED';
    value.post.importedFromPlatform = imported;
    render(React.createElement(CalendarItem, value));
    fireEvent.click(screen.getByRole('button', { name: 'Preview post' }));
    const preview = mockModal.mock.calls[0][0].children;
    cleanup();
    render(preview);
    expect(screen.queryByRole('button', { name: 'Edit post' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate post' }));
    expect(value.duplicatePost).toHaveBeenCalledTimes(1);
    expect(mockCloseById).toHaveBeenCalledWith('post-preview-post');
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy to another network' })
    );
    expect(value.copyToChannel).toHaveBeenCalledTimes(1);
    expect(value.deletePost).not.toHaveBeenCalled();
  }
);

it('keeps write actions out of the viewer preview and context menu', () => {
  mockCanWrite = false;
  const value: any = props();
  value.post.importedFromPlatform = true;
  render(React.createElement(CalendarItem, value));
  const card = screen.getByRole('button', { name: 'Preview post' });
  fireEvent.contextMenu(card);
  expect(screen.queryByRole('menuitem', { name: 'Duplicate post' })).toBeNull();
  expect(
    screen.queryByRole('menuitem', { name: 'Copy to another network' })
  ).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(card);
  const preview = mockModal.mock.calls[0][0].children;
  cleanup();
  render(preview);
  expect(screen.queryByRole('button', { name: 'Duplicate post' })).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Copy to another network' })
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Remove from Mali Posts' })
  ).toBeNull();
  expect(screen.getByTitle('Preview post').getAttribute('src')).toBe(
    '/p/post?private=true'
  );
});

it.each([false, true])(
  'opens a new composer from full post data, including imported posts (%s)',
  async (importedFromPlatform: boolean) => {
    const source = { group: 'group', importedFromPlatform };
    const media = [{ id: 'media', path: '/photo.jpg' }];
    const data = {
      integration: 'source',
      posts: [
        {
          id: 'original',
          content: 'Complete caption',
          image: media,
          releaseId: 'remote',
          settings: { sourceOnly: true },
        },
      ],
      siblings: [{ integration: 'other' }],
    };
    mockFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url === '/posts/find-slot' ? { date: '2030-01-01T12:00:00Z' } : data,
    }));
    const { CalendarContext } = require('./calendar.context');
    const { result } = renderHook(() => usePostActions(), {
      wrapper: ({ children }: any) =>
        React.createElement(
          CalendarContext.Provider,
          {
            value: {
              integrations: mockIntegrations,
              reloadCalendarView: mockReload,
            },
          },
          children
        ),
    });
    await act(async () => {
      await result.current.editPost(source, true)();
    });
    const duplicate = mockModal.mock.calls[0][0].children;
    expect(duplicate.type).toBe(React.Fragment);
    expect(duplicate.props.children.props).toMatchObject({
      selectedChannels: ['source'],
      onlyValues: [{ content: 'Complete caption', image: media }],
      integrations: mockIntegrations,
      allIntegrations: mockIntegrations,
    });
    expect(duplicate.props.children.props.onlyValues[0]).toEqual({
      content: 'Complete caption',
      image: media,
    });
    mockModal.mockClear();
    await act(async () => {
      await result.current.editPost(source, true, true)();
    });
    const copy = mockModal.mock.calls[0][0].children;
    expect(copy.type).toBe(React.Fragment);
    expect(copy.props.children.props.selectedChannels).toBeUndefined();
    expect(copy.props.children.props.onlyValues).toEqual([
      { content: 'Complete caption', image: media },
    ]);
    expect(copy.props.children.props.integrations).toEqual(mockIntegrations);
    expect(
      mockFetch.mock.calls.every(
        (args: any[]) => !args[1]?.method || args[1].method === 'GET'
      )
    ).toBe(true);
    expect(mockReload).not.toHaveBeenCalled();
  }
);

it('prevents repeated remote deletion from the private preview while a request is running', async () => {
  const { deleteDialog } = require('@gitroom/react/helpers/delete.dialog');
  deleteDialog.mockResolvedValue(true);
  mockFetch.mockImplementation(async (_url: string, options: any) => ({
    ok: true,
    json: async () =>
      options?.method === 'POST'
        ? { status: 'deleted' }
        : {
            supported: true,
            status: 'not_requested',
            version: 1,
            remoteId: 'remote',
          },
  }));
  const value: any = props();
  value.state = value.post.state = 'PUBLISHED';
  Object.assign(value.post, {
    releaseId: 'remote',
    remoteDeletionSupported: true,
  });
  render(React.createElement(CalendarItem, value));
  fireEvent.click(screen.getByRole('button', { name: 'Preview post' }));
  render(mockModal.mock.calls[0][0].children);
  const deletion = screen.getByRole('button', { name: 'Delete from network' });
  await act(async () => {
    fireEvent.click(deletion);
    fireEvent.click(deletion);
  });
  expect(deleteDialog).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(mockFetch).toHaveBeenLastCalledWith('/posts/post/delete-remote', {
    method: 'POST',
    body: JSON.stringify({ version: 1, confirmRemoteId: 'remote' }),
  });
});

it.each([
  'instagram',
  'instagram-standalone',
  'facebook',
  'linkedin',
  'x',
  'youtube',
  'tiktok',
  'pinterest',
  'neuraltalk',
])(
  '%s keeps local editing for drafts/queue/errors and offers original-platform editing for published posts',
  (provider: string) => {
    for (const state of ['DRAFT', 'QUEUE', 'ERROR', 'PUBLISHED']) {
      const value: any = props();
      value.state = value.post.state = state;
      value.post.integration.providerIdentifier = provider;
      value.post.releaseURL = 'https://example.com/original';
      value.post.releaseId = state === 'PUBLISHED' ? 'remote' : null;
      render(React.createElement(CalendarItem, value));
      fireEvent.click(screen.getByRole('button', { name: 'Post actions' }));
      const published = state === 'PUBLISHED';
      fireEvent.click(
        screen.getByRole('menuitem', {
          name: published ? 'Edit on original platform' : 'Edit post',
        })
      );
      expect(value.editPost).toHaveBeenCalledTimes(published ? 0 : 1);
      expect(value.openPost).toHaveBeenCalledTimes(published ? 1 : 0);
      expect(value.duplicatePost).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      if (published) {
        fireEvent.click(screen.getByRole('button', { name: 'Preview post' }));
        render(mockModal.mock.calls.at(-1)[0].children);
        fireEvent.click(
          screen.getByRole('button', { name: 'Edit on original platform' })
        );
        expect(value.openPost).toHaveBeenCalledTimes(2);
        expect(value.editPost).not.toHaveBeenCalled();
      }
      cleanup();
    }
  }
);

it.each(['viewer', 'deleted', 'no-link', 'unsafe-link'])(
  'hides original-platform editing for %s',
  (kind: string) => {
    const value: any = props();
    value.state = value.post.state = 'PUBLISHED';
    value.post.releaseId = 'remote';
    value.post.releaseURL =
      kind === 'unsafe-link'
        ? 'javascript:alert(1)'
        : kind === 'no-link'
        ? null
        : 'https://example.com/post';
    value.post.remoteDeleted = kind === 'deleted';
    mockCanWrite = kind !== 'viewer';
    render(React.createElement(CalendarItem, value));
    fireEvent.click(screen.getByRole('button', { name: 'Post actions' }));
    expect(
      screen.queryByRole('menuitem', { name: 'Edit on original platform' })
    ).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Edit post' })).toBeNull();
  }
);

it.each([
  { state: 'PUBLISHED' },
  { importedFromPlatform: true },
  { state: 'ERROR', releaseId: 'partial-thread' },
])(
  'never opens the scheduling composer for an existing publication %j',
  async (publication: any) => {
    const { result } = renderHook(() => usePostActions());
    await act(async () =>
      result.current.editPost(
        {
          ...publication,
          content: 'Caption',
          releaseURL: 'https://example.com/original',
          publishDate: '2030-01-01',
        },
        false
      )()
    );
    expect(mockFetch).not.toHaveBeenCalled();
    render(mockModal.mock.calls[0][0].children);
    expect(
      screen
        .getByRole('link', { name: 'Edit on original platform' })
        .getAttribute('href')
    ).toBe('https://example.com/original');
    expect(
      screen.getByText(/Saving in the composer would not update/)
    ).not.toBeNull();
  }
);

it.each([true, false])(
  'uses the real modal manager/store/content chain in the calendar (writer=%s)',
  (writer: boolean) => {
    mockRealModals = true;
    mockCanWrite = writer;
    const actual = jest.requireActual(
      '@gitroom/frontend/components/layout/new-modal'
    );
    const value: any = props();
    value.state = value.post.state = 'PUBLISHED';
    render(
      React.createElement(
        actual.ModalManager,
        null,
        React.createElement(CalendarItem, value)
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview post' }));
    const frame = screen.getByTitle('Preview post');
    expect(frame.getAttribute('src')).toBe(
      '/p/post?private=true' + (writer ? '&share=true' : '')
    );
    const panel = frame.closest('[style*="80vh"]');
    expect(panel.style.display).toBe('grid');
    expect(panel.style.gridTemplateRows).toBe('auto minmax(0, 1fr)');
    expect(panel.style.width).toBe('80vw');
    expect(panel.lastElementChild.className).toContain('min-h-0');
    expect(
      panel.lastElementChild.contains(
        screen.getByRole('group', { name: 'Post actions' })
      )
    ).toBe(true);
    expect(mockModal).not.toHaveBeenCalled();
    const { result } = renderHook(actual.useModals);
    act(() => result.current.closeAll());
    expect(screen.queryByTitle('Preview post')).toBeNull();
  }
);

it.each([true, false])(
  'opens Visualizar publicação from real analytics through the real modal manager (writer=%s)',
  async (writer: boolean) => {
    mockRealModals = true;
    mockCanWrite = writer;
    const actual = jest.requireActual(
      '@gitroom/frontend/components/layout/new-modal'
    );
    const {
      WorkspaceAnalytics,
    } = require('../platform-analytics/workspace.analytics');
    const { SWRConfig } = require('swr');
    const post = {
      id: 'insight-post',
      content: 'Analytics caption',
      publishDate: '2030-01-01',
      format: 'post',
      channelName: 'Instagram',
      platform: 'instagram',
      metrics: {},
      engagementRate: { value: null, formula: null },
      status: 'available',
    };
    mockFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url === '/integrations/list'
          ? { integrations: [] }
          : {
              total: 1,
              posts: [post],
              topReactions: [],
              topComments: [],
              summary: {
                availablePosts: 1,
                metrics: {},
                coverage: Object.fromEntries(
                  [
                    'reactions',
                    'comments',
                    'views',
                    'reach',
                    'impressions',
                  ].map((k) => [k, { known: 0, total: 1 }])
                ),
              },
              weekdays: [],
              channels: [],
            },
    }));
    render(
      React.createElement(
        SWRConfig,
        { value: { provider: () => new Map(), dedupingInterval: 0 } },
        React.createElement(
          actual.ModalManager,
          null,
          React.createElement(WorkspaceAnalytics)
        )
      )
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /Analytics caption/ })
    );
    const frame = screen.getByTitle('Preview post');
    expect(screen.getByText('View publication')).not.toBeNull();
    expect(frame.getAttribute('src')).toBe(
      '/p/insight-post?private=true' + (writer ? '&share=true' : '')
    );
    const panel = frame.closest('[style*="80vh"]');
    expect(panel.style.display).toBe('grid');
    expect(panel.style.gridTemplateRows).toBe('auto minmax(0, 1fr)');
    expect(panel.lastElementChild.firstElementChild).toBe(frame.parentElement);
    expect(mockModal).not.toHaveBeenCalled();
    const { result } = renderHook(actual.useModals);
    act(() => result.current.closeAll());
    expect(screen.queryByTitle('Preview post')).toBeNull();
  }
);

it.each(['http', 'network', 'invalid-json'])(
  'keeps the composer closed and reports a failed post read (%s)',
  async (failure: string) => {
    mockFetch.mockImplementation(async () => {
      if (failure === 'network') throw new Error('Private failure details');
      return {
        ok: failure !== 'http',
        json: async () => {
          if (failure === 'invalid-json') throw new Error('Private payload');
          return { posts: [{ content: 'Error response' }] };
        },
      };
    });
    const { result } = renderHook(() => usePostActions());
    await act(async () => { await result.current.editPost({ group: 'group' })(); });
    expect(mockModal).not.toHaveBeenCalled();
    expect(mockReload).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('Could not load the post. Try again.', 'warning');
  }
);
it('does not load or open a composer when the active profile cannot write', async () => {
  mockCanWrite = false;
  const { result } = renderHook(() => usePostActions());
  await act(async () => { await result.current.editPost({ group: 'group' }, true)(); });
  expect(mockFetch).not.toHaveBeenCalled();
  expect(mockModal).not.toHaveBeenCalled();
});
