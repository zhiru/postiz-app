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
  fireEvent,
  render,
  screen,
  waitFor,
} = require('@testing-library/react');
const { SWRConfig } = require('swr');
const { CustomerModal } = require('./customer.modal');

const mockFetch = jest.fn();
const mockClose = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ closeAll: mockClose }),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, value: string) => value,
}));

function open(groups: Array<{ id: string; name: string }>, saveOk = true) {
  mockFetch.mockImplementation(async (path: string) =>
    path === '/integrations/customers'
      ? { ok: true, json: async () => groups }
      : { ok: saveOk }
  );
  const onClose = jest.fn();
  render(
    React.createElement(
      SWRConfig,
      { value: { provider: () => new Map(), dedupingInterval: 0 } },
      React.createElement(CustomerModal, {
        integration: { id: 'channel', customer: { name: 'Old' } },
        onClose,
      })
    )
  );
  return onClose;
}

beforeEach(() => jest.clearAllMocks());

test('lists existing groups on open and saves the selected group', async () => {
  const onClose = open([{ id: 'g1', name: 'New group' }]);
  fireEvent.click(await screen.findByRole('button', { name: 'New group' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(mockFetch).toHaveBeenCalledWith(
    '/integrations/channel/customer-name',
    {
      method: 'PUT',
      body: JSON.stringify({ name: 'New group' }),
    }
  );
});

test('explains an empty list and keeps the dialog open when creating fails', async () => {
  const onClose = open([], false);
  await screen.findByText(
    'There are no groups yet. Enter a name to create the first one.'
  );
  fireEvent.change(screen.getByLabelText('Search for or name a group'), {
    target: { value: '  New group  ' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Create group and move channel' })
  );
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not save the group'
  );
  expect(onClose).not.toHaveBeenCalled();
});

test('removes the existing association after clearing the search', async () => {
  const onClose = open([{ id: 'g1', name: 'Old' }]);
  await screen.findByRole('button', { name: 'Old' });
  fireEvent.click(screen.getByRole('button', { name: 'Remove from group' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(mockFetch).toHaveBeenCalledWith(
    '/integrations/channel/customer-name',
    {
      method: 'PUT',
      body: JSON.stringify({ name: '' }),
    }
  );
});
