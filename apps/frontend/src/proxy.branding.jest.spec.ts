import { NextRequest } from 'next/server';
import { proxy } from './proxy';

const request = (pathname: string) =>
  new NextRequest(new URL(pathname, 'https://posts.example.com'));

test.each(['icon.svg', 'logo.webp', 'apple-touch-icon.png'])(
  'serves the Mali %s asset before sign-in',
  async (file) => {
    const response = await proxy(request(`/branding/mali-${file}`));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  }
);

test.each(['/settings', '/branding/private.svg', '/branding/mali-icon.svg/other'])(
  'preserves the sign-in redirect for %s',
  async (pathname) => {
    const response = await proxy(request(pathname));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/auth');
  }
);
