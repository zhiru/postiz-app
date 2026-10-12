// Run: npx tsx --test apps/backend/src/api/routes/social.comments.controller.spec.ts
//
// POST /social-comments/auto-reply used to have no @CheckPolicies, so any
// org member (role USER) could turn on auto-reply and have automated
// comment replies go out to the social networks unattended. The fix gates
// it behind the same admin policy settings.controller.ts uses for org
// settings. This pins the metadata PoliciesGuard reads, and that the
// read-only/human-reply endpoints stay ungated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECK_POLICIES_KEY } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { SocialCommentsController } from './social.comments.controller.ts';

const policiesOf = (methodName: keyof SocialCommentsController) =>
  Reflect.getMetadata(
    CHECK_POLICIES_KEY,
    SocialCommentsController.prototype[methodName]
  );

test('setAutoReply requires the admin policy', () => {
  assert.deepEqual(policiesOf('setAutoReply'), [
    [AuthorizationActions.Create, Sections.ADMIN],
  ]);
});

test('reading comments and auto-reply status stays open to any org member', () => {
  assert.equal(policiesOf('getComments'), undefined);
  assert.equal(policiesOf('getAutoReply'), undefined);
  assert.equal(policiesOf('getComment'), undefined);
});

test('a human-typed reply stays open to any org member', () => {
  assert.equal(policiesOf('reply'), undefined);
});
