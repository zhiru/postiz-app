import { SocialCommentsService } from '../social-comments/social.comments.service';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { TemporalService } from 'nestjs-temporal-core';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';
import { MediaService } from '../media/media.service';
import {
  captionText,
  normalizeCaptionSpacing,
  postContentToHtml,
} from '@gitroom/helpers/utils/sanitize.post.content';
import {
  updatePostSchema,
  postStatusSchema,
  postDateSchema,
  bulkUpdatePostsSchema,
  UpdatePostInput,
} from '@gitroom/nestjs-libraries/dtos/posts/manage.post.dto';

const hash = (value: unknown): string => {
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])])
        )
      : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
};
const mergeSettings = (before: any, patch: any, depth = 0): any => {
  if (depth > 20)
    throw new BadRequestException(
      'Post settings exceed the maximum nesting depth.'
    );
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const result = { ...before };
  for (const [key, value] of Object.entries(patch)) {
    if (
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      /token|secret|password|api.?key|credential/i.test(key)
    )
      throw new BadRequestException(
        'Credentials and unsafe keys are not post settings.'
      );
    result[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? mergeSettings(before?.[key], value, depth + 1)
        : value;
  }
  return result;
};
const parseStored = (value: string | null, fallback: string): any => {
  try {
    return JSON.parse(value ?? fallback);
  } catch {
    throw new BadRequestException({
      code: 'STORED_DATA_INVALID',
      message: 'Stored post data cannot be parsed safely.',
    });
  }
};
const publicSettings = (value: any): any =>
  Array.isArray(value)
    ? value.map(publicSettings)
    : value && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value)
          .filter(
            ([key]) => !/token|secret|password|api.?key|credential/i.test(key)
          )
          .map(([k, v]) => [k, publicSettings(v)])
      )
    : value;

@Injectable()
export class PostManagementService {
  constructor(
    private repository: PostsRepository,
    private posts: PostsService,
    private media: MediaService,
    private temporal: TemporalService,
    private socialComments: SocialCommentsService
  ) {}

  private parse<T>(
    schema: { safeParse: (v: unknown) => any },
    input: unknown
  ): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException({
        code: 'INVALID_INPUT',
        errors: parsed.error.issues.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    return parsed.data;
  }
  private async rows(org: string, profile: string | undefined, id: string) {
    const rows = await this.repository.getManagedPost(org, profile, id);
    if (!rows.length) throw new NotFoundException('Post not found');
    return rows;
  }
  private mutable(
    post: Awaited<ReturnType<PostsRepository['getManagedPost']>>[number],
    version: string
  ) {
    if (post.updatedAt.toISOString() !== new Date(version).toISOString())
      throw new ConflictException({
        code: 'POST_VERSION_CONFLICT',
        message: 'Read the latest post before editing.',
      });
    if (
      post.importedFromPlatform ||
      post.state === 'PUBLISHED' ||
      post.releaseId
    )
      throw new ConflictException({
        code: 'POST_NOT_EDITABLE',
        message:
          'Published/imported posts cannot be edited or republished by this operation.',
      });
    if (
      post.state === 'QUEUE' &&
      post.publishDate.getTime() <= Date.now() + 30000
    )
      throw new ConflictException({
        code: 'PUBLICATION_MAY_HAVE_STARTED',
        message:
          'The publication may already be processing. Check its execution before making changes.',
      });
  }
  private timeZone(zone: string) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone }).format();
    } catch {
      throw new BadRequestException({
        code: 'INVALID_TIME_ZONE',
        message: 'Use an IANA time zone, for example America/Sao_Paulo.',
      });
    }
  }
  private view(row: any) {
    const settings = parseStored(row.settings, '{}');
    return {
      id: row.id,
      version: row.updatedAt.toISOString(),
      contentHtml: row.content,
      contentText: captionText(row.content),
      media: parseStored(row.image, '[]'),
      settings: publicSettings(settings),
      collaborators: (Array.isArray(settings.collaborators)
        ? settings.collaborators
        : []
      ).map((c: any) => ({
        handle: typeof c === 'string' ? c : c.label,
        configured: true,
        invitationSent: 'unknown',
        invitationAccepted: 'unknown',
        profileValidation: 'unknown',
      })),
      comments: row.comments.map((c: any) => ({
        id: c.id,
        contentHtml: postContentToHtml(c.content),
        parentId: c.parentId,
        createdAt: c.createdAt,
        resolvedAt: c.resolvedAt,
      })),
      state: row.state,
      remoteId:
        row.releaseId && row.releaseId !== 'missing' ? row.releaseId : null,
      publishedUrl: row.releaseURL,
      // Raw errors can contain credentials/request bodies; they never leave the server.
      error: row.error
        ? {
            code: 'PUBLICATION_FAILED',
            message:
              'Publication failed. Check the authenticated execution history for provider details.',
          }
        : null,
    };
  }
  async get(
    org: string,
    profile: string | undefined,
    id: string,
    timeZone = 'UTC',
    commentsPage = 1
  ) {
    this.timeZone(timeZone);
    if (
      !Number.isSafeInteger(commentsPage) ||
      commentsPage < 1 ||
      commentsPage > 100000
    )
      throw new BadRequestException(
        'commentsPage must be a positive integer up to 100000.'
      );
    const rows = await this.rows(org, profile, id);
    const root = rows[0];
    const item = this.view(root);
    let queueActive: boolean | null = null;
    if (root.state === 'QUEUE' || root.state === 'DRAFT') {
      try {
        const client = this.temporal.client.getRawClient();
        if (client)
          queueActive =
            (await client.workflow.getHandle(`post_${id}`).describe()).status
              .name === 'RUNNING';
      } catch (error) {
        if ((error as Error).name === 'WorkflowNotFoundError')
          queueActive = false;
      }
    }
    const executionState =
      root.state === 'DRAFT'
        ? queueActive === false
          ? 'DRAFT_SAVED'
          : 'EXECUTION_UNKNOWN'
        : root.state === 'ERROR'
        ? 'FAILED'
        : root.state === 'PUBLISHED'
        ? item.remoteId
          ? 'PUBLISHED'
          : 'AWAITING_REMOTE_CONFIRMATION'
        : queueActive === false
        ? 'SCHEDULE_MISSING'
        : queueActive === null
        ? 'EXECUTION_UNKNOWN'
        : root.publishDate.getTime() > Date.now()
        ? 'SCHEDULED'
        : 'PROCESSING';
    return {
      ...item,
      channel: root.integration,
      profileId: root.profileId,
      publishDateUtc: root.publishDate.toISOString(),
      timeZone,
      publishDateLocal: new Intl.DateTimeFormat('sv-SE', {
        timeZone,
        dateStyle: 'short',
        timeStyle: 'long',
        hourCycle: 'h23',
      }).format(root.publishDate),
      reviewUrl: `${process.env.FRONTEND_URL}/p/${id}?share=true`,
      sequence: rows.slice(1).map((r) => this.view(r)),
      networkComments: {
        ...(await this.socialComments.getComments(
          org,
          { postId: id, page: commentsPage },
          profile
        )),
        page: commentsPage,
        pageSize: 20,
      },
      executionState,
      queueActive,
      observedAt: new Date().toISOString(),
      source: 'stored_provider_result',
      remoteDeletion: {
        supported: false,
        reason:
          'Deleting from Postiz does not necessarily delete the post on the social network.',
      },
    };
  }

  async validate(
    org: string,
    profile: string | undefined,
    id: string,
    changes: UpdatePostInput
  ) {
    const prepared = await this.prepare(org, profile, id, changes);
    return {
      id,
      version: prepared.root.updatedAt.toISOString(),
      valid: prepared.errors.length === 0,
      errors: prepared.errors,
      warnings: [
        {
          field: 'settings.collaborators',
          code: 'REMOTE_STATE_UNKNOWN',
          message:
            'A configured collaborator is not proof that an invitation was sent or accepted. No remote profile check is available through this operation.',
        },
      ],
    };
  }
  private async prepare(
    org: string,
    profile: string | undefined,
    id: string,
    input: UpdatePostInput
  ) {
    const changes = this.parse<ReturnType<typeof updatePostSchema.parse>>(
      updatePostSchema,
      input
    );
    const rows = await this.rows(org, profile, id);
    const root = rows[0];
    this.mutable(root, changes.version);
    const data: { content?: string; image?: string; settings?: string } = {};
    if (changes.content !== undefined || changes.normalizeSpacing) {
      const html =
        changes.content === undefined
          ? root.content
          : postContentToHtml(changes.content);
      const content = changes.normalizeSpacing
        ? normalizeCaptionSpacing(html)
        : html;
      if (content !== root.content) data.content = content;
    }
    let media = parseStored(root.image, '[]');
    if (changes.media !== undefined) {
      const resolved = [];
      for (const entry of changes.media) {
        const previous =
          media.find((m: any) => entry.id && m.id === entry.id) ||
          media.find((m: any) => entry.path && m.path === entry.path);
        const merged = { ...previous, ...entry };
        const canonical = await this.media.resolvePostMedia(
          org,
          merged,
          profile ?? root.profileId ?? undefined
        );
        resolved.push({
          ...merged,
          id: canonical.id,
          path: canonical.path,
        });
      }
      media = resolved;
      if (JSON.stringify(media) !== root.image)
        data.image = JSON.stringify(media);
    }
    const settings =
      changes.settings === undefined
        ? parseStored(root.settings, '{}')
        : mergeSettings(parseStored(root.settings, '{}'), changes.settings);
    if (changes.settings !== undefined) {
      if (settings.__type !== root.integration.providerIdentifier)
        throw new BadRequestException({
          code: 'CHANNEL_IMMUTABLE',
          message: 'Provider and channel cannot change when editing.',
        });
      if (JSON.stringify(settings) !== root.settings)
        data.settings = JSON.stringify(settings);
    }
    const value = rows.map((r, i) => ({
      content: i === 0 ? data.content ?? r.content : r.content,
      image: i === 0 ? media : parseStored(r.image, '[]'),
    }));
    const errors: { field: string; code: string; message: string }[] = [];
    const [validation] = await this.posts.validatePosts(org, [
      { integration: { id: root.integrationId }, settings, value },
    ]);
    if (!validation.valid)
      errors.push(
        ...(validation.fieldErrors?.length
          ? validation.fieldErrors
          : [
              {
                field: 'settings',
                code: 'INVALID_CHANNEL_SETTINGS',
                message: validation.settingsError || 'Invalid settings',
              },
            ])
      );
    if (validation.emptyContent)
      errors.push({
        field: 'content',
        code: 'CONTENT_REQUIRED',
        message: 'Provide content or media.',
      });
    if (validation.tooLong)
      errors.push({
        field: 'content',
        code: 'CAPTION_TOO_LONG',
        message: `Maximum ${validation.maximumCharacters} characters.`,
      });
    if (validation.errors !== true)
      errors.push({
        field: 'media',
        code: 'INVALID_MEDIA',
        message: String(validation.errors),
      });
    errors.push(
      ...(await this.media.assertReadyForPosts(
        org,
        [
          ...value.flatMap((v) => v.image),
          ...(settings.cover?.path ? [settings.cover] : []),
        ],
        profile ?? root.profileId ?? undefined
      ))
    );
    const diff = Object.fromEntries(
      Object.entries(data).map(([key, after]) => {
        const before = root[key as keyof typeof root];
        const safe = (value: any) =>
          key === 'settings'
            ? JSON.stringify(publicSettings(parseStored(value, '{}')))
            : value;
        return [key, { before: safe(before), after: safe(after) }];
      })
    );
    return {
      root,
      changes,
      data,
      diff,
      errors,
      previewHash: hash({ id, version: changes.version, data }),
    };
  }
  async update(
    org: string,
    profile: string | undefined,
    id: string,
    input: UpdatePostInput
  ) {
    const p = await this.prepare(org, profile, id, input);
    if (p.changes.dryRun)
      return {
        id,
        status: 'preview',
        diff: p.diff,
        previewHash: p.previewHash,
        validation: { valid: !p.errors.length, errors: p.errors },
        preview: {
          contentHtml: p.data.content ?? p.root.content,
          contentText: captionText(p.data.content ?? p.root.content),
        },
      };
    if (p.changes.normalizeSpacing && p.changes.previewHash !== p.previewHash)
      throw new HttpException(
        {
          code: 'PREVIEW_REQUIRED',
          message:
            'Run dryRun first and apply its previewHash without changing the version or content.',
        },
        428
      );
    if (p.errors.length)
      throw new BadRequestException({
        code: 'POST_VALIDATION_FAILED',
        errors: p.errors,
      });
    if (!Object.keys(p.data).length)
      return { id, status: 'skipped', post: await this.get(org, profile, id) };
    await this.repository.patchManagedPost(
      org,
      profile,
      id,
      p.changes.version,
      p.data
    );
    const warnings: { code: string; message: string }[] = [];
    if (p.data.content !== undefined) {
      try {
        await this.posts.detachStaleAnchors([{ id, content: p.data.content }]);
      } catch {
        warnings.push({
          code: 'REVIEW_ANCHORS_PENDING',
          message:
            'The edit was saved, but review anchors could not be checked. Review them before approval.',
        });
      }
    }
    try {
      return {
        id,
        status: 'updated',
        diff: p.diff,
        post: await this.get(org, profile, id),
        ...(warnings.length ? { warnings } : {}),
      };
    } catch {
      return {
        id,
        status: 'updated',
        diff: p.diff,
        confirmation: 'pending',
        warnings: [
          ...warnings,
          {
            code: 'POST_READ_PENDING',
            message:
              'The edit was saved, but its final read failed. Use getPostTool before editing again.',
          },
        ],
      };
    }
  }

  async status(
    org: string,
    profile: string | undefined,
    id: string,
    input: unknown
  ) {
    const body = this.parse<ReturnType<typeof postStatusSchema.parse>>(
      postStatusSchema,
      input
    );
    const [root] = await this.rows(org, profile, id);
    this.mutable(root, body.version);
    if (body.status === 'schedule') {
      const v = await this.validate(org, profile, id, {
        version: body.version,
      });
      if (!v.valid)
        throw new BadRequestException({
          code: 'POST_VALIDATION_FAILED',
          errors: v.errors,
        });
      if (root.publishDate.getTime() <= Date.now() + 30000)
        throw new BadRequestException('Set a future date before scheduling.');
      if (root.state === 'ERROR')
        throw new ConflictException(
          'Resolve the previous publication result before scheduling again.'
        );
    }
    await this.posts.changePostStatus(
      org,
      id,
      body.status,
      profile,
      body.version
    );
    const post = await this.get(org, profile, id);
    return { id, status: post.state, post };
  }
  async date(
    org: string,
    profile: string | undefined,
    id: string,
    input: unknown
  ) {
    const body = this.parse<ReturnType<typeof postDateSchema.parse>>(
      postDateSchema,
      input
    );
    this.timeZone(body.timeZone);
    const [root] = await this.rows(org, profile, id);
    this.mutable(root, body.version);
    if (
      root.state === 'QUEUE' &&
      new Date(body.date).getTime() <= Date.now() + 30000
    )
      throw new BadRequestException(
        'Use a future date for an active schedule.'
      );
    await this.posts.changeDate(
      org,
      id,
      new Date(body.date).toISOString(),
      'update',
      false,
      profile,
      body.version
    );
    const post = await this.get(org, profile, id, body.timeZone);
    if (body.action === 'schedule' && post.state !== 'QUEUE') {
      await this.status(org, profile, id, {
        version: post.version,
        status: 'schedule',
      });
      return { id, post: await this.get(org, profile, id, body.timeZone) };
    }
    return { id, post };
  }

  async once<T>(
    org: string,
    profile: string | undefined,
    kind: string,
    key: string,
    request: unknown,
    execute: () => Promise<T>
  ): Promise<T> {
    return this.posts.runIdempotentPostOperation(
      org,
      profile,
      kind,
      key,
      request,
      execute
    );
  }
  async bulk(org: string, profile: string | undefined, input: unknown) {
    const body = this.parse<ReturnType<typeof bulkUpdatePostsSchema.parse>>(
      bulkUpdatePostsSchema,
      input
    );
    const results = [];
    for (const item of body.updates) {
      const execute = async () => {
        try {
          return await this.update(org, profile, item.id, {
            ...item.changes,
            dryRun: body.dryRun,
          });
        } catch (e) {
          return {
            id: item.id,
            status: 'failed',
            error:
              e instanceof HttpException
                ? e.getResponse()
                : {
                    code: 'UPDATE_FAILED',
                    message: 'Could not update this post.',
                  },
          };
        }
      };
      try {
        results.push(
          body.dryRun
            ? await execute()
            : await this.once(
                org,
                profile,
                'bulk-update',
                hash([body.idempotencyKey, item.id]),
                item.changes,
                execute
              )
        );
      } catch (e) {
        results.push({
          id: item.id,
          status: 'failed',
          error:
            e instanceof HttpException
              ? e.getResponse()
              : { code: 'UPDATE_FAILED' },
        });
      }
    }
    return { dryRun: body.dryRun, results };
  }
}
