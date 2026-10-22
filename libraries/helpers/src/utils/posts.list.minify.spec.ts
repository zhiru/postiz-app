import { isVideo } from './has.extension';
import { getPostFormat } from './posts.list.minify';

describe('getPostFormat', () => {
  it('distinguishes stories from short videos and feed posts without platform branches', () => {
    expect(
      getPostFormat({
        settings: '{"post_type":"story"}',
        image: '[{"path":"clip.mp4"}]',
      })
    ).toBe('story');
    expect(getPostFormat({ image: '[{"path":"clip.mp4?download=1"}]' })).toBe(
      'video'
    );
    expect(
      getPostFormat({ image: '[{"path":"a.png"},{"path":"clip.mp4"}]' })
    ).toBe('carousel');
    expect(getPostFormat({ image: '[{"path":"a.png"}]' })).toBe('post');
  });

  it('recognizes imported stories and reels without attachments and tolerates legacy JSON', () => {
    expect(
      getPostFormat({ releaseURL: 'https://example.com/stories/account/123/' })
    ).toBe('story');
    expect(
      getPostFormat({
        releaseURL: 'https://example.com/reel/123/',
        settings: '{}',
      })
    ).toBe('video');
    expect(getPostFormat({ settings: 'broken', image: 'broken' })).toBe('post');
    expect(getPostFormat({ settings: 'null', image: 'null' })).toBe('post');
  });
});

describe('media video classification', () => {
  it.each(['clip.mp4', 'clip.MOV', 'clip.webm?download=1', 'clip.m4v#preview'])(
    'recognizes %s for both filters and previews',
    (path) => {
      expect(isVideo(path)).toBe(true);
      expect(getPostFormat({ image: JSON.stringify([{ path }]) })).toBe(
        'video'
      );
    }
  );
  it('does not mistake a name or query string for a video extension', () => {
    expect(isVideo('clip.mp4.jpg')).toBe(false);
    expect(isVideo('image.jpg?name=clip.mp4')).toBe(false);
  });
});
