jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {}, socialIntegrationList: [] }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
import { AnalyticsReportService } from './analytics.report.service';
import { AnalyticsReportRepository } from './analytics.report.repository';
import { IntegrationService } from '../integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { createMock } from '@gitroom/nestjs-libraries/test';

describe('AnalyticsReport - isolamento por perfil', () => {
  it('filtra canais antes de carregar dados atuais e comparativos', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new AnalyticsReportRepository({} as any, { model: { integration: { findMany } } } as any, {} as any);
    await repository.getChannels('org-1', ['canal-outro-perfil'], 'profile-1');
    expect(findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({ organizationId: 'org-1', profileId: 'profile-1', id: { in: ['canal-outro-perfil'] } }));
  });
  it('recusa backfill de canal de outro perfil sem consultar o provider', async () => {
    const repository = createMock<AnalyticsReportRepository>();
    const integrations = createMock<IntegrationService>();
    const manager = createMock<IntegrationManager>();
    integrations.getIntegrationById.mockResolvedValue({ id: 'channel-2', profileId: 'profile-2' } as any);
    const service = new AnalyticsReportService(repository, integrations, manager);
    await expect(service.backfill({ id: 'org-1' } as any, 'channel-2', 30, 'profile-1')).rejects.toThrow('Invalid integration');
    expect(manager.getSocialIntegration).not.toHaveBeenCalled();
    expect(repository.savePoints).not.toHaveBeenCalled();
  });
});
