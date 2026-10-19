import { DeletePostTool } from './delete.post.tool';

jest.mock('@mastra/core/tools', () => ({ createTool: (tool: unknown) => tool }));
jest.mock('@gitroom/nestjs-libraries/chat/auth.context', () => ({ checkAuth: jest.fn() }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {},
}));

describe('DeletePostTool after upstream integration', () => {
  const context = { requestContext: { get: () => JSON.stringify({ id: 'org-a' }) } };
  const makeTool = () => {
    const posts = { getPostById: jest.fn(), deletePost: jest.fn() };
    const tool = new DeletePostTool(posts as any).run() as any;
    return { posts, execute: () => tool.execute({ id: 'post-a' }, context) };
  };

  it('preserves the existing output contract and scopes lookup/deletion to the organization', async () => {
    const { posts, execute } = makeTool();
    posts.getPostById.mockResolvedValue({ id: 'post-a', group: 'thread-a' });
    await expect(execute()).resolves.toEqual({ output: { id: 'post-a' } });
    expect(posts.getPostById).toHaveBeenCalledWith('post-a', 'org-a');
    expect(posts.deletePost).toHaveBeenCalledWith('org-a', 'thread-a');
  });

  it('does not delete a whole thread when the supplied id belongs to a comment', async () => {
    const { posts, execute } = makeTool();
    posts.getPostById.mockResolvedValue({ group: 'thread-a', parentPostId: 'parent-a' });
    await expect(execute()).resolves.toEqual({ output: { errors: expect.stringContaining('main post') } });
    expect(posts.deletePost).not.toHaveBeenCalled();
  });

  it('does not delete when the scoped post is absent', async () => {
    const { posts, execute } = makeTool();
    posts.getPostById.mockResolvedValue(null);
    await expect(execute()).resolves.toEqual({ output: { errors: 'Post not found' } });
    expect(posts.deletePost).not.toHaveBeenCalled();
  });

  it('keeps internal deletion failures out of the tool response', async () => {
    const { posts, execute } = makeTool();
    posts.getPostById.mockResolvedValue({ group: 'thread-a' });
    posts.deletePost.mockRejectedValue(new Error('private database details'));
    await expect(execute()).resolves.toEqual({ output: { errors: 'Post not found or failed to delete' } });
  });
});
