import { z } from 'zod';

export const imageUserTagsSchema = z
  .array(
    z
      .object({
        username: z
          .string()
          .trim()
          .transform((value) => value.replace(/^@/, ''))
          .pipe(z.string().regex(/^[A-Za-z0-9._]{1,30}$/)),
        x: z.number().finite().min(0).max(1),
        y: z.number().finite().min(0).max(1),
      })
      .strict()
  )
  .superRefine((tags, ctx) => {
    const seen = new Set<string>();
    tags.forEach((tag, index) => {
      const username = tag.username.toLowerCase();
      if (seen.has(username))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'username'],
          message: 'Tag each username only once per image',
        });
      seen.add(username);
    });
  });

export const managedMediaSchema = z
  .object({
    id: z.string().min(1).optional(),
    path: z.string().url().optional(),
    alt: z.string().max(10000).optional(),
    user_tags: imageUserTagsSchema.optional(),
    thumbnail: z.string().url().nullable().optional(),
    thumbnailTimestamp: z.number().int().min(0).nullable().optional(),
  })
  .strict()
  .refine((v) => !!(v.id || v.path), 'A media id or path is required');
export const updatePostSchema = z
  .object({
    version: z.string().datetime({ offset: true }),
    content: z.string().max(100000).optional(),
    media: z.array(managedMediaSchema).max(50).optional(),
    settings: z
      .record(z.unknown())
      .superRefine((value, ctx) => {
        const pending = [{ value, depth: 0 }];
        while (pending.length) {
          const item = pending.pop();
          if (item.depth > 20) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Maximum settings nesting depth is 20.',
            });
            return;
          }
          if (item.value && typeof item.value === 'object')
            for (const child of Object.values(item.value))
              pending.push({ value: child as any, depth: item.depth + 1 });
        }
      })
      .optional(),
    normalizeSpacing: z.boolean().default(false),
    previewHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();
export type UpdatePostInput = z.input<typeof updatePostSchema>;
export const postStatusSchema = z
  .object({
    version: z.string().datetime({ offset: true }),
    status: z.enum(['draft', 'schedule']),
  })
  .strict();
export const postDateSchema = z
  .object({
    version: z.string().datetime({ offset: true }),
    date: z.string().datetime({ offset: true }),
    timeZone: z.string().min(1).max(100),
    action: z.enum(['update', 'schedule']).default('update'),
  })
  .strict();
export const bulkUpdatePostsSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(200),
    dryRun: z.boolean().default(true),
    updates: z
      .array(z.object({ id: z.string().min(1), changes: updatePostSchema }))
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.updates.map((u) => u.id)).size === v.updates.length,
    'Each post id must occur once'
  );

export const remoteDeletePostSchema = z
  .object({
    version: z.string().datetime({ offset: true }),
    confirmRemoteId: z.string().regex(/^[0-9]{1,40}$/),
  })
  .strict();
