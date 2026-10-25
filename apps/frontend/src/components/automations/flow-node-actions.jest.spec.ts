export {};
jest.mock('canvas', () => null);
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_: string, fallback: string) => fallback,
}));
const mockState = { nodes: [] as any[], edges: [] as any[] };
jest.mock('@xyflow/react', () => ({
  useReactFlow: () => ({
    getNode: (id: string) => mockState.nodes.find((n) => n.id === id),
    setNodes: (fn: any) => {
      mockState.nodes = fn(mockState.nodes);
    },
    setEdges: (fn: any) => {
      mockState.edges = fn(mockState.edges);
    },
  }),
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
const {
  FlowNodeActions,
  FlowNodeActionsContext,
} = require('./nodes/flow-node-actions');
afterEach(() => cleanup());
const setup = (type = 'sendDm', disabled = false) => {
  const source = {
    id: 'a',
    type,
    position: { x: 10, y: 20 },
    data: {
      config: JSON.stringify({ message: 'Original', media: { id: 'media' } }),
    },
  };
  mockState.nodes = [
    source,
    { id: 'b', type: 'sendDm', position: { x: 0, y: 0 }, data: {} },
  ];
  mockState.edges = [
    { id: 'in', source: 'b', target: 'a' },
    { id: 'out', source: 'a', target: 'b' },
    { id: 'keep', source: 'b', target: 'b' },
  ];
  const edit = jest.fn();
  render(
    React.createElement(
      FlowNodeActionsContext.Provider,
      { value: { edit, disabled } },
      React.createElement(FlowNodeActions, { id: 'a' })
    )
  );
  if (!disabled)
    fireEvent.click(screen.getByRole('button', { name: 'Step actions' }));
  return { source, edit };
};
it('duplicates the configuration with a new ID and no copied connections', () => {
  const { source, edit } = setup();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate step' }));
  expect(mockState.nodes).toHaveLength(3);
  const copy = mockState.nodes[2];
  expect(copy.id).not.toBe(source.id);
  expect(copy.data).toEqual(source.data);
  expect(copy.data).not.toBe(source.data);
  expect(copy.position).not.toEqual(source.position);
  expect(mockState.edges).toHaveLength(3);
  expect(edit).toHaveBeenCalledWith(copy);
});
it('deletes only the node and its incident edges', () => {
  const { edit } = setup();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete step' }));
  expect(mockState.nodes.map((n) => n.id)).toEqual(['b']);
  expect(mockState.edges.map((e) => e.id)).toEqual(['keep']);
  expect(edit).toHaveBeenCalledWith(null);
});
it('opens the selected step for editing', () => {
  const { source, edit } = setup();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit step' }));
  expect(edit).toHaveBeenCalledWith(source);
});
it('protects the trigger from duplication and deletion', () => {
  setup('trigger');
  const duplicate = screen.getByRole('menuitem', { name: 'Duplicate step' });
  const remove = screen.getByRole('menuitem', { name: 'Delete step' });
  expect((duplicate as HTMLButtonElement).disabled).toBe(true);
  expect((remove as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(duplicate);
  fireEvent.click(remove);
  expect(mockState.nodes).toHaveLength(2);
  expect(mockState.edges).toHaveLength(3);
});
it('disables actions for an active V2 flow', () => {
  setup('sendDm', true);
  expect(
    (screen.getByRole('button', { name: 'Step actions' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});
