export {};
jest.mock('canvas', () => null);
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
const React = require('react');
const {
  render,
  screen,
  fireEvent,
  cleanup,
} = require('@testing-library/react');
import { Pagination } from './pagination';
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars: Record<string, unknown> = {}) =>
      fallback.replace(/{{(\w+)}}/g, (_match, key) => String(vars[key])),
}));
afterEach(cleanup);
describe('Pagination', () => {
  it('keeps boundaries disabled and the selected page unambiguous', () => {
    const setPage = jest.fn();
    const { rerender, container } = render(
      React.createElement(Pagination, { current: 0, totalPages: 30, setPage })
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Previous page',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(setPage).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Page 30' }));
    expect(setPage).toHaveBeenLastCalledWith(29);
    rerender(
      React.createElement(Pagination, { current: 29, totalPages: 30, setPage })
    );
    expect(
      (screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
      '30'
    );
  });
  it('offers a page size even with no results and never requests a negative page', () => {
    const setPage = jest.fn(),
      setPageSize = jest.fn();
    render(
      React.createElement(Pagination, {
        current: 0,
        totalPages: 0,
        total: 0,
        pageSize: 24,
        pageSizes: [12, 24, 48, 96],
        setPage,
        setPageSize,
      })
    );
    expect(screen.getByRole('status').textContent).toBe('Showing 0–0 of 0');
    fireEvent.change(screen.getByRole('combobox', { name: 'Items per page' }), {
      target: { value: '48' },
    });
    expect(setPageSize).toHaveBeenCalledWith(48);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(setPage).not.toHaveBeenCalled();
  });
});

afterAll(() => dom.window.close());
