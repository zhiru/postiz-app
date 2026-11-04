export {};
jest.mock('canvas', () => null);
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost' });
Object.assign(global, { window: dom.window, document: dom.window.document });
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
(global as any).IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { render, screen, fireEvent, cleanup, waitFor } = require('@testing-library/react');

jest.mock('./flow-execution-list.component', () => ({ FlowExecutionList: () => null }));
jest.mock('./hooks/use-flow-history', () => ({ useFlowHistory: () => ({ selectedExecutionId: 'e', navigateHistory: jest.fn() }) }));
jest.mock('./hooks/use-flows', () => ({ useFlowExecution: jest.fn(), useFlowExecutionPublication: () => ({ data: { permalink: null } }) }));
jest.mock('./hooks/use-flow-redispatch', () => ({ useFlowRedispatch: jest.fn() }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({ useT: () => (_key: string, fallback: string) => fallback }));
const { FlowExecutionsComponent } = require('./flow-executions.component');
const { useFlowExecution } = require('./hooks/use-flows');
const { useFlowRedispatch } = require('./hooks/use-flow-redispatch');
const mockFetch = jest.fn();
let mockExecution: any;
let mockPreview: any;
const mockMutate = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  mockExecution = { id: 'e', status: 'COMPLETED', igCommenterId: 'person', commentText: 'hello',
    executionLog: JSON.stringify([
      { nodeId: 't', nodeType: 'TRIGGER', status: 'entered' },
      { nodeId: 't', nodeType: 'TRIGGER', status: 'skipped', error: 'keywords_not_matched' },
    ]) };
  mockPreview = { data: { configurationToken: 'a'.repeat(64), publicReply: true, directMessage: true } };
  useFlowExecution.mockImplementation(() => ({ data: mockExecution, mutate: mockMutate }));
  useFlowRedispatch.mockImplementation((_flow: string, _id: string, enabled: boolean) => enabled ? mockPreview : {});
  mockFetch.mockResolvedValue({ ok: true });
});
afterEach(cleanup);
const show = () => render(React.createElement(FlowExecutionsComponent, { flowId: 'f' }));

it('offers redispatch on a COMPLETED keyword skip and requires a separate confirmation naming public reply and DM', async () => {
  show();
  expect(mockFetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Redispatch' }));
  expect(screen.getByText('Public reply: may be sent to the comment.')).toBeTruthy();
  expect(screen.getByText('DM: may be sent privately to the commenter, including the follow gate.')).toBeTruthy();
  expect(mockFetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm redispatch' }));
  await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
  expect(mockFetch).toHaveBeenCalledWith('/flows/f/executions/e/redispatch', {
    method: 'POST', body: JSON.stringify({ confirmed: true, configurationToken: 'a'.repeat(64) }),
  });
});

it('never sends on cancel and names unconfigured effects', () => {
  mockPreview.data.publicReply = false;
  mockPreview.data.directMessage = false;
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Redispatch' }));
  expect(screen.getByText('Public reply: none configured.')).toBeTruthy();
  expect(screen.getByText('DM: none configured.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockFetch).not.toHaveBeenCalled();
});

it.each(['RUNNING', 'WAITING_POSTBACK', 'malformed', 'delivered', 'claimed'])('hides redispatch for %s', (scenario) => {
  if (scenario === 'malformed') mockExecution.executionLog = '{';
  else if (scenario === 'delivered') mockExecution.executionLog = '[{"nodeType":"SEND_DM","status":"completed"}]';
  else if (scenario === 'claimed') mockExecution.executionLog = '[{"nodeType":"TRIGGER","status":"redispatch_requested"}]';
  else mockExecution.status = scenario;
  show();
  expect(screen.queryByRole('button', { name: 'Redispatch' })).toBeNull();
});

it('blocks confirmation when the server cannot confirm eligibility', () => {
  mockPreview = { error: new Error('blocked') };
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Redispatch' }));
  expect(screen.getByRole('alert').textContent).toContain('Redispatch blocked');
  expect(screen.queryByRole('button', { name: 'Confirm redispatch' })).toBeNull();
  expect(mockFetch).not.toHaveBeenCalled();
});

it('does not retry an uncertain start or accept double clicks', async () => {
  mockFetch.mockRejectedValue(new Error('lost response'));
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Redispatch' }));
  const confirm = screen.getByRole('button', { name: 'Confirm redispatch' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('result unknown'));
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Confirm redispatch' })).toBeNull();
});
