import { HttpException, Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentToolInterface } from '../agent.tool.interface';
import { checkAuth } from '../auth.context';
import { readRequestContext } from './tool.context.helper';
import { MediaTransferService } from '@gitroom/nestjs-libraries/database/prisma/media/media.transfer.service';
import {
  uploadMediaSchema,
  prepareMediaUploadSchema,
  completeMediaUploadSchema,
  PreparedMediaTransfer,
} from '@gitroom/nestjs-libraries/dtos/media/media.transfer.dto';

const mediaTransferOutputSchema = z.object({
  uploadId: z.string().optional(),
  status: z
    .enum([
      'awaiting_upload',
      'uploading',
      'processing',
      'ready',
      'failed',
      'unknown',
    ])
    .optional(),
  progress: z.number().min(0).max(100).nullable().optional(),
  id: z.string().optional(),
  path: z.string().optional(),
  originalPath: z.string().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  uploadUrl: z.string().url().optional(),
  method: z.literal('POST').optional(),
  uploadHeaders: z.object({ 'X-Postiz-Upload-Ticket': z.string() }).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

const publicErrorMessages: Record<string, string> = {
  INVALID_UPLOAD_INPUT:
    'Invalid upload parameters. Check the filename, MIME type, size, hash and idempotency key.',
  UPLOAD_IDEMPOTENCY_CONFLICT:
    'This idempotency key was already used with different upload parameters. Reuse the original parameters.',
  UPLOAD_IN_PROGRESS:
    'This upload is still in progress. Check completeMediaUpload with the same uploadId before retrying.',
  UPLOAD_RESULT_UNKNOWN:
    'The upload result is not confirmed. Check completeMediaUpload with the same uploadId; do not create another upload.',
  UPLOAD_NOT_FOUND:
    'Upload not found in the authenticated organization and profile.',
  UPLOAD_TICKET_INVALID:
    'The upload ticket is invalid or expired. Check the existing upload before requesting new upload instructions.',
  UPLOAD_INTEGRITY_MISMATCH:
    'The uploaded bytes do not match the declared size, hash or media type.',
  UPLOAD_FAILED:
    'The upload could not be completed. Check its status before retrying.',
  UPLOAD_UNAVAILABLE:
    'Media upload is temporarily unavailable. Retry with the same idempotency key.',
  UPLOAD_URL_NOT_CONFIGURED:
    'The upload URL is not configured correctly on this instance.',
};

function transferError(error: unknown) {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      'code' in response
    ) {
      const code = (response as { code?: unknown }).code;
      if (
        typeof code === 'string' &&
        Object.prototype.hasOwnProperty.call(publicErrorMessages, code)
      ) {
        return { error: { code, message: publicErrorMessages[code] } };
      }
    }
  }
  return {
    error: {
      code: 'UPLOAD_OPERATION_FAILED',
      message:
        'Could not complete the upload operation. Check the existing upload before retrying with the same idempotency key.',
    },
  };
}

function transferTool<Schema extends z.ZodTypeAny>(
  name: string,
  description: string,
  inputSchema: Schema,
  execute: (
    org: string,
    profile: string | undefined,
    input: z.infer<Schema>
  ) => Promise<PreparedMediaTransfer>
) {
  return createTool({
    id: name,
    description,
    mcp: {
      annotations: {
        title: name,
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    inputSchema,
    outputSchema: mediaTransferOutputSchema,
    execute: async (input, context) => {
      checkAuth(input, context);
      const request = readRequestContext(context);
      let organizationId: string;
      try {
        const organization = JSON.parse(request.get('organization') as string);
        if (typeof organization?.id !== 'string' || !organization.id)
          throw new Error();
        organizationId = organization.id;
      } catch {
        return {
          error: {
            code: 'AUTH_CONTEXT_REQUIRED',
            message: 'Authenticated organization context is required.',
          },
        };
      }
      try {
        return await execute(
          organizationId,
          request.get('profileId') as string | undefined,
          input
        );
      } catch (error) {
        return transferError(error);
      }
    },
  });
}

@Injectable()
export class UploadMediaTool implements AgentToolInterface {
  constructor(private readonly media: MediaTransferService) {}
  name = 'uploadMediaTool';
  mcpOnly = true;
  run() {
    return transferTool(
      this.name,
      'Upload actual image/video bytes supplied by the client as base64, without a public source URL. filename is a basename, never a server filesystem path; mimeType must match the bytes. The service allows at most 6 MiB of base64 characters (about 4.5 MiB decoded); this is a server limit, not a guaranteed ChatGPT/MCP client limit. Do not invent bytes or assume an attachment/file ID is base64. If the client cannot provide bytes, use an upload-capable client or the existing uploadWidgetTool. For larger files use prepareMediaUpload and its private multipart upload instructions. Reuse idempotencyKey and identical input on retries to avoid duplicates. adjust=true requests compatible media preparation, retaining the original. Returns uploadId/status/progress; call completeMediaUpload to confirm processing. Only attach returned media id/path when status is ready; uploading/processing/unknown never means ready or published.',
      uploadMediaSchema,
      (org, profile, input) => this.media.upload(org, profile, input)
    );
  }
}

@Injectable()
export class PrepareMediaUploadTool implements AgentToolInterface {
  constructor(private readonly media: MediaTransferService) {}
  name = 'prepareMediaUpload';
  mcpOnly = true;
  run() {
    return transferTool(
      this.name,
      'Prepare an idempotent private upload of a local image/video without base64 or a public source URL. Supply the actual basename, MIME type, byte size and SHA-256 of the file. Service limits: images 10 MiB, videos 1 GiB; client limits/capabilities may differ. Requires a client that can read the file and send an HTTP multipart request; a ChatGPT attachment alone does not imply these capabilities. POST the file in multipart field file to uploadUrl with the exact uploadHeaders returned. The server verifies size, hash and media type. Treat the short-lived upload headers as secrets: never log, publish or place them in a query string. Reuse the same idempotencyKey and manifest on retries, including after a timeout. After the upload request completes, call completeMediaUpload with uploadId; await ready before attaching media. This operation never creates or publishes posts. Existing uploadWidgetTool remains available for interactive uploads.',
      prepareMediaUploadSchema,
      (org, profile, input) => this.media.prepare(org, profile, input)
    );
  }
}

@Injectable()
export class CompleteMediaUploadTool implements AgentToolInterface {
  constructor(private readonly media: MediaTransferService) {}
  name = 'completeMediaUpload';
  mcpOnly = true;
  run() {
    return transferTool(
      this.name,
      'Confirm the latest result of the uploadId returned by uploadMediaTool or prepareMediaUpload, scoped to the authenticated organization/profile. Call after sending the multipart file, or poll the same uploadId while uploading/processing. Returns status, progress (null when indeterminate), media id/path/originalPath and sanitized error when available. awaiting_upload means bytes have not arrived; uploading/processing are not ready; unknown requires reconciliation rather than a new upload key. Only ready media may be attached to a post. This operation never creates, schedules or publishes a post and does not duplicate a completed transfer.',
      completeMediaUploadSchema,
      (org, profile, input) => this.media.complete(org, profile, input.uploadId)
    );
  }
}
