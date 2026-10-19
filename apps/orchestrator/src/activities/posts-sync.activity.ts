import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { PostsSyncService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts-sync.service';

@Injectable()
@Activity()
export class PostsSyncActivity {
  constructor(private sync: PostsSyncService) {}

  @ActivityMethod()
  async requestExternalPostsSync() {
    for (const channel of await this.sync.eligible()) {
      await this.sync.request(channel.organizationId, channel.id);
    }
  }

  @ActivityMethod()
  prepareExternalPostsSync(organizationId: string, id: string) {
    return this.sync.prepare(organizationId, id);
  }

  @ActivityMethod()
  async syncExternalPostsPage(
    organizationId: string,
    id: string,
    full: boolean,
    cursor?: string
  ) {
    try {
      return await this.sync.page(organizationId, id, full, cursor);
    } catch {
      // Provider exceptions may contain OAuth tokens or signed media URLs.
      throw new Error(
        'Could not synchronize this channel. Check the connection and retry.'
      );
    }
  }

  @ActivityMethod()
  finishExternalPostsSync(organizationId: string, id: string, full: boolean) {
    return this.sync.finish(organizationId, id, full);
  }

  @ActivityMethod()
  failExternalPostsSync(organizationId: string, id: string) {
    return this.sync.failed(organizationId, id);
  }
}
