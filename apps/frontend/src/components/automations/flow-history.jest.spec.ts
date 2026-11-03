export {};

jest.mock('canvas', () => null);
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_: string, fallback: string) => fallback,
}));
jest.mock('./hooks/use-flow-executions-page', () => ({
  useFlowExecutionsPage: jest.fn(),
}));
jest.mock('use-debounce', () => ({ useDebounce: (value: string) => [value] }));
jest.mock('./hooks/use-flows', () => ({
  useFlowExecution: jest.fn(),
}));

// Model the App Router's reactive URL hooks and client-side push navigation.
jest.mock('next/navigation', () => {
  const React = require('react');
  const subscribe = (callback: () => void) => {
    window.addEventListener('popstate', callback);
    return () => window.removeEventListener('popstate', callback);
  };
  const useUrl = () =>
    React.useSyncExternalStore(subscribe, () => window.location.href);
  return {
    usePathname: () => new URL(useUrl()).pathname,
    useSearchParams: () => new URL(useUrl()).searchParams,
    useRouter: () => ({
      push: (href: string) => {
        window.history.pushState(null, '', href);
        window.dispatchEvent(new window.PopStateEvent('popstate'));
      },
    }),
  };
});
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, onClick }: any) =>
    require('react').createElement('a', { href, onClick }, children),
}));

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<html><body></body></html>', {
  url: 'http://localhost/automacoes/flow-a',
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
  cleanup,
  fireEvent,
  act,
  waitFor,
} = require('@testing-library/react');
const { FlowExecutionsComponent } = require('./flow-executions.component');
const { useFlowHistory } = require('./hooks/use-flow-history');
const { useFlowExecution } = require('./hooks/use-flows');
const { useFlowExecutionsPage } = require('./hooks/use-flow-executions-page');

const executions = ['a', 'b'].map((id) => ({
  id: `execution-${id}`,
  igCommenterName: `Person ${id}`,
  commentText: `Comment ${id}`,
  status: 'COMPLETED',
  startedAt: '2026-11-03T12:00:00Z',
}));

// This is the editor's history visibility contract, using the real URL hook.
const HistoryPanel = ({ flowId = 'flow-a' }) => {
  const { showHistory, navigateHistory } = useFlowHistory();
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'button',
      { onClick: () => navigateHistory(!showHistory) },
      showHistory ? 'Close history' : 'Open history'
    ),
    showHistory && React.createElement(FlowExecutionsComponent, { flowId })
  );
};

const visit = (url: string) => {
  window.history.replaceState(null, '', url);
};

const traverse = async (
  direction: 'back' | 'forward',
  expectedId: string | null
) => {
  await act(async () => {
    const popped = new Promise<void>((resolve) =>
      window.addEventListener('popstate', () => resolve(), { once: true })
    );
    window.history[direction]();
    await popped;
  });
  await waitFor(() => {
    expect(new URL(window.location.href).searchParams.get('executionId')).toBe(
      expectedId
    );
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  visit('/automacoes/flow-a?profile=p1&tag=one&tag=two#comments');
  useFlowExecutionsPage.mockReturnValue({
    data: { items: executions, total: executions.length },
    isLoading: false,
  });
  useFlowExecution.mockImplementation(
    (flowId: string, executionId: string) => ({
      data: executions.find((execution) => execution.id === executionId),
      isLoading: false,
    })
  );
});
afterEach(() => cleanup());

it('selects a comment, exposes a direct link and preserves the flow, query parameters and hash', () => {
  render(React.createElement(FlowExecutionsComponent, { flowId: 'flow-a' }));
  const link = screen.getByRole('link', { name: 'Person a' });
  const href = new URL(link.getAttribute('href'), window.location.href);
  expect(href.pathname).toBe('/automacoes/flow-a');
  expect(href.searchParams.get('executionId')).toBe('execution-a');
  expect(href.searchParams.get('history')).toBe('1');
  expect(href.searchParams.get('profile')).toBe('p1');
  expect(href.searchParams.getAll('tag')).toEqual(['one', 'two']);
  expect(href.hash).toBe('#comments');
  fireEvent.click(screen.getByText('Comment a'));
  expect(window.location.href).toBe(href.href);
  expect(screen.getByRole('button', { name: /Back to list/ })).toBeTruthy();
  expect(useFlowExecution).toHaveBeenLastCalledWith('flow-a', 'execution-a');
});

it('opens a copied link directly, even if the selected comment is outside the loaded list', () => {
  visit('/automacoes/flow-a?executionId=execution-b&profile=p1');
  useFlowExecutionsPage.mockReturnValue({
    data: { items: [], total: 0 },
    isLoading: false,
  });
  render(React.createElement(HistoryPanel));
  expect(screen.getByRole('button', { name: 'Close history' })).toBeTruthy();
  expect(screen.getByText('Person b')).toBeTruthy();
  expect(useFlowExecution).toHaveBeenLastCalledWith('flow-a', 'execution-b');
});

it('restores list and selected comments on browser Back/Forward and after remount', async () => {
  visit('/automacoes/flow-a?profile=p1&history=1');
  const view = render(React.createElement(HistoryPanel));
  fireEvent.click(screen.getByText('Comment a'));
  await traverse('back', null);
  expect(screen.getByRole('table')).toBeTruthy();
  await traverse('forward', 'execution-a');
  expect(screen.getByText('Person a')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  view.unmount();
  render(React.createElement(HistoryPanel));
  expect(screen.getByText('Person a')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Back to list/ }));
  fireEvent.click(screen.getByText('Comment b'));
  await traverse('back', null);
  expect(screen.getByRole('table')).toBeTruthy();
  await traverse('back', 'execution-a');
  expect(screen.getByText('Person a')).toBeTruthy();
});

it('restores the history panel after closing it and navigating Back', async () => {
  visit('/automacoes/flow-a?profile=p1&executionId=execution-a#comments');
  render(React.createElement(HistoryPanel));
  fireEvent.click(screen.getByRole('button', { name: 'Close history' }));
  expect(window.location.pathname).toBe('/automacoes/flow-a');
  expect(window.location.search).toBe('?profile=p1');
  expect(window.location.hash).toBe('#comments');
  expect(screen.queryByText('Person a')).toBeNull();
  await traverse('back', 'execution-a');
  expect(screen.getByText('Person a')).toBeTruthy();
  await traverse('forward', null);
  expect(screen.getByRole('button', { name: 'Open history' })).toBeTruthy();
});

it.each([
  { isLoading: true, label: 'Loading...' },
  { isLoading: false, label: 'Execution not found' },
])(
  'keeps a way back to the list when the selected comment is $label',
  ({ isLoading, label }) => {
    visit('/automacoes/flow-a?executionId=missing&profile=p1');
    useFlowExecution.mockReturnValue({ data: undefined, isLoading });
    render(React.createElement(FlowExecutionsComponent, { flowId: 'flow-a' }));
    expect(screen.getByText(label)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Back to list/ }));
    expect(screen.getByRole('table')).toBeTruthy();
    expect(window.location.search).toBe('?profile=p1&history=1');
  }
);

it('uses the current automation when the route changes instead of retaining an old local selection', () => {
  visit('/automacoes/flow-a?executionId=execution-a');
  const view = render(
    React.createElement(FlowExecutionsComponent, { flowId: 'flow-a' })
  );
  act(() => {
    visit('/automacoes/flow-b?history=1&profile=p2');
    window.dispatchEvent(new window.PopStateEvent('popstate'));
  });
  view.rerender(
    React.createElement(FlowExecutionsComponent, { flowId: 'flow-b' })
  );
  expect(screen.getByRole('table')).toBeTruthy();
  const href = screen
    .getByRole('link', { name: 'Person a' })
    .getAttribute('href');
  expect(href).toContain('/automacoes/flow-b?');
  expect(href).toContain('profile=p2');
});

it.each(['list', 'cards'])(
  'keeps direct links and browser history in the %s view',
  (view) => {
    visit('/automacoes/flow-a?history=1&profile=p1#comments');
    render(React.createElement(HistoryPanel));
    if (view === 'cards')
      fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    const link = screen.getByRole('link', { name: /Person a/ });
    expect(link.getAttribute('href')).toContain('executionId=execution-a');
    expect(link.getAttribute('href')).toContain('profile=p1');
    fireEvent.click(link);
    expect(new URL(window.location.href).searchParams.get('executionId')).toBe(
      'execution-a'
    );
    expect(useFlowExecution).toHaveBeenLastCalledWith('flow-a', 'execution-a');
    expect(screen.getByRole('button', { name: /Back to list/ })).toBeTruthy();
  }
);
