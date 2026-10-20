import { readRequestContext } from './tool.context.helper';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { HttpException, Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class MediaStatusTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'mediaStatusTool';

  run() {
    return createTool({
      id: 'mediaStatusTool',
      description: `Check whether a media uploaded with adjust set to true finished adjusting to the platforms' limits, using the media id returned by uploadFromUrlTool, the public API (POST /public/v1/upload or /public/v1/upload-from-url) or the Postiz CLI (postiz upload).
Files the user uploaded through the upload widget (uploadWidgetTool) have no id until they are listed, so check those with uploadWidgetStatusTool and its sessionId instead.
Only a media with the status "processing" needs checking: wait about 10 seconds and call again. Don't publish a post with its path until it is "ready": a post published while it is processing uses the original, unadjusted file.
"ready" means the adjusted file is in place at the same path. "ready" with a warning means the adjustment failed and the original file was kept and will be used for publishing.`,
      mcp: {
        annotations: {
          title: 'Media Status',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        id: z.string().describe('The media id returned by the upload'),
      }),
      outputSchema: z.object({
        id: z.string().optional(),
        path: z.string().optional(),
        status: z.string().optional(),
        warning: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const org = JSON.parse(
            readRequestContext(context).get('organization') as string
          );
          if (!org?.id) return { error: 'Organization context is required.' };
          return await this._mediaService.getMediaUploadStatus(
            org.id,
            inputData.id,
            readRequestContext(context).get('profileId') as string | undefined
          );
        } catch (err) {
          return { error: err instanceof HttpException && err.getStatus() === 404 ? 'Media not found.' : 'Could not check media status. Try again.' };
        }
      },
    });
  }
}
