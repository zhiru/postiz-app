import { ALLOW_VIEWER_KEY } from '@gitroom/nestjs-libraries/services/auth/profile-access/profile-access.decorators';
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service',
  () => ({ SocialCommentsService: class {} })
);
// Run: npx tsx --test apps/backend/src/api/routes/social.comments.controller.spec.ts
//
// POST /social-comments/auto-reply used to have no @CheckPolicies, so any
// org member (role USER) could turn on auto-reply and have automated
// comment replies go out to the social networks unattended. The fix gates
// it behind the same admin policy settings.controller.ts uses for org
// settings. This pins the metadata PoliciesGuard reads, and that the
// read-only/human-reply endpoints stay ungated.
import { CHECK_POLICIES_KEY } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { SocialCommentsController } from './social.comments.controller';

const policiesOf = (methodName: keyof SocialCommentsController) =>
  Reflect.getMetadata(
    CHECK_POLICIES_KEY,
    SocialCommentsController.prototype[methodName]
  );

it('setAutoReply requires the admin policy', () => {
  expect(policiesOf('setAutoReply')).toEqual([
    [AuthorizationActions.Create, Sections.ADMIN],
  ]);
});

it('reading comments and auto-reply status stays open to any org member', () => {
  expect(policiesOf('getComments')).toBeUndefined();
  expect(policiesOf('getAutoReply')).toBeUndefined();
  expect(policiesOf('getComment')).toBeUndefined();
});

it('a human-typed reply stays open to any org member', () => {
  expect(policiesOf('reply')).toBeUndefined();
});

it('propaga perfil autenticado ao responder, sem aceitar escopo do payload', async () => {
  const service = { reply: jest.fn().mockResolvedValue({ status: 'REPLIED' }) };
  const controller = new SocialCommentsController(service as any);
  await controller.reply(
    { id: 'org-1' } as any,
    { id: 'profile-1' } as any,
    'comment-1',
    { message: 'Obrigado' }
  );
  expect(service.reply).toHaveBeenCalledWith(
    'org-1',
    'comment-1',
    'Obrigado',
    'human',
    'profile-1'
  );
});

it('scopes post refresh and cached data to the authenticated organization/profile', async () => {
  const service = { refreshPost: jest.fn(), getPostData: jest.fn() };
  const controller = new SocialCommentsController(service as any);
  await controller.refreshPost(
    { id: 'org-1' } as any,
    { id: 'profile-1' } as any,
    'post-1'
  );
  await controller.getPostData(
    { id: 'org-1' } as any,
    { id: 'profile-1' } as any,
    'post-1'
  );
  expect(service.refreshPost).toHaveBeenCalledWith(
    'org-1',
    'post-1',
    'profile-1'
  );
  expect(service.getPostData).toHaveBeenCalledWith(
    'org-1',
    'post-1',
    'profile-1'
  );
});

it('allows viewers to refresh only their scoped post data without granting reply permissions', () => {
  expect(
    Reflect.getMetadata(
      ALLOW_VIEWER_KEY,
      SocialCommentsController.prototype.refreshPost
    )
  ).toBe(true);
  expect(
    Reflect.getMetadata(
      ALLOW_VIEWER_KEY,
      SocialCommentsController.prototype.reply
    )
  ).toBeUndefined();
});
