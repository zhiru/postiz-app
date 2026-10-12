import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service';
import { GetSocialCommentsDto } from '@gitroom/nestjs-libraries/dtos/comments/get.social.comments.dto';
import { ReplySocialCommentDto } from '@gitroom/nestjs-libraries/dtos/comments/reply.social.comment.dto';
import { AutoReplyCommentsDto } from '@gitroom/nestjs-libraries/dtos/comments/auto.reply.comments.dto';

@ApiTags('Social Comments')
@Controller('/social-comments')
export class SocialCommentsController {
  constructor(private _socialCommentsService: SocialCommentsService) {}

  @Get('/')
  async getComments(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetSocialCommentsDto
  ) {
    return this._socialCommentsService.getComments(org.id, query);
  }

  @Get('/auto-reply')
  async getAutoReply(@GetOrgFromRequest() org: Organization) {
    return { autoReplyComments: await this._socialCommentsService.getAutoReply(org.id) };
  }

  @Post('/auto-reply')
  async setAutoReply(
    @GetOrgFromRequest() org: Organization,
    @Body() body: AutoReplyCommentsDto
  ) {
    await this._socialCommentsService.setAutoReply(
      org.id,
      body.autoReplyComments
    );

    return { autoReplyComments: body.autoReplyComments };
  }

  @Get('/:id')
  async getComment(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    const comment = await this._socialCommentsService.getComment(org.id, id);
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    return comment;
  }

  // A reply typed or approved by a person in the UI, so it goes out right away.
  @Post('/:id/reply')
  async reply(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: ReplySocialCommentDto
  ) {
    return this._socialCommentsService.reply(org.id, id, body.message, 'human');
  }
}
