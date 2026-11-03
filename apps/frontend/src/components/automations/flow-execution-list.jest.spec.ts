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
const { FlowExecutionList } = require('./flow-execution-list.component');
const { useFlowExecutionsPage } = require('./hooks/use-flow-executions-page');

jest.mock('./hooks/use-flow-executions-page', () => ({
  useFlowExecutionsPage: jest.fn(),
}));
jest.mock('use-debounce', () => ({ useDebounce: (value: string) => [value] }));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars: Record<string, unknown> = {}) =>
      fallback.replace(/{{(\w+)}}/g, (_match, key) => String(vars[key])),
}));
const execution = {
  id: 'exec-1',
  igCommenterName: 'Ana',
  igCommenterId: 'ig-1',
  commentText: 'Quero saber mais',
  status: 'FAILED',
  startedAt: '2026-11-02T12:00:00.000Z',
};
let mockResult: any;
beforeEach(() => {
  mockResult = {
    data: { items: [execution], total: 63 },
    isLoading: false,
    mutate: jest.fn(),
  };
  useFlowExecutionsPage.mockImplementation(() => mockResult);
});
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});
const latestQuery = () => useFlowExecutionsPage.mock.calls.at(-1)[1];

it('requests later pages and resets pagination when filters or page size change', () => {
  render(
    React.createElement(FlowExecutionList, {
      flowId: 'flow-1',
      onSelect: jest.fn(),
    })
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
  expect(latestQuery().page).toBe(2);
  fireEvent.change(screen.getByLabelText('Status'), {
    target: { value: 'FAILED' },
  });
  expect(latestQuery()).toEqual(
    expect.objectContaining({ page: 1, status: 'FAILED' })
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
  fireEvent.change(screen.getByLabelText('Search comments or people'), {
    target: { value: '  Ana  ' },
  });
  expect(latestQuery()).toEqual(
    expect.objectContaining({ page: 1, search: 'Ana', status: 'FAILED' })
  );
  fireEvent.change(screen.getByLabelText('Started from'), {
    target: { value: '2026-11-01' },
  });
  fireEvent.change(screen.getByLabelText('Started through'), {
    target: { value: '2026-11-02' },
  });
  expect(latestQuery().since).toBe(
    new Date('2026-11-01T00:00:00').toISOString()
  );
  expect(latestQuery().until).toBe(
    new Date('2026-11-03T00:00:00').toISOString()
  );
  fireEvent.change(screen.getByLabelText('Order'), {
    target: { value: 'asc' },
  });
  expect(latestQuery().order).toBe('asc');
  fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
  fireEvent.change(screen.getAllByLabelText('Items per page')[0], {
    target: { value: '50' },
  });
  expect(latestQuery()).toEqual(
    expect.objectContaining({ page: 1, limit: 50 })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(latestQuery()).toEqual({
    page: 1,
    limit: 50,
    search: '',
    status: '',
    since: '',
    until: '',
    order: 'desc',
  });
});

it('switches views without changing the page and delegates the same selection callback', () => {
  const onSelect = jest.fn();
  render(
    React.createElement(FlowExecutionList, { flowId: 'flow-1', onSelect })
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Open comment by Ana' }));
  expect(onSelect).toHaveBeenLastCalledWith('exec-1');
  fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
  expect(
    screen.getByRole('button', { name: 'Cards' }).getAttribute('aria-pressed')
  ).toBe('true');
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByText('Quero saber mais')).toBeTruthy();
  expect(latestQuery().page).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'Open comment by Ana' }));
  expect(onSelect).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Compact list' }));
  expect(screen.getByRole('table')).toBeTruthy();
  expect(window.location.href).toBe('http://localhost/');
});

it('distinguishes loading, errors with retry, empty data and no filter matches', () => {
  mockResult = { isLoading: true };
  const { rerender } = render(
    React.createElement(FlowExecutionList, {
      flowId: 'flow-1',
      onSelect: jest.fn(),
    })
  );
  expect(screen.getByRole('status').textContent).toBe('Loading...');
  mockResult = { error: new Error('network'), mutate: jest.fn() };
  rerender(
    React.createElement(FlowExecutionList, {
      flowId: 'flow-1',
      onSelect: jest.fn(),
    })
  );
  expect(screen.getByRole('alert').textContent).toContain(
    'Unable to load comments.'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(mockResult.mutate).toHaveBeenCalledTimes(1);
  mockResult = { data: { items: [], total: 0 } };
  rerender(
    React.createElement(FlowExecutionList, {
      flowId: 'flow-1',
      onSelect: jest.fn(),
    })
  );
  expect(screen.getByText('No executions yet')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Status'), {
    target: { value: 'FAILED' },
  });
  expect(screen.getByText('No comments match these filters.')).toBeTruthy();
});

it('clamps a page after results shrink and resets on a different flow', async () => {
  const { rerender } = render(
    React.createElement(FlowExecutionList, {
      flowId: 'flow-1',
      onSelect: jest.fn(),
    })
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
  mockResult = { data: { items: [execution], total: 1 } };
  rerender(
    React.createElement(FlowExecutionList, {
      flowId: 'flow-1',
      onSelect: jest.fn(),
    })
  );
  await waitFor(() => expect(latestQuery().page).toBe(1));
  mockResult = { data: { items: [execution], total: 63 } };
  rerender(
    React.createElement(FlowExecutionList, {
      flowId: 'flow-1',
      onSelect: jest.fn(),
    })
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
  rerender(
    React.createElement(FlowExecutionList, {
      flowId: 'flow-2',
      onSelect: jest.fn(),
    })
  );
  expect(latestQuery().page).toBe(1);
});

it('does not restore a stale page when filters are cleared without paging the filtered results', () => {
  render(
    React.createElement(FlowExecutionList, {
      flowId: 'flow-1',
      onSelect: jest.fn(),
    })
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
  fireEvent.change(screen.getByLabelText('Status'), {
    target: { value: 'FAILED' },
  });
  expect(latestQuery().page).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(latestQuery().page).toBe(1);
});

it('explains inverted dates and disables the listing request until the range is valid', () => {
  render(
    React.createElement(FlowExecutionList, {
      flowId: 'flow-1',
      onSelect: jest.fn(),
    })
  );
  fireEvent.change(screen.getByLabelText('Started from'), {
    target: { value: '2026-11-03' },
  });
  fireEvent.change(screen.getByLabelText('Started through'), {
    target: { value: '2026-11-01' },
  });
  expect(screen.getByRole('alert').textContent).toContain(
    'The end date must be on or after the start date.'
  );
  expect(useFlowExecutionsPage.mock.calls.at(-1)[2]).toBe(false);
  expect(screen.queryByRole('table')).toBeNull();
});
