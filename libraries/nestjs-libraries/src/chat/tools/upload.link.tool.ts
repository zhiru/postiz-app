import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { readRequestContext } from './tool.context.helper';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';

@Injectable()
export class UploadLinkTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'uploadLinkTool';
  mcpOnly = true;

  run() {
    return createTool({
      id: this.name,
      description: `Get a temporary upload URL for an agent that can run commands on the user's computer, such as Codex or Claude Code. Use it for local images/videos when no MCP upload widget is available; no CLI sign-in or API key is needed.
POST each file to uploadUrl as multipart form-data in the field "file", for example: curl --fail-with-body -H "X-Postiz-Upload-Ticket: <uploadHeaders.X-Postiz-Upload-Ticket>" -F "file=@/path/to/photo.png" "<uploadUrl>". The response includes the stored media id and path. Optional form field adjust=true requests media adjustment; otherwise the original is retained.
Check uploadWidgetStatusTool with sessionId if processing is pending, and wait for ready before attaching {id,path} to a post. For public URLs use uploadFromUrlTool instead.
The link expires after 10 minutes and can upload multiple files into the authenticated organization/profile. Send uploadHeaders with the multipart request; never put the ticket in a URL/query string. Anyone holding the ticket can upload until expiry. Treat it as a secret: use it only for the upload, never publish it, show it publicly, or include it in logs. Call this tool again if it expires.`,
      mcp: {
        annotations: {
          title: 'Upload Link For Local Files',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({}),
      outputSchema: z.object({
        uploadUrl: z.string().optional(),
        sessionId: z.string().optional(),
        uploadHeaders: z
          .object({ 'X-Postiz-Upload-Ticket': z.string() })
          .optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const request = readRequestContext(context);
          const org = JSON.parse(request.get('organization') as string);
          if (!org?.id) return { error: 'Organization context is required.' };
          const profileId = request.get('profileId') as string | undefined;
          const backend =
            process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL ||
            process.env.NEXT_PUBLIC_BACKEND_URL ||
            '';
          const url = new URL(
            `${backend.replace(/\/+$/, '')}/media-widget/upload`
          );
          if (!['https:', 'http:'].includes(url.protocol)) {
            return {
              error: 'The public backend URL is not configured correctly.',
            };
          }
          const sessionId = await this._mediaService.createUploadSession(
            org.id,
            profileId
          );
          const ticket = await this._mediaService.createUploadTicket(
            org.id,
            sessionId,
            profileId
          );
          return {
            sessionId,
            uploadUrl: url.toString(),
            uploadHeaders: { 'X-Postiz-Upload-Ticket': ticket },
          };
        } catch {
          return {
            error:
              'Could not create an upload link. Check the backend configuration and try again.',
          };
        }
      },
    });
  }
}
