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
  cleanup,
} = require('@testing-library/react');
const dayjs = require('dayjs');
const mockModal = jest.fn();
jest.mock('react-dnd', () => ({
  useDrag: () => [{ opacity: 1 }, () => {}],
  useDrop: () => [{}, () => {}],
}));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: mockModal }),
}));
jest.mock('@gitroom/frontend/hooks/use-profile-permissions', () => ({
  useProfilePermissions: () => ({ canWrite: true }),
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
jest.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: (v: any) => require('dayjs')(v),
  fromUtc: (v: any) => require('dayjs')(v),
}));
jest.mock('@gitroom/helpers/utils/sanitize.post.content', () => ({
  postContentPlainText: (v: string) => v,
}));
const { CalendarItem } = require('./calendar');
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
    screen.getByRole('menuitem', { name: 'Duplicate post' })
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
});
it('keeps published posts in a fullscreen preview without opening another tab', () => {
  const value: any = props();
  value.state = 'PUBLISHED';
  value.post.releaseId = '123';
  render(React.createElement(CalendarItem, value));
  fireEvent.click(screen.getByRole('button', { name: 'Preview post' }));
  expect(value.editPost).not.toHaveBeenCalled();
  expect(mockModal.mock.calls[0][0].fullScreen).toBe(true);
  expect(mockModal.mock.calls[0][0].children.type).toBe('iframe');
});
