import {
  normalizeCaptionSpacing,
  captionText,
} from '@gitroom/helpers/utils/sanitize.post.content';
describe('caption spacing', () => {
  it('groups date/location and lists without rewriting text', () => {
    const html =
      '<p>Olá @pessoa! 💙</p><p>📌 Um</p><p>📌 Dois</p><p>📅 Dia 10</p><p>📍 Local</p><p>#evento #aqui</p>';
    const result = normalizeCaptionSpacing(html);
    expect(captionText(result)).toBe(
      'Olá @pessoa! 💙\n\n📌 Um\n📌 Dois\n\n📅 Dia 10\n📍 Local\n\n#evento #aqui'
    );
    expect(captionText(result).replace(/\s/g, '')).toBe(
      captionText(html).replace(/\s/g, '')
    );
    expect(normalizeCaptionSpacing(result)).toBe(result);
  });
  it('keeps inline HTML in one paragraph', () => {
    const result = normalizeCaptionSpacing('Olá <strong>mundo</strong>!');
    expect(captionText(result)).toBe('Olá mundo!');
  });
  it('preserves mention HTML, rich lists and escaped literal text', () => {
    const html =
      '<p><span data-mention-id="1">@nome</span></p><ul><li>Um</li><li>Dois</li></ul><p>Fim</p>';
    const result = normalizeCaptionSpacing(html);
    expect(result).toContain('data-mention-id="1"');
    expect(result).toContain('<ul><li>Um</li><li>Dois</li></ul>');
    expect(normalizeCaptionSpacing('Uma < duas\nOutra')).toContain('&lt;');
  });
});

it('normalizes HTML break runs and keeps event lines together without losing inline formatting', () => {
  expect(captionText(normalizeCaptionSpacing('<p>A<br><br><br>B</p>'))).toBe(
    'A\n\nB'
  );
  expect(
    captionText(normalizeCaptionSpacing('<p>📅 Data<br><br>📍 Local</p>'))
  ).toBe('📅 Data\n📍 Local');
  const result = normalizeCaptionSpacing('<p><strong>A<br><br>B</strong></p>');
  expect(result).toContain('<strong>A</strong>');
  expect(result).toContain('<strong>B</strong>');
  expect(captionText(result)).toBe('A\n\nB');
});
