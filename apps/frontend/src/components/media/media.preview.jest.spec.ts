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
  waitFor,
  cleanup,
} = require('@testing-library/react');
const { SWRConfig } = require('swr');
const { MediaPreview } = require('./media.preview');
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars: Record<string, unknown> = {}) =>
      fallback.replace(/{{(\w+)}}/g, (_match, key) => String(vars[key])),
}));
jest.mock('@gitroom/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (s: string) => s }),
}));
const show = jest.fn();
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show }),
}));
const a = { id: 'a', path: '/a.jpg', name: 'First.jpg' },
  b = { id: 'b', path: '/b.mp4', name: 'Video.mp4' },
  c = { id: 'c', path: '/c.png', name: 'Last.png' };
const first = { results: [a, b], pages: 2, total: 3 };
const setup = (initialMedia = a) => {
  const loadPage = jest
      .fn()
      .mockImplementation(async (page: number) =>
        page === 0 ? first : { results: [c], pages: 2, total: 3 }
      ),
    onPageChange = jest.fn(),
    onClose = jest.fn();
  render(
    React.createElement(
      SWRConfig,
      {
        value: {
          provider: () => new Map(),
          dedupingInterval: 0,
          errorRetryCount: 0,
        },
      },
      React.createElement(MediaPreview, {
        initialMedia,
        initialPage: 0,
        initialData: first,
        pageSize: 2,
        cacheKey: 'media-test',
        loadPage,
        onPageChange,
        onClose,
      })
    )
  );
  return { loadPage, onPageChange, onClose };
};
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  document.documentElement.dir = '';
});
describe('MediaPreview', () => {
  it('steps through images and videos, across pages and back', async () => {
    const ctx = setup();
    expect(
      (
        screen.getByRole('button', {
          name: 'Previous media',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next media' }));
    expect(document.querySelector('video')?.getAttribute('src')).toBe('/b.mp4');
    fireEvent.click(screen.getByRole('button', { name: 'Next media' }));
    await screen.findByRole('img', { name: 'Last.png' });
    expect(ctx.loadPage).toHaveBeenCalledWith(1);
    expect(ctx.onPageChange).toHaveBeenCalledWith(1);
    expect(
      (screen.getByRole('button', { name: 'Next media' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    ctx.loadPage.mockResolvedValue(first);
    fireEvent.click(screen.getByRole('button', { name: 'Previous media' }));
    await waitFor(() =>
      expect(document.querySelector('video')?.getAttribute('src')).toBe(
        '/b.mp4'
      )
    );
    expect(ctx.onPageChange).toHaveBeenLastCalledWith(0);
  });
  it('retains the current file and grid page if the next page fails', async () => {
    const ctx = setup(b);
    ctx.loadPage.mockImplementation(async (page: number) => {
      if (page === 1) throw new Error('private url');
      return first;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next media' }));
    await waitFor(() => expect(show).toHaveBeenCalled());
    expect(document.querySelector('video')?.getAttribute('src')).toBe('/b.mp4');
    expect(ctx.onPageChange).not.toHaveBeenCalled();
    expect(show.mock.calls.flat().join()).not.toContain('private url');
    ctx.loadPage.mockResolvedValue({ results: [c], pages: 2, total: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Next media' }));
    await screen.findByRole('img', { name: 'Last.png' });
  });
  it('uses arrows except while seeking a video or using browser shortcuts', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowRight', altKey: true });
    expect(screen.getByRole('img', { name: 'First.jpg' })).toBeDefined();
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    const video = document.querySelector('video')!;
    fireEvent.keyDown(video, { key: 'ArrowLeft' });
    expect(document.querySelector('video')).not.toBeNull();
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(screen.getByRole('img', { name: 'First.jpg' })).toBeDefined();
  });
  it('supports RTL arrows, close, and a failed image without blanking the next file', () => {
    document.documentElement.dir = 'rtl';
    const ctx = setup();
    fireEvent.error(screen.getByRole('img', { name: 'First.jpg' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
    expect(document.querySelector('video')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(ctx.onClose).toHaveBeenCalled();
  });
});
