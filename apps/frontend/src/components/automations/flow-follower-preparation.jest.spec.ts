export {};
jest.mock('canvas', () => null);
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_: string, fallback: string) => fallback,
}));
jest.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Bottom: 'bottom' },
}));
jest.mock('./nodes/flow-node-actions', () => ({ FlowNodeActions: () => null }));
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
const { render, screen, cleanup } = require('@testing-library/react');
const { TriggerNode } = require('./nodes/trigger-node');
afterEach(() => cleanup());
it('shows follower preparation as blocked rather than a comment or Story trigger', () => {
  render(
    React.createElement(TriggerNode, {
      id: 't',
      data: {
        config: JSON.stringify({
          triggerType: 'new_follower',
          keywords: ['old'],
          mode: 'next_publication',
        }),
      },
    })
  );
  expect(screen.getByText('New follower · preparation')).toBeDefined();
  expect(screen.getByText('Waiting for official Meta access')).toBeDefined();
  expect(screen.queryByText(/old/)).toBeNull();
  expect(screen.queryByText('Todos os posts')).toBeNull();
});
it('keeps legacy comment trigger labels', () => {
  render(React.createElement(TriggerNode, { id: 't', data: { config: '{}' } }));
  expect(screen.getByText('Gatilho: Comentario no Instagram')).toBeDefined();
});
