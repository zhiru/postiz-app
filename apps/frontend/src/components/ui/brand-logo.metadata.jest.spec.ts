export {};
/** @jest-environment node */
jest.mock('canvas', () => null);
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<html><head></head><body></body></html>', {
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
const { act, render, cleanup } = require('@testing-library/react');
const { BrandMetadata, BrandLogo } = require('./brand-logo.component');
let mockBranding: any;
jest.mock('@gitroom/frontend/hooks/use-branding.hook', () => ({
  useBranding: () => ({ data: mockBranding }),
}));
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
describe('platform browser metadata', () => {
  beforeEach(() => {
    document.head.innerHTML =
      '<title>Robô MultiPost Settings</title><link rel="icon" type="image/x-icon" href="/favicon.ico">';
    mockBranding = {
      name: 'Custom Brand',
      logoUrl: 'https://example.com/logo.webp',
    };
  });
  afterEach(cleanup);
  it('uses saved name and icon and retains them when Next changes metadata', async () => {
    render(React.createElement(BrandMetadata));
    expect(document.title).toBe('Custom Brand Settings');
    expect(
      document.querySelector('link[rel="icon"]')?.getAttribute('href')
    ).toBe(mockBranding.logoUrl);
    expect(
      document.querySelector('link[rel="icon"]')?.hasAttribute('type')
    ).toBe(false);
    document.title = 'Automations';
    await flush();
    expect(document.title).toBe('Custom Brand Automations');
    document.title = 'Postiz Report';
    await flush();
    expect(document.title).toBe('Custom Brand Report');
  });
  it('keeps the official Mali M when the instance has a wide logo configured', async () => {
    mockBranding = {
      name: 'Mali Posts',
      logoUrl: 'https://example.com/wide.webp',
    };
    render(React.createElement(BrandMetadata));
    expect(
      document.querySelector('link[rel="icon"]')?.getAttribute('href')
    ).toBe('/branding/mali-icon.svg');
    document
      .querySelector('link[rel="icon"]')
      ?.setAttribute('href', '/favicon.ico');
    await flush();
    expect(
      document.querySelector('link[rel="icon"]')?.getAttribute('href')
    ).toBe('/branding/mali-icon.svg');
  });
  it('uses local Mali assets by default and preserves a custom wordmark', () => {
    mockBranding = undefined;
    const view = render(
      React.createElement(BrandLogo, { children: 'fallback' })
    );
    expect(view.getByRole('img').getAttribute('src')).toBe(
      '/branding/mali-logo.webp'
    );
    mockBranding = { name: 'Mali Posts', logoUrl: 'https://example.com/custom.webp' };
    view.rerender(React.createElement(BrandLogo, { children: 'fallback' }));
    expect(view.getByRole('img').getAttribute('src')).toBe(mockBranding.logoUrl);
    view.rerender(
      React.createElement(BrandLogo, { children: 'fallback', compact: true })
    );
    expect(view.getByRole('img').getAttribute('src')).toBe(
      '/branding/mali-icon.svg'
    );
    mockBranding = {
      name: 'Custom Brand',
      logoUrl: 'https://example.com/custom.svg',
    };
    view.rerender(
      React.createElement(BrandLogo, { children: 'fallback', compact: true })
    );
    expect(view.getByRole('img').getAttribute('src')).toBe(
      mockBranding.logoUrl
    );
  });
  it('updates saved branding and restores the default favicon without duplicating names', () => {
    const view = render(React.createElement(BrandMetadata));
    mockBranding = { name: 'New Brand', logoUrl: null };
    view.rerender(React.createElement(BrandMetadata));
    expect(document.title).toBe('New Brand Settings');
    expect(
      document.querySelector('link[rel="icon"]')?.getAttribute('href')
    ).toBe('/branding/mali-icon.svg');
  });
  it('keeps existing metadata while the branding request is unavailable', () => {
    mockBranding = undefined;
    render(React.createElement(BrandMetadata));
    expect(document.title).toBe('Robô MultiPost Settings');
  });
  it('creates an icon when missing and does not interpret the brand as HTML', () => {
    document.head.innerHTML = '<title>Gitroom Login</title>';
    mockBranding = { name: '<Mali>', logoUrl: null };
    render(React.createElement(BrandMetadata));
    expect(document.title).toBe('<Mali> Login');
    expect(document.head.querySelector('mali')).toBeNull();
    expect(document.querySelector('link[rel="icon"]')).not.toBeNull();
  });
});
