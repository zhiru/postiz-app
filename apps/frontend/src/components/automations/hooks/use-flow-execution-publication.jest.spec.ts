export {};
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: jest.fn(),
}));
jest.mock('react', () => ({ useCallback: (fn: unknown) => fn }));
jest.mock('swr', () => ({ __esModule: true, default: jest.fn() }));
const useSWR = require('swr').default;
const { useFetch } = require('@gitroom/helpers/utils/custom.fetch');
const { useFlowExecutionPublication } = require('./use-flows');
const endpoint = '/flows/flow/executions/execution/publication';
let request: any;
beforeEach(() => {
  request = jest.fn();
  useFetch.mockReturnValue(request);
});
const load = () => {
  useFlowExecutionPublication('flow', 'execution');
  const [key, fetcher, options] = useSWR.mock.calls.at(-1);
  expect(key).toBe(endpoint);
  expect(options).toEqual({
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  return fetcher(key);
};
it('fetches the execution-specific permalink using the authenticated wrapper', async () => {
  const permalink = 'https://www.instagram.com/p/RealShortcode/';
  request.mockResolvedValue({ ok: true, json: async () => ({ permalink }) });
  await expect(load()).resolves.toEqual({ permalink });
  expect(request).toHaveBeenCalledWith(endpoint);
});
it.each([
  null,
  123,
  'javascript:alert(1)',
  'http://instagram.com/p/real/',
  'https://instagram.com.evil.test/p/real/',
  'https://evil.test/p/real/',
  'https://user:password@instagram.com/p/real/',
  'https://instagram.com:8443/p/real/',
])('does not expose unsafe permalink %s', async (permalink) => {
  request.mockResolvedValue({ ok: true, json: async () => ({ permalink }) });
  await expect(load()).resolves.toEqual({ permalink: null });
});
it('rejects failed responses before parsing the body', async () => {
  const json = jest.fn();
  request.mockResolvedValue({ ok: false, json });
  await expect(load()).rejects.toThrow('Unable to load publication');
  expect(json).not.toHaveBeenCalled();
});
