import { Injectable, HttpException, BadRequestException } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentToolInterface } from '../agent.tool.interface';
import { checkAuth } from '../auth.context';
import { readRequestContext } from './tool.context.helper';
import { PostManagementService } from '@gitroom/nestjs-libraries/database/prisma/posts/post.management.service';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import {
  remoteDeletePostSchema,
  postStatusSchema,
  postDateSchema,
} from '@gitroom/nestjs-libraries/dtos/posts/manage.post.dto';

const idSchema = z.object({
  id: z.string().min(1),
  timeZone: z.string().optional(),
  commentsPage: z.number().int().min(1).max(100000).optional(),
});
const patchSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().datetime({ offset: true }),
    content: z.string().optional(),
    media: z
      .array(
        z.object({
          id: z.string().optional(),
          path: z.string().optional(),
          alt: z.string().optional(),
          thumbnail: z.string().nullable().optional(),
          thumbnailTimestamp: z.number().int().min(0).nullable().optional(),
        })
      )
      .optional(),
    settingsJson: z
      .string()
      .optional()
      .describe(
        'JSON object with only settings to change. collaborators:[{label:"@handle"}], or collaborators:[] to remove. A caption mention is never a collab invitation.'
      ),
    normalizeSpacing: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    previewHash: z.string().optional(),
  })
  .strict();
const parseJson = (value: string, field: string) => {
  try {
    return JSON.parse(value);
  } catch {
    throw new BadRequestException({
      code: 'INVALID_INPUT',
      errors: [{ field, message: 'Use valid JSON.' }],
    });
  }
};
const changes = ({
  id,
  settingsJson,
  ...rest
}: z.infer<typeof patchSchema>) => ({
  ...rest,
  ...(settingsJson !== undefined
    ? { settings: parseJson(settingsJson, 'settingsJson') }
    : {}),
});
const tool = (
  name: string,
  description: string,
  inputSchema: any,
  readOnly: boolean,
  execute: (
    org: string,
    profile: string | undefined,
    input: any
  ) => Promise<any>
) =>
  createTool({
    id: name,
    description,
    mcp: {
      annotations: {
        title: name,
        readOnlyHint: readOnly,
        destructiveHint: !readOnly,
        idempotentHint: readOnly,
        openWorldHint: false,
      },
    },
    inputSchema,
    outputSchema: z.object({
      output: z.unknown().optional(),
      error: z.unknown().optional(),
    }),
    execute: async (input, context) => {
      checkAuth(input, context);
      const request = readRequestContext(context);
      const org = JSON.parse(request.get('organization') as string);
      if (!org?.id) throw new Error('Organization context is required');
      try {
        return {
          output: await execute(
            org.id,
            request.get('profileId') as string | undefined,
            input
          ),
        };
      } catch (error) {
        return {
          error:
            error instanceof HttpException
              ? error.getResponse()
              : {
                  code: 'OPERATION_FAILED',
                  message:
                    'Could not complete the operation. Read the post before retrying.',
                },
        };
      }
    },
  });
@Injectable()
export class GetPostTool implements AgentToolInterface {
  constructor(private service: PostManagementService) {}
  name = 'getPostTool';
  run() {
    return tool(
      this.name,
      'Read an existing post by its ID: version, HTML/plain caption, ordered media/sequence, review comments and paginated stored network comments (commentsPage, 20 per page), settings/collaborators, UTC/local date, state, review URL and remote publication result. No browser or mutation. Invitation status stays unknown without provider evidence.',
      idSchema,
      true,
      (o, p, i) => this.service.get(o, p, i.id, i.timeZone, i.commentsPage)
    );
  }
}
@Injectable()
export class UpdatePostTool implements AgentToolInterface {
  constructor(private service: PostManagementService) {}
  name = 'updatePostTool';
  run() {
    return tool(
      this.name,
      'Partially edit an UNPUBLISHED post using the version from getPostTool. Only supplied fields change. Never creates, publishes, activates or moves the schedule. Media is the ordered list; entries merge by id/path so omitted alt/cover survive. settingsJson recursively merges objects and replaces arrays. normalizeSpacing is OPTIONAL and never rewrites wording: first call dryRun=true, show preview/diff, then apply with its previewHash and the same version. Published/imported posts are read-only.',
      patchSchema,
      false,
      (o, p, i) => this.service.update(o, p, i.id, changes(i))
    );
  }
}
@Injectable()
export class ValidatePostTool implements AgentToolInterface {
  constructor(private service: PostManagementService) {}
  name = 'validatePostTool';
  run() {
    return tool(
      this.name,
      'Validate the current post or proposed edits using existing backend caption, settings and provider/media rules. Supply id/version and optional edits. Returns field errors, never executes publication. Remote collaborator profile/invitation state can remain unknown.',
      patchSchema,
      true,
      (o, p, i) => this.service.validate(o, p, i.id, changes(i))
    );
  }
}
@Injectable()
export class ChangePostStatusTool implements AgentToolInterface {
  constructor(private service: PostManagementService) {}
  name = 'changePostStatusTool';
  run() {
    return tool(
      this.name,
      'Change an unpublished post to draft or schedule with its current version. Draft cancels and verifies the pending workflow. Schedule activates only with valid content and a future time. Published posts cannot be republished. Read the returned final state; an accepted request is not a completed social publication.',
      postStatusSchema.extend({ id: z.string() }),
      false,
      (o, p, { id, ...body }) => this.service.status(o, p, id, body)
    );
  }
}
@Injectable()
export class ChangePostDateTool implements AgentToolInterface {
  constructor(private service: PostManagementService) {}
  name = 'changePostDateTool';
  run() {
    return tool(
      this.name,
      'Change post time using current version, ISO date with Z/offset, and explicit IANA timeZone. action=update preserves draft/schedule state; action=schedule additionally activates an unpublished draft. Content, media, collabs and channel survive. If activation fails, read back the saved date/status before retrying.',
      postDateSchema.extend({ id: z.string() }),
      false,
      (o, p, { id, ...body }) => this.service.date(o, p, id, body)
    );
  }
}
@Injectable()
export class BulkUpdatePostsTool implements AgentToolInterface {
  constructor(private service: PostManagementService) {}
  name = 'bulkUpdatePostsTool';
  run() {
    return tool(
      this.name,
      'Partially update multiple existing posts without creating or publishing. updatesJson is JSON [{id,changes:{version,content?,media?,settings?,normalizeSpacing?,previewHash?}}]. dryRun defaults true and returns per-post before/after and preview hashes. Show the diff before applying normalization. Apply with an idempotencyKey; retries replay each completed item, including after partial failure. A pending unknown result must be reconciled, never retried with a new key. Results: updated/skipped/failed/preview.',
      z.object({
        idempotencyKey: z.string().min(8).max(200),
        dryRun: z.boolean().default(true),
        updatesJson: z.string(),
      }),
      false,
      (o, p, i) =>
        this.service.bulk(o, p, {
          idempotencyKey: i.idempotencyKey,
          dryRun: i.dryRun,
          updates: parseJson(i.updatesJson, 'updatesJson'),
        })
    );
  }
}
@Injectable()
export class GetPostExecutionTool implements AgentToolInterface {
  constructor(private service: PostManagementService) {}
  name = 'getPostExecutionTool';
  run() {
    return tool(
      this.name,
      'Read the latest stored provider result and scheduling execution for a post ID. Returns state/error, remote ID and URL, distinguishing draft saved, schedule active, processing, completed, failed and awaiting remote confirmation. Never declares published just because accepted/uploaded. Does not publish or retry.',
      idSchema,
      true,
      (o, p, i) => this.service.get(o, p, i.id, i.timeZone, i.commentsPage)
    );
  }
}
@Injectable()
export class UploadFileTool implements AgentToolInterface {
  constructor(private media: MediaService) {}
  name = 'uploadFileTool';
  mcpOnly = true;
  run() {
    return tool(
      this.name,
      'Upload a local/private file without a public URL. The MCP client supplies fileReference {name,base64} containing the actual bytes (up to 4.5 MB), never a server filesystem path. For larger files use uploadLinkTool and POST multipart file=@local-path to its private temporary upload URL. Uses the existing API upload validation/storage. adjust=true prepares compatible media; MOV automatically requests MP4 preparation. Keeps originalPath. Returns fileReference/media id, status, progress (null when indeterminate), error/warning. Poll mediaStatusTool; do not attach/publish until ready. No browser required.',
      z.object({
        fileReference: z.object({
          name: z.string().min(1).max(200),
          base64: z
            .string()
            .min(1)
            .max(6 * 1024 * 1024),
        }),
        adjust: z.boolean().default(false),
      }),
      false,
      (o, p, i) =>
        this.media.uploadFileReference(
          o,
          { ...i.fileReference, adjust: i.adjust },
          p
        )
    );
  }
}

@Injectable()
export class DeleteRemotePostTool implements AgentToolInterface {
  constructor(private service: PostManagementService) {}
  name = 'deleteRemotePostTool';
  run() {
    return tool(
      this.name,
      'Permanently delete published media from Instagram via Facebook Login with instagram_manage_contents. First read the post and show the exact account/media to the user; call only after explicit confirmation. Requires current version and exact remote ID. Non-ad posts, stories, reels and WHOLE carousels only; cannot delete one carousel slide. Keeps local history. status deleted means provider confirmed; unknown means inspect Instagram, do not retry or claim deletion. Other providers/login types unsupported. Does not publish or delete the local record.',
      remoteDeletePostSchema.extend({ id: z.string().min(1) }),
      false,
      (org, profile, input) => {
        const { id, ...body } = input;
        return this.service.deleteRemote(org, profile, id, body);
      }
    );
  }
}

@Injectable()
export class GetRemoteDeletionTool implements AgentToolInterface {
  constructor(private service: PostManagementService) {}
  name = 'getRemoteDeletionTool';
  run() {
    return tool(
      this.name,
      'Read remote deletion capability and durable result (not_requested, deleted, unknown) by Postiz post ID. Capability does not prove token permission. Never performs deletion.',
      z.object({ id: z.string().min(1) }),
      true,
      (org, profile, input) =>
        this.service.remoteDeletionInfo(org, profile, input.id)
    );
  }
}
