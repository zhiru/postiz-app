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
