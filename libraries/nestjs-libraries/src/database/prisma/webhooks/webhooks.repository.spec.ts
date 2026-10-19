jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
import { WebhooksRepository } from './webhooks.repository';

describe('Webhooks - limites do perfil', () => {
  it('rotacao de segredo usa perfil e devolve somente o segredo novo', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'hook-1' });
    const repository = new WebhooksRepository({ model: { webhooks: { update } } } as any, {} as any);
    const result = await repository.rotateSecret('org-1', 'hook-1', 'profile-1');
    expect(update.mock.calls[0][0].where).toEqual({ id: 'hook-1', organizationId: 'org-1', profileId: 'profile-1' });
    expect(update.mock.calls[0][0].select).toEqual({ id: true });
    expect(Object.keys(result)).toEqual(['secret']);
  });
  it('historico de entregas nao permite consultar webhook de outro perfil', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new WebhooksRepository({} as any, { model: { webhookDeliveries: { findMany } } } as any);
    await repository.getDeliveries('org-1', 'hook-2', 'profile-1');
    expect(findMany.mock.calls[0][0].where.webhook).toEqual({ organizationId: 'org-1', profileId: 'profile-1' });
  });
  it('dispatch inclui somente webhooks globais ou do perfil dono do canal', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new WebhooksRepository({ model: { webhooks: { findMany } } } as any, {} as any);
    await repository.getWebhooksForDispatch('org-1', 'channel-1');
    expect(findMany.mock.calls[0][0].where.OR).toEqual([{ profileId: null }, { profile: { integrations: { some: { id: 'channel-1' } } } }]);
  });
});
