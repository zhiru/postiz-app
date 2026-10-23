import {
  UseFilters,
  Controller,
  Header,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  MediaTransferInterceptor,
  MediaTransferExceptionFilter,
  MediaTransferRequest,
} from '@gitroom/nestjs-libraries/upload/media.transfer.interceptor';

@ApiTags('Media')
@Controller('/media-transfer')
@UseFilters(MediaTransferExceptionFilter)
export class MediaTransferController {
  @Post('/:uploadId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Transfer one file using its short-lived upload ticket',
    description:
      'Prepare through authenticated MCP first. The ticket is scoped to one upload manifest and expires after 10 minutes. POST exactly one multipart file field with the prepared filename. MIME magic bytes, size and SHA-256 must match. Replays return the same media; pending/unknown results must be checked with completeMediaUpload. This route never publishes.',
  })
  @ApiHeader({
    name: 'X-Postiz-Upload-Ticket',
    required: true,
    description:
      'Temporary upload-only credential. Never put it in a URL or logs.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'Upload status: ready, processing, failed or unknown; not proof of publication.',
  })
  @ApiResponse({
    status: 401,
    description: 'Ticket missing, expired or invalid.',
  })
  @ApiResponse({
    status: 409,
    description: 'Upload already in progress. Consult completeMediaUpload.',
  })
  @UseInterceptors(MediaTransferInterceptor)
  upload(@Req() request: MediaTransferRequest) {
    return request.mediaTransferResult;
  }
}
