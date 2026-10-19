import { applyTrackCookies } from './track.cookies';

describe('conversion cookies', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://social.example.com';
    delete process.env.NOT_SECURED;
  });
  afterEach(() => {
    process.env = { ...original };
  });
  it('retains the identity of repeated clicks and an existing browser cookie', () => {
    const cookie = jest.fn();
    const result = applyTrackCookies(
      {
        cookies: {
          track: 'visitor',
          _fbc: 'fb.1.1.click',
          _fbp: 'fb.1.1.browser',
        },
      } as any,
      { cookie } as any,
      'click'
    );
    expect(result).toEqual({
      uniqueId: 'visitor',
      fbc: 'fb.1.1.click',
      fbp: 'fb.1.1.browser',
    });
    expect(cookie).not.toHaveBeenCalled();
  });
  it('keeps HTTPS security and the visitor cookie HttpOnly on a new click', () => {
    const cookie = jest.fn();
    const result = applyTrackCookies(
      { cookies: {} } as any,
      { cookie } as any,
      'new-click'
    );
    expect(result.fbc).toMatch(/^fb\.1\.\d+\.new-click$/);
    expect(cookie).toHaveBeenCalledWith(
      'track',
      expect.any(String),
      expect.objectContaining({
        secure: true,
        httpOnly: true,
        sameSite: 'none',
      })
    );
    expect(cookie).toHaveBeenCalledWith(
      '_fbc',
      result.fbc,
      expect.objectContaining({ secure: true, httpOnly: false })
    );
  });
});
