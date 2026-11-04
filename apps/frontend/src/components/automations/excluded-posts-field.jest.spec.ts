export {};
jest.mock('canvas', () => null);
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_: string, fallback: string) => fallback,
}));
const mockFetch = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
jest.mock('../media/media.component', () => ({ MediaBox: () => null }));
jest.mock('../layout/new-modal', () => ({ useModals: () => ({}) }));
jest.mock('./ad-aliases-field.component', () => ({
  AdAliasesField: () => null,
}));
jest.mock('./comma-separated-keywords-input.component', () => ({
  CommaSeparatedKeywordsInput: () => null,
}));
jest.mock('./instagram-account-select', () => ({
  InstagramAccountSelect: () => null,
}));
jest.mock('./wizard-phone-preview.component', () => ({
  WizardPhonePreview: () => null,
}));
jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration.list',
  () => ({
    useIntegrationList: () => ({
      data: [{ id: 'int-1', identifier: 'instagram' }],
    }),
  })
);
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: jest.fn() }),
}));
jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string) => ({
    data: key === '/flows/flow-1' ? { integrationId: 'int-1' } : [],
  }),
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
            {
              id: 'media-1',
              caption: 'Summit',
              thumbnailUrl: 'https://example.com/post.jpg',
            },
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
  within,
  waitFor,
} = require('@testing-library/react');
const { ExcludedPostsField } = require('./excluded-posts-field');
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockKeys.length = 0;
});
function setup(ids: string[] = [], enabled = true, open = true) {
  const onChange = jest.fn();
  function Field() {
    const [value, setValue] = React.useState(ids);
    const [active, setActive] = React.useState(enabled);
    return React.createElement(ExcludedPostsField, {
      integrationId: 'int-1',
      value,
      enabled: active,
      onEnabledChange: setActive,
      onChange: (next: string[]) => {
        onChange(next);
        setValue(next);
      },
    });
  }
  render(React.createElement(Field));
  if (open)
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar Todos' }));
  return onChange;
}
it('selects a post without losing older exclusions outside the loaded pages', () => {
  const change = setup(['older-media']);
  fireEvent.click(screen.getAllByRole('checkbox', { name: /Summit/ })[0]);
  expect(change).toHaveBeenCalledWith(['older-media', 'media-1']);
});
it('removes an excluded ID even when it is not in the loaded page', () => {
  const change = setup(['older-media'], true, false);
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
  expect(
    within(screen.getByRole('dialog')).getAllByRole('checkbox')
  ).toHaveLength(1);
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

it('hides the selector while disabled and restores selections after toggling', () => {
  setup(['older-media'], true, false);
  const toggle = screen.getByRole('switch', { name: 'Excluded posts' });
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(screen.queryByRole('button', { name: 'Mostrar Todos' })).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Remove exclusion: older-media' })
  ).toBeNull();
  fireEvent.click(toggle);
  expect(
    screen.getByRole('button', { name: 'Remove exclusion: older-media' })
  ).toBeTruthy();
});
it('starts with the selector hidden when disabled', () => {
  setup([], false, false);
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  expect(screen.queryByRole('button', { name: 'Mostrar Todos' })).toBeNull();
});
it('opens a named modal with image cards and closes on Confirmar', async () => {
  setup();
  const dialog = screen.getByRole('dialog', { name: 'Excluded posts' });
  expect(within(dialog).getAllByRole('checkbox')).toHaveLength(2);
  expect(dialog.querySelector('img').getAttribute('src')).toBe(
    'https://example.com/post.jpg'
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('closes the modal using its accessible close button or Escape', async () => {
  setup();
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' })
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar Todos' }));
  fireEvent.keyDown(screen.getByRole('dialog'), {
    key: 'Escape',
    code: 'Escape',
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('keeps modal selection and search when reopening', async () => {
  setup();
  let dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Search loaded posts'), {
    target: { value: 'Summit' },
  });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Summit/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar Todos' }));
  dialog = screen.getByRole('dialog');
  expect(within(dialog).getByLabelText('Search loaded posts').value).toBe(
    'Summit'
  );
  expect(
    within(dialog)
      .getByRole('checkbox', { name: /Summit/ })
      .getAttribute('aria-checked')
  ).toBe('true');
});

const { AutomationWizardComponent } = require('./automation-wizard.component');
const { NodeConfigPanel } = require('./node-config-panel');
describe.each(['wizard', 'builder'])('%s exclusion save', (surface: string) => {
  function editor(ids: string[] = ['older-media']) {
    const config = {
      mode: 'all',
      triggerType: 'comment_on_post',
      excludedPostIds: ids,
    };
    const onUpdate = jest.fn();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'flow-1' }),
    });
    if (surface === 'wizard') {
      render(
        React.createElement(AutomationWizardComponent, {
          flowId: 'flow-1',
          initialFlow: {
            id: 'flow-1',
            name: 'Example',
            integrationId: 'int-1',
            nodes: [
              { type: 'TRIGGER', data: JSON.stringify(config) },
              {
                type: 'REPLY_COMMENT',
                data: JSON.stringify({ messages: ['Thanks'] }),
              },
            ],
          },
        })
      );
    } else {
      render(
        React.createElement(NodeConfigPanel, {
          node: {
            id: 'trigger-1',
            type: 'trigger',
            data: { config: JSON.stringify(config) },
          },
          flowId: 'flow-1',
          onUpdate,
          onClose: jest.fn(),
        })
      );
    }
    return {
      save: async () => {
        fireEvent.click(
          screen.getByRole('button', {
            name: surface === 'wizard' ? 'Save Changes' : 'Save',
            exact: true,
          })
        );
        if (surface === 'wizard') {
          await waitFor(() => expect(mockFetch).toHaveBeenCalled());
          return JSON.parse(
            mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body
          );
        }
        expect(onUpdate).toHaveBeenCalled();
        return onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1];
      },
    };
  }
  it('enables existing exclusions and sends an empty list when saved disabled', async () => {
    const { save } = editor();
    const toggle = screen.getByRole('switch', { name: 'Excluded posts' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect((await save()).excludedPostIds).toEqual([]);
  });
  it('preserves existing exclusions when toggled off and back on before saving', async () => {
    const { save } = editor();
    const toggle = screen.getByRole('switch', { name: 'Excluded posts' });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect((await save()).excludedPostIds).toEqual(['older-media']);
  });
  it('starts disabled without exclusions and saves an empty list', async () => {
    const { save } = editor([]);
    expect(
      screen
        .getByRole('switch', { name: 'Excluded posts' })
        .getAttribute('aria-checked')
    ).toBe('false');
    expect((await save()).excludedPostIds).toEqual([]);
  });
});
