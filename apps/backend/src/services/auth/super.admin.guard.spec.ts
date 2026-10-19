jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
import { SuperAdminGuard } from './super.admin.guard';

describe('SuperAdminGuard - escopo de credencial', () => {
  const context = (request: unknown) => ({ switchToHttp: () => ({ getRequest: () => request }) }) as any;
  it('recusa chave de perfil mesmo que a organizacao seja da instancia admin', async () => {
    const service = { canUseSuperAdminApi: jest.fn().mockResolvedValue(true) };
    const guard = new SuperAdminGuard(service as any);
    await expect(guard.canActivate(context({ org: { id: 'admin-org' }, publicApiProfileId: 'profile-1' }))).rejects.toMatchObject({ status: 403 });
    expect(service.canUseSuperAdminApi).not.toHaveBeenCalled();
  });
  it('mantem a consulta de permissao para chave da organizacao', async () => {
    const service = { canUseSuperAdminApi: jest.fn().mockResolvedValue(true) };
    const guard = new SuperAdminGuard(service as any);
    await expect(guard.canActivate(context({ org: { id: 'admin-org' } }))).resolves.toBe(true);
  });
});
