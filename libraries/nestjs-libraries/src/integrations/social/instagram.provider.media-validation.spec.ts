import { InstagramProvider } from './instagram.provider';
describe('Instagram media validation', () => {
  const provider = new InstagramProvider();
  it('rejects carousel stories and story collaborators', async () => {
    expect(
      await provider.checkValidity([[{ path: 'a.jpg' }, { path: 'b.jpg' }]], {
        post_type: 'story',
      })
    ).toMatch(/one/i);
    expect(
      await provider.checkValidity([[{ path: 'a.jpg' }]], {
        post_type: 'story',
        collaborators: [{ label: '@pessoa' }],
      })
    ).toMatch(/collaborator/i);
  });
  it('validates measured feed image dimensions without modifying content', async () => {
    expect(
      await provider.checkValidity(
        [
          [
            {
              path: 'a.jpg',
              width: 1080,
              height: 1350,
              content_type: 'image/jpeg',
            },
          ],
        ],
        { post_type: 'post' }
      )
    ).toBe(true);
    expect(
      await provider.checkValidity(
        [
          [
            {
              path: 'a.jpg',
              width: 1080,
              height: 1920,
              content_type: 'image/jpeg',
            },
          ],
        ],
        { post_type: 'post' }
      )
    ).toMatch(/ratio/i);
  });
});

it('checks measured video dimensions, codec and unsupported media formats', async () => {
  const provider = new InstagramProvider();
  expect(
    await provider.checkValidity(
      [
        [
          {
            path: 'a.mp4',
            content_type: 'video/mp4',
            width: 2000,
            height: 1080,
          },
        ],
      ],
      { post_type: 'post' }
    )
  ).toMatch(/1920/);
  expect(
    await provider.checkValidity(
      [
        [
          {
            path: 'a.mp4',
            content_type: 'video/mp4',
            width: 1080,
            height: 1920,
            video_codec: 'mpeg4',
          },
        ],
      ],
      { post_type: 'post' }
    )
  ).toMatch(/H.264/);
  expect(
    await provider.checkValidity(
      [[{ path: 'a.gif', content_type: 'image/gif' }]],
      { post_type: 'story' }
    )
  ).toMatch(/JPEG/);
});
