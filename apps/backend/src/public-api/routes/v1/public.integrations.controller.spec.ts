jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({ RefreshIntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({ MediaService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service', () => ({ AdminStatsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service', () => ({ ClippingService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/analytics/analytics.report.service', () => ({ AnalyticsReportService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service', () => ({ SocialCommentsService: class {} }));
import 'reflect-metadata';
import { BadRequestException, HttpException } from '@nestjs/common';
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: jest.fn(), socialIntegrationList: [] }));
jest.mock('@gitroom/nestjs-libraries/upload/multer.stream.engine', () => ({ streamUploadOptions: () => ({}) }));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({ UploadFactory: { createStorage: () => ({}) } }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({ ioRedis: { set: jest.fn(), get: jest.fn() } }));
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));
import { PublicIntegrationsController } from './public.integrations.controller';

const build = () => {
  const integrations = { getIntegrationsList: jest.fn().mockResolvedValue([]), validateIntegrationProfile: jest.fn() };
  const media = { saveFile: jest.fn().mockResolvedValue({ id: 'media-1' }), uploadFromUrl: jest.fn().mockResolvedValue({ id: 'media-2' }) };
  const comments = { getComments: jest.fn(), reply: jest.fn() };
  const controller = new PublicIntegrationsController(integrations as any, {} as any, media as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, comments as any);
  return { controller, integrations, media, comments };
};

describe('PublicIntegrationsController - limites de credencial', () => {
  it('chave de perfil lista somente o perfil autenticado', async () => {
    const { controller, integrations } = build();
    await controller.listIntegration({ id: 'org-1' } as any, 'profile-1');
    expect(integrations.getIntegrationsList).toHaveBeenCalledWith('org-1', 'profile-1');
  });
  it('recusa query de outro perfil antes de ler canais', async () => {
    const { controller, integrations } = build();
    await expect(controller.listIntegration({ id: 'org-1' } as any, 'profile-1', 'profile-2')).rejects.toBeInstanceOf(HttpException);
    expect(integrations.getIntegrationsList).not.toHaveBeenCalled();
  });
  it('mantem chave da organizacao e filtro por grupo', async () => {
    const { controller, integrations } = build();
    integrations.getIntegrationsList.mockResolvedValue([{ id: 'i-1', name: 'Perfil', customer: { id: 'g-1', name: 'Marca' } }] as any);
    const result = await controller.listIntegration({ id: 'org-1' } as any, undefined, undefined, 'g-1');
    expect(result).toHaveLength(1);
  });
  it('vincula upload ja validado por streaming ao perfil da chave', async () => {
    const { controller, media } = build();
    await controller.uploadSimple({ id: 'org-1' } as any, 'profile-1', { filename: 'safe.jpg', originalname: 'Foto.jpg', path: '/uploads/safe.jpg' } as any);
    expect(media.saveFile).toHaveBeenCalledWith('org-1', 'safe.jpg', '/uploads/safe.jpg', 'Foto.jpg', 'profile-1');
  });
  it('delega download seguro com o perfil e conserva erros de validacao', async () => {
    const { controller, media } = build();
    await controller.uploadsFromUrl({ id: 'org-1' } as any, 'profile-1', { url: 'https://cdn.example.com/foto.jpg' });
    expect(media.uploadFromUrl).toHaveBeenCalledWith('org-1', 'https://cdn.example.com/foto.jpg', 'profile-1');
    media.uploadFromUrl.mockRejectedValue(new BadRequestException('Unsupported file type.'));
    await expect(controller.uploadsFromUrl({ id: 'org-1' } as any, 'profile-1', { url: 'https://cdn.example.com/foto.svg' })).rejects.toThrow(HttpException);
  });
  it('respostas automatizadas propagam o perfil e exigem aprovacao no service', async () => {
    const { controller, comments } = build();
    await controller.replyToComment({ id: 'org-1' } as any, 'profile-1', 'comment-1', { message: 'Obrigado' });
    expect(comments.reply).toHaveBeenCalledWith('org-1', 'comment-1', 'Obrigado', 'automation', 'profile-1');
  });
  it('clipping recusa chave de perfil antes de criar trabalho', () => {
    const { controller } = build();
    expect(() => controller.startClipping({ id: 'org-1' } as any, 'profile-1', {} as any)).toThrow(HttpException);
  });
});
