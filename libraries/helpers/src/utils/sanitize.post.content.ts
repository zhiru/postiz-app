import DOMPurify from 'isomorphic-dompurify';
import { parseFragment, serialize } from 'parse5';

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'u',
  'a',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'span',
  'img',
];

const ALLOWED_ATTR = [
  'dir',
  'href',
  'target',
  'rel',
  'class',
  'data-mention-id',
  'data-mention-label',
  'src',
  'alt',
];

// <img> keeps data: URIs whatever ALLOWED_URI_REGEXP says, so a picture
// that doesn't point to a real file is dropped
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (
    data.tagName === 'img' &&
    !/^https?:\/\//i.test((node as Element).getAttribute('src') || '')
  ) {
    node.parentNode?.removeChild(node);
  }
});

export const sanitizePostContent = (value: unknown): string => {
  if (typeof value !== 'string' || !value) {
    return '';
  }

  // a block tag the editor doesn't know would be dropped with its text kept,
  // gluing its line to the next one
  const paragraphs = value.replace(
    /<(\/?)(div|section|article|blockquote|pre|h[4-6])\b[^<>]*>/gi,
    '<$1p>'
  );

  return DOMPurify.sanitize(paragraphs, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/|#)/i,
  });
};

// The plain text a reviewer sees for a post item: the text nodes of the
// sanitised HTML, in order, entities decoded. This is what anchor offsets
// index into on both the frontend (element.textContent) and the backend.
export const postContentPlainText = (value: unknown): string => {
  const walk = (nodes: any[]): string =>
    nodes
      .map((node) =>
        node.nodeName === '#text' ? node.value : walk(node.childNodes || [])
      )
      .join('');

  return walk(parseFragment(sanitizePostContent(value)).childNodes as any[]);
};

// Plain captions must become editor paragraphs without treating literal text as HTML.
export const postContentToHtml = (value: string): string => {
  const fragment = parseFragment(value);
  if (fragment.childNodes.some((node: any) => node.tagName)) {
    return sanitizePostContent(value);
  }
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(
      (line) =>
        `<p>${line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</p>`
    )
    .join('');
};

// Unlike anchor offsets, a caption's plain representation includes block breaks.
export const captionText = (value: string): string => {
  const walk = (node: any): string => {
    if (node.nodeName === '#text') return node.value;
    if (node.tagName === 'br') return '\n';
    return (
      (node.childNodes || []).map(walk).join('') +
      (['p', 'li', 'h1', 'h2', 'h3'].includes(node.tagName) ? '\n' : '')
    );
  };
  return walk(parseFragment(postContentToHtml(value))).replace(/\n$/, '');
};

export const normalizeCaptionSpacing = (value: string): string => {
  const html = postContentToHtml(value);
  const fragment = parseFragment(html);
  const blocks: { html: string; text: string }[] = [];
  let inline: any[] = [];
  const add = (nodes: any[], wrap = false) => {
    const serialized = serialize({
      nodeName: '#document-fragment',
      childNodes: nodes,
    });
    const block = wrap ? `<p>${serialized}</p>` : serialized;
    const text = captionText(block);
    if (text.trim()) blocks.push({ html: block, text: text.trim() });
  };
  const splitLines = (nodes: any[]): any[][] => {
    const lines: any[][] = [[]];
    for (const node of nodes) {
      const parts =
        node.tagName === 'br'
          ? [[], []]
          : node.childNodes
          ? splitLines(node.childNodes).map((children) => [
              { ...node, childNodes: children },
            ])
          : [[node]];
      lines[lines.length - 1].push(...parts[0]);
      lines.push(...parts.slice(1));
    }
    return lines;
  };
  const addParagraph = (node: any) => {
    let children: any[] = [];
    const flush = () => {
      if (children.length) add([{ ...node, childNodes: children }]);
      children = [];
    };
    for (const line of splitLines(node.childNodes || [])) {
      const text = captionText(
        serialize({ nodeName: '#document-fragment', childNodes: line })
      );
      if (!text.trim()) {
        flush();
        continue;
      }
      if (children.length)
        children.push({
          nodeName: 'br',
          tagName: 'br',
          attrs: [],
          childNodes: [],
          namespaceURI: 'http://www.w3.org/1999/xhtml',
        });
      children.push(...line);
    }
    flush();
  };
  for (const node of fragment.childNodes as any[]) {
    if (['p', 'ul', 'ol', 'h1', 'h2', 'h3'].includes(node.tagName)) {
      if (inline.length) {
        add(inline, true);
        inline = [];
      }
      if (['p', 'h1', 'h2', 'h3'].includes(node.tagName)) addParagraph(node);
      else add([node]);
    } else inline.push(node);
  }
  if (inline.length) add(inline, true);
  const kind = (text: string) =>
    /^(?:📅|📆|🗓|📍|⏰|🕐)/u.test(text)
      ? 'event'
      : /^(?:📌|✅|✔|☑|🔹|🔸|[-•▪]|\d+[.)])\s*/u.test(text)
      ? 'list'
      : /^#/u.test(text)
      ? 'hashtags'
      : '';
  return blocks
    .map((block, i) => {
      const sameGroup =
        i && kind(block.text) && kind(block.text) === kind(blocks[i - 1].text);
      return (i && !sameGroup ? '<p></p>' : '') + block.html;
    })
    .join('');
};
