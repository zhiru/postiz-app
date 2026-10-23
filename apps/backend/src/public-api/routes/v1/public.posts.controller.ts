import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetPublicApiProfileId } from '@gitroom/nestjs-libraries/user/public.api.profile.from.request';
import { PostManagementService } from '@gitroom/nestjs-libraries/database/prisma/posts/post.management.service';
import { UpdatePostInput } from '@gitroom/nestjs-libraries/dtos/posts/manage.post.dto';

const updateSchema: any = {
  type: 'object',
  additionalProperties: false,
  required: ['version'],
  properties: {
    version: {
      type: 'string',
      format: 'date-time',
      description: 'Version returned by GET. Stale versions return 409.',
    },
    content: {
      type: 'string',
      description: 'HTML or plain text. Omit to preserve.',
    },
    media: {
      type: 'array',
      description:
        'Ordered complete media list. Entries merge by id/path; omitted fields retain their value.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          path: { type: 'string', format: 'uri' },
          alt: { type: 'string' },
          thumbnail: { type: 'string', nullable: true },
          thumbnailTimestamp: { type: 'integer', nullable: true },
        },
      },
    },
    settings: {
      type: 'object',
      additionalProperties: true,
      description:
        'Recursive object merge; arrays replace. collaborators:[] removes configured collabs. Published posts are read-only.',
    },
    normalizeSpacing: { type: 'boolean', default: false },
    dryRun: { type: 'boolean', default: false },
    previewHash: {
      type: 'string',
      description: 'Required when applying normalization. Returned by dryRun.',
    },
  },
};
const itemSchema: any = {
  type: 'object',
  required: [
    'id',
    'version',
    'contentHtml',
    'contentText',
    'media',
    'settings',
    'collaborators',
    'comments',
    'state',
  ],
  properties: {
    id: { type: 'string' },
    version: { type: 'string', format: 'date-time' },
    contentHtml: { type: 'string' },
    contentText: { type: 'string' },
    media: updateSchema.properties.media,
    settings: { type: 'object', additionalProperties: true },
    collaborators: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          handle: { type: 'string' },
          configured: { type: 'boolean' },
          invitationSent: { type: 'string', enum: ['unknown'] },
          invitationAccepted: { type: 'string', enum: ['unknown'] },
          profileValidation: { type: 'string', enum: ['unknown'] },
        },
      },
    },
    comments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          contentHtml: { type: 'string' },
          parentId: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          resolvedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
    },
    state: { type: 'string', enum: ['DRAFT', 'QUEUE', 'PUBLISHED', 'ERROR'] },
    remoteId: { type: 'string', nullable: true },
    publishedUrl: { type: 'string', nullable: true },
    error: {
      type: 'object',
      nullable: true,
      properties: { code: { type: 'string' }, message: { type: 'string' } },
    },
  },
};
const readSchema: any = {
  ...itemSchema,
  properties: {
    ...itemSchema.properties,
    channel: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        providerIdentifier: { type: 'string' },
      },
    },
    profileId: { type: 'string', nullable: true },
    sequence: { type: 'array', items: itemSchema },
    networkComments: {
      type: 'object',
      properties: {
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
        count: { type: 'integer' },
        comments: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            description:
              'Existing public comment projection: id, content, authorName/authorId, providerCommentId, parentCommentId, permalink, publishedAt, status, suggestedReply, reply, repliedAt, and safe channel identity.',
          },
        },
      },
    },
    publishDateUtc: { type: 'string', format: 'date-time' },
    timeZone: { type: 'string' },
    publishDateLocal: { type: 'string' },
    reviewUrl: { type: 'string' },
    executionState: {
      type: 'string',
      enum: [
        'DRAFT_SAVED',
        'SCHEDULED',
        'PROCESSING',
        'PUBLISHED',
        'FAILED',
        'AWAITING_REMOTE_CONFIRMATION',
        'SCHEDULE_MISSING',
        'EXECUTION_UNKNOWN',
      ],
    },
    queueActive: { type: 'boolean', nullable: true },
    observedAt: { type: 'string', format: 'date-time' },
    source: { type: 'string', enum: ['stored_provider_result'] },
    remoteDeletion: {
      type: 'object',
      properties: {
        supported: { type: 'boolean', enum: [false] },
        reason: { type: 'string' },
      },
    },
  },
};
const editResultSchema: any = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['updated', 'skipped', 'preview'] },
    post: readSchema,
    diff: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: { before: { type: 'string' }, after: { type: 'string' } },
      },
    },
    previewHash: { type: 'string' },
    preview: {
      type: 'object',
      properties: {
        contentHtml: { type: 'string' },
        contentText: { type: 'string' },
      },
    },
    validation: {
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        errors: { type: 'array', items: { type: 'object' } },
      },
    },
    confirmation: { type: 'string', enum: ['pending'] },
    warnings: { type: 'array', items: { type: 'object' } },
  },
};
@ApiTags('Public API - Post management')
@ApiSecurity('api-key')
@ApiResponse({
  status: 400,
  description:
    'INVALID_INPUT or POST_VALIDATION_FAILED with errors[{field,code,message}].',
})
@ApiResponse({
  status: 404,
  description: 'Post does not exist in this organization/profile.',
})
@ApiResponse({
  status: 409,
  description:
    'POST_VERSION_CONFLICT, POST_NOT_EDITABLE, IDEMPOTENCY_KEY_REUSED or OPERATION_UNKNOWN_RESULT. Read/reconcile before retrying.',
})
@ApiResponse({
  status: 428,
  description: 'PREVIEW_REQUIRED. Supply the normalization previewHash.',
})
@ApiResponse({
  status: 503,
  description:
    'Queue cancellation/activation could not be confirmed. Inspect the current state; do not assume publication.',
})
@Controller('/public/v1/posts')
export class PublicPostsController {
  constructor(private readonly management: PostManagementService) {}
  @Get(':id')
  @ApiOkResponse({ schema: readSchema })
  @ApiOperation({
    summary: 'Read a post by ID',
    description:
      'Returns version, HTML/plain caption, ordered media/sequence, review and paginated stored network comments, settings/collaborators, UTC/local time, state, sanitized error, review URL and remote id/URL. Credentials and raw request/error bodies are excluded. Collab invitation/acceptance remains unknown unless confirmed by the provider.',
  })
  @ApiQuery({ name: 'timeZone', required: false, example: 'America/Sao_Paulo' })
  @ApiQuery({
    name: 'commentsPage',
    required: false,
    type: Number,
    description: 'Stored network comments page, 20 per page; starts at 1.',
  })
  get(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() profile: string | undefined,
    @Param('id') id: string,
    @Query('timeZone') zone?: string,
    @Query('commentsPage') commentsPage?: string
  ) {
    return this.management.get(
      org.id,
      profile,
      id,
      zone,
      commentsPage === undefined ? 1 : Number(commentsPage)
    );
  }
  @Get(':id/status')
  @ApiOkResponse({ schema: readSchema })
  @ApiOperation({
    summary: 'Read current publication result',
    description:
      'Read-only, never publishes. Distinguishes saved draft, active schedule, processing, completed/failed and missing remote confirmation. Local acceptance or an upload-only draft is not proof of a published social post.',
  })
  status(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() profile: string | undefined,
    @Param('id') id: string
  ) {
    return this.management.get(org.id, profile, id);
  }
  @Patch(':id')
  @ApiOkResponse({ schema: editResultSchema })
  @ApiOperation({
    summary: 'Partially update an unpublished post',
    description:
      'No creation, publication, date/state/channel change. All omitted fields and sequence items survive. Run dryRun for a before/after diff; normalized spacing additionally requires its previewHash on apply.',
  })
  @ApiBody({
    schema: updateSchema,
    examples: {
      caption: {
        value: {
          version: '2026-10-22T12:00:00.000Z',
          content: 'Primeiro parágrafo.\n\nSegundo parágrafo.',
        },
      },
      spacing: {
        value: {
          version: '2026-10-22T12:00:00.000Z',
          normalizeSpacing: true,
          dryRun: true,
        },
      },
    },
  })
  update(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() profile: string | undefined,
    @Param('id') id: string,
    @Body() body: UpdatePostInput
  ) {
    return this.management.update(org.id, profile, id, body);
  }
  @Post(':id/validate')
  @ApiResponse({
    status: 201,
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        version: { type: 'string' },
        valid: { type: 'boolean' },
        errors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              code: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
        warnings: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  @ApiOperation({
    summary: 'Validate without publishing',
    description:
      'Reuses backend provider/settings/media/caption rules. Validates proposed edits or the current post with only version. Returns field errors and explicit unknowns for remote collab validation.',
  })
  @ApiBody({ schema: updateSchema })
  validate(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() profile: string | undefined,
    @Param('id') id: string,
    @Body() body: UpdatePostInput
  ) {
    return this.management.validate(org.id, profile, id, body);
  }
  @Put(':id/status')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string' },
        post: readSchema,
      },
    },
  })
  @ApiOperation({
    summary: 'Move an unpublished post to draft or schedule',
    description:
      'Requires the current version. Draft cancels and verifies the pending workflow. Schedule validates content and requires a future date; published posts cannot be republished.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['version', 'status'],
      properties: {
        version: { type: 'string', format: 'date-time' },
        status: { type: 'string', enum: ['draft', 'schedule'] },
      },
    },
  })
  changeStatus(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() profile: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.management.status(org.id, profile, id, body);
  }
  @Put(':id/date')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { id: { type: 'string' }, post: readSchema },
    },
  })
  @ApiOperation({
    summary: 'Update time independently from activating a schedule',
    description:
      'date must be ISO 8601 with Z/offset; timeZone is an explicit IANA zone. action=update preserves state, including draft. Existing active schedules refresh their timer. action=schedule additionally activates an unpublished draft; activation errors do not undo an already saved date.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['version', 'date', 'timeZone'],
      properties: {
        version: { type: 'string', format: 'date-time' },
        date: { type: 'string', format: 'date-time' },
        timeZone: { type: 'string', example: 'America/Sao_Paulo' },
        action: {
          type: 'string',
          enum: ['update', 'schedule'],
          default: 'update',
        },
      },
    },
  })
  date(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() profile: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.management.date(org.id, profile, id, body);
  }
  @Post('bulk-update')
  @ApiResponse({
    status: 201,
    schema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean' },
        results: {
          type: 'array',
          items: {
            ...editResultSchema,
            properties: {
              ...editResultSchema.properties,
              status: {
                type: 'string',
                enum: ['updated', 'skipped', 'preview', 'failed'],
              },
              error: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Update posts independently with durable retry receipts',
    description:
      'dryRun defaults true. Apply uses idempotencyKey plus each id: completed/failed results are replayed, never executed twice. An interrupted unknown result returns 409 for reconciliation. New desired changes require a new key/version. Each result is updated, skipped, failed or preview; no publications are created.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['idempotencyKey', 'updates'],
      properties: {
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
        dryRun: { type: 'boolean', default: true },
        updates: {
          type: 'array',
          maxItems: 100,
          items: {
            type: 'object',
            required: ['id', 'changes'],
            properties: { id: { type: 'string' }, changes: updateSchema },
          },
        },
      },
    },
  })
  bulk(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() profile: string | undefined,
    @Body() body: unknown
  ) {
    return this.management.bulk(org.id, profile, body);
  }
}
