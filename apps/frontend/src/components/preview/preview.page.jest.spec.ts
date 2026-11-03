export {};
const mockInternalFetch = jest.fn();
jest.mock('@gitroom/helpers/utils/internal.fetch', () => ({
  internalFetch: (...args: any[]) => mockInternalFetch(...args),
}));
jest.mock('@gitroom/helpers/utils/is.general.server.side', () => ({
  isGeneralServerSide: () => false,
}));
jest.mock('@gitroom/helpers/utils/sanitize.post.content', () => ({
  sanitizePostContent: (value: string) => value,
}));
jest.mock('@gitroom/react/translation/get.translation.service.backend', () => ({
  getT: async () => (_: string, fallback: string) => fallback,
}));
jest.mock('@gitroom/react/helpers/safe.image', () => ({
  __esModule: true,
  default: 'img',
}));
jest.mock('next/link', () => ({ __esModule: true, default: 'a' }));
jest.mock('./neuraltalk.recipients', () => ({
  NeuralTalkRecipients: 'private-recipients',
}));
jest.mock('./comments.components', () => ({
  CommentsComponents: 'internal-comments',
}));
jest.mock('./preview.comments.context', () => ({
  PreviewCommentsProvider: 'preview-provider',
}));
jest.mock('./post.content.client', () => ({
  PostContentClient: 'post-content',
}));
jest.mock('@gitroom/react/helpers/video.or.image', () => ({
  VideoOrImage: 'media-preview',
}));
jest.mock('./copy.client', () => ({ CopyClient: 'copy-link' }));
jest.mock('./render.preview.date.client', () => ({
  RenderPreviewDateClient: 'preview-date',
}));
jest.mock('./review.comments.components', () => ({
  ReviewCommentsComponents: 'review-comments',
}));
jest.mock(
  '@gitroom/frontend/components/launches/helpers/platform-icon.helper',
  () => ({ getPlatformIconPath: () => '/icon.png' })
);
jest.mock('@gitroom/frontend/components/ui/logo-text.component', () => ({
  LogoTextComponent: 'logo',
}));
jest.mock('./post.engagement', () => ({ PostEngagement: 'engagement' }));
jest.mock(
  '@gitroom/frontend/components/launches/creation.method.badge',
  () => ({ CreationMethodBadge: 'creation-badge' })
);
const {
  default: PreviewPage,
} = require('../../app/(app)/(preview)/p/[id]/page');

function elements(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object') return [];
  return [node, ...elements(node.props?.children)];
}

beforeEach(() => {
  mockInternalFetch.mockReset().mockImplementation(async (url: string) => ({
    json: async () =>
      url.includes('/review?')
        ? { valid: true, allowComment: true, allowApprove: true }
        : [
            {
              id: 'post',
              organizationId: 'org',
              state: 'PUBLISHED',
              content: 'hello',
              image: '[]',
              integration: { name: 'Inbox', providerIdentifier: 'neuraltalk' },
            },
          ],
  }));
});
it.each([
  [{}, false],
  [{ share: 'true' }, false],
  [{ private: 'true' }, true],
  [{ private: 'true', token: 'review-token' }, false],
  [{ token: 'review-token' }, false],
])(
  'only mounts the recipient panel in the internal preview: %j',
  async (searchParams, visible) => {
    const tree = await PreviewPage({
      params: Promise.resolve({ id: 'post' }),
      searchParams: Promise.resolve(searchParams),
    });
    const nodes = elements(tree);
    expect(nodes.some((node) => node.type === 'private-recipients')).toBe(
      visible
    );
    const review = nodes.find((node) => node.type === 'review-comments');
    expect(review.props.token).toBe((searchParams as any).token);
    if ((searchParams as any).token) {
      expect(mockInternalFetch).toHaveBeenCalledWith(
        '/public/posts/post/review?token=review-token'
      );
      expect(review.props.reviewInfo.valid).toBe(true);
      expect(nodes.some((node) => node.type === 'internal-comments')).toBe(
        false
      );
    }
  }
);
