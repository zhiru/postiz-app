import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service';

// An activity on main can never change its parameters, so this one takes a
// single object: a new knob can be added to it without a new activity
@Injectable()
@Activity()
export class CommentsActivity {
  constructor(private _socialCommentsService: SocialCommentsService) {}

  @ActivityMethod()
  async pollComments({ sinceDays }: { sinceDays: number }) {
    return this._socialCommentsService.pollComments(sinceDays);
  }
}
