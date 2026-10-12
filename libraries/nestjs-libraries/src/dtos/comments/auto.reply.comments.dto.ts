import { IsBoolean, IsDefined } from 'class-validator';

export class AutoReplyCommentsDto {
  @IsBoolean()
  @IsDefined()
  autoReplyComments: boolean;
}
