import { sanitizePostContent } from '@gitroom/helpers/utils/sanitize.post.content';
describe('unsupported post block rewrite', () => {
  it('preserves paragraph boundaries and blank lines before the sanitizer', () => {
    expect(
      sanitizePostContent(
        '<div>First</div><section>Second</section><p></p><blockquote>Third</blockquote>'
      )
    ).toBe('<p>First</p><p>Second</p><p></p><p>Third</p>');
  });
  it('keeps malformed nested opens bounded without consuming adjacent tags', () => {
    const input = '<div'.repeat(10000);
    expect(sanitizePostContent(input)).toBe(input);
    expect(sanitizePostContent('<div broken <section>Text</section>')).toBe(
      '<div broken <p>Text</p>'
    );
  });
});
