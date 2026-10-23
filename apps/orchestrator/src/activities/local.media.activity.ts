import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
@Injectable()
@Activity()
export class LocalMediaActivity {
  constructor(private media: MediaService) {}
  @ActivityMethod() async prepareLocalMediaV1(mediaId: string) {
    await this.media.prepareLocalMedia(mediaId);
  }
  @ActivityMethod() async failLocalMediaV1(mediaId: string) {
    await this.media.failProcessing(
      mediaId,
      'Local MOV preparation failed. The original file was preserved.'
    );
  }
}
