jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class {} })
);
import { UploadLinkTool } from '../upload.link.tool';
const context = (org?: string, profileId?: string) => ({
  requestContext: new Map([
    ['organization', JSON.stringify(org ? { id: org } : null)],
    ['profileId', profileId],
  ]),
});
describe('UploadLinkTool', () => {
  const service = {
    createUploadSession: jest.fn(),
    createUploadTicket: jest.fn(),
  };
  const previous = process.env.NEXT_PUBLIC_BACKEND_URL,
    override = process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL;
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://posts.example/api/';
    delete process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL;
    service.createUploadSession.mockResolvedValue('session-1');
    service.createUploadTicket.mockResolvedValue('ticket-private');
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BACKEND_URL;
    else process.env.NEXT_PUBLIC_BACKEND_URL = previous;
    if (override === undefined)
      delete process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL;
    else process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL = override;
  });
  it('creates a profile-scoped link using the existing upload route', async () => {
    const tool = new UploadLinkTool(service as any).run() as any;
    const result = await tool.execute({}, context('org-1', 'profile-1'));
    expect(service.createUploadSession).toHaveBeenCalledWith(
      'org-1',
      'profile-1'
    );
    expect(service.createUploadTicket).toHaveBeenCalledWith(
      'org-1',
      'session-1',
      'profile-1'
    );
    expect(result).toEqual({
      sessionId: 'session-1',
      uploadUrl: 'https://posts.example/api/media-widget/upload',
      uploadHeaders: { 'X-Postiz-Upload-Ticket': 'ticket-private' },
    });
    expect(tool.outputSchema.safeParse(result).success).toBe(true);
    expect(tool.inputSchema.safeParse({}).success).toBe(true);
    expect(tool.mcp.annotations.readOnlyHint).toBe(false);
  });
  it('uses the public backend override without losing its path', async () => {
    process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL =
      'https://relay.example/custom/api';
    const result = await (
      new UploadLinkTool(service as any).run() as any
    ).execute({}, context('org-1'));
    expect(result.uploadUrl).toBe(
      'https://relay.example/custom/api/media-widget/upload'
    );
  });
  it('does not issue a ticket without authenticated organization context', async () => {
    const result = await (
      new UploadLinkTool(service as any).run() as any
    ).execute({}, context());
    expect(result.error).toBeDefined();
    expect(service.createUploadSession).not.toHaveBeenCalled();
  });
  it.each(['not-a-url', 'file:///private'])(
    'rejects an invalid backend configuration before creating a session',
    async (url) => {
      process.env.NEXT_PUBLIC_BACKEND_URL = url;
      const result = await (
        new UploadLinkTool(service as any).run() as any
      ).execute({}, context('org-1'));
      expect(result.error).toBeDefined();
      expect(service.createUploadSession).not.toHaveBeenCalled();
    }
  );
  it('does not expose ticket/provider secrets on failure', async () => {
    service.createUploadTicket.mockRejectedValue(
      new Error('secret-private-credential')
    );
    const result = await (
      new UploadLinkTool(service as any).run() as any
    ).execute({}, context('org-1', 'profile-1'));
    expect(result.error).toBeDefined();
    expect(JSON.stringify(result)).not.toContain('secret-private');
  });
});
