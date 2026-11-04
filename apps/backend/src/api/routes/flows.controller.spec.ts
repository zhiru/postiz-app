import 'reflect-metadata';

jest.mock('@gitroom/nestjs-libraries/database/prisma/flows/flows.service', () => ({
  FlowsService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/credentials/credential.service', () => ({
  CredentialService: class {},
}));

import { FlowsController } from './flows.controller';
import { FlowsService } from '@gitroom/nestjs-libraries/database/prisma/flows/flows.service';
import { CredentialService } from '@gitroom/nestjs-libraries/database/prisma/credentials/credential.service';
import { createMock } from '@gitroom/nestjs-libraries/test';

describe('FlowsController Instagram media profile scope', () => {
  const org = { id: 'org-1' } as any;
  const profile = { id: 'profile-1' } as any;

  it('passes the selected profile and pagination to post reads', async () => {
    const flows = createMock<FlowsService>();
    const controller = new FlowsController(flows, createMock<CredentialService>());

    await controller.getIntegrationPosts(org, profile, 'channel', 'cursor', '50');

    expect(flows.getInstagramPostsByIntegration).toHaveBeenCalledWith(
      'org-1', 'channel', 'cursor', 50, 'profile-1'
    );
  });

  it('keeps the default page size for organization admin reads', async () => {
    const flows = createMock<FlowsService>();
    const controller = new FlowsController(flows, createMock<CredentialService>());

    await controller.getIntegrationPosts(org, null, 'channel');

    expect(flows.getInstagramPostsByIntegration).toHaveBeenCalledWith(
      'org-1', 'channel', undefined, 25, undefined
    );
  });

  it('passes the selected profile to story reads', async () => {
    const flows = createMock<FlowsService>();
    const controller = new FlowsController(flows, createMock<CredentialService>());

    await controller.getIntegrationStories(org, profile, 'channel');

    expect(flows.getInstagramStoriesByIntegration).toHaveBeenCalledWith(
      'org-1', 'channel', 'profile-1'
    );
  });
});

describe('FlowsController execution listing compatibility', () => {
  const org = { id: 'org-1' } as any;
  const profile = { id: 'profile-1' } as any;

  it('scopes redispatch preview and explicit confirmation to the organization, flow and selected profile', async () => {
    const flows = createMock<FlowsService>();
    const controller = new FlowsController(flows, createMock<CredentialService>());
    const body = { confirmed: true, configurationToken: 'a'.repeat(64) };
    await controller.previewRedispatch(org, profile, 'flow-1', 'exec-1');
    await controller.redispatchExecution(org, profile, 'flow-1', 'exec-1', body);
    expect(flows.previewRedispatch).toHaveBeenCalledWith('org-1', 'flow-1', 'exec-1', 'profile-1');
    expect(flows.redispatchExecution).toHaveBeenCalledWith('org-1', 'flow-1', 'exec-1', body, 'profile-1');
  });

  it('retains the array response for existing callers', async () => {
    const flows = createMock<FlowsService>();
    flows.getExecutions.mockResolvedValue([{ id: 'exec-1' }] as any);
    const controller = new FlowsController(flows, createMock<CredentialService>());
    await expect(controller.getExecutions(org, profile, 'flow-1', { page: 2, limit: 20 }))
      .resolves.toEqual([{ id: 'exec-1' }]);
    expect(flows.getExecutions).toHaveBeenCalledWith('org-1', 'flow-1', 2, 20, 'profile-1');
    expect(flows.getExecutionsPage).not.toHaveBeenCalled();
  });

  it('returns the paginated response only when explicitly requested', async () => {
    const flows = createMock<FlowsService>();
    const result = { items: [] as never[], total: 0 };
    flows.getExecutionsPage.mockResolvedValue(result);
    const controller = new FlowsController(flows, createMock<CredentialService>());
    const query = { paginated: 'true' as const, page: 2, limit: 10, search: 'Ana' };
    await expect(controller.getExecutions(org, profile, 'flow-1', query)).resolves.toEqual(result);
    expect(flows.getExecutionsPage).toHaveBeenCalledWith('org-1', 'flow-1', query, 'profile-1');
    expect(flows.getExecutions).not.toHaveBeenCalled();
  });
});
