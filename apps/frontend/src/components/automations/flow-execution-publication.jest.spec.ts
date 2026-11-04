export {};
jest.mock('canvas', () => null);
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<html><body></body></html>', {
  url: 'http://localhost',
});
Object.assign(global, { window: dom.window, document: dom.window.document });
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
  waitFor,
} = require('@testing-library/react');
const {
  FlowExecutionPublication,
} = require('./flow-execution-publication.component');
const { useFlowExecutionPublication } = require('./hooks/use-flows');
jest.mock('./hooks/use-flows', () => ({
  useFlowExecutionPublication: jest.fn(),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
afterEach(cleanup);
const renderPublication = () =>
  render(
    React.createElement(FlowExecutionPublication, {
      flowId: 'flow',
      executionId: 'execution',
    })
  );
it('opens the actual permalink in another tab without changing history', () => {
  const permalink = 'https://www.instagram.com/reel/Shortcode/';
  useFlowExecutionPublication.mockReturnValue({
    data: { permalink },
    isLoading: false,
  });
  const location = window.location.href;
  renderPublication();
  const link = screen.getByRole('link', {
    name: 'Open publication in a new tab',
  });
  expect(link.getAttribute('href')).toBe(permalink);
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(window.location.href).toBe(location);
  expect(useFlowExecutionPublication).toHaveBeenCalledWith('flow', 'execution');
});
it.each([true, false])(
  'keeps the action disabled while no permalink is available (loading: %s)',
  (isLoading) => {
    useFlowExecutionPublication.mockReturnValue({
      data: { permalink: null },
      isLoading,
    });
    renderPublication();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button').disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe(
      isLoading ? 'Loading publication link...' : 'Publication link unavailable'
    );
  }
);
