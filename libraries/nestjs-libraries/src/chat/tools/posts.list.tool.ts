import { readRequestContext } from '@gitroom/nestjs-libraries/chat/tools/tool.context.helper';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

const PAGE_SIZE = 50;

const parseSettings = (settings: string | null) => {
  try {
    return JSON.parse(settings || '{}');
  } catch (err) {
    return {};
  }
};

@Injectable()
export class PostsListTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postsListTool';

  run() {
    return createTool({
      id: 'postsListTool',
      mcp: {
        annotations: {
          title: 'List Posts',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
List the organization's posts scheduled to be published between two dates (the same data as the "List Posts" API endpoint).
Returns the posts in the window whatever their state (scheduled, draft, published, errored), ordered by publish date.
"startDate" and "endDate" are required (UTC) - prefer a narrow window (days or weeks) over a wide one.
Results are paged, ${PAGE_SIZE} posts per page: "total" is the number of posts in the window and "hasMore" tells if there are more pages - to get the next page, call again with the same parameters and "page" + 1 (the first page is 0).
Each item has an "id", its publish date, state, error (for errored posts), content, channel and current provider settings.
Pass "includeAttachments": true to also get each post's "attachments" (media already uploaded to Postiz). Their "path" values can be passed straight to integrationSchedulePostTool as "attachments" to reuse the same media on another channel - do not re-upload them.
To delete a post, pass its "id" to deletePostTool - only after the user explicitly confirmed which post(s) to delete.
`,
      inputSchema: z.object({
        startDate: z
          .string()
          .describe('Start of the window (UTC), for example 2026-07-20T00:00:00'),
        endDate: z
          .string()
          .describe('End of the window (UTC), for example 2026-08-20T00:00:00'),
        customer: z
          .string()
          .optional()
          .describe('Optional customer (group) id to filter the channels by'),
        page: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Page number, starts at 0 (default 0)'),
        includeAttachments: z
          .boolean()
          .optional()
          .describe(
            'Set to true to include the attachments of each post (needed to duplicate or mirror a post with its media)'
          ),
      }),
      outputSchema: z.object({
        output: z.object({
          posts: z.array(
            z.object({
              id: z
                .string()
                .describe('The post id'),
              publishDate: z.string().describe('UTC time'),
              state: z.string().describe('QUEUE, DRAFT, PUBLISHED or ERROR'),
              error: z
                .string()
                .nullable()
                .describe(
                  'Curated failure message for errored posts, null otherwise'
                ),
              content: z.string(),
              settings: z
                .any()
                .describe('The post current provider settings'),
              group: z.string(),
              integrationId: z.string(),
              platform: z.string(),
              integrationName: z.string(),
              attachments: z
                .array(
                  z.object({
                    id: z.string().optional(),
                    path: z.string(),
                    thumbnail: z.string().nullable(),
                  })
                )
                .optional()
                .describe(
                  'Only present when "includeAttachments" is true - pass the "path" values to integrationSchedulePostTool to reuse the media'
                ),
            })
          ),
          total: z.number().describe('Number of posts in the window'),
          page: z.number(),
          hasMore: z.boolean().describe('True if there are more pages'),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const profileId = readRequestContext(context).get('profileId') as string | undefined;
        const organizationId = JSON.parse(
          readRequestContext(context).get('organization') as string
        ).id;

        const page = inputData.page || 0;
        const all = (
          (await this._postsService.getPosts(
            organizationId,
            {
              startDate: inputData.startDate,
              endDate: inputData.endDate,
              customer: inputData.customer,
            } as any,
            inputData.includeAttachments,
            profileId
          )) || []
        ).sort(
          (a: any, b: any) =>
            dayjs(a.publishDate).valueOf() - dayjs(b.publishDate).valueOf() ||
            a.id.localeCompare(b.id)
        );
        const posts = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

        return {
          output: {
            posts: posts.map((p: any) => ({
              id: p.id,
              publishDate: dayjs(p.publishDate)
                .utc()
                .format('YYYY-MM-DDTHH:mm:ss'),
              state: p.state,
              error: p.error ?? null,
              content: p.content || '',
              settings: parseSettings(p.settings),
              group: p.group,
              integrationId: p.integration?.id,
              platform: p.integration?.providerIdentifier,
              integrationName: p.integration?.name,
              attachments: p.attachments,
            })),
            total: all.length,
            page,
            hasMore: (page + 1) * PAGE_SIZE < all.length,
          },
        };
      },
    });
  }
}
