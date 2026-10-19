jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {}, socialIntegrationList: [] }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service', () => ({ WebhooksService: class {} }));
import { SocialCommentsService } from './social.comments.service';
import { SocialCommentsRepository } from './social.comments.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { createMock } from '@gitroom/nestjs-libraries/test';

describe('SocialComments - isolamento e credenciais', () => {
  it('filtra comentarios pela integracao do perfil em listagem e leitura individual', async () => {
    const findMany = jest.fn().mockResolvedValue([]), findFirst = jest.fn().mockResolvedValue(null), count = jest.fn().mockResolvedValue(0);
    const repository = new SocialCommentsRepository({ model: { socialComments: { findMany, findFirst, count } } } as any, {} as any, {} as any);
    repository.getComments('org-1', {}, 'profile-1');
    repository.countComments('org-1', {}, 'profile-1');
    repository.getComment('org-1', 'comment-2', 'profile-1');
    for (const mock of [findMany, findFirst, count]) expect(mock.mock.calls[0][0].where).toEqual(expect.objectContaining({ organizationId: 'org-1', integration: { profileId: 'profile-1', organizationId: 'org-1', deletedAt: null } }));
  });
  it('nega resposta fora do perfil antes de enviar ou salvar sugestao', async () => {
    const repository = createMock<SocialCommentsRepository>();
    const manager = createMock<IntegrationManager>();
    repository.getComment.mockResolvedValue(undefined);
    const service = new SocialCommentsService(repository, manager, {} as any, {} as any);
    await expect(service.reply('org-1', 'comment-2', 'Resposta', 'human', 'profile-1')).rejects.toThrow('Comment not found');
    expect(repository.getComment).toHaveBeenCalledWith('org-1', 'comment-2', 'profile-1');
    expect(repository.saveSuggestion).not.toHaveBeenCalled();
    expect(manager.getSocialIntegration).not.toHaveBeenCalled();
  });
  it('retorna somente os campos publicos da integracao', async () => {
    const repository = createMock<SocialCommentsRepository>();
    repository.getComment.mockResolvedValue({ id: 'comment-1', integration: { id: 'channel-1', name: 'Canal', picture: null, providerIdentifier: 'instagram', token: 'NAO-EXPOR', additionalSettings: 'NAO-EXPOR', profileId: 'profile-1', organizationId: 'org-1' } } as any);
    const service = new SocialCommentsService(repository, {} as any, {} as any, {} as any);
    const result = await service.getComment('org-1', 'comment-1', 'profile-1');
    expect(result.integration).toEqual({ id: 'channel-1', name: 'Canal', picture: null, providerIdentifier: 'instagram' });
  });
});
