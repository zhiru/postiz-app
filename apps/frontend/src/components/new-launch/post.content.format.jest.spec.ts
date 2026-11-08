export {};
jest.mock('canvas', () => null);
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
afterAll(() => dom.window.close());
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: require('dompurify')(window),
}));
const {
  postContentToHtml,
} = require('@gitroom/helpers/utils/sanitize.post.content');

describe('caption formatting for editor and MCP', () => {
  it('keeps each blank line as an empty paragraph and escapes literal text', () => {
    expect(postContentToHtml('Title 🥃\r\n\r\nA < 10 & B\n📍 Londrina')).toBe(
      '<p>Title 🥃</p><p></p><p>A &lt; 10 &amp; B</p><p>📍 Londrina</p>'
    );
  });
  it('keeps rich text and removes unsafe attributes', () => {
    expect(
      postContentToHtml('<p>Title</p><p></p><p><strong>Details</strong></p>')
    ).toBe('<p>Title</p><p></p><p><strong>Details</strong></p>');
    expect(postContentToHtml('<p onclick="bad()">Hello</p>')).toBe(
      '<p>Hello</p>'
    );
  });
});
