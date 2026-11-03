export {};
jest.mock('canvas', () => null);
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_: string, fallback: string) => fallback,
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => jest.fn(),
}));
const mockSetSize = jest.fn().mockResolvedValue(undefined);
const mockKeys: any[] = [];
jest.mock('swr/infinite', () => ({
  __esModule: true,
  default: (key: any) => {
    mockKeys.push(key);
    return {
      data: [
        {
          items: [
            { id: 'media-1', caption: 'Summit' },
            { id: 'media-2', caption: 'Outro post' },
          ],
          nextCursor: 'page 2',
        },
      ],
      size: 1,
      setSize: mockSetSize,
      isValidating: false,
      mutate: jest.fn(),
    };
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
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
});
Object.defineProperty(global, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
});
window.matchMedia = () =>
  ({ matches: false, addListener: () => {}, removeListener: () => {} } as any);
(global as any).IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const {
  render,
  screen,
  cleanup,
  fireEvent,
} = require('@testing-library/react');
const { ExcludedPostsField } = require('./excluded-posts-field');
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockKeys.length = 0;
});
function setup(ids: string[] = []) {
  const onChange = jest.fn();
  render(
    React.createElement(ExcludedPostsField, {
      integrationId: 'int-1',
      value: ids,
      onChange,
    })
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Choose posts to ignore' })
  );
  return onChange;
}
it('selects a post without losing older exclusions outside the loaded pages', () => {
  const change = setup(['older-media']);
  fireEvent.click(screen.getByRole('checkbox', { name: /Summit/ }));
  expect(change).toHaveBeenCalledWith(['older-media', 'media-1']);
});
it('removes an excluded ID even when it is not in the loaded page', () => {
  const change = setup(['older-media']);
  fireEvent.click(
    screen.getByRole('button', { name: 'Remove exclusion: older-media' })
  );
  expect(change).toHaveBeenCalledWith([]);
});
it('searches loaded posts and requests the next cursor using the API contract', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Search loaded posts'), {
    target: { value: 'Summit' },
  });
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  expect(mockSetSize).toHaveBeenCalledWith(2);
  expect(mockKeys[mockKeys.length - 1](1, { nextCursor: 'page 2' })).toBe(
    '/flows/integrations/int-1/posts?cursor=page%202'
  );
});
it('adds a manual media ID and prevents duplicate additions', () => {
  const change = setup(['media-1']);
  const input = screen.getByLabelText(
    'Or add an Instagram media ID (including ads)'
  );
  fireEvent.change(input, { target: { value: 'media-1' } });
  expect(screen.getByRole('button', { name: 'Add' }).disabled).toBe(true);
  fireEvent.change(input, { target: { value: '178900' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(change).toHaveBeenCalledWith(['media-1', '178900']);
});
