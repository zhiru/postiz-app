export {};
jest.mock('canvas', () => null);
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
jest.mock('@gitroom/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (path: string) => path }),
}));
jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration',
  () => ({
    useIntegration: () => ({ integration: { id: 'ig' } }),
  })
);
jest.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: () => require('dayjs')(),
}));
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<html><body></body></html>', {
  url: 'http://localhost',
});
Object.assign(global, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
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
  act,
} = require('@testing-library/react');
const { InstagramImageTags } = require('./instagram.image.tags');
const { useLaunchStore } = require('../../store');
const tag = { username: 'existing', x: 0.2, y: 0.8 };
beforeEach(() => {
  useLaunchStore.getState().reset();
  useLaunchStore.setState({
    selectedIntegrations: [{ integration: { id: 'ig' }, settings: {} }],
    global: [
      {
        id: 'post',
        content: 'caption',
        delay: 0,
        media: [
          { id: 'a', path: 'https://example.com/a.jpg', user_tags: [tag] },
          { id: 'b', path: 'https://example.com/b.jpg' },
        ],
      },
    ],
  });
});
afterEach(cleanup);

it('customizes only this channel, edits coordinates with the keyboard and removes a tag', () => {
  render(React.createElement(InstagramImageTags, { isStory: false }));
  fireEvent.change(screen.getAllByLabelText('Instagram username')[0], {
    target: { value: '@Person' },
  });
  fireEvent.click(screen.getAllByRole('button', { name: 'Add person' })[0]);
  const state = useLaunchStore.getState();
  expect(state.global[0].media[0].user_tags).toEqual([tag]);
  expect(state.internal[0].integrationValue[0].media[0].user_tags[1]).toEqual({
    username: 'Person',
    x: 0.5,
    y: 0.5,
  });
  fireEvent.change(screen.getAllByLabelText('X (0 left, 1 right)')[1], {
    target: { value: '0.75' },
  });
  expect(
    useLaunchStore.getState().internal[0].integrationValue[0].media[0]
      .user_tags[1].x
  ).toBe(0.75);
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove person' })[1]);
  expect(
    useLaunchStore.getState().internal[0].integrationValue[0].media[0].user_tags
  ).toEqual([tag]);
});

it('rejects duplicate usernames and retains tags when images are reordered or text changes', () => {
  render(React.createElement(InstagramImageTags, { isStory: false }));
  fireEvent.change(screen.getAllByLabelText('Instagram username')[0], {
    target: { value: '@EXISTING' },
  });
  fireEvent.click(screen.getAllByRole('button', { name: 'Add person' })[0]);
  expect(screen.getByRole('alert').textContent).toMatch(/valid username/);
  act(() => {
    const state = useLaunchStore.getState();
    state.addRemoveInternal('ig');
    state.setInternalValueMedia('ig', 0, [...state.global[0].media].reverse());
    state.setInternalValueText('ig', 0, 'new caption');
  });
  const values = useLaunchStore.getState().internal[0].integrationValue[0];
  expect(values.media[1]).toMatchObject({ id: 'a', user_tags: [tag] });
  expect(values.content).toBe('new caption');
});

it('lets a user remove unsupported tags after switching to a story', () => {
  render(React.createElement(InstagramImageTags, { isStory: true }));
  expect(screen.queryByRole('button', { name: 'Add person' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Remove person' }));
  expect(
    useLaunchStore.getState().internal[0].integrationValue[0].media[0].user_tags
  ).toEqual([]);
});
