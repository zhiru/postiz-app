'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { NeuralTalkDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/neuraltalk.dto';
import { NeuralTalkDestinations } from './neuraltalk.destinations';

export default withProvider({
  postComment: PostComment.POST,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: NeuralTalkDestinations,
  dto: NeuralTalkDto,
  defaults: { targets: [] },
  maximumCharacters: 4096,
});
